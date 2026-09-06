import { describe, expect, it } from 'vitest';
import {
  ADJ, CAVE, PIT, ROUTES, SPACE, SPACES, applyAction, availableRoutes, buildDeck, createGame, eligibility,
  legalPaths, routeHits,
} from '../src/engine/index.ts';
import type { Action, GameState, PlayerId } from '../src/engine/index.ts';
import { nextRandom } from '../src/engine/rng.ts';

function newGame(seed = 7, n = 3): GameState {
  return createGame({ seed, players: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })) });
}

function act(state: GameState, pid: PlayerId, action: Action): GameState {
  const r = applyAction(state, pid, action);
  if (!r.ok) throw new Error(`action failed: ${r.error} (${action.type}) phase=${state.phase}`);
  return r.state;
}

/** pass every window until a single-actor phase is reached */
function drain(state: GameState): GameState {
  let guard = 0;
  while (['preRoll', 'postRoll', 'postMove', 'postTurn', 'cardResponse', 'preFireball', 'stealAttempt', 'postCaveRoll'].includes(state.phase) && guard++ < 50) {
    const p = state.players.find((pl) => eligibility(state, pl.id).canPass);
    if (!p) break;
    state = act(state, p.id, { type: 'PASS' });
  }
  return state;
}

describe('board data', () => {
  it('has a connected trail graph with unique ids', () => {
    const ids = new Set(SPACES.map((s) => s.id));
    expect(ids.size).toBe(SPACES.length);
    const seen = new Set<string>();
    const stack = ['DMP'];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c)) continue;
      seen.add(c);
      for (const n of ADJ[c]) stack.push(n);
    }
    expect(seen.size).toBe(SPACES.length);
  });
  it('has six caves, six pits with rock chips, and routes over known spaces', () => {
    expect(Object.keys(CAVE).length).toBe(6);
    expect(CAVE[4].entry).toBeUndefined();
    for (const p of Object.values(PIT)) expect(SPACE[p.rockChip]).toBeDefined();
    for (const r of ROUTES) for (const s of r.spaces) expect(SPACE[s]).toBeDefined();
    expect(ROUTES.filter((r) => r.fireball === 'V').length).toBe(6);
  });
  it('every fireball-affected space lies on at least one trailway (Figure 6 chart)', () => {
    const covered = new Set(ROUTES.flatMap((r) => r.spaces));
    const missing = SPACES.filter((sp) => !sp.safe && !covered.has(sp.id)).map((sp) => sp.id);
    expect(missing).toEqual([]);
    for (const sp of SPACES) if (sp.safe) for (const r of ROUTES) expect(r.spaces).not.toContain(sp.id);
  });
  it('the deck has 48 cards', () => {
    expect(buildDeck().length).toBe(48);
  });
});

describe('setup', () => {
  it('deals one card each, all pieces start on Dead Man\'s Plateau, jewel on Vul-Kar', () => {
    const s = newGame();
    for (const p of s.players) {
      expect(p.hand.length).toBe(1);
      expect(p.loc).toEqual({ kind: 'space', id: 'DMP' });
    }
    expect(s.jewel).toEqual({ kind: 'vulkar' });
    expect(s.deck.length + s.discard.length + s.players.reduce((a, p) => a + p.hand.length, 0)).toBe(48);
    expect(['preRoll', 'awaitRoll']).toContain(s.phase);
  });
  it('is deterministic for a seed', () => {
    const a = newGame(42);
    const b = newGame(42);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('movement rules', () => {
  it('moves the full count in any direction without revisiting', () => {
    const s = newGame();
    const paths = legalPaths(s, { player: 0, steps: 3, from: 'DMP', allowCaves: true });
    // from the start: 3 along Witchlord Trail, or 3 toward the junction / Dock Run
    const ends = new Set(paths.map((p) => p[p.length - 1]));
    expect(ends.has('WT3')).toBe(true);
    expect(ends.has('DR2') || ends.has('VP10')).toBe(true);
    for (const p of paths) expect(new Set(p).size).toBe(p.length);
  });
  it('lands on the next open space when the landing space is occupied', () => {
    const s = newGame();
    s.players[1].loc = { kind: 'space', id: 'WT2' };
    const paths = legalPaths(s, { player: 0, steps: 2, from: 'DMP', allowCaves: true });
    const ends = paths.map((p) => p[p.length - 1]);
    expect(ends).not.toContain('WT2');
    expect(ends).toContain('WT3');
  });
  it('must stop on an unoccupied bridge and may cross an occupied one', () => {
    const s = newGame();
    s.players[0].loc = { kind: 'space', id: 'GSB5' };
    let paths = legalPaths(s, { player: 0, steps: 4, from: 'GSB5', allowCaves: true });
    expect(paths.some((p) => p.length === 1 && p[0] === 'BRIDGE1')).toBe(true);
    expect(paths.some((p) => p.includes('BRIDGE1') && p.length > 1)).toBe(false);
    s.players[1].loc = { kind: 'space', id: 'BRIDGE1' };
    paths = legalPaths(s, { player: 0, steps: 3, from: 'GSB5', allowCaves: true });
    expect(paths.some((p) => p.join('>') === 'BRIDGE1>CP1>CP2')).toBe(true);
  });
  it('captures the jewel at Vul-Kar Point without exact count and cannot pass through before capture', () => {
    const s = newGame();
    s.players[0].loc = { kind: 'space', id: 'FC7' };
    const paths = legalPaths(s, { player: 0, steps: 6, from: 'FC7', allowCaves: true });
    expect(paths.some((p) => p.join('>') === 'FC8>VKP')).toBe(true);
    expect(paths.some((p) => p.includes('VKP') && p.includes('BR1'))).toBe(false);
  });
  it('lets the jewel owner use Vul-Kar Point as a connecting space and reach the Dock without exact count', () => {
    const s = newGame();
    s.jewel = { kind: 'player', player: 0 };
    s.players[0].hasJewel = true;
    s.players[0].loc = { kind: 'space', id: 'BR2' };
    let paths = legalPaths(s, { player: 0, steps: 4, from: 'BR2', allowCaves: true });
    expect(paths.some((p) => p.join('>') === 'BR1>VKP>FC8>FC7')).toBe(true);
    s.players[0].loc = { kind: 'space', id: 'DR9' };
    paths = legalPaths(s, { player: 0, steps: 6, from: 'DR9', allowCaves: true });
    expect(paths.some((p) => p.join('>') === 'DR10>DOCK')).toBe(true);
    s.players[1].loc = { kind: 'space', id: 'DR9' };
    paths = legalPaths(s, { player: 1, steps: 6, from: 'DR9', allowCaves: true });
    expect(paths.some((p) => p.includes('DOCK'))).toBe(true); // anyone may step onto the Dock; only the jewel wins
  });
  it('stealing the jewel on the way to the Dock wins on the same move', () => {
    let s = newGame(90, 2);
    s.players[1].loc = { kind: 'space', id: 'DR9' };
    s.players[1].hasJewel = true;
    s.jewel = { kind: 'player', player: 1 };
    s.players[0].loc = { kind: 'space', id: 'DR8' };
    s.players[0].hand = [];
    s.players[1].hand = [];
    s.active = 0;
    s.phase = 'awaitMove';
    s.move = { steps: 2, fromCard: true, from: 'space', legal: legalPaths(s, { player: 0, steps: 2, from: 'DR8', allowCaves: true }) };
    expect(s.move.legal.some((p) => p.join('>') === 'DR9>DR10')).toBe(true);
    s = act(s, 0, { type: 'MOVE', path: ['DR9', 'DR10'] });
    s = drain(s); // steal resolves, then the thief reaches DR8 (no exact count needed for the Dock later)
    expect(s.players[0].hasJewel).toBe(true);
    // and a longer roll reaches the Dock on the same move
    let t = newGame(91, 2);
    t.players[1].loc = { kind: 'space', id: 'DR9' };
    t.players[1].hasJewel = true;
    t.jewel = { kind: 'player', player: 1 };
    t.players[0].loc = { kind: 'space', id: 'DR8' };
    t.players[0].hand = [];
    t.players[1].hand = [];
    t.active = 0;
    t.phase = 'awaitMove';
    t.move = { steps: 3, fromCard: true, from: 'space', legal: legalPaths(t, { player: 0, steps: 3, from: 'DR8', allowCaves: true }) };
    const winning = t.move.legal.find((p) => p.join('>') === 'DR9>DR10>DOCK')!;
    expect(winning).toBeDefined();
    t = act(t, 0, { type: 'MOVE', path: winning });
    t = drain(t);
    expect(t.phase).toBe('gameOver');
    expect(t.winner).toBe(0);
  });
  it('can enter a cave counting it as a space, ending the move', () => {
    const s = newGame();
    s.players[0].loc = { kind: 'space', id: 'WT6' };
    const paths = legalPaths(s, { player: 0, steps: 5, from: 'WT6', allowCaves: true });
    expect(paths.some((p) => p.join('>') === 'WT7>WT8>CAVE:1')).toBe(true);
    // an opponent standing on the entry space is passed over; an occupied cave cannot be entered
    s.players[1].loc = { kind: 'space', id: 'WT8' };
    expect(legalPaths(s, { player: 0, steps: 5, from: 'WT6', allowCaves: true }).some((p) => p.join('>') === 'WT7>WT8>CAVE:1')).toBe(true);
    s.players[1].loc = { kind: 'cave', n: 1 };
    expect(legalPaths(s, { player: 0, steps: 5, from: 'WT6', allowCaves: true }).some((p) => p.includes('CAVE:1'))).toBe(false);
  });
});

describe('turn flow', () => {
  it('rolls, moves, and passes the turn to the left', () => {
    let s = drain(newGame(3));
    expect(s.phase).toBe('awaitRoll');
    const first = s.active;
    s = act(s, first, { type: 'ROLL' });
    s = drain(s);
    if (s.phase === 'chooseFireball') {
      const r = availableRoutes(s)[0];
      s = act(s, first, { type: 'CHOOSE_FIREBALL', route: r.route.id });
      s = drain(s);
    } else {
      expect(s.phase).toBe('awaitMove');
      s = act(s, first, { type: 'MOVE', path: s.move!.legal[0] });
      s = drain(s);
    }
    expect(s.active).toBe((first + 1) % 3);
  });
  it('a piece lying in a smolder pit loses its next turn, then moves out via the Rock Chip space', () => {
    let s = newGame(5, 2);
    s.players[0].loc = { kind: 'pit', pit: 'A', down: true };
    s.players[1].loc = { kind: 'space', id: 'GSB1' };
    s.active = 1;
    s.phase = 'postTurn';
    s.window = { passed: [] };
    s.players[0].hand = [];
    s.players[1].hand = [];
    s = drain(s); // ends P1's turn -> P0 stands up and loses the turn -> back to P1
    expect(s.players[0].loc).toEqual({ kind: 'pit', pit: 'A', down: false });
    expect(s.active).toBe(1);
    expect(s.phase).toBe('awaitRoll');
    s = act(s, 1, { type: 'ROLL' });
    s = drain(s);
    if (s.phase === 'chooseFireball') {
      s = act(s, 1, { type: 'CHOOSE_FIREBALL', route: availableRoutes(s)[0].route.id });
      s = drain(s);
    } else {
      s = act(s, 1, { type: 'MOVE', path: s.move!.legal[0] });
      s = drain(s);
    }
    expect(s.active).toBe(0);
    s = act(s, 0, { type: 'ROLL' });
    s = drain(s);
    if (s.phase === 'awaitMove') {
      for (const p of s.move!.legal) expect(p[0]).toBe('WT5');
    }
  });
});

describe('fireballs', () => {
  it('must hit a target when any route can, and sends pieces to the matching pit', () => {
    let s = newGame(9, 2);
    s.players[0].loc = { kind: 'space', id: 'TA5' };
    s.players[1].loc = { kind: 'space', id: 'DMP' };
    s.active = 1;
    s.phase = 'chooseFireball';
    s.fireball = { by: 1, reason: 'card', resume: 'preRoll' };
    s.players[1].hand = [];
    s.players[0].hand = [];
    const avail = availableRoutes(s);
    expect(avail.every((r) => r.hits.length > 0)).toBe(true);
    expect(avail.some((r) => r.route.id === 'B-north')).toBe(true);
    s = act(s, 1, { type: 'CHOOSE_FIREBALL', route: 'B-north' });
    s = drain(s);
    expect(s.players[0].loc).toEqual({ kind: 'pit', pit: 'B', down: true });
  });
  it('knocks a piece on a bridge into the water and drops the jewel on the bridge', () => {
    let s = newGame(11, 2);
    s.players[0].loc = { kind: 'space', id: 'BRIDGE1' };
    s.players[0].hasJewel = true;
    s.jewel = { kind: 'player', player: 0 };
    s.active = 1;
    s.phase = 'chooseFireball';
    s.fireball = { by: 1, reason: 'card', resume: 'preRoll' };
    s.players[1].hand = [];
    s.players[0].hand = [];
    s = act(s, 1, { type: 'CHOOSE_FIREBALL', route: 'C-bridge' });
    s = drain(s);
    expect(s.players[0].loc).toEqual({ kind: 'water' });
    expect(s.jewel).toEqual({ kind: 'space', id: 'BRIDGE1' });
    // climbing out: first step is GSB1
    s.active = 0;
    s.phase = 'awaitRoll';
    s = act(s, 0, { type: 'ROLL' });
    s = drain(s);
    if (s.phase === 'awaitMove') for (const p of s.move!.legal) expect(p[0]).toBe('GSB1');
  });
  it('the jewel holder fireballed on a trail drops it on the Rock Chip space', () => {
    let s = newGame(12, 2);
    s.players[0].loc = { kind: 'space', id: 'WT10' };
    s.players[0].hasJewel = true;
    s.jewel = { kind: 'player', player: 0 };
    s.active = 1;
    s.phase = 'chooseFireball';
    s.fireball = { by: 1, reason: 'card', resume: 'preRoll' };
    s.players[1].hand = [];
    s.players[0].hand = [];
    s = act(s, 1, { type: 'CHOOSE_FIREBALL', route: 'A-east' });
    s = drain(s);
    expect(s.players[0].loc).toEqual({ kind: 'pit', pit: 'A', down: true });
    expect(s.jewel).toEqual({ kind: 'space', id: 'WT5' });
  });
  it('safe spaces are never hit', () => {
    const s = newGame(1, 2);
    s.players[0].loc = { kind: 'space', id: 'GSB3' };
    expect(routeHits(s, ROUTES.find((r) => r.id === 'C-bridge')!)).toEqual([]);
    s.players[0].loc = { kind: 'space', id: 'HR3' };
    expect(routeHits(s, ROUTES.find((r) => r.id === 'C-highroad')!)).toEqual([]);
    s.players[0].loc = { kind: 'space', id: 'HR12' };
    expect(routeHits(s, ROUTES.find((r) => r.id === 'C-highroad')!)).toEqual([0]);
  });
});

describe('fireballed on your own turn', () => {
  it('loses the rest of the turn, stands up next turn, and rolls out the turn after', () => {
    let s = newGame(70, 2);
    s.players[0].loc = { kind: 'space', id: 'TA5' };
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 5, type: 'FIREBALL' }];
    s.active = 0;
    s.phase = 'postRoll';
    s.lastRoll = 4;
    s.lastRollRaw = 4;
    s.window = { passed: [] };
    s = act(s, 1, { type: 'PLAY_CARD', uid: 5 });
    s = act(s, 1, { type: 'CHOOSE_FIREBALL', route: 'B-north' });
    s = drain(s);
    expect(s.players[0].loc).toEqual({ kind: 'pit', pit: 'B', down: true });
    expect(s.active).toBe(1); // P0 did not get to move
    expect(s.phase).toBe('awaitRoll');
    s = act(s, 1, { type: 'ROLL' });
    s = drain(s);
    if (s.phase === 'chooseFireball') {
      s = act(s, 1, { type: 'CHOOSE_FIREBALL', route: availableRoutes(s)[0].route.id });
      s = drain(s);
    } else if (s.phase === 'awaitMove') {
      s = act(s, 1, { type: 'MOVE', path: s.move!.legal[0] });
      s = drain(s);
    }
    // P0 stands up and loses that turn, so it is P1 again
    expect(s.players[0].loc).toEqual({ kind: 'pit', pit: 'B', down: false });
    expect(s.active).toBe(1);
  });
});

describe('jewel and cards', () => {
  it('capture gives a full hand, a fireball, and 3 turns in a row', () => {
    let s = newGame(21, 2);
    s.players[0].loc = { kind: 'space', id: 'FC8' };
    s.players[0].hand = [];
    s.players[1].hand = [];
    s.active = 0;
    s.phase = 'awaitRoll';
    s = act(s, 0, { type: 'ROLL' });
    s = drain(s);
    if (s.phase === 'chooseFireball' && s.fireball?.reason === 'rolledOne') return; // unlucky seed path
    expect(s.phase).toBe('awaitMove');
    const path = s.move!.legal.find((p) => p[p.length - 1] === 'VKP')!;
    s = act(s, 0, { type: 'MOVE', path });
    expect(s.jewel).toEqual({ kind: 'player', player: 0 });
    expect(s.players[0].hand.length).toBe(4);
    expect(s.phase).toBe('chooseFireball');
    s = act(s, 0, { type: 'CHOOSE_FIREBALL', route: availableRoutes(s)[0].route.id });
    s = drain(s); // everyone passes, the bonus fireball rolls, the turn ends and the first bonus turn begins
    expect(s.players[0].extraTurns).toBe(2);
    expect(s.active).toBe(0);
  });
  it('passing the jewel owner steals the jewel unless FAKE JEWEL is played', () => {
    let s = newGame(30, 2);
    s.players[1].loc = { kind: 'space', id: 'WT3' };
    s.players[1].hasJewel = true;
    s.jewel = { kind: 'player', player: 1 };
    s.players[0].loc = { kind: 'space', id: 'WT1' };
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 900, type: 'FAKE_JEWEL' }];
    s.active = 0;
    s.phase = 'awaitMove';
    s.move = { steps: 4, fromCard: true, from: 'space', legal: legalPaths(s, { player: 0, steps: 4, from: 'WT1', allowCaves: true }) };
    const path = s.move.legal.find((p) => p.join('>') === 'WT2>WT3>WT4>WT5')!;
    s = act(s, 0, { type: 'MOVE', path });
    expect(s.phase).toBe('stealAttempt');
    s = act(s, 1, { type: 'PLAY_CARD', uid: 900 });
    s = drain(s);
    expect(s.players[1].hasJewel).toBe(true);
    expect(s.players[0].hasJewel).toBe(false);
    expect(s.players[0].loc).toEqual({ kind: 'space', id: 'WT5' });
    // without the card, the steal succeeds
    let t = newGame(30, 2);
    t.players[1].loc = { kind: 'space', id: 'WT3' };
    t.players[1].hasJewel = true;
    t.jewel = { kind: 'player', player: 1 };
    t.players[0].loc = { kind: 'space', id: 'WT1' };
    t.players[0].hand = [];
    t.players[1].hand = [];
    t.active = 0;
    t.phase = 'awaitMove';
    t.move = { steps: 4, fromCard: true, from: 'space', legal: legalPaths(t, { player: 0, steps: 4, from: 'WT1', allowCaves: true }) };
    t = act(t, 0, { type: 'MOVE', path });
    t = drain(t);
    expect(t.players[0].hasJewel).toBe(true);
  });
  it('CANCEL cancels a card; a second CANCEL restores it; FIREBALL cannot be canceled', () => {
    let s = newGame(40, 3);
    s.players[0].hand = [{ uid: 1, type: 'DOUBLE' }];
    s.players[1].hand = [{ uid: 2, type: 'CANCEL' }];
    s.players[2].hand = [{ uid: 3, type: 'CANCEL' }];
    s.active = 0;
    s.phase = 'preRoll';
    s.window = { passed: [] };
    s = act(s, 0, { type: 'PLAY_CARD', uid: 1 });
    expect(s.phase).toBe('cardResponse');
    s = act(s, 1, { type: 'PLAY_CARD', uid: 2 });
    s = act(s, 2, { type: 'PLAY_CARD', uid: 3 });
    s = drain(s);
    expect(s.doubleNextRoll).toBe(true);
    let t = newGame(40, 2);
    t.players[0].hand = [{ uid: 1, type: 'FIREBALL' }];
    t.players[1].hand = [{ uid: 2, type: 'CANCEL' }];
    t.active = 0;
    t.phase = 'preRoll';
    t.window = { passed: [] };
    t = act(t, 0, { type: 'PLAY_CARD', uid: 1 });
    expect(t.phase).toBe('chooseFireball');
    expect(eligibility(t, 1).cards).toEqual([]);
  });
  it('MAGIC TALISMAN stops a fireball', () => {
    let s = newGame(41, 2);
    s.players[0].loc = { kind: 'space', id: 'WT9' };
    s.players[0].hand = [{ uid: 5, type: 'TALISMAN' }];
    s.players[1].hand = [{ uid: 6, type: 'FIREBALL' }];
    s.active = 1;
    s.phase = 'preRoll';
    s.window = { passed: [] };
    s = act(s, 1, { type: 'PLAY_CARD', uid: 6 });
    s = act(s, 1, { type: 'CHOOSE_FIREBALL', route: 'A-east' });
    expect(s.phase).toBe('preFireball');
    s = act(s, 0, { type: 'PLAY_CARD', uid: 5 });
    s = drain(s);
    expect(s.players[0].loc).toEqual({ kind: 'space', id: 'WT9' });
  });
  it('DOUBLE turns a 1 into a 2 with no fireball', () => {
    let s = newGame(2, 2);
    s.doubleNextRoll = true;
    s.players[0].hand = [];
    s.players[1].hand = [];
    s.active = 0;
    s.phase = 'awaitRoll';
    // find a seed state that rolls 1 next
    let guard = 0;
    while (guard++ < 200) {
      const r = nextRandom(s.rng);
      if (1 + Math.floor(r.value * 6) === 1) break;
      s.rng = r.state;
    }
    s = act(s, 0, { type: 'ROLL' });
    expect(s.lastRollRaw).toBe(1);
    expect(s.lastRoll).toBe(2);
    s = drain(s);
    expect(s.phase).toBe('awaitMove');
  });
  it('MOVE ANY OPPONENT BACK moves the active player back, chosen by the card player', () => {
    let s = newGame(50, 2);
    s.players[0].loc = { kind: 'space', id: 'WT6' };
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 7, type: 'MOVE_BACK', n: 2 }];
    s.active = 0;
    s.phase = 'preRoll';
    s.window = { passed: [] };
    s = act(s, 1, { type: 'PLAY_CARD', uid: 7 });
    s = drain(s);
    expect(s.phase).toBe('chooseMoveBackPath');
    expect(s.moveBack!.by).toBe(1);
    const path = s.moveBack!.legal.find((p) => p.join('>') === 'WT5>WT4')!;
    s = act(s, 1, { type: 'CHOOSE_MOVE_BACK', path });
    expect(s.players[0].loc).toEqual({ kind: 'space', id: 'WT4' });
  });
  it('Witchlord Step gives one token, trading it fills the hand, and jewel+token blocks TAKE 1 CARD', () => {
    let s = newGame(60, 2);
    s.players[0].loc = { kind: 'space', id: 'WT18' };
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 8, type: 'TAKE_CARD' }];
    s.active = 0;
    s.phase = 'awaitMove';
    s.move = { steps: 2, fromCard: true, from: 'space', legal: legalPaths(s, { player: 0, steps: 2, from: 'WT18', allowCaves: true }) };
    s = act(s, 0, { type: 'MOVE', path: ['WT19', 'WS'] });
    expect(s.players[0].hasToken).toBe(true);
    expect(s.tokensInRuin).toBe(3);
    s = drain(s);
    s.players[0].hasJewel = true;
    s.jewel = { kind: 'player', player: 0 };
    s.players[0].hand = [{ uid: 99, type: 'REROLL' }];
    expect(eligibility(s, 1).cards).toEqual([]); // protected by jewel + token
    s.players[0].hasJewel = false;
    s.jewel = { kind: 'vulkar' };
    // trade the token on own turn
    s.active = 0;
    s.phase = 'awaitRoll';
    s.window = { passed: [] };
    const u = act(s, 0, { type: 'TRADE_TOKEN' });
    expect(u.players[0].hand.length).toBe(4);
    expect(u.players[0].hasToken).toBe(false);
    expect(u.tokensInRuin).toBe(4);
  });
});

describe('review follow-ups', () => {
  it('a steal attempt waits for explicit passes even when nobody holds FAKE JEWEL', () => {
    let s = newGame(82, 2);
    s.players[1].loc = { kind: 'space', id: 'WT3' };
    s.players[1].hasJewel = true;
    s.jewel = { kind: 'player', player: 1 };
    s.players[0].loc = { kind: 'space', id: 'WT1' };
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 1, type: 'REROLL' }];
    s.active = 0;
    s.phase = 'awaitMove';
    s.move = { steps: 4, fromCard: true, from: 'space', legal: legalPaths(s, { player: 0, steps: 4, from: 'WT1', allowCaves: true }) };
    s = act(s, 0, { type: 'MOVE', path: ['WT2', 'WT3', 'WT4', 'WT5'] });
    expect(s.phase).toBe('stealAttempt'); // open regardless of the owner's hand
    expect(eligibility(s, 1).canPass).toBe(true);
    s = act(s, 1, { type: 'PASS' });
    expect(s.phase).toBe('stealAttempt'); // the thief passes too
    s = act(s, 0, { type: 'PASS' });
    expect(s.players[0].hasJewel).toBe(true);
  });
  it('DOUBLE survives a REROLL of the doubled roll, and a cave roll can be rerolled', () => {
    let s = newGame(95, 2);
    s.doubleNextRoll = true;
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 9, type: 'REROLL' }];
    s.active = 0;
    s.phase = 'awaitRoll';
    s = act(s, 0, { type: 'ROLL' });
    expect(s.lastRoll).toBe((s.lastRollRaw ?? 0) * 2);
    s = act(s, 1, { type: 'PLAY_CARD', uid: 9 });
    s = drain(s);
    expect(s.lastRoll).toBe((s.lastRollRaw ?? 0) * 2); // the replacement roll is doubled too
    let t = newGame(96, 2);
    t.players[0].loc = { kind: 'cave', n: 2 };
    t.players[0].hand = [];
    t.players[1].hand = [{ uid: 9, type: 'REROLL' }];
    t.active = 0;
    t.phase = 'awaitRoll';
    t.cave = { choice: 'newCave' };
    t = act(t, 0, { type: 'ROLL' });
    expect(t.phase).toBe('postCaveRoll');
    const first = t.lastCaveRoll;
    t = act(t, 1, { type: 'PLAY_CARD', uid: 9 });
    t = drain(t);
    expect(first).toBeDefined();
    expect(t.log.filter((e) => e.type === 'caveRoll').length).toBe(2); // the cave die was rolled again
  });
  it('a dead-end branch cannot be used to stop short when a full move exists', () => {
    const s = newGame(97, 2);
    s.players[0].loc = { kind: 'space', id: 'S1' };
    s.players[1].loc = { kind: 'cave', n: 6 };
    const paths = legalPaths(s, { player: 0, steps: 6, from: 'S1', allowCaves: true });
    expect(paths.some((p) => p.join('>') === 'S2>S3>S4')).toBe(false);
    expect(paths.every((p) => p.filter((x) => !x.startsWith('CAVE')).length === 6 || SPACE[p[p.length - 1]]?.bridge)).toBe(true);
  });
  it('knocked off a bridge on your own turn, the pending roll is spent climbing from the water', () => {
    let s = newGame(83, 2);
    s.players[0].loc = { kind: 'space', id: 'BRIDGE1' };
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 5, type: 'FIREBALL' }];
    s.active = 0;
    s.phase = 'postRoll';
    s.lastRoll = 3;
    s.lastRollRaw = 3;
    s.window = { passed: [] };
    s = act(s, 1, { type: 'PLAY_CARD', uid: 5 });
    s = act(s, 1, { type: 'CHOOSE_FIREBALL', route: 'C-bridge' });
    s = drain(s);
    expect(s.active).toBe(0);
    expect(s.phase).toBe('awaitMove');
    for (const p of s.move!.legal) expect(p[0]).toBe('GSB1');
  });
  it('stealing from an owner standing on Witchlord Step still grants the token', () => {
    let s = newGame(80, 2);
    s.players[1].loc = { kind: 'space', id: 'WS' };
    s.players[1].hasJewel = true;
    s.jewel = { kind: 'player', player: 1 };
    s.players[0].loc = { kind: 'space', id: 'WT18' };
    s.players[0].hand = [];
    s.players[1].hand = [];
    s.active = 0;
    s.phase = 'awaitMove';
    s.move = { steps: 3, fromCard: true, from: 'space', legal: legalPaths(s, { player: 0, steps: 3, from: 'WT18', allowCaves: true }) };
    s = act(s, 0, { type: 'MOVE', path: ['WT19', 'WS', 'TA1'] });
    s = drain(s);
    expect(s.players[0].hasJewel).toBe(true);
    expect(s.players[0].hasToken).toBe(true);
  });
  it('a move back grants the token and a dark-space card like any other move', () => {
    let s = newGame(92, 2);
    s.players[0].loc = { kind: 'space', id: 'TA2' };
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 7, type: 'MOVE_BACK', n: 3 }];
    s.active = 0;
    s.phase = 'preRoll';
    s.window = { passed: [] };
    s = act(s, 1, { type: 'PLAY_CARD', uid: 7 });
    s = drain(s);
    expect(s.phase).toBe('chooseMoveBackPath');
    const path = s.moveBack!.legal.find((p) => p.join('>') === 'TA1>WS>WT19')!;
    s = act(s, 1, { type: 'CHOOSE_MOVE_BACK', path });
    expect(s.players[0].hasToken).toBe(true);
    // landing on a dark trail space draws a card
    let t = newGame(94, 2);
    t.players[0].loc = { kind: 'space', id: 'WT4' };
    t.players[0].hand = [];
    t.players[1].hand = [{ uid: 7, type: 'MOVE_BACK', n: 2 }];
    t.active = 0;
    t.phase = 'preRoll';
    t.window = { passed: [] };
    t = act(t, 1, { type: 'PLAY_CARD', uid: 7 });
    t = drain(t);
    expect(SPACE.WT2.dark).toBe(true);
    t = act(t, 1, { type: 'CHOOSE_MOVE_BACK', path: ['WT3', 'WT2'] });
    expect(t.players[0].hand.length).toBe(1);
  });
  it('MOVE AHEAD can be forced on a piece standing up in a pit, sending it out via the Rock Chip space', () => {
    let s = newGame(93, 2);
    s.players[0].loc = { kind: 'pit', pit: 'A', down: false };
    s.players[0].hand = [];
    s.players[1].hand = [{ uid: 8, type: 'MOVE_AHEAD', n: 4 }];
    s.active = 0;
    s.phase = 'preRoll';
    s.window = { passed: [] };
    expect(eligibility(s, 1).cards).toContain(8);
    s = act(s, 1, { type: 'PLAY_CARD', uid: 8, target: 0 });
    s = drain(s);
    expect(s.phase).toBe('awaitMove');
    for (const p of s.move!.legal) expect(p[0]).toBe('WT5');
  });
  it('the token cannot be traded with a full hand, and may be traded after moving', () => {
    const s = newGame(81, 2);
    s.players[0].hasToken = true;
    s.players[0].hand = [{ uid: 1, type: 'REROLL' }, { uid: 2, type: 'REROLL' }, { uid: 3, type: 'REROLL' }, { uid: 4, type: 'REROLL' }];
    s.active = 0;
    s.phase = 'awaitRoll';
    expect(eligibility(s, 0).canTradeToken).toBe(false);
    s.players[0].hand = [{ uid: 1, type: 'REROLL' }];
    expect(eligibility(s, 0).canTradeToken).toBe(true);
    s.phase = 'postMove';
    s.window = { passed: [] };
    expect(eligibility(s, 0).canTradeToken).toBe(true);
    expect(eligibility(s, 1).canTradeToken).toBe(false);
  });
});

describe('random play', () => {
  // goal-directed random player: heads for the jewel (or a dropped jewel), then the Dock
  function dist(from: string): Record<string, number> {
    const d: Record<string, number> = { [from]: 0 };
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      for (const n of ADJ[c]) if (!(n in d)) { d[n] = d[c] + 1; q.push(n); }
    }
    return d;
  }
  const toVK = dist('VKP');
  const toDock = dist('DOCK');

  it('finishes many random games without illegal states', () => {
    let finished = 0;
    for (let g = 0; g < 12; g++) {
      let s = newGame(1000 + g, 2 + (g % 3));
      let rng = 77 + g;
      let steps = 0;
      while (s.phase !== 'gameOver' && steps++ < 6000) {
        let acted = false;
        for (const p of s.players) {
          const el = eligibility(s, p.id);
          const r = nextRandom(rng);
          rng = r.state;
          let action: Action | undefined;
          if (el.needsMove) {
            const legal = s.move!.legal;
            const goal = p.hasJewel ? toDock : s.jewel.kind === 'space' ? dist(s.jewel.id) : toVK;
            const score = (path: string[]) => {
              const end = path[path.length - 1];
              return end.startsWith('CAVE') ? 50 : goal[end] ?? 99;
            };
            const best = legal.slice().sort((a, b) => score(a) - score(b))[0];
            action = { type: 'MOVE', path: r.value < 0.15 ? legal[Math.floor(r.value * legal.length)] : best };
          } else if (el.needsFireball) {
            const av = availableRoutes(s);
            action = { type: 'CHOOSE_FIREBALL', route: av[Math.floor(r.value * av.length)].route.id };
          } else if (el.needsMoveBack) {
            const legal = s.moveBack!.legal;
            action = { type: 'CHOOSE_MOVE_BACK', path: legal[Math.floor(r.value * legal.length)] };
          } else if (el.canDeclareCave) {
            action = { type: 'DECLARE_CAVE', choice: r.value < 0.7 ? 'exit' : 'newCave' };
          } else if (el.canRoll) {
            action = r.value < 0.2 && el.canTradeToken ? { type: 'TRADE_TOKEN' } : { type: 'ROLL' };
          } else if (el.cards.length > 0 && r.value < 0.6) {
            const uid = el.cards[Math.floor(r.value * el.cards.length)];
            const card = p.hand.find((c) => c.uid === uid)!;
            let target: PlayerId | undefined;
            if (card.type === 'TAKE_CARD') {
              const opts = s.players.filter((o) => o.id !== p.id && o.hand.length > 0 && !(o.hasJewel && o.hasToken));
              target = opts[Math.floor(r.value * opts.length)]?.id;
              if (target === undefined) action = { type: 'PASS' };
            }
            if (!action) action = { type: 'PLAY_CARD', uid, target };
          } else if (el.canPass) {
            action = { type: 'PASS' };
          }
          if (action) {
            let res = applyAction(s, p.id, action);
            if (!res.ok && action.type === 'DECLARE_CAVE') res = applyAction(s, p.id, { type: 'DECLARE_CAVE', choice: 'newCave' });
            if (!res.ok) throw new Error(`illegal: ${res.error} ${JSON.stringify(action)} phase=${s.phase}`);
            s = res.state;
            acted = true;
            break;
          }
        }
        if (!acted) throw new Error(`stuck in phase ${s.phase} turn ${s.turn}`);
        // invariants
        const cards = s.deck.length + s.discard.length + s.players.reduce((a, p) => a + p.hand.length, 0) + s.cardStack.length;
        if (cards !== 48) throw new Error(`card count drift ${cards}`);
        for (const p of s.players) if (p.hand.length > 4) throw new Error('hand over limit');
        const holders = s.players.filter((p) => p.hasJewel).length;
        if (holders > 1) throw new Error('two jewel holders');
        if (s.jewel.kind === 'player' && !s.players[s.jewel.player].hasJewel) throw new Error('jewel mismatch');
        for (const p of s.players) if (p.loc.kind === 'pit' && p.loc.down && s.phase === 'awaitMove' && s.active === p.id) throw new Error('moving while lying in a pit');
      }
      if (s.phase === 'gameOver') finished++;
      expect(s.phase).toBe('gameOver');
    }
    expect(finished).toBe(12);
  }, 90000);
});
