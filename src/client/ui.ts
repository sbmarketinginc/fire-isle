// HTML overlay: player chips, status, actions, hand, dialogs, hot-seat curtain, log.
import {
  CAVE, CARD_INFO, CARD_TIMING, FIREBALL, PIT, ROUTE, SPACE, TRAIL_NAMES, availableRoutesForView, cardText, cardTitle,
  eligibilityForView, isReactiveWindow, isWindowPhase,
} from '../engine/index.ts';
import type { Action, Card, GameView, LogEvent, PlayerId } from '../engine/index.ts';
import type { Board3D } from './three/board3d.ts';
import type { Session } from './session.ts';
import { musicEnabled, setMusicEnabled, setSoundEnabled, soundEnabled } from './audio.ts';
import { CAVE_PREFIX } from '../engine/paths.ts';

export interface UIOptions {
  root: HTMLElement;
  board: Board3D;
  session: Session;
  onLeave: () => void;
}

function el(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function describeLoc(view: GameView, pid: PlayerId): string {
  const loc = view.players[pid].loc;
  if (loc.kind === 'space') {
    const s = SPACE[loc.id];
    if (s.special === 'start') return "Dead Man's Plateau";
    if (s.special === 'vulkar') return 'Vul-Kar Point';
    if (s.special === 'dock') return 'the Dock';
    if (s.special === 'witchlordStep') return 'Witchlord Step';
    if (s.special === 'beach') return 'Skeleton Head Beach';
    if (s.bridge) return 'a bridge';
    return TRAIL_NAMES[s.trail];
  }
  if (loc.kind === 'cave') return `Cave ${loc.n}`;
  if (loc.kind === 'pit') return `${PIT[loc.pit].name}${loc.down ? ' (lying down)' : ''}`;
  return 'the water';
}

function pathNotes(view: GameView, path: string[]): string {
  const passed = path.filter((id) => !id.startsWith(CAVE_PREFIX)).slice(0, -1).map((id) => view.players.find((p) => p.loc.kind === 'space' && p.loc.id === id && p.id !== view.me)).filter((p): p is GameView['players'][number] => !!p);
  return passed.length ? `passes ${passed.map((p) => p.name).join(' and ')}` : '';
}

function pathSummary(path: string[]): string {
  const spaces = path.filter((s) => !s.startsWith(CAVE_PREFIX));
  const trails: string[] = [];
  for (const id of spaces) {
    const t = SPACE[id].bridge ? 'bridge' : TRAIL_NAMES[SPACE[id].trail];
    if (trails[trails.length - 1] !== t) trails.push(t);
  }
  const cave = path[path.length - 1].startsWith(CAVE_PREFIX) ? ` into Cave ${path[path.length - 1].slice(CAVE_PREFIX.length)}` : '';
  return `via ${trails.join(' → ')}${cave}`;
}

export class GameUI {
  private root: HTMLElement;
  private board: Board3D;
  private session: Session;
  private onLeave: () => void;
  private top = el('div', 'topbar');
  private bottom = el('div', 'bottom');
  private logEl = el('div', 'log');
  private overlayEl: HTMLElement | null = null;
  private view: GameView | null = null;
  private busy = false;
  private logOpen = false;
  private labelsOn = false;
  private logSeen = 0;
  private lastActor: PlayerId | null = null;
  /** hot-seat: show a curtain before the first hand is revealed */
  private curtainPending = false;

  requireCurtain() {
    this.curtainPending = true;
  }

  constructor(opts: UIOptions) {
    this.root = opts.root;
    this.board = opts.board;
    this.session = opts.session;
    this.onLeave = opts.onLeave;
    this.root.innerHTML = '';
    this.root.append(this.top, this.bottom, this.logEl);
    this.logEl.style.display = 'none';
    this.board.onPickPath = (path) => this.pickPath(path);
  }

  setBusy(b: boolean) {
    this.busy = b;
    if (this.view) this.render(this.view);
  }

  toast(msg: string) {
    const t = el('div', 'toast', esc(msg));
    this.root.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ---------------------------------------------------------------------------

  render(view: GameView) {
    this.view = view;
    this.renderTop(view);
    this.renderLog(view.log);
    this.board.clearChoices();
    if (view.phase === 'gameOver') {
      this.renderBottom(view, null);
      this.showGameOver(view);
      return;
    }
    // hot-seat: make sure the device is with the player who has to act
    if (this.session.kind === 'local' && !this.busy) {
      if (this.curtainPending) {
        this.curtainPending = false;
        const first = this.requiredActor(view) ?? view.active;
        this.lastActor = first;
        this.showCurtain(view, first);
        this.renderBottom(view, null, true);
        return;
      }
      const actor = this.requiredActor(view);
      if (actor !== null && actor !== view.me) {
        if (this.lastActor !== actor) {
          this.lastActor = actor;
          this.showCurtain(view, actor);
        }
        this.renderBottom(view, null, true);
        return;
      }
      if (isWindowPhase(view.phase)) {
        const mine = view.me === null ? null : eligibilityForView(view);
        if (mine && mine.canPass && mine.cards.length === 0 && isReactiveWindow(view.phase)) {
          const top = view.cardStack[view.cardStack.length - 1];
          const ownCardResponse = view.phase === 'cardResponse' && top?.player === view.me;
          if (view.myHand.length === 0 || ownCardResponse) {
            // nothing hidden to protect (no cards, or answering one's own card): pass quietly
            this.renderBottom(view, null, true);
            void this.session.submit({ type: 'PASS' }, view.me as PlayerId);
            return;
          }
          // holding cards but none apply: show the same one-tap screen a player with an option sees
          this.renderBottom(view, null, true);
          this.showNothingToPlay(view);
          return;
        }
        let others = this.otherResponders(view);
        // Keep the table moving: the routine "anyone?" prompt only comes before a roll and after a
        // move. After a roll it is asked only when a REROLL is in someone's hand, and the end-of-turn
        // window is skipped (any-time cards get their chance again a moment later, before the next roll).
        if (view.phase === 'postTurn' || (view.phase === 'postRoll' && !others.some((o) => this.guessHand(view, o.pid).some((c) => c.type === 'REROLL')))) {
          for (const o of others) if (o.canPass) void this.session.submit({ type: 'PASS' }, o.pid);
          others = [];
        }
        if ((!mine || !mine.canPass) && others.length > 0) {
          this.renderBottom(view, null, true);
          this.showResponsePrompt(view, others);
          return;
        }
        if ((!mine || !mine.canPass) && others.length === 0 && isReactiveWindow(view.phase)) {
          // everyone else holds no cards at all: pass them on their behalf
          for (const p of view.players) if (p.id !== view.me && !view.window.passed.includes(p.id)) void this.session.submit({ type: 'PASS' }, p.id);
        }
      }
    }
    this.lastActor = view.me;
    const el = view.me === null ? null : eligibilityForView(view);
    this.renderBottom(view, el);
    if (el && !this.busy) {
      if (el.needsMove && view.move) this.board.showChoices(view.move.legal, true);
      if (el.needsMoveBack && view.moveBack) this.board.showChoices(view.moveBack.legal, true);
    }
  }

  /** In hot-seat mode: which seat must act now in a single-actor phase (null in response windows). */
  private requiredActor(view: GameView): PlayerId | null {
    const ph = view.phase;
    if (ph === 'awaitRoll' || ph === 'awaitMove') return view.active;
    if (ph === 'chooseFireball') return view.fireball?.by ?? null;
    if (ph === 'chooseMoveBackPath') return view.moveBack?.by ?? null;
    return null;
  }

  /**
   * Hot-seat: other seats that may still respond in the current window. Every seat that holds
   * cards and has not passed is listed (not only those holding a relevant card), so the prompt
   * never reveals who is holding a TALISMAN, FAKE JEWEL, CANCEL or REROLL.
   */
  private otherResponders(view: GameView): { pid: PlayerId; canPass: boolean }[] {
    const out: { pid: PlayerId; canPass: boolean }[] = [];
    for (const p of view.players) {
      if (p.id === view.me || view.window.passed.includes(p.id)) continue;
      if (p.handCount === 0) {
        // holds no cards at all (public knowledge): pass them silently in reactive windows
        if (isReactiveWindow(view.phase)) void this.session.submit({ type: 'PASS' }, p.id);
        continue;
      }
      const probe = { ...view, me: p.id, myHand: this.guessHand(view, p.id) };
      const e = eligibilityForView(probe);
      out.push({ pid: p.id, canPass: e.canPass });
    }
    return out;
  }

  private showResponsePrompt(view: GameView, others: { pid: PlayerId; canPass: boolean }[]) {
    this.closeOverlay();
    const ov = el('div', 'overlay');
    ov.style.background = 'rgba(6,2,14,0.35)';
    ov.style.alignItems = 'flex-end';
    const d = el('div', 'dialog');
    d.append(el('h2', '', 'Anyone want to play a card?'));
    d.append(el('p', '', esc(this.windowPromptText(view))));
    const row = el('div', 'stack');
    for (const o of others) {
      const p = view.players[o.pid];
      const b = el('button', '', `${esc(p.name)} looks at their cards`) as HTMLButtonElement;
      b.style.borderColor = p.color;
      b.onclick = () => {
        this.closeOverlay();
        this.lastActor = o.pid;
        this.showCurtain(view, o.pid);
      };
      row.append(b);
    }
    const none = el('button', 'primary', 'Nobody — carry on') as HTMLButtonElement;
    none.onclick = async () => {
      this.closeOverlay();
      for (const o of others) {
        if (!o.canPass) continue;
        const err = await this.session.submit({ type: 'PASS' }, o.pid);
        if (err && err !== 'nothing to pass') this.toast(err);
      }
    };
    row.append(none);
    d.append(row);
    ov.append(d);
    this.root.append(ov);
    this.overlayEl = ov;
  }

  private showNothingToPlay(view: GameView) {
    this.closeOverlay();
    const ov = el('div', 'overlay');
    ov.style.background = 'rgba(6,2,14,0.35)';
    ov.style.alignItems = 'flex-end';
    const d = el('div', 'dialog');
    d.append(el('h2', '', esc(view.players[view.me!].name)));
    d.append(el('p', '', esc(this.windowPromptText(view))));
    d.append(el('p', 'small', 'None of your cards can be played at this moment.'));
    const b = el('button', 'primary', 'Pass') as HTMLButtonElement;
    b.style.width = '100%';
    b.onclick = () => {
      this.closeOverlay();
      void this.session.submit({ type: 'PASS' }, view.me as PlayerId);
    };
    d.append(b);
    ov.append(d);
    this.root.append(ov);
    this.overlayEl = ov;
  }

  private windowPromptText(view: GameView): string {
    const name = (pid: PlayerId) => view.players[pid].name;
    switch (view.phase) {
      case 'preRoll': return `${name(view.active)} is about to roll. Cards may be played before the roll.`;
      case 'postRoll': return `${name(view.active)} rolled a ${view.lastRoll}. A REROLL could change it.`;
      case 'preFireball': return `${name(view.fireball!.by)} is about to roll a fireball. A MAGIC TALISMAN could stop it.`;
      case 'stealAttempt': return `${name(view.steal!.thief)} is stealing the jewel from ${name(view.steal!.owner)}.`;
      case 'postCaveRoll': return `${name(view.active)} rolled a ${view.lastCaveRoll} for the caves.`;
      case 'postMove': return `${name(view.active)} has finished moving.`;
      case 'postTurn': return `${name(view.active)}'s turn is ending.`;
      case 'cardResponse': return `${name(view.cardStack[view.cardStack.length - 1].player)} played ${cardTitle(view.cardStack[view.cardStack.length - 1].card)}. A CANCEL could stop it.`;
    }
    return '';
  }

  private guessHand(view: GameView, pid: PlayerId): Card[] {
    const s = this.session as unknown as { state?: { players: { hand: Card[] }[] } };
    return s.state ? s.state.players[pid].hand : Array.from({ length: view.players[pid].handCount }, (_, i) => ({ uid: -1 - i, type: 'FIREBALL' as const }));
  }

  private renderTop(view: GameView) {
    this.top.innerHTML = '';
    const chips = el('div', 'chips');
    for (const p of view.players) {
      const c = el('div', `chip${p.id === view.active ? ' active' : ''}`);
      const dot = el('span', 'dot');
      dot.style.background = p.color;
      c.append(dot);
      c.append(el('span', 'name', `${esc(p.name)}${p.id === view.me && this.session.kind === 'net' ? ' (you)' : ''}`));
      c.append(el('span', 'badge loc', esc(describeLoc(view, p.id))));
      c.append(el('span', 'badge', `🂠${p.handCount}`));
      if (p.hasJewel) c.append(el('span', 'badge jewel', '◆ jewel'));
      if (p.hasToken) c.append(el('span', 'badge token', '⬢'));
      if (p.extraTurns > 0) c.append(el('span', 'badge', `+${p.extraTurns}`));
      c.title = describeLoc(view, p.id);
      chips.append(c);
    }
    this.top.append(chips);
    const toggle = (label: string, glyph: string, on: () => boolean, flip: () => void) => {
      const b = el('button', `iconbtn ghost${on() ? '' : ' off'}`, glyph) as HTMLButtonElement;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-pressed', String(on()));
      b.onclick = () => {
        flip();
        b.classList.toggle('off', !on());
        b.setAttribute('aria-pressed', String(on()));
      };
      return b;
    };
    const logBtn = toggle('Game log', '📜', () => this.logOpen, () => {
      this.logOpen = !this.logOpen;
      this.logEl.style.display = this.logOpen ? 'block' : 'none';
    });
    const labelBtn = toggle('Trail names', '🏷', () => this.labelsOn, () => {
      this.labelsOn = !this.labelsOn;
      this.board.labelMesh.visible = this.labelsOn;
    });
    const sndBtn = toggle('Sound effects', '🔊', soundEnabled, () => setSoundEnabled(!soundEnabled()));
    const musicBtn = toggle('Music', '🎵', musicEnabled, () => setMusicEnabled(!musicEnabled()));
    const menuBtn = el('button', 'iconbtn ghost', '☰') as HTMLButtonElement;
    menuBtn.title = 'Game menu';
    menuBtn.setAttribute('aria-label', 'Game menu');
    menuBtn.onclick = () => this.showMenu();
    this.top.append(logBtn, labelBtn, sndBtn, musicBtn, menuBtn);
    // keep the log and toasts below the chips, whatever height the bar takes
    requestAnimationFrame(() => this.root.style.setProperty('--topbar-h', `${this.top.offsetHeight}px`));
  }

  private renderLog(log: LogEvent[]) {
    if (log.length && this.logSeen !== log[log.length - 1].t) {
      this.logEl.innerHTML = log.slice(-40).map((e) => `<div class="${e.player === this.view?.me ? 'me' : ''}">${esc(e.text)}</div>`).join('');
      this.logEl.scrollTop = this.logEl.scrollHeight;
      this.logSeen = log[log.length - 1].t;
    }
  }

  private statusText(view: GameView, e: ReturnType<typeof eligibilityForView> | null): string {
    const active = view.players[view.active];
    const meActive = view.me === view.active;
    const name = (pid: PlayerId) => (pid === view.me ? 'You' : esc(view.players[pid].name));
    const ph = view.phase;
    if (this.busy) return '…';
    if (!e) return `${esc(active.name)}'s turn.`;
    if (isReactiveWindow(ph) && e.canPass && e.cards.length === 0 && this.session.kind === 'net') return 'Waiting for responses…';
    switch (ph) {
      case 'preRoll':
        if (view.forcedSteps) return `<b>${name(view.active)}</b> must move ahead ${view.forcedSteps} instead of rolling. ${e.cards.length ? 'Play a card or pass.' : 'Pass to continue.'}`;
        return meActive ? `<b>Your turn.</b> ${e.cards.length ? 'Play a card now, or continue.' : 'Continue to roll the die.'}` : `<b>${name(view.active)}</b>'s turn is starting. ${e.cards.length ? 'Play a card before the roll, or pass.' : 'Pass.'}`;
      case 'awaitRoll':
        if (!meActive) return `Waiting for <b>${name(view.active)}</b> to roll.`;
        if (active.loc.kind === 'cave') {
          if (!view.cave?.choice) return `<b>You are in Cave ${active.loc.n}.</b> Leave for the trail, or roll for another cave?`;
          return view.cave.choice === 'exit' ? '<b>Roll</b> to move out of the cave onto the trail.' : '<b>Roll</b> to find another cave.';
        }
        if (active.loc.kind === 'pit') return `<b>Roll</b> to climb out of the smolder pit onto the Rock Chip space.`;
        if (active.loc.kind === 'water') return `<b>Roll</b> to climb the 5 spaces of Great Sway Bluff.`;
        return `<b>Roll the die.</b>${e.cards.length ? ' Or play a card first.' : ''}${e.canTradeToken ? ' You may trade your Magic Charm token for a full hand first.' : ''}`;
      case 'postRoll':
        return `<b>${name(view.active)}</b> rolled <span class="dieface">${view.lastRoll}</span>${view.lastRollRaw !== view.lastRoll ? ' (doubled)' : ''}. ${e.cards.length ? 'Play a card or pass.' : 'Pass to continue.'}`;
      case 'awaitMove':
        if (!meActive) return `<b>${name(view.active)}</b> is moving ${view.move?.steps} space${view.move?.steps === 1 ? '' : 's'}.`;
        return `<b>Move ${view.move?.steps} space${view.move?.steps === 1 ? '' : 's'}</b> — tap a highlighted space.`;
      case 'chooseFireball':
        return view.fireball?.by === view.me ? '<b>Roll a Fireball!</b> Choose which fireball to push and which way.' : `<b>${name(view.fireball!.by)}</b> is choosing a fireball.`;
      case 'preFireball': {
        const r = view.fireball?.route ? ROUTE[view.fireball.route] : null;
        const hits = (view.fireball?.hits ?? []).map((h) => name(h)).join(', ');
        return `<b>${name(view.fireball!.by)}</b> aims the ${r ? FIREBALL[r.fireball].name : 'fireball'}: ${r ? esc(r.label) : ''}. ${hits ? `Targets: ${hits}.` : 'No one is in the way.'} ${e.cards.length ? 'Play MAGIC TALISMAN or pass.' : 'Pass.'}`;
      }
      case 'stealAttempt':
        return `<b>${name(view.steal!.thief)}</b> reaches for <b>${name(view.steal!.owner)}</b>'s jewel! ${e.cards.length ? 'Play FAKE JEWEL or pass.' : 'Pass.'}`;
      case 'postCaveRoll':
        return `Cave roll: <span class="dieface">${view.lastCaveRoll}</span>. ${e.cards.length ? 'Play REROLL or pass.' : 'Pass to continue.'}`;
      case 'chooseMoveBackPath':
        if (view.moveBack!.by !== view.me) return `<b>${name(view.moveBack!.by)}</b> is choosing where ${name(view.moveBack!.target)} moves back to.`;
        return `<b>Move ${name(view.moveBack!.target)} back ${view.moveBack!.n}</b> — tap a highlighted space.`;
      case 'postMove':
        return `${meActive ? 'You have' : `${name(view.active)} has`} finished moving. ${e.cards.length ? 'Play a card or pass.' : 'Pass to continue.'}`;
      case 'postTurn':
        return view.skippedTurn && meActive ? 'You stood up in the smolder pit. Your turn is over.' : `End of ${meActive ? 'your' : `${name(view.active)}'s`} turn. ${e.cards.length ? 'Play a card or pass.' : 'Pass to continue.'}`;
      case 'cardResponse': {
        const top = view.cardStack[view.cardStack.length - 1];
        return `<b>${name(top.player)}</b> played <b>${esc(cardTitle(top.card))}</b>. ${e.cards.length ? 'Play CANCEL or pass.' : 'Pass to continue.'}`;
      }
    }
    return '';
  }

  private renderBottom(view: GameView, e: ReturnType<typeof eligibilityForView> | null, hideHand = false) {
    this.bottom.innerHTML = '';
    const controls = el('div', 'controls');
    const gameOver = view.phase === 'gameOver' && view.winner !== undefined;
    const status = el('div', 'status', gameOver ? `<b>${esc(view.players[view.winner!].name)}</b> escaped with the jewel and wins the game!` : hideHand ? `${esc(view.players[view.active].name)}'s turn.` : this.statusText(view, e));
    controls.append(status);
    const actions = el('div', 'actions');
    if (gameOver) {
      const back = el('button', 'primary', 'Back to menu') as HTMLButtonElement;
      back.onclick = () => this.onLeave();
      actions.append(back);
      const again = el('button', '', 'Show result') as HTMLButtonElement;
      again.onclick = () => this.showGameOver(view);
      actions.append(again);
    }
    if (e && !this.busy) {
      const btn = (label: string, cls: string, fn: () => void) => {
        const b = el('button', cls, label) as HTMLButtonElement;
        b.onclick = fn;
        actions.append(b);
      };
      if (e.canDeclareCave) {
        btn('Leave the cave', 'primary', () => this.submit({ type: 'DECLARE_CAVE', choice: 'exit' }));
        btn('Try another cave', '', () => this.submit({ type: 'DECLARE_CAVE', choice: 'newCave' }));
      }
      if (e.canRoll) btn('🎲 Roll', 'primary', () => this.submit({ type: 'ROLL' }));
      if (e.canTradeToken) btn('⬢ Trade token: fill hand to 4', '', () => this.submit({ type: 'TRADE_TOKEN' }));
      if (e.needsFireball) btn('🔥 Aim fireball', 'primary', () => this.showFireballDialog(view));
      if (e.canPass) btn(view.phase === 'preRoll' && view.me === view.active ? 'Continue' : 'Pass', e.cards.length ? '' : 'primary', () => this.submit({ type: 'PASS' }));
      if (e.needsMove || e.needsMoveBack) btn('Overview', 'ghost', () => this.board.overview());
    }
    controls.append(actions);
    this.bottom.append(controls);
    // hand
    const wrap = el('div', 'handwrap');
    const hand = el('div', 'hand');
    let firstPlayable: HTMLElement | null = null;
    if (view.me !== null && !hideHand) {
      for (const c of view.myHand) {
        const playable = !!e && e.cards.includes(c.uid) && !this.busy;
        const card = el('div', `card${playable ? ' playable' : ' dim'}`);
        card.append(el('div', 'art'));
        card.append(el('div', '', esc(cardTitle(c))));
        card.onclick = () => this.cardTapped(view, c, playable);
        hand.append(card);
        if (playable && !firstPlayable) firstPlayable = card;
      }
      if (view.myHand.length === 0) hand.append(el('div', 'small', 'No cards in hand — land on a dark trail space to draw.'));
    }
    wrap.append(hand);
    this.bottom.append(wrap);
    // show a fade only when the hand actually overflows, and bring the first playable card into view
    requestAnimationFrame(() => {
      wrap.classList.toggle('noFade', hand.scrollWidth <= hand.clientWidth + 2);
      firstPlayable?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      hand.addEventListener('scroll', () => wrap.classList.toggle('noFade', hand.scrollLeft + hand.clientWidth >= hand.scrollWidth - 2), { passive: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private async submit(action: Action) {
    const as = this.view?.me ?? undefined;
    const err = await this.session.submit(action, as as PlayerId | undefined);
    if (err) this.toast(err);
  }

  private pickPath(path: string[]) {
    if (!this.view || this.busy) return;
    const v = this.view;
    const el = v.me === null ? null : eligibilityForView(v);
    if (!el) return;
    const alternatives = this.board.choicesFor(path[path.length - 1]);
    const go = (p: string[]) => this.submit(el.needsMoveBack ? { type: 'CHOOSE_MOVE_BACK', path: p } : { type: 'MOVE', path: p });
    if (alternatives.length > 1) {
      this.showChoiceDialog('Which way?', alternatives.map((p) => ({ label: pathSummary(p), sub: pathNotes(v, p), fn: () => go(p) })));
      return;
    }
    go(path);
  }

  private cardTapped(view: GameView, card: Card, playable: boolean) {
    const info = CARD_INFO[card.type];
    if (!playable) {
      this.showDialog(cardTitle(card), `<p>${esc(cardText(card))}</p><p class="small"><b>Not playable at this moment.</b> ${esc(CARD_TIMING[card.type])}</p>`, [{ label: 'Close' }]);
      return;
    }
    const play = (target?: PlayerId) => this.submit({ type: 'PLAY_CARD', uid: card.uid, target });
    if (card.type === 'TAKE_CARD') {
      const opts = view.players.filter((o) => o.id !== view.me && o.handCount > 0 && !(o.hasJewel && o.hasToken));
      this.showChoiceDialog(info.title, opts.map((o) => ({ label: esc(o.name), sub: `${o.handCount} card${o.handCount === 1 ? '' : 's'}`, fn: () => play(o.id) })), cardText(card));
      return;
    }
    let extra = '';
    if (card.type === 'FIREBALL') {
      const routes = availableRoutesForView(view);
      const lines = routes.map((r) => `<li>${esc(FIREBALL[r.route.fireball].name)}: ${esc(r.route.label)} — ${r.hits.length ? `hits ${r.hits.map((h) => (h === view.me ? 'you' : esc(view.players[h].name))).join(', ')}` : 'hits nobody'}</li>`);
      extra = `<p><b>Rolls you could choose right now:</b></p><ul class="small" style="margin:0 0 8px 18px;padding:0">${lines.join('')}</ul><p class="small">${routes.every((r) => r.hits.length > 0) ? 'The fireball must hit a target when it can.' : ''}</p>`;
    }
    if (card.type === 'MOVE_BACK') extra = `<p>${esc(view.players[view.active].name)} will be moved back ${card.n} space${card.n === 1 ? '' : 's'}, and you choose where.</p>`;
    if (card.type === 'MOVE_AHEAD' && view.me !== view.active) extra = `<p>${esc(view.players[view.active].name)} will be forced to move ahead ${card.n} instead of rolling.</p>`;
    this.showDialog(cardTitle(card), `<p>${esc(cardText(card))}</p>${extra}`, [
      { label: 'Play it', primary: true, fn: () => play(card.type === 'MOVE_AHEAD' || card.type === 'MOVE_BACK' ? view.active : undefined) },
      { label: 'Keep it' },
    ]);
  }

  private showFireballDialog(view: GameView) {
    const routes = availableRoutesForView(view);
    const order: Record<string, number> = { V: 0, A: 1, B: 2, C: 3, D: 4 };
    const sorted = routes.slice().sort((a, b) => (b.hits.length > 0 ? 1 : 0) - (a.hits.length > 0 ? 1 : 0) || order[a.route.fireball] - order[b.route.fireball]);
    let lastGroup = '';
    const items = sorted.map((r) => {
      const group = FIREBALL[r.route.fireball].name;
      const header = group !== lastGroup ? group : '';
      lastGroup = group;
      return {
        label: r.route.label.replace(/^Vul-Kar faces [a-z-]+: /, (m) => m.replace('Vul-Kar faces ', 'Face ').replace(': ', ' — ')),
        sub: r.hits.length ? `Hits ${r.hits.map((h) => (h === view.me ? 'you' : view.players[h].name)).join(', ')}` : 'Hits nobody',
        hit: r.hits.length > 0,
        header,
        fn: () => this.submit({ type: 'CHOOSE_FIREBALL', route: r.route.id }),
      };
    });
    const note = routes.every((r) => r.hits.length > 0) ? 'The fireball must hit a target when it can.' : 'No piece can be hit — push any fireball down any trailway.';
    this.showChoiceDialog('Roll a Fireball', items, note, false);
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  private closeOverlay() {
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  showDialog(title: string, html: string, buttons: { label: string; primary?: boolean; danger?: boolean; fn?: () => void }[]) {
    this.closeOverlay();
    const ov = el('div', 'overlay');
    ov.addEventListener('click', (ev) => {
      if (ev.target === ov) this.closeOverlay();
    });
    const d = el('div', 'dialog');
    d.append(el('h2', '', esc(title)));
    d.append(el('div', '', html));
    const row = el('div', 'row');
    for (const b of buttons) {
      const btn = el('button', b.primary ? 'primary' : b.danger ? 'danger' : '', esc(b.label)) as HTMLButtonElement;
      btn.style.flex = '1';
      btn.onclick = () => {
        this.closeOverlay();
        b.fn?.();
      };
      row.append(btn);
    }
    d.append(row);
    ov.append(d);
    this.root.append(ov);
    this.overlayEl = ov;
  }

  showChoiceDialog(title: string, items: { label: string; sub?: string; hit?: boolean; header?: string; fn: () => void }[], note?: string, cancelable = true) {
    this.closeOverlay();
    const ov = el('div', 'overlay');
    const d = el('div', 'dialog');
    d.append(el('h2', '', esc(title)));
    if (note) d.append(el('p', '', esc(note)));
    const list = el('div', 'choice');
    for (const it of items) {
      if (it.header) list.append(el('div', 'groupHead', esc(it.header)));
      const b = el('button', it.hit ? 'hit' : '', `${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}`) as HTMLButtonElement;
      b.onclick = () => {
        this.closeOverlay();
        it.fn();
      };
      list.append(b);
    }
    d.append(list);
    if (cancelable) {
      const cancel = el('button', 'ghost', 'Never mind') as HTMLButtonElement;
      cancel.style.marginTop = '10px';
      cancel.onclick = () => this.closeOverlay();
      d.append(cancel);
      ov.addEventListener('click', (ev) => {
        if (ev.target === ov) this.closeOverlay();
      });
    }
    ov.append(d);
    this.root.append(ov);
    this.overlayEl = ov;
  }

  private showCurtain(view: GameView, actor: PlayerId) {
    this.closeOverlay();
    const p = view.players[actor];
    const ov = el('div', 'overlay');
    const d = el('div', 'dialog curtain');
    const sw = el('div', 'swatch');
    sw.style.background = p.color;
    sw.style.margin = '0 auto';
    sw.style.width = '48px';
    sw.style.height = '48px';
    d.append(sw);
    d.append(el('div', 'big', `Pass the device to ${esc(p.name)}`));
    const why = actor === view.active && (view.phase === 'preRoll' || view.phase === 'awaitRoll' || view.phase === 'awaitMove') ? `It's ${esc(p.name)}'s turn.` : view.phase === 'chooseFireball' ? `${esc(p.name)} must roll a fireball.` : view.phase === 'chooseMoveBackPath' ? `${esc(p.name)} chooses where the piece moves back to.` : `${esc(p.name)} may play a card now.`;
    d.append(el('p', '', why));
    if (view.turn <= 1) {
      const rolloff = view.log.filter((e) => e.type === 'rolloff' || e.type === 'first').map((e) => esc(e.text)).join(' ');
      if (rolloff) d.append(el('p', 'small', `Roll for first player: ${rolloff}`));
    }
    const b = el('button', 'primary', `I'm ${esc(p.name)}`) as HTMLButtonElement;
    b.style.width = '100%';
    b.onclick = () => {
      this.closeOverlay();
      this.session.setViewer(actor);
    };
    d.append(b);
    ov.append(d);
    this.root.append(ov);
    this.overlayEl = ov;
  }

  private showGameOver(view: GameView) {
    if (view.winner === undefined) return;
    const w = view.players[view.winner];
    this.showDialog(`${w.name} wins!`, `<div class="curtain"><div class="big" style="color:${w.color}">${esc(w.name)} escapes with the jewel!</div><p>The jewel of Vul-Kar has left the island. The game is over.</p></div>`, [
      { label: 'Back to menu', primary: true, fn: () => this.onLeave() },
      { label: 'Look at the board' },
    ]);
  }

  private showMenu() {
    const v = this.view;
    const code = (this.session as unknown as { code?: string }).code;
    this.showDialog('Game menu', `<p>${code ? `Game code: <b>${esc(code)}</b><br/>` : ''}Turn ${v?.turn ?? 0}.</p>`, [
      { label: 'Keep playing', primary: true },
      { label: 'How to play', fn: () => showRules(this) },
      { label: 'Leave game', danger: true, fn: () => this.showDialog('Leave the game?', '<p>This abandons the game on this device; there is no save.</p>', [{ label: 'Keep playing', primary: true }, { label: 'Leave', danger: true, fn: () => this.onLeave() }]) },
    ]);
  }
}

export function rulesHtml(): string {
  return `<div class="rules">
  <p><b>Object:</b> capture the jewel from the idol Vul-Kar and be first to reach the Dock with it.</p>
  <h3>Your turn</h3>
  <p>Roll the die and move that many spaces along the trails in any direction, never onto the same space twice in one move. If you land on an occupied space, move on to the next open one. Roll a <b>1</b> and you don't move: you must roll a Fireball instead.</p>
  <h3>Special spaces</h3>
  <p><b>Dark trail spaces:</b> landing on one draws a card (4-card hand limit). <b>Witchlord Step:</b> land on or pass it to take a Magic Charm token from the Ruin (once per game); trade it on your turn for a full hand of 4 cards. <b>Bridges</b> count as a space; you must stop on an empty bridge and may cross an occupied one. <b>Caves:</b> step into a cave (it counts as a space) and roll again to pop out of the cave with that number; Cave 4 is a dead end. Next turn, declare whether you leave for the trail or roll for another cave. <b>Vul-Kar Point:</b> reaching it (no exact count) captures the jewel.</p>
  <h3>Fireballs</h3>
  <p>Push one of the 5 fireballs down a trailway toward your targets (Vul-Kar can be turned). If the fireball can hit someone, it must. Pieces it touches go to the smolder pit for that trail: lie down and lose the next turn, then roll out onto the Rock Chip space. Pieces knocked off a bridge land in the water and must climb the 5 spaces of Great Sway Bluff. A fireballed jewel owner drops the jewel on the Rock Chip space (or on the bridge) for the next passer-by.</p>
  <h3>The jewel</h3>
  <p>Capturing it gives a full hand, a free Fireball and 3 turns in a row. Pass the owner on a trail or bridge to steal it. Fit the jewel into your token and nobody can take a card from you.</p>
  <h3>Cards</h3>
  <p>Cards may be played during anyone's turn as their text allows. CANCEL cancels the last card played (even a CANCEL), but a FIREBALL! can never be canceled. Reach the Dock with the jewel to win.</p>
</div>`;
}

export function showRules(ui: GameUI) {
  ui.showDialog('How to play', rulesHtml(), [{ label: 'Close', primary: true }]);
}

export { CAVE, cardTitle };
