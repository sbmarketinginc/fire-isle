import './styles.css';
import { PLAYER_COLORS, PLAYER_COLOR_NAMES } from '../engine/index.ts';
import type { GameView, LogEvent, PlayerId } from '../engine/index.ts';
import { musicEnabled, musicPlaying, setMusicEnabled, startMusic, unlockAudio } from './audio.ts';
import { LocalSession, NetSession, defaultServerUrl } from './session.ts';
import type { LobbyInfo, Session } from './session.ts';
import { Board3D } from './three/board3d.ts';
import { SceneApp } from './three/scene.ts';
import { GameUI, rulesHtml } from './ui.ts';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

function el(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

let app: SceneApp;
let board: Board3D;
let session: Session | null = null;
let ui: GameUI | null = null;
let queue: Promise<void> = Promise.resolve();

function overlay(html: string): HTMLElement {
  const ov = el('div', 'overlay');
  const d = el('div', 'dialog');
  d.innerHTML = html;
  ov.append(d);
  uiRoot.append(ov);
  return ov;
}

function showMenu() {
  uiRoot.innerHTML = '';
  app.overview();
  board.clearChoices();
  const ov = overlay(`
    <h1>FIRE ISLE</h1>
    <p>The dimensional adventure of pitfalls and perils. Capture the jewel of Vul-Kar, dodge the fireballs, and be first to the Dock.</p>
    <div class="stack">
      <button class="primary" id="btnLocal">Pass &amp; Play (2–4 players, one device)</button>
      <button id="btnOnline">Play Online</button>
      <button class="ghost" id="btnRules">How to Play</button>
      <button class="ghost" id="btnMusic">${musicEnabled() ? '🎵 Music: on' : '🎵 Music: off'}</button>
    </div>
    <p class="small" style="margin-top:12px">Drag to orbit the island, pinch to zoom. Works best in landscape.</p>`);
  ov.querySelector('#btnMusic')!.addEventListener('click', (e) => {
    setMusicEnabled(!musicEnabled());
    (e.currentTarget as HTMLButtonElement).textContent = musicEnabled() ? '🎵 Music: on' : '🎵 Music: off';
  });
  ov.querySelector('#btnLocal')!.addEventListener('click', () => {
    unlockAudio();
    startMusic();
    ov.remove();
    showLocalSetup();
  });
  ov.querySelector('#btnOnline')!.addEventListener('click', () => {
    unlockAudio();
    startMusic();
    ov.remove();
    showOnlineSetup();
  });
  ov.querySelector('#btnRules')!.addEventListener('click', () => {
    const r = overlay(`<h2>How to play</h2>${rulesHtml()}<div class="row"><button class="primary" style="flex:1">Close</button></div>`);
    r.querySelector('button')!.addEventListener('click', () => r.remove());
  });
}

function showLocalSetup() {
  let count = 2;
  const ov = overlay('');
  const d = ov.querySelector('.dialog') as HTMLElement;
  const render = () => {
    d.innerHTML = `<h2>Pass &amp; Play</h2><p>Each player takes the device on their turn. Hands stay hidden behind a curtain.</p>`;
    const rows = el('div', 'stack');
    for (let i = 0; i < count; i++) {
      const row = el('div', 'playerRow');
      const sw = el('div', 'swatch');
      sw.style.background = PLAYER_COLORS[i];
      const input = el('input') as HTMLInputElement;
      input.placeholder = `${PLAYER_COLOR_NAMES[i]} explorer`;
      input.value = (d.dataset[`name${i}`] as string) || '';
      input.maxLength = 16;
      input.oninput = () => (d.dataset[`name${i}`] = input.value);
      input.className = 'nameInput';
      row.append(sw, input, el('span', 'small', PLAYER_COLOR_NAMES[i]));
      rows.append(row);
    }
    d.append(rows);
    const ctl = el('div', 'row');
    const minus = el('button', 'ghost', '− player') as HTMLButtonElement;
    minus.disabled = count <= 2;
    minus.onclick = () => {
      count--;
      render();
    };
    const plus = el('button', 'ghost', '+ player') as HTMLButtonElement;
    plus.disabled = count >= 4;
    plus.onclick = () => {
      count++;
      render();
    };
    ctl.append(minus, plus);
    d.append(ctl);
    const row = el('div', 'row');
    const back = el('button', '', 'Back') as HTMLButtonElement;
    back.onclick = () => {
      ov.remove();
      showMenu();
    };
    const start = el('button', 'primary', 'Start the adventure') as HTMLButtonElement;
    start.style.flex = '1';
    start.onclick = () => {
      const names = Array.from(d.querySelectorAll<HTMLInputElement>('.nameInput')).map((i, k) => i.value.trim() || `${PLAYER_COLOR_NAMES[k]}`);
      ov.remove();
      startLocal(names);
    };
    row.append(back, start);
    d.append(row);
  };
  render();
}

function startLocal(names: string[]) {
  const s = new LocalSession({ seed: (Math.random() * 2 ** 31) >>> 0, players: names.map((n) => ({ name: n })) });
  attachSession(s);
  s.setViewer(s.state.active);
}

function showOnlineSetup() {
  const ov = overlay(`
    <h2>Play Online</h2>
    <p>Create a game and share the code, or join a friend's game. Everyone needs to reach the same Fire Isle server.</p>
    <input id="name" placeholder="Your name" maxlength="16" />
    <div class="row" style="margin-top:10px"><button class="primary" id="create" style="flex:1">Create game</button></div>
    <div class="row"><input id="code" placeholder="Game code" maxlength="5" style="text-transform:uppercase" /><button id="join">Join</button></div>
    <div class="row"><button class="ghost" id="back" style="flex:1">Back</button></div>
    <p class="small" id="err"></p>`);
  const name = ov.querySelector('#name') as HTMLInputElement;
  try {
    name.value = localStorage.getItem('fireisle.name') || '';
  } catch { /* ignore */ }
  const err = ov.querySelector('#err') as HTMLElement;
  const connect = async () => {
    const url = defaultServerUrl();
    if (!url) {
      err.textContent = 'Online play is not available on this static site yet — use Pass & Play here, or host the Fire Isle server (see README).';
      return null;
    }
    const net = new NetSession(url);
    net.onError = (m) => (err.textContent = m);
    try {
      await net.connect();
    } catch (e) {
      err.textContent = (e as Error).message + ' — start it with "npm run server".';
      return null;
    }
    try {
      localStorage.setItem('fireisle.name', name.value.trim());
    } catch { /* ignore */ }
    return net;
  };
  ov.querySelector('#create')!.addEventListener('click', async () => {
    const net = await connect();
    if (!net) return;
    net.create(name.value.trim() || 'Host');
    ov.remove();
    showLobby(net);
  });
  ov.querySelector('#join')!.addEventListener('click', async () => {
    const code = (ov.querySelector('#code') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length < 4) {
      err.textContent = 'Enter the 5-letter game code.';
      return;
    }
    const net = await connect();
    if (!net) return;
    net.join(code, name.value.trim() || 'Explorer');
    ov.remove();
    showLobby(net);
  });
  ov.querySelector('#back')!.addEventListener('click', () => {
    ov.remove();
    showMenu();
  });
}

function showLobby(net: NetSession) {
  const ov = overlay('<h2>Lobby</h2><p>Connecting…</p>');
  const d = ov.querySelector('.dialog') as HTMLElement;
  let started = false;
  const render = (lobby: LobbyInfo) => {
    if (started) return;
    d.innerHTML = `<h2>Game code: ${esc(lobby.code)}</h2><p>Share this code. The host starts the game when 2–4 explorers are in.</p>`;
    const list = el('div', 'list');
    for (const p of lobby.players) {
      const it = el('div', 'item');
      const sw = el('div', 'swatch');
      sw.style.background = PLAYER_COLORS[p.seat];
      it.append(sw, el('span', '', `${esc(p.name)}${p.seat === net.seat ? ' (you)' : ''}${p.seat === lobby.hostSeat ? ' · host' : ''}`), el('span', 'spacer'), el('span', 'small', p.connected ? 'online' : 'away'));
      list.append(it);
    }
    d.append(list);
    const row = el('div', 'row');
    const leave = el('button', '', 'Leave') as HTMLButtonElement;
    leave.onclick = () => {
      net.leave();
      ov.remove();
      showMenu();
    };
    row.append(leave);
    if (net.seat === lobby.hostSeat) {
      const start = el('button', 'primary', 'Start game') as HTMLButtonElement;
      start.style.flex = '1';
      start.disabled = lobby.players.length < 2;
      start.onclick = () => net.start();
      row.append(start);
    } else {
      row.append(el('span', 'small', 'Waiting for the host to start…'));
    }
    d.append(row);
  };
  net.onLobby(render);
  if (net.lobby) render(net.lobby);
  net.onError = (m) => {
    d.innerHTML = `<h2>Could not join</h2><p>${esc(m)}</p>`;
    const b = el('button', 'primary', 'Back') as HTMLButtonElement;
    b.onclick = () => {
      net.leave();
      ov.remove();
      showMenu();
    };
    d.append(b);
  };
  const off = net.onUpdate(() => {
    if (started) return;
    started = true;
    off();
    ov.remove();
    attachSession(net);
  });
}

function attachSession(s: Session) {
  session?.leave();
  session = s;
  uiRoot.innerHTML = '';
  ui = new GameUI({
    root: uiRoot,
    board,
    session: s,
    onLeave: () => {
      s.leave();
      session = null;
      ui = null;
      showMenu();
    },
  });
  const handle = (view: GameView, events: LogEvent[]) => {
    queue = queue.then(async () => {
      if (!ui) return;
      const animated = events.filter((e) => ['roll', 'caveRoll', 'move', 'movedBack', 'fireball', 'fireballed', 'caveMove', 'caveEnter', 'capture', 'stolen', 'jewelPicked', 'cardPlayed', 'win'].includes(e.type));
      if (animated.length) {
        ui.setBusy(true);
        for (const e of events) if (['capture', 'stolen', 'fireballed', 'jewelDropped', 'token', 'cardCanceled', 'fireballStopped', 'stealFailed', 'caveBlocked', 'win'].includes(e.type)) ui.toast(e.text);
        await board.playEvents(events, view, s.kind === 'local' && events.length > 12);
        ui.setBusy(false);
      } else {
        board.setView(view);
      }
      ui.render(view);
    });
  };
  s.onUpdate(handle);
  if (s.view) {
    board.setView(s.view);
    ui.render(s.view);
    const acting = s.view.players[s.view.active];
    if (acting.loc.kind === 'space') app.focusOn(board.spacePoint(acting.loc.id), 12);
  }
  if (s.kind === 'net') {
    (s as NetSession).onClose = () => ui?.toast('Connection lost — reconnecting…');
    (s as NetSession).onReconnected = () => ui?.toast('Reconnected.');
  }
}

async function tryRejoin(): Promise<boolean> {
  let saved: { code: string; token: string } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem('fireisle.session') || 'null');
  } catch { /* ignore */ }
  if (!saved) return false;
  const net = new NetSession(defaultServerUrl());
  try {
    await net.connect();
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    let done = false;
    net.onError = () => {
      if (!done) {
        done = true;
        net.leave();
        resolve(false);
      }
    };
    net.onUpdate((view) => {
      if (done) return;
      done = true;
      attachSession(net);
      board.setView(view);
      ui?.render(view);
      resolve(true);
    });
    net.onLobby(() => {
      if (done) return;
      done = true;
      showLobby(net);
      resolve(true);
    });
    net.rejoin(saved!.code, saved!.token);
    setTimeout(() => {
      if (!done) {
        done = true;
        net.leave();
        resolve(false);
      }
    }, 4000);
  });
}

// autoplay policy: the theme can only start after the first tap or click
window.addEventListener('pointerdown', () => startMusic(), { once: true });

async function boot() {
  const loading = overlay('<h1>FIRE ISLE</h1><p>Raising the island from the sea…</p>');
  await new Promise((r) => setTimeout(r, 30));
  app = new SceneApp(canvas);
  board = new Board3D(app);
  app.start();
  loading.remove();
  const fresh = new URLSearchParams(location.search).has('fresh');
  if (fresh || !(await tryRejoin())) showMenu();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI).pathname, { scope: new URL('./', document.baseURI).pathname }).catch(() => {});
  }
}

boot();

// expose for debugging and automated tests
(window as unknown as { fireIsle: unknown }).fireIsle = {
  get session() {
    return session;
  },
  get board() {
    return board;
  },
  get musicPlaying() {
    return musicPlaying();
  },
  startLocal,
};
