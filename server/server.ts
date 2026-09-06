// Fire Isle multiplayer server: serves the built client and runs authoritative games over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { applyAction, availableRoutes, createGame, eligibility, isReactiveWindow, isWindowPhase, viewFor } from '../src/engine/index.ts';
import type { Action, GameState, PlayerId } from '../src/engine/index.ts';

const PORT = Number(process.env.PORT ?? 8787);
const WINDOW_TIMEOUT_MS = Number(process.env.WINDOW_TIMEOUT_MS ?? 30000);
/** how long a player may sit on a roll / move / aim before the server acts for them */
const ACTOR_TIMEOUT_MS = Number(process.env.ACTOR_TIMEOUT_MS ?? 90000);
/** uniform delay before players with nothing to play are passed in a reactive window (hides who holds what) */
const AUTO_PASS_DELAY_MS = Number(process.env.AUTO_PASS_DELAY_MS ?? 2500);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');

interface Seat {
  seat: PlayerId;
  name: string;
  token: string;
  ws: WebSocket | null;
}

interface Room {
  code: string;
  seats: Seat[];
  state: GameState | null;
  hostToken: string;
  timer: NodeJS.Timeout | null;
  autoPassTimer: NodeJS.Timeout | null;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(code) ? randomCode() : code;
}

function randomToken(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

function send(ws: WebSocket | null, msg: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function lobbyInfo(room: Room) {
  return {
    code: room.code,
    players: room.seats.map((s) => ({ seat: s.seat, name: s.name, connected: !!s.ws && s.ws.readyState === WebSocket.OPEN })),
    hostSeat: room.seats.find((s) => s.token === room.hostToken)?.seat ?? 0,
    started: !!room.state,
  };
}

function broadcastLobby(room: Room) {
  const info = lobbyInfo(room);
  for (const s of room.seats) send(s.ws, { type: 'lobby', lobby: info });
}

function broadcastState(room: Room, events: unknown[]) {
  if (!room.state) return;
  for (const s of room.seats) send(s.ws, { type: 'state', view: viewFor(room.state, s.seat), events });
  armTimer(room);
}

/** Default action for a player who is not responding in a single-actor phase. */
function defaultAction(state: GameState): { pid: PlayerId; action: Action } | null {
  const active = state.active;
  switch (state.phase) {
    case 'awaitRoll': {
      const el = eligibility(state, active);
      if (el.canDeclareCave) return { pid: active, action: { type: 'DECLARE_CAVE', choice: 'exit' } };
      if (el.canRoll) return { pid: active, action: { type: 'ROLL' } };
      return null;
    }
    case 'awaitMove':
      return state.move ? { pid: active, action: { type: 'MOVE', path: state.move.legal[0] } } : null;
    case 'chooseFireball': {
      if (!state.fireball) return null;
      const routes = availableRoutes(state);
      const pick = routes.find((r) => !r.hits.includes(state.fireball!.by)) ?? routes[0];
      return { pid: state.fireball.by, action: { type: 'CHOOSE_FIREBALL', route: pick.route.id } };
    }
    case 'chooseMoveBackPath':
      return state.moveBack ? { pid: state.moveBack.by, action: { type: 'CHOOSE_MOVE_BACK', path: state.moveBack.legal[0] } } : null;
  }
  return null;
}

/** In reactive windows, pass players who hold nothing playable after the same delay every time. */
function armAutoPass(room: Room) {
  if (room.autoPassTimer) clearTimeout(room.autoPassTimer);
  room.autoPassTimer = null;
  const st = room.state;
  if (!st || !isReactiveWindow(st.phase)) return;
  room.autoPassTimer = setTimeout(() => {
    room.autoPassTimer = null;
    let state = room.state;
    if (!state || !isReactiveWindow(state.phase)) return;
    const events: unknown[] = [];
    for (const p of state.players) {
      const el = eligibility(state, p.id);
      if (!el.canPass || el.cards.length > 0) continue;
      const r = applyAction(state, p.id, { type: 'PASS' });
      if (r.ok) {
        state = r.state;
        events.push(...r.events);
      }
      if (!isReactiveWindow(state.phase)) break;
    }
    room.state = state;
    broadcastState(room, events);
  }, AUTO_PASS_DELAY_MS);
}

/** Auto-pass response windows and act for absent players so an online game never stalls. */
function armTimer(room: Room) {
  armAutoPass(room);
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  const st = room.state;
  if (!st || st.phase === 'gameOver') return;
  const windowPhase = isWindowPhase(st.phase);
  room.timer = setTimeout(() => {
    room.timer = null;
    let state = room.state;
    if (!state || state.phase === 'gameOver') return;
    const events: unknown[] = [];
    if (isWindowPhase(state.phase)) {
      for (const p of state.players) {
        if (!eligibility(state, p.id).canPass) continue;
        const r = applyAction(state, p.id, { type: 'PASS' });
        if (r.ok) {
          state = r.state;
          events.push(...r.events);
        }
        if (!isWindowPhase(state.phase)) break;
      }
    } else {
      let guard = 0;
      while (state.phase !== 'gameOver' && !isWindowPhase(state.phase) && guard++ < 4) {
        const d = defaultAction(state);
        if (!d) break;
        const r = applyAction(state, d.pid, d.action);
        if (!r.ok) break;
        state = r.state;
        events.push(...r.events);
      }
    }
    room.state = state;
    broadcastState(room, events);
  }, windowPhase ? WINDOW_TIMEOUT_MS : ACTOR_TIMEOUT_MS);
}

const ACTION_TYPES = new Set(['ROLL', 'DECLARE_CAVE', 'MOVE', 'CHOOSE_FIREBALL', 'PLAY_CARD', 'CHOOSE_MOVE_BACK', 'TRADE_TOKEN', 'PASS']);

/** Shape-check a client action before it reaches the engine. */
function validateAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.type !== 'string' || !ACTION_TYPES.has(a.type)) return null;
  const isPath = (p: unknown) => Array.isArray(p) && p.length > 0 && p.length < 64 && p.every((s) => typeof s === 'string' && s.length < 16);
  const isSeat = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 4);
  switch (a.type) {
    case 'ROLL':
    case 'TRADE_TOKEN':
    case 'PASS':
      return { type: a.type };
    case 'DECLARE_CAVE':
      return a.choice === 'exit' || a.choice === 'newCave' ? { type: 'DECLARE_CAVE', choice: a.choice } : null;
    case 'MOVE':
      return isPath(a.path) ? { type: 'MOVE', path: a.path as string[] } : null;
    case 'CHOOSE_MOVE_BACK':
      return isPath(a.path) ? { type: 'CHOOSE_MOVE_BACK', path: a.path as string[] } : null;
    case 'CHOOSE_FIREBALL':
      return typeof a.route === 'string' && a.route.length < 32 ? { type: 'CHOOSE_FIREBALL', route: a.route } : null;
    case 'PLAY_CARD':
      return Number.isInteger(a.uid) && isSeat(a.target) ? { type: 'PLAY_CARD', uid: a.uid as number, target: a.target as PlayerId | undefined } : null;
  }
  return null;
}

function handleMessage(ws: WebSocket, ctx: { room: Room | null; seat: Seat | null }, raw: string) {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const type = msg.type as string;
  if (type === 'create') {
    const room: Room = { code: randomCode(), seats: [], state: null, hostToken: '', timer: null, autoPassTimer: null, createdAt: Date.now() };
    const seat: Seat = { seat: 0, name: String(msg.name || 'Host').slice(0, 20), token: randomToken(), ws };
    room.hostToken = seat.token;
    room.seats.push(seat);
    rooms.set(room.code, room);
    ctx.room = room;
    ctx.seat = seat;
    send(ws, { type: 'joined', code: room.code, seat: 0, token: seat.token });
    broadcastLobby(room);
    return;
  }
  if (type === 'join') {
    const room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return send(ws, { type: 'error', message: 'No game with that code' });
    if (room.state) return send(ws, { type: 'error', message: 'That game has already started' });
    if (room.seats.length >= 4) return send(ws, { type: 'error', message: 'That game is full' });
    const seat: Seat = { seat: room.seats.length as PlayerId, name: String(msg.name || `Player ${room.seats.length + 1}`).slice(0, 20), token: randomToken(), ws };
    room.seats.push(seat);
    ctx.room = room;
    ctx.seat = seat;
    send(ws, { type: 'joined', code: room.code, seat: seat.seat, token: seat.token });
    broadcastLobby(room);
    return;
  }
  if (type === 'rejoin') {
    const room = rooms.get(String(msg.code || '').toUpperCase());
    const seat = room?.seats.find((s) => s.token === msg.token);
    if (!room || !seat) return send(ws, { type: 'error', message: 'Could not rejoin that game' });
    seat.ws = ws;
    ctx.room = room;
    ctx.seat = seat;
    send(ws, { type: 'joined', code: room.code, seat: seat.seat, token: seat.token });
    broadcastLobby(room);
    if (room.state) send(ws, { type: 'state', view: viewFor(room.state, seat.seat), events: [] });
    return;
  }
  const room = ctx.room;
  const seat = ctx.seat;
  if (!room || !seat) return send(ws, { type: 'error', message: 'Join a game first' });
  if (type === 'start') {
    if (seat.token !== room.hostToken) return send(ws, { type: 'error', message: 'Only the host can start' });
    if (room.seats.length < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
    if (room.state) return;
    const seed = Number(msg.seed) || (Math.floor(Math.random() * 2 ** 31) >>> 0);
    room.state = createGame({ seed, players: room.seats.map((s) => ({ name: s.name })) });
    broadcastLobby(room);
    broadcastState(room, room.state.log.slice());
    return;
  }
  if (type === 'action') {
    if (!room.state) return send(ws, { type: 'ack', id: msg.id, error: 'The game has not started' });
    const action = validateAction(msg.action);
    if (!action) return send(ws, { type: 'ack', id: msg.id, error: 'Malformed action' });
    const r = applyAction(room.state, seat.seat, action);
    send(ws, { type: 'ack', id: msg.id, error: r.ok ? undefined : r.error });
    if (r.ok) {
      room.state = r.state;
      broadcastState(room, r.events);
    }
    return;
  }
  if (type === 'leave') {
    seat.ws = null;
    broadcastLobby(room);
  }
}

// ---------------------------------------------------------------------------
// HTTP: static client + health
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Build the client first: npm run build');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const ctx: { room: Room | null; seat: Seat | null } = { room: null, seat: null };
  ws.on('message', (data) => {
    try {
      handleMessage(ws, ctx, data.toString().slice(0, 20000));
    } catch (err) {
      console.error('message handling failed:', err);
      send(ws, { type: 'error', message: 'The server could not process that message' });
    }
  });
  ws.on('error', (err) => console.error('socket error:', err.message));
  ws.on('close', () => {
    if (ctx.seat && ctx.seat.ws === ws) {
      ctx.seat.ws = null;
      if (ctx.room) broadcastLobby(ctx.room);
    }
  });
});

// drop stale rooms after 12 hours
setInterval(() => {
  const cutoff = Date.now() - 12 * 3600 * 1000;
  for (const [code, room] of rooms) if (room.createdAt < cutoff) rooms.delete(code);
}, 600000).unref();

server.listen(PORT, () => {
  console.log(`Fire Isle server listening on http://localhost:${PORT}  (WebSocket at /ws)`);
});
