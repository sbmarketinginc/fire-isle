// Game sessions: hot-seat on one device, or online through the Fire Isle server.
import { applyAction, createGame, viewFor } from '../engine/index.ts';
import type { Action, GameState, GameView, LogEvent, PlayerId } from '../engine/index.ts';

export type UpdateHandler = (view: GameView, events: LogEvent[]) => void;

export interface Session {
  readonly kind: 'local' | 'net';
  /** seat this device is currently acting/viewing as (null before a seat is assigned) */
  readonly seat: PlayerId | null;
  /** seats controlled on this device */
  readonly localSeats: PlayerId[];
  readonly view: GameView | null;
  submit(action: Action, as?: PlayerId): Promise<string | undefined>;
  onUpdate(cb: UpdateHandler): () => void;
  /** hot-seat: change which seat is looking at the screen */
  setViewer(seat: PlayerId): void;
  leave(): void;
}

// ---------------------------------------------------------------------------
// Local (pass-and-play)
// ---------------------------------------------------------------------------

export class LocalSession implements Session {
  readonly kind = 'local' as const;
  state: GameState;
  seat: PlayerId;
  localSeats: PlayerId[];
  private handlers = new Set<UpdateHandler>();

  constructor(config: { seed: number; players: { name: string; color?: string }[] }) {
    this.state = createGame(config);
    this.localSeats = this.state.players.map((p) => p.id);
    this.seat = this.state.active;
  }

  get view(): GameView {
    return viewFor(this.state, this.seat);
  }

  async submit(action: Action, as?: PlayerId): Promise<string | undefined> {
    const pid = as ?? this.seat;
    const res = applyAction(this.state, pid, action);
    if (!res.ok) return res.error;
    this.state = res.state;
    this.emit(res.events);
    return undefined;
  }

  setViewer(seat: PlayerId) {
    this.seat = seat;
    this.emit([]);
  }

  onUpdate(cb: UpdateHandler) {
    this.handlers.add(cb);
    return () => this.handlers.delete(cb);
  }

  private emit(events: LogEvent[]) {
    const v = this.view;
    for (const h of this.handlers) h(v, events);
  }

  leave() {
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Online
// ---------------------------------------------------------------------------

export interface LobbyInfo {
  code: string;
  players: { seat: number; name: string; connected: boolean }[];
  hostSeat: number;
  started: boolean;
}

export type NetMessage =
  | { type: 'joined'; code: string; seat: PlayerId; token: string }
  | { type: 'lobby'; lobby: LobbyInfo }
  | { type: 'state'; view: GameView; events: LogEvent[] }
  | { type: 'error'; message: string }
  | { type: 'ack'; id: number; error?: string };

export class NetSession implements Session {
  readonly kind = 'net' as const;
  seat: PlayerId | null = null;
  localSeats: PlayerId[] = [];
  view: GameView | null = null;
  lobby: LobbyInfo | null = null;
  code = '';
  token = '';
  private ws: WebSocket | null = null;
  private handlers = new Set<UpdateHandler>();
  private lobbyHandlers = new Set<(l: LobbyInfo) => void>();
  private pending = new Map<number, (err?: string) => void>();
  private nextId = 1;
  private url: string;
  onError: ((msg: string) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  private closedByUser = false;
  private reconnectAttempts = 0;
  onReconnected: (() => void) | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not connect to the game server'));
      ws.onclose = () => {
        this.onClose?.();
        this.scheduleReconnect();
      };
      ws.onmessage = (ev) => this.handle(JSON.parse(ev.data) as NetMessage);
    });
  }

  /** After a dropped connection, reconnect and rejoin the same seat with the saved token. */
  private scheduleReconnect() {
    if (this.closedByUser || !this.code || !this.token) return;
    const delay = Math.min(15000, 1000 * 2 ** this.reconnectAttempts++);
    setTimeout(async () => {
      if (this.closedByUser) return;
      try {
        await this.connect();
        this.reconnectAttempts = 0;
        this.rejoin(this.code, this.token);
        this.onReconnected?.();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private send(msg: Record<string, unknown>) {
    this.ws?.send(JSON.stringify(msg));
  }

  private handle(msg: NetMessage) {
    switch (msg.type) {
      case 'joined':
        this.seat = msg.seat;
        this.localSeats = [msg.seat];
        this.code = msg.code;
        this.token = msg.token;
        try {
          localStorage.setItem('fireisle.session', JSON.stringify({ code: msg.code, token: msg.token, seat: msg.seat }));
        } catch { /* ignore */ }
        break;
      case 'lobby':
        this.lobby = msg.lobby;
        for (const h of this.lobbyHandlers) h(msg.lobby);
        break;
      case 'state':
        this.view = msg.view;
        for (const h of this.handlers) h(msg.view, msg.events);
        break;
      case 'error':
        this.onError?.(msg.message);
        break;
      case 'ack': {
        const cb = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        cb?.(msg.error);
        break;
      }
    }
  }

  create(name: string) {
    this.send({ type: 'create', name });
  }
  join(code: string, name: string) {
    this.send({ type: 'join', code: code.toUpperCase(), name });
  }
  rejoin(code: string, token: string) {
    this.send({ type: 'rejoin', code, token });
  }
  start(seed?: number) {
    this.send({ type: 'start', seed });
  }
  onLobby(cb: (l: LobbyInfo) => void) {
    this.lobbyHandlers.add(cb);
    return () => this.lobbyHandlers.delete(cb);
  }

  submit(action: Action): Promise<string | undefined> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, (err) => resolve(err));
      this.send({ type: 'action', id, action });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve('No answer from the server');
        }
      }, 8000);
    });
  }

  setViewer() { /* online seats are fixed */ }

  onUpdate(cb: UpdateHandler) {
    this.handlers.add(cb);
    return () => this.handlers.delete(cb);
  }

  leave() {
    this.closedByUser = true;
    this.ws?.close();
    this.handlers.clear();
    this.lobbyHandlers.clear();
    try {
      localStorage.removeItem('fireisle.session');
    } catch { /* ignore */ }
  }
}

export function defaultServerUrl(): string {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const configured = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL;
  if (configured) return configured;
  // dev server on 5173 -> game server on 8787
  if (loc.port === '5173') return `${proto}//${loc.hostname}:8787/ws`;
  if (loc.hostname.endsWith('github.io')) return ''; // static hosting: no game server unless VITE_SERVER_URL is set
  return `${proto}//${loc.host}/ws`;
}
