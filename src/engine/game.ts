// Fire Isle rules engine — a faithful implementation of the 1986 Fireball Island rulebook.
import {
  CAVE, FIREBALL, PIT, ROUTE, ROUTES, SPACE, SPACES, TRAIL_NAMES, pitForSpace,
} from './board.ts';
import { HAND_LIMIT, buildDeck, cardTitle } from './cards.ts';
import { CAVE_PREFIX, caveOccupant, legalPaths, occupant, pathEndsInCave } from './paths.ts';
import { pick, rollDie, shuffle } from './rng.ts';
import type {
  Action, ActionResult, Card, CaveNum, FireballRoute, GameState, LogEvent, Phase, PlayerId, PlayerState,
} from './types.ts';

export const PLAYER_COLORS = ['#e0322a', '#2f7fe0', '#f2c21b', '#d34fc2'];
export const PLAYER_COLOR_NAMES = ['Red', 'Blue', 'Yellow', 'Magenta'];

export interface GameConfig {
  seed: number;
  players: { name: string; color?: string }[];
}

const WINDOW_PHASES: Phase[] = ['preRoll', 'postRoll', 'preFireball', 'stealAttempt', 'postCaveRoll', 'postMove', 'postTurn', 'cardResponse'];
export const isWindowPhase = (p: Phase) => WINDOW_PHASES.includes(p);
/**
 * Windows that wait for an explicit pass from every player, even those holding nothing useful.
 * Closing them the instant nobody can respond would reveal that nobody holds a TALISMAN,
 * FAKE JEWEL, CANCEL or REROLL. Hosts auto-pass idle players after a uniform delay instead.
 */
const REACTIVE_WINDOWS: Phase[] = ['preFireball', 'stealAttempt', 'cardResponse', 'postCaveRoll'];
export const isReactiveWindow = (p: Phase) => REACTIVE_WINDOWS.includes(p);
// FIREBALL, TAKE 1 CARD and DOUBLE may be played in every response window except while a fireball
// is already pending or a CANCEL response is open (one card stack and one fireball at a time).
const ANYTIME_PHASES: Phase[] = ['preRoll', 'postRoll', 'postMove', 'postTurn', 'stealAttempt', 'postCaveRoll'];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createGame(config: GameConfig): GameState {
  if (config.players.length < 2 || config.players.length > 4) throw new Error('2 to 4 players');
  let rng = (config.seed >>> 0) || 1;
  const shuffled = shuffle(buildDeck(), rng);
  rng = shuffled.state;
  const players: PlayerState[] = config.players.map((p, i) => ({
    id: i as PlayerId,
    name: p.name || PLAYER_COLOR_NAMES[i],
    color: p.color || PLAYER_COLORS[i],
    hand: [],
    loc: { kind: 'space', id: 'DMP' },
    hasJewel: false,
    hasToken: false,
    tokenCollected: false,
    extraTurns: 0,
    pendingMoveBack: [],
  }));
  const state: GameState = {
    version: 1,
    seed: config.seed,
    rng,
    phase: 'lobby',
    turn: 0,
    active: 0,
    players,
    playerCount: players.length,
    jewel: { kind: 'vulkar' },
    tokensInRuin: 4,
    deck: shuffled.arr,
    discard: [],
    window: { passed: [] },
    cardStack: [],
    doubleNextRoll: false,
    vulkarFacing: 'S',
    log: [],
  };
  const events: LogEvent[] = [];
  // deal one card to each player
  for (const p of players) drawCard(state, p.id, events);
  // roll for first player: highest roller goes first, ties re-roll
  let contenders = players.map((p) => p.id);
  let first: PlayerId = 0;
  for (let guard = 0; guard < 20; guard++) {
    const rolls = contenders.map((id) => {
      const r = rollDie(state.rng);
      state.rng = r.state;
      return { id, v: r.value };
    });
    const max = Math.max(...rolls.map((r) => r.v));
    log(state, events, 'rolloff', rolls.map((r) => `${players[r.id].name} rolled ${r.v}`).join(', '));
    const top = rolls.filter((r) => r.v === max).map((r) => r.id);
    if (top.length === 1) {
      first = top[0];
      break;
    }
    contenders = top;
    first = top[0];
  }
  log(state, events, 'first', `${players[first].name} goes first.`, first);
  state.active = first;
  beginTurn(state, events);
  return state;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(state: GameState, events: LogEvent[], type: string, text: string, player?: PlayerId, data?: Record<string, unknown>) {
  const e: LogEvent = { t: state.log.length, type, text, ...(player !== undefined ? { player } : {}), ...(data ? { data } : {}) };
  state.log.push(e);
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  events.push(e);
}

function drawCard(state: GameState, pid: PlayerId, events: LogEvent[], silent = false): Card | undefined {
  const p = state.players[pid];
  if (p.hand.length >= HAND_LIMIT) return undefined;
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return undefined;
    const s = shuffle(state.discard, state.rng);
    state.rng = s.state;
    state.deck = s.arr;
    state.discard = [];
    log(state, events, 'reshuffle', 'The discard pile is shuffled into a new drawpile.');
  }
  const card = state.deck.shift()!;
  p.hand.push(card);
  if (!silent) log(state, events, 'draw', `${p.name} draws a card.`, pid, { count: p.hand.length });
  return card;
}

function fillHand(state: GameState, pid: PlayerId, events: LogEvent[]) {
  const p = state.players[pid];
  const before = p.hand.length;
  while (p.hand.length < HAND_LIMIT && drawCard(state, pid, events, true)) { /* draw */ }
  if (p.hand.length > before) log(state, events, 'draw', `${p.name} fills their hand to ${p.hand.length} cards.`, pid, { count: p.hand.length });
}

function discardCard(state: GameState, card: Card) {
  state.discard.push(card);
}

function jewelHolder(state: GameState): PlayerId | undefined {
  return state.jewel.kind === 'player' ? state.jewel.player : undefined;
}

function protectedFromTakeCard(p: PlayerState): boolean {
  return p.hasJewel && p.hasToken; // jewel fitted into the token
}

function nextPlayer(state: GameState, from: PlayerId): PlayerId {
  return ((from + 1) % state.playerCount) as PlayerId;
}

function playerLocSpace(p: PlayerState): string | undefined {
  return p.loc.kind === 'space' ? p.loc.id : undefined;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface Eligibility {
  cards: number[]; // uids playable right now
  canPass: boolean;
  canRoll: boolean;
  canDeclareCave: boolean;
  canTradeToken: boolean;
  needsMove: boolean;
  needsFireball: boolean;
  needsMoveBack: boolean;
}

export function eligibility(state: GameState, pid: PlayerId): Eligibility {
  const e: Eligibility = {
    cards: [], canPass: false, canRoll: false, canDeclareCave: false, canTradeToken: false,
    needsMove: false, needsFireball: false, needsMoveBack: false,
  };
  if (state.phase === 'gameOver' || state.phase === 'lobby') return e;
  const p = state.players[pid];
  const active = state.active;
  const isActive = pid === active;
  const ph = state.phase;

  // the Magic Charm token may be traded in on any one of your turns (before rolling or after moving)
  const tradePhases: Phase[] = ['awaitRoll', 'postMove', 'postTurn'];
  e.canTradeToken = isActive && p.hasToken && p.hand.length < HAND_LIMIT && tradePhases.includes(ph);
  if (isWindowPhase(ph)) {
    e.canPass = !state.window.passed.includes(pid);
    if (e.canPass) e.cards = p.hand.filter((c) => cardPlayable(state, pid, c)).map((c) => c.uid);
    if (!e.canPass) e.cards = [];
    return e;
  }
  if (ph === 'awaitRoll' && isActive) {
    if (p.loc.kind === 'cave') {
      e.canDeclareCave = state.cave?.choice === undefined;
      e.canRoll = state.cave?.choice !== undefined;
    } else {
      e.canRoll = true;
    }
    e.cards = p.hand.filter((c) => cardPlayable(state, pid, c)).map((c) => c.uid);
  }
  if (ph === 'awaitMove' && isActive) e.needsMove = true;
  if (ph === 'chooseFireball' && state.fireball?.by === pid) e.needsFireball = true;
  if (ph === 'chooseMoveBackPath' && state.moveBack?.by === pid) e.needsMoveBack = true;
  return e;
}

/** Whether a player has anything they could do in the current window. */
function hasWindowAction(state: GameState, pid: PlayerId): boolean {
  if (state.window.passed.includes(pid)) return false;
  const p = state.players[pid];
  return p.hand.some((c) => cardPlayable(state, pid, c));
}

export function cardPlayable(state: GameState, pid: PlayerId, card: Card): boolean {
  const ph = state.phase;
  const p = state.players[pid];
  const active = state.active;
  const isActive = pid === active;
  if (state.skippedTurn && isActive) return false; // lying in a smolder pit: no cards this turn
  const activeP = state.players[active];
  const anytime = ANYTIME_PHASES.includes(ph);
  switch (card.type) {
    case 'FIREBALL':
      return anytime;
    case 'TAKE_CARD':
      return anytime && state.players.some((o) => o.id !== pid && o.hand.length > 0 && !protectedFromTakeCard(o));
    case 'DOUBLE':
      return anytime && !state.doubleNextRoll;
    case 'MOVE_BACK':
      return !isActive && (ph === 'preRoll' || ph === 'postRoll' || ph === 'postMove' || ph === 'postTurn') && activeP.loc.kind !== 'pit' && activeP.loc.kind !== 'water' && !(ph !== 'postRoll' && activeP.loc.kind === 'cave');
    case 'MOVE_AHEAD':
      if (isActive) return ph === 'awaitRoll' && (p.loc.kind !== 'cave' || state.cave?.choice === 'exit');
      return ph === 'preRoll' && state.forcedSteps === undefined && !(activeP.loc.kind === 'pit' && activeP.loc.down) && !(activeP.loc.kind === 'cave' && !CAVE[activeP.loc.n].entry);
    case 'REROLL':
      return ph === 'postRoll' || ph === 'postCaveRoll';
    case 'EXTRA_TURN':
      return isActive && ph === 'postTurn';
    case 'TALISMAN': {
      if (ph !== 'preFireball' || !state.fireball) return false;
      if (state.fireball.by !== pid) return true;
      return (state.fireball.hits ?? []).includes(pid); // the roller may stop it only if their own piece is the target
    }
    case 'FAKE_JEWEL':
      return ph === 'stealAttempt' && state.steal?.owner === pid;
    case 'CANCEL':
      // a FIREBALL! never enters the card stack (playCard rolls it at once), so anything on the stack can be canceled
      return ph === 'cardResponse' && state.cardStack.length > 0;
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function openWindow(state: GameState, phase: Phase, events: LogEvent[]) {
  state.phase = phase;
  state.window = { passed: [] };
  maybeCloseWindow(state, events);
}

function maybeCloseWindow(state: GameState, events: LogEvent[]) {
  if (!isWindowPhase(state.phase)) return;
  const waiting = isReactiveWindow(state.phase)
    ? state.players.some((p) => !state.window.passed.includes(p.id))
    : state.players.some((p) => hasWindowAction(state, p.id));
  if (!waiting) onWindowClosed(state, events);
}

function onWindowClosed(state: GameState, events: LogEvent[]) {
  const ph = state.phase;
  state.window = { passed: [] };
  switch (ph) {
    case 'preRoll': {
      const active = state.players[state.active];
      if (state.forcedSteps !== undefined) {
        const steps = state.forcedSteps;
        state.forcedSteps = undefined;
        startMove(state, events, steps, true);
        return;
      }
      state.phase = 'awaitRoll';
      if (active.loc.kind === 'cave') state.cave = { choice: CAVE[active.loc.n].entry ? undefined : 'newCave' };
      return;
    }
    case 'postRoll': {
      const raw = state.lastRollRaw ?? 0;
      if (raw === 1 && !rollWasDoubled(state)) {
        state.fireball = { by: state.active, reason: 'rolledOne', resume: 'postMove' };
        state.phase = 'chooseFireball';
        log(state, events, 'fireballTriggered', `${state.players[state.active].name} rolled a 1 and must roll a Fireball!`, state.active);
        return;
      }
      startMove(state, events, state.lastRoll ?? 0, false);
      return;
    }
    case 'postCaveRoll':
      resolveCaveRoll(state, events);
      return;
    case 'preFireball':
      resolveFireball(state, events);
      return;
    case 'stealAttempt':
      // no FAKE JEWEL: the steal succeeds
      resolveSteal(state, events, true);
      return;
    case 'postMove': {
      const active = state.players[state.active];
      if (active.pendingMoveBack.length > 0) {
        const mb = active.pendingMoveBack.shift()!;
        beginMoveBack(state, events, mb.by, state.active, mb.n, 'postMove');
        return;
      }
      openWindow(state, 'postTurn', events);
      return;
    }
    case 'postTurn':
      endTurn(state, events);
      return;
    case 'cardResponse':
      resolveCardStack(state, events);
      return;
  }
}

function rollWasDoubled(state: GameState): boolean {
  return state.lastRollRaw !== undefined && state.lastRoll !== undefined && state.lastRoll !== state.lastRollRaw;
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function beginTurn(state: GameState, events: LogEvent[]) {
  state.turn += 1;
  const active = state.players[state.active];
  state.lastRoll = undefined;
  state.lastRollRaw = undefined;
  state.lastCaveRoll = undefined;
  state.move = undefined;
  state.cave = undefined;
  state.forcedSteps = undefined;
  state.skippedTurn = false;
  state.steal = undefined;
  log(state, events, 'turn', `${active.name}'s turn.`, state.active, { turn: state.turn });
  if (active.loc.kind === 'pit' && active.loc.down) {
    // stand up in the smolder pit; no roll, move, or cards this turn
    active.loc = { kind: 'pit', pit: active.loc.pit, down: false };
    state.skippedTurn = true;
    log(state, events, 'standUp', `${active.name} stands up in ${PIT[active.loc.pit].name} and loses the turn.`, state.active);
    openWindow(state, 'postTurn', events);
    return;
  }
  openWindow(state, 'preRoll', events);
}

function endTurn(state: GameState, events: LogEvent[]) {
  if (state.phase === 'gameOver') return;
  const active = state.players[state.active];
  active.pendingMoveBack = [];
  if (active.extraTurns > 0) {
    active.extraTurns -= 1;
    log(state, events, 'extraTurn', `${active.name} takes another turn.`, state.active);
  } else {
    state.active = nextPlayer(state, state.active);
  }
  beginTurn(state, events);
}

function doRoll(state: GameState, events: LogEvent[]) {
  const r = rollDie(state.rng);
  state.rng = r.state;
  const raw = r.value;
  let value = raw;
  if (state.doubleNextRoll) {
    value = raw * 2;
    state.doubleNextRoll = false;
    log(state, events, 'roll', `${state.players[state.active].name} rolls a ${raw} — doubled to ${value}!`, state.active, { raw, value });
  } else {
    log(state, events, 'roll', `${state.players[state.active].name} rolls a ${raw}.`, state.active, { raw, value });
  }
  state.lastRollRaw = raw;
  state.lastRoll = value;
}

function startMove(state: GameState, events: LogEvent[], steps: number, fromCard: boolean) {
  const active = state.players[state.active];
  if (active.loc.kind === 'pit' && active.loc.down) {
    log(state, events, 'noMove', `${active.name} is lying in the smolder pit and cannot move.`, state.active);
    openWindow(state, 'postMove', events);
    return;
  }
  let legal: string[][] = [];
  let from: 'space' | 'cave' | 'pit' | 'water' = 'space';
  if (active.loc.kind === 'space') {
    legal = legalPaths(state, { player: state.active, steps, from: active.loc.id, allowCaves: true });
  } else if (active.loc.kind === 'pit') {
    from = 'pit';
    legal = legalPaths(state, { player: state.active, steps, from: '', firstStep: PIT[active.loc.pit].rockChip, allowCaves: true });
  } else if (active.loc.kind === 'water') {
    from = 'water';
    legal = legalPaths(state, { player: state.active, steps, from: '', firstStep: 'GSB1', allowCaves: true });
  } else if (active.loc.kind === 'cave') {
    from = 'cave';
    const entry = CAVE[active.loc.n].entry;
    if (entry) legal = legalPaths(state, { player: state.active, steps, from: '', firstStep: entry, allowCaves: true });
  }
  if (legal.length === 0) {
    log(state, events, 'noMove', `${active.name} cannot move.`, state.active);
    openWindow(state, 'postMove', events);
    return;
  }
  state.move = { steps, fromCard, from, legal };
  state.phase = 'awaitMove';
}

// ---------------------------------------------------------------------------
// Movement execution
// ---------------------------------------------------------------------------

function executeMove(state: GameState, events: LogEvent[], path: string[]) {
  const active = state.players[state.active];
  const caveN = pathEndsInCave(path);
  const spaces = caveN ? path.slice(0, -1) : path;
  state.move!.executing = { path, index: 0, passedStep: false };
  log(state, events, 'move', `${active.name} moves ${spaces.length} space${spaces.length === 1 ? '' : 's'} to ${describeSpace(spaces[spaces.length - 1] ?? '')}.`, state.active, { path });
  continueMove(state, events);
}

export function describeSpace(id: string): string {
  const s = SPACE[id];
  if (!s) return id;
  if (s.special === 'start') return "Dead Man's Plateau";
  if (s.special === 'vulkar') return 'Vul-Kar Point';
  if (s.special === 'dock') return 'the Dock';
  if (s.special === 'witchlordStep') return 'Witchlord Step';
  if (s.special === 'beach') return 'Skeleton Head Beach';
  if (s.bridge) return id === 'BRIDGE1' ? 'the Great Sway Bluff bridge' : 'the Viper Pass bridge';
  const n = id.match(/(\d+)$/)?.[1];
  const total = SPACES.filter((o) => o.trail === s.trail && /\d+$/.test(o.id)).length;
  return n && total > 1 ? `${TRAIL_NAMES[s.trail]} (space ${n} of ${total})` : TRAIL_NAMES[s.trail];
}

function continueMove(state: GameState, events: LogEvent[]) {
  const active = state.players[state.active];
  const ex = state.move!.executing!;
  const caveN = pathEndsInCave(ex.path);
  const spaces = caveN ? ex.path.slice(0, -1) : ex.path;
  while (ex.index < spaces.length) {
    const id = spaces[ex.index];
    const last = ex.index === spaces.length - 1;
    // passing an opponent who owns the jewel: steal attempt
    const occ = occupant(state, id);
    if (!ex.passedStep && occ && occ.id !== state.active && occ.hasJewel) {
      ex.passedStep = true;
      state.steal = { thief: state.active, owner: occ.id };
      log(state, events, 'stealAttempt', `${active.name} passes ${occ.name} and reaches for the jewel!`, state.active, { owner: occ.id });
      openWindow(state, 'stealAttempt', events);
      return;
    }
    ex.passedStep = false;
    // passing or landing on a dropped jewel
    if (state.jewel.kind === 'space' && state.jewel.id === id) {
      state.jewel = { kind: 'player', player: state.active };
      active.hasJewel = true;
      log(state, events, 'jewelPicked', `${active.name} picks up the jewel!`, state.active);
    }
    // Witchlord Step: magic charm token
    if (SPACE[id].special === 'witchlordStep' && !active.tokenCollected && state.tokensInRuin > 0) {
      active.tokenCollected = true;
      active.hasToken = true;
      state.tokensInRuin -= 1;
      log(state, events, 'token', `${active.name} collects a Magic Charm token from the Ruin.`, state.active);
    }
    if (last) {
      active.loc = { kind: 'space', id };
      if (SPACE[id].special === 'dock') {
        if (active.hasJewel) {
          state.phase = 'gameOver';
          state.winner = state.active;
          log(state, events, 'win', `${active.name} reaches the Dock with the jewel and wins the game!`, state.active);
          return;
        }
        log(state, events, 'dockEmpty', `${active.name} reaches the Dock without the jewel.`, state.active);
      }
      if (SPACE[id].special === 'vulkar' && state.jewel.kind === 'vulkar') {
        state.jewel = { kind: 'player', player: state.active };
        active.hasJewel = true;
        log(state, events, 'capture', `${active.name} captures the jewel from Vul-Kar!`, state.active);
        fillHand(state, state.active, events);
        state.fireball = { by: state.active, reason: 'capture', resume: 'postMove' };
        state.phase = 'chooseFireball';
        log(state, events, 'fireballTriggered', `Capture bonus: ${active.name} rolls a Fireball, then takes 3 turns in a row.`, state.active);
        state.move!.executing = undefined;
        return;
      }
      if (SPACE[id].dark) {
        if (active.hand.length < HAND_LIMIT) {
          drawCard(state, state.active, events);
        } else {
          log(state, events, 'handFull', `${active.name} lands on a dark trail space but already holds 4 cards.`, state.active);
        }
      }
    }
    ex.index += 1;
  }
  if (caveN) {
    active.loc = { kind: 'cave', n: caveN };
    log(state, events, 'caveEnter', `${active.name} enters Cave ${caveN}.`, state.active, { cave: caveN });
    state.move!.executing = undefined;
    rollForCave(state, events);
    return;
  }
  state.move!.executing = undefined;
  openWindow(state, 'postMove', events);
}

function resolveSteal(state: GameState, events: LogEvent[], success: boolean) {
  const st = state.steal!;
  const thief = state.players[st.thief];
  const owner = state.players[st.owner];
  if (success) {
    owner.hasJewel = false;
    thief.hasJewel = true;
    state.jewel = { kind: 'player', player: st.thief };
    log(state, events, 'stolen', `${thief.name} steals the jewel from ${owner.name}!`, st.thief, { from: st.owner });
  } else {
    log(state, events, 'stealFailed', `${owner.name}'s jewel was a fake — ${thief.name} moves on empty-handed.`, st.owner);
  }
  state.steal = undefined;
  if (state.move?.executing) {
    state.move.executing.passedStep = true; // re-run the owner's space without a second steal attempt
    continueMove(state, events);
  } else {
    openWindow(state, 'postMove', events);
  }
}

// ---------------------------------------------------------------------------
// Caves
// ---------------------------------------------------------------------------

function rollForCave(state: GameState, events: LogEvent[]) {
  const r = rollDie(state.rng);
  state.rng = r.state;
  state.lastCaveRoll = r.value;
  log(state, events, 'caveRoll', `${state.players[state.active].name} rolls a ${r.value} for the caves.`, state.active, { value: r.value });
  openWindow(state, 'postCaveRoll', events);
}

function resolveCaveRoll(state: GameState, events: LogEvent[]) {
  const active = state.players[state.active];
  const n = state.lastCaveRoll as CaveNum;
  const rolledOne = n === 1;
  if (active.loc.kind === 'cave') {
    const occ = caveOccupant(state, n);
    if (occ && occ.id === state.active) {
      log(state, events, 'caveBlocked', `${active.name} rolls their own cave and stays in Cave ${n}.`, state.active);
    } else if (occ) {
      log(state, events, 'caveBlocked', `Cave ${n} is occupied by ${occ.name} — ${active.name} stays in Cave ${active.loc.n}.`, state.active);
    } else {
      active.loc = { kind: 'cave', n };
      log(state, events, 'caveMove', `${active.name} comes out in Cave ${n}${CAVE[n].entry ? ` by ${TRAIL_NAMES[SPACE[CAVE[n].entry].trail]}` : ' — a dead end!'}.`, state.active, { cave: n });
    }
  }
  if (rolledOne) {
    state.fireball = { by: state.active, reason: 'rolledOne', resume: 'postMove' };
    state.phase = 'chooseFireball';
    log(state, events, 'fireballTriggered', `${active.name} rolled a 1 in the caves and must roll a Fireball!`, state.active);
    return;
  }
  openWindow(state, 'postMove', events);
}

// ---------------------------------------------------------------------------
// Fireballs
// ---------------------------------------------------------------------------

export function routeHits(state: GameState, route: FireballRoute): PlayerId[] {
  const hits: PlayerId[] = [];
  for (const id of route.spaces) {
    const occ = occupant(state, id);
    if (occ && pitForSpace(id)) hits.push(occ.id);
  }
  return hits;
}

/** Routes the fireball roller may choose: must hit at least one piece if any route can. */
export function availableRoutes(state: GameState): { route: FireballRoute; hits: PlayerId[] }[] {
  const all = ROUTES.map((route) => ({ route, hits: routeHits(state, route) }));
  const anyHit = all.some((r) => r.hits.length > 0);
  return anyHit ? all.filter((r) => r.hits.length > 0) : all;
}

function resolveFireball(state: GameState, events: LogEvent[]) {
  const fb = state.fireball!;
  const route = ROUTE[fb.route!];
  const roller = state.players[fb.by];
  log(state, events, 'fireball', `${roller.name} rolls the ${FIREBALL[route.fireball].name} — ${route.label.toLowerCase()}.`, fb.by, { route: route.id, hits: fb.hits ?? [] });
  for (const id of route.spaces) {
    const occ = occupant(state, id);
    if (!occ) continue;
    const pit = pitForSpace(id);
    if (!pit) continue;
    if (pit === 'W') {
      occ.loc = { kind: 'water' };
      log(state, events, 'fireballed', `${occ.name} is knocked off the bridge into the water!`, occ.id, { to: 'W', from: id });
      if (occ.hasJewel) {
        occ.hasJewel = false;
        state.jewel = { kind: 'space', id };
        log(state, events, 'jewelDropped', `The jewel lands on the bridge — the first player to move onto it captures it.`, occ.id, { space: id });
      }
    } else {
      occ.loc = { kind: 'pit', pit, down: true };
      log(state, events, 'fireballed', `${occ.name} is fireballed on ${TRAIL_NAMES[SPACE[id].trail]} and lands in ${PIT[pit].name}!`, occ.id, { to: pit, from: id });
      if (occ.hasJewel) {
        occ.hasJewel = false;
        state.jewel = { kind: 'space', id: PIT[pit].rockChip };
        log(state, events, 'jewelDropped', `The jewel drops on the Rock Chip space beside ${PIT[pit].name}.`, occ.id, { space: PIT[pit].rockChip });
      }
    }
  }
  log(state, events, 'fireballReturn', `The fireball is returned to its place.`, undefined, { fireball: route.fireball });
  afterFireball(state, events);
}

function afterFireball(state: GameState, events: LogEvent[]) {
  const fb = state.fireball!;
  state.fireball = undefined;
  // A piece fireballed during its own turn lies in the smolder pit: the rest of that turn is lost
  // (it stands up next turn and rolls out the turn after, per the rulebook).
  const active = state.players[state.active];
  const beforeMove = fb.resume === 'preRoll' || fb.resume === 'postRoll' || fb.resume === 'awaitRoll';
  // (a piece knocked into the water keeps its pending roll: the rulebook says the water costs no turn)
  const knockedOut = active.loc.kind === 'pit' && active.loc.down;
  if (fb.reason === 'card' && beforeMove && knockedOut) {
    state.forcedSteps = undefined;
    log(state, events, 'turnLost', `${active.name} is lying in the smolder pit — the rest of the turn is lost.`, state.active);
    openWindow(state, 'postMove', events);
    return;
  }
  if (fb.reason === 'capture') {
    const p = state.players[fb.by];
    p.extraTurns += 3;
    log(state, events, 'bonusTurns', `${p.name} will take 3 full turns in a row.`, fb.by);
    openWindow(state, 'postMove', events);
    return;
  }
  if (fb.reason === 'rolledOne') {
    openWindow(state, 'postMove', events);
    return;
  }
  if (fb.resume === 'stealAttempt' && state.steal) {
    const thief = state.players[state.steal.thief];
    const owner = state.players[state.steal.owner];
    if (thief.loc.kind !== 'space') {
      // the thief was knocked out mid-move: the move (and the steal) are over
      state.steal = undefined;
      if (state.move) state.move.executing = undefined;
      log(state, events, 'moveAborted', `${thief.name}'s move ends where the fireball left them.`, thief.id);
      openWindow(state, 'postMove', events);
      return;
    }
    if (!owner.hasJewel) {
      // the owner lost the jewel to the fireball: nothing left to steal, carry on moving
      state.steal = undefined;
      if (state.move?.executing) {
        state.move.executing.passedStep = true;
        continueMove(state, events);
      } else {
        openWindow(state, 'postMove', events);
      }
      return;
    }
  }
  resumePhase(state, events, fb.resume);
}

function resumePhase(state: GameState, events: LogEvent[], phase: Phase) {
  if (isWindowPhase(phase)) openWindow(state, phase, events);
  else state.phase = phase;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function playCard(state: GameState, events: LogEvent[], pid: PlayerId, card: Card, target?: PlayerId): string | undefined {
  const p = state.players[pid];
  const idx = p.hand.findIndex((c) => c.uid === card.uid);
  if (idx < 0) return 'card not in hand';
  if (!cardPlayable(state, pid, card)) return 'card cannot be played now';
  // validate targets
  if (card.type === 'TAKE_CARD') {
    if (target === undefined || target === pid) return 'choose an opponent';
    const o = state.players[target];
    if (!o || o.hand.length === 0 || protectedFromTakeCard(o)) return 'that opponent cannot be targeted';
  }
  if (card.type === 'MOVE_BACK' && target !== undefined && target !== state.active) return 'the card targets the player whose turn it is';
  p.hand.splice(idx, 1);
  log(state, events, 'cardPlayed', `${p.name} plays ${cardTitle(card)}${target !== undefined && target !== pid ? ` on ${state.players[target].name}` : ''}.`, pid, { card, target });

  if (card.type === 'FIREBALL') {
    discardCard(state, card);
    state.fireball = { by: pid, reason: 'card', resume: state.phase };
    state.phase = 'chooseFireball';
    state.window = { passed: [] };
    return undefined;
  }
  const resume: Phase = state.phase === 'cardResponse' ? state.cardStack[0].resume : state.phase;
  state.cardStack.push({ card, player: pid, target: card.type === 'MOVE_BACK' ? state.active : target, resume });
  openWindow(state, 'cardResponse', events);
  return undefined;
}

function resolveCardStack(state: GameState, events: LogEvent[]) {
  const stack = state.cardStack;
  state.cardStack = [];
  const base = stack[0];
  const cancels = stack.length - 1;
  const alive = cancels % 2 === 0;
  for (const s of stack) discardCard(state, s.card);
  const who = state.players[base.player];
  if (!alive) {
    log(state, events, 'cardCanceled', `${cardTitle(base.card)} is canceled.`, base.player, { card: base.card });
  }
  const resume = base.resume;
  switch (base.card.type) {
    case 'FAKE_JEWEL':
      resolveSteal(state, events, !alive);
      return;
    case 'TALISMAN': {
      if (alive) {
        const fb = state.fireball!;
        log(state, events, 'fireballStopped', `The Magic Talisman stops the fireball!`, base.player);
        // the fireball is not rolled; continue as if it had been resolved
        state.fireball = { ...fb, hits: [] };
        afterFireball(state, events);
      } else {
        resolveFireball(state, events);
      }
      return;
    }
    case 'REROLL': {
      if (alive) {
        if (resume === 'postCaveRoll') {
          rollForCave(state, events);
        } else {
          // the ignored roll never happened: a DOUBLE spent on it applies to the new roll instead
          if (state.lastRollRaw !== undefined && state.lastRoll !== undefined && state.lastRoll !== state.lastRollRaw) state.doubleNextRoll = true;
          doRoll(state, events);
          openWindow(state, 'postRoll', events);
        }
      } else {
        resumePhase(state, events, resume);
      }
      return;
    }
    case 'EXTRA_TURN':
      if (alive) {
        state.players[state.active].extraTurns += 1;
        log(state, events, 'extraTurnGranted', `${who.name} will take another turn.`, base.player);
      }
      resumePhase(state, events, resume);
      return;
    case 'TAKE_CARD': {
      if (alive) {
        const o = state.players[base.target!];
        if (o.hand.length > 0 && !protectedFromTakeCard(o) && who.hand.length < HAND_LIMIT) {
          const pk = pick(o.hand, state.rng);
          state.rng = pk.state;
          o.hand.splice(pk.index, 1);
          who.hand.push(pk.item);
          log(state, events, 'cardTaken', `${who.name} takes a card from ${o.name}.`, base.player, { from: o.id });
        } else {
          log(state, events, 'cardTakenFailed', `${who.name} finds nothing to take.`, base.player);
        }
      }
      resumePhase(state, events, resume);
      return;
    }
    case 'DOUBLE':
      if (alive) {
        state.doubleNextRoll = true;
        log(state, events, 'doubleSet', `The next die roll will be doubled.`, base.player);
      }
      resumePhase(state, events, resume);
      return;
    case 'MOVE_AHEAD': {
      if (!alive) {
        resumePhase(state, events, resume);
        return;
      }
      const n = base.card.n ?? 4;
      if (base.player === state.active) {
        state.lastRoll = undefined;
        state.lastRollRaw = undefined;
        startMove(state, events, n, true);
      } else {
        state.forcedSteps = n;
        log(state, events, 'forcedMove', `${state.players[state.active].name} must move ahead ${n} spaces instead of rolling.`, state.active);
        resumePhase(state, events, resume);
      }
      return;
    }
    case 'MOVE_BACK': {
      const n = base.card.n ?? 1;
      if (!alive) {
        resumePhase(state, events, resume);
        return;
      }
      if (resume === 'postRoll') {
        state.players[state.active].pendingMoveBack.push({ by: base.player, n });
        log(state, events, 'moveBackQueued', `${state.players[state.active].name} must move back ${n} after finishing the move.`, state.active);
        resumePhase(state, events, resume);
        return;
      }
      beginMoveBack(state, events, base.player, state.active, n, resume);
      return;
    }
    default:
      resumePhase(state, events, resume);
  }
}

function beginMoveBack(state: GameState, events: LogEvent[], by: PlayerId, target: PlayerId, n: number, resume: Phase) {
  const t = state.players[target];
  if (t.loc.kind !== 'space') {
    log(state, events, 'moveBackNoEffect', `${t.name} cannot be moved back from there.`, target);
    resumePhase(state, events, resume);
    return;
  }
  const legal = legalPaths(state, { player: target, steps: n, from: t.loc.id, allowCaves: false, penalty: true });
  if (legal.length === 0) {
    log(state, events, 'moveBackNoEffect', `${t.name} has nowhere to move back to.`, target);
    resumePhase(state, events, resume);
    return;
  }
  state.moveBack = { by, target, n, legal, resume };
  state.phase = 'chooseMoveBackPath';
}

function applyMoveBack(state: GameState, events: LogEvent[], path: string[]) {
  const mb = state.moveBack!;
  const t = state.players[mb.target];
  const dest = path[path.length - 1];
  t.loc = { kind: 'space', id: dest };
  log(state, events, 'movedBack', `${t.name} is moved back ${path.length} space${path.length === 1 ? '' : 's'} to ${describeSpace(dest)}.`, mb.target, { path });
  // passing effects apply as on any move: a dropped jewel is picked up, Witchlord Step gives a token
  for (const id of path) {
    if (state.jewel.kind === 'space' && state.jewel.id === id) {
      state.jewel = { kind: 'player', player: mb.target };
      t.hasJewel = true;
      log(state, events, 'jewelPicked', `${t.name} picks up the jewel!`, mb.target);
    }
    if (SPACE[id].special === 'witchlordStep' && !t.tokenCollected && state.tokensInRuin > 0) {
      t.tokenCollected = true;
      t.hasToken = true;
      state.tokensInRuin -= 1;
      log(state, events, 'token', `${t.name} collects a Magic Charm token from the Ruin.`, mb.target);
    }
  }
  if (SPACE[dest].dark) {
    if (t.hand.length < HAND_LIMIT) drawCard(state, mb.target, events);
    else log(state, events, 'handFull', `${t.name} lands on a dark trail space but already holds 4 cards.`, mb.target);
  }
  state.moveBack = undefined;
  resumePhase(state, events, mb.resume);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function applyAction(input: GameState, pid: PlayerId, action: Action): ActionResult {
  const state = structuredClone(input);
  const events: LogEvent[] = [];
  const fail = (error: string): ActionResult => ({ ok: false, error, state: input, events: [] });
  if (state.phase === 'gameOver') return fail('the game is over');
  if (state.phase === 'lobby') return fail('the game has not started');
  const p = state.players[pid];
  if (!p) return fail('unknown player');
  const el = eligibility(state, pid);

  switch (action.type) {
    case 'PASS': {
      if (!el.canPass) return fail('nothing to pass');
      state.window.passed.push(pid);
      maybeCloseWindow(state, events);
      return { ok: true, state, events };
    }
    case 'PLAY_CARD': {
      const card = p.hand.find((c) => c.uid === action.uid);
      if (!card) return fail('card not in hand');
      if (!el.cards.includes(card.uid)) return fail('card cannot be played now');
      const err = playCard(state, events, pid, card, action.target);
      if (err) return fail(err);
      return { ok: true, state, events };
    }
    case 'TRADE_TOKEN': {
      if (!el.canTradeToken) return fail('no token to trade');
      p.hasToken = false;
      state.tokensInRuin += 1;
      log(state, events, 'tokenTraded', `${p.name} trades in the Magic Charm token.`, pid);
      fillHand(state, pid, events);
      return { ok: true, state, events };
    }
    case 'DECLARE_CAVE': {
      if (!el.canDeclareCave) return fail('no cave decision to make');
      if (p.loc.kind !== 'cave') return fail('not in a cave');
      if (action.choice === 'exit' && !CAVE[p.loc.n].entry) return fail('Cave 4 is a dead end — you must roll for a new cave');
      state.cave = { choice: action.choice };
      log(state, events, 'caveDeclare', action.choice === 'exit' ? `${p.name} will leave Cave ${p.loc.n} for the trail.` : `${p.name} will try another cave.`, pid);
      return { ok: true, state, events };
    }
    case 'ROLL': {
      if (!el.canRoll) return fail('cannot roll now');
      if (p.loc.kind === 'cave' && state.cave?.choice === 'newCave') {
        rollForCave(state, events);
        return { ok: true, state, events };
      }
      doRoll(state, events);
      openWindow(state, 'postRoll', events);
      return { ok: true, state, events };
    }
    case 'MOVE': {
      if (!el.needsMove || !state.move) return fail('not your move');
      const key = action.path.join('>');
      if (!state.move.legal.some((l) => l.join('>') === key)) return fail('illegal path');
      executeMove(state, events, action.path);
      return { ok: true, state, events };
    }
    case 'CHOOSE_FIREBALL': {
      if (!el.needsFireball || !state.fireball) return fail('no fireball to roll');
      const avail = availableRoutes(state);
      const chosen = avail.find((r) => r.route.id === action.route);
      if (!chosen) return fail('that route is not allowed — the fireball must hit a target if it can');
      state.fireball.route = chosen.route.id;
      state.fireball.hits = chosen.hits;
      if (chosen.route.facing) state.vulkarFacing = chosen.route.facing;
      log(state, events, 'fireballAimed', `${p.name} aims the ${FIREBALL[chosen.route.fireball].name}: ${chosen.route.label.toLowerCase()}.`, pid, { route: chosen.route.id, hits: chosen.hits });
      openWindow(state, 'preFireball', events);
      return { ok: true, state, events };
    }
    case 'CHOOSE_MOVE_BACK': {
      if (!el.needsMoveBack || !state.moveBack) return fail('no move back to choose');
      const key = action.path.join('>');
      if (!state.moveBack.legal.some((l) => l.join('>') === key)) return fail('illegal path');
      applyMoveBack(state, events, action.path);
      return { ok: true, state, events };
    }
  }
  return fail('unknown action');
}

/** Legal path choices for the acting player (for UI highlighting). */
export function currentChoices(state: GameState, pid: PlayerId): string[][] {
  if (state.phase === 'awaitMove' && state.active === pid && state.move) return state.move.legal;
  if (state.phase === 'chooseMoveBackPath' && state.moveBack?.by === pid) return state.moveBack.legal;
  return [];
}

export { CAVE_PREFIX };
export type { Eligibility as PlayerEligibility };

/**
 * Eligibility computed from a player's view (other hands hidden). Only the viewer's own
 * options are meaningful; other players' hidden cards are replaced by placeholders.
 */
export function eligibilityForView(view: import('./view.ts').GameView): Eligibility {
  if (view.me === null) {
    return { cards: [], canPass: false, canRoll: false, canDeclareCave: false, canTradeToken: false, needsMove: false, needsFireball: false, needsMoveBack: false };
  }
  const pseudo = {
    ...view,
    players: view.players.map((p) => ({
      ...p,
      hand: p.id === view.me ? view.myHand : Array.from({ length: p.handCount }, (_, i) => ({ uid: -1000 - i, type: 'FIREBALL' as const })),
      pendingMoveBack: Array.from({ length: p.pendingMoveBack }, () => ({ by: 0 as PlayerId, n: 1 })),
    })),
    deck: [],
    discard: [],
    rng: 0,
    seed: 0,
    version: 1 as const,
    playerCount: view.players.length,
  } as unknown as GameState;
  return eligibility(pseudo, view.me);
}

/** Routes available to the fireball roller, from a view (occupancy is public). */
export function availableRoutesForView(view: import('./view.ts').GameView): { route: FireballRoute; hits: PlayerId[] }[] {
  const pseudo = { players: view.players.map((p) => ({ ...p, hand: [] })), jewel: view.jewel } as unknown as GameState;
  return availableRoutes(pseudo);
}
