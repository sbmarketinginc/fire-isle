// Board data for Fire Isle — transcribed from the 1986 Fireball Island gameboard
// (trail map in rulebook Figure 5, fireball trailways/rollways in Figure 6, and a
// top-down photograph of the vacuum-formed board). Coordinates are in "board pixels"
// on a 1024 x 744 top-down view: x grows east (toward Thunder Alley / The Ruin),
// y grows south (toward Dead Man's Plateau). The Dock is at the west edge.

import type {
  CaveDef, CaveNum, FireballDef, FireballId, FireballRoute, PitDef, SpaceDef, TrailId,
} from './types.ts';

export const BOARD_W = 1024;
export const BOARD_H = 744;

export const TRAIL_NAMES: Record<TrailId, string> = {
  DMP: "Dead Man's Plateau",
  WT: 'Witchlord Trail',
  WS: 'Witchlord Step',
  TA: 'Thunder Alley',
  SHB: 'Skeleton Head Beach',
  LR: 'Low Road',
  HR: 'High Road',
  GG: 'Grim Gully',
  FC: 'Fireflash Chute',
  VKP: 'Vul-Kar Point',
  BR: 'Blister Run',
  C6: 'Cave 6 Passage',
  GSB: 'Great Sway Bluff',
  CP: 'Chasm Peak',
  BRIDGE: 'Bridge',
  VP: 'Viper Pass',
  DR: 'Dock Run',
  DOCK: 'The Dock',
  W: 'Water Penalty Area',
};

/** Which smolder pit a fireballed piece goes to, by trail (rulebook Figure 6 chart). */
export const TRAIL_PIT: Partial<Record<TrailId, 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'W'>> = {
  WT: 'A',
  TA: 'B',
  SHB: 'C',
  BR: 'C',
  FC: 'D',
  HR: 'D',
  LR: 'D',
  VP: 'E',
  DR: 'F',
  BRIDGE: 'W',
};

type P = [number, number];

function chain(prefix: string, trail: TrailId, pts: P[], opts: Partial<Record<number, Partial<SpaceDef>>> = {}): SpaceDef[] {
  return pts.map(([x, y], i) => ({ id: `${prefix}${i + 1}`, x, y, trail, ...(opts[i + 1] ?? {}) }));
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

const DMP: SpaceDef = { id: 'DMP', x: 300, y: 580, trail: 'DMP', safe: true, special: 'start' };

// Witchlord Trail: Dead Man's Plateau east to Witchlord Step.
const WT = chain('WT', 'WT', [
  [350, 567], [380, 559], [410, 557], [438, 557], [462, 561], [490, 558], [516, 557], [542, 556],
  [570, 558], [597, 563], [622, 573], [645, 585], [670, 589], [695, 585], [720, 576], [746, 567],
  [772, 560], [800, 554], [824, 545],
], { 2: { dark: true }, 5: { rockChip: 'A' }, 8: { caveEntry: 1 }, 10: { dark: true }, 15: { dark: true }, 17: { dark: true } });

const WS: SpaceDef = { id: 'WS', x: 846, y: 534, trail: 'WS', safe: true, special: 'witchlordStep' };

// Thunder Alley: from Witchlord Step north along the east shore to Skeleton Head Beach.
// Listed south -> north (TA1 is next to Witchlord Step).
const TA = chain('TA', 'TA', [
  [856, 512], [866, 492], [876, 466], [884, 440], [886, 412], [880, 386], [874, 360], [868, 334],
  [872, 306], [880, 278], [886, 250], [890, 222], [884, 196],
], { 2: { dark: true }, 6: { rockChip: 'B' }, 7: { dark: true }, 10: { caveEntry: 2 }, 11: { dark: true } });

const SHB: SpaceDef = { id: 'SHB', x: 858, y: 176, trail: 'SHB', special: 'beach' };

// Low Road: from the Grim Gully fork east along the north shore to Skeleton Head Beach.
const LR = chain('LR', 'LR', [
  [196, 135], [226, 116], [258, 104], [292, 92], [322, 90], [355, 90], [385, 94], [420, 95],
  [455, 95], [490, 97], [523, 107], [556, 120], [588, 132], [620, 128], [652, 116], [686, 104],
  [716, 124], [748, 134], [779, 132], [812, 140], [842, 152],
], { 2: { dark: true }, 5: { dark: true }, 10: { rockChip: 'D' }, 12: { dark: true }, 21: { dark: true } }).map((s, i) => (i < 7 ? { ...s, safe: true } : s));
// LR1..LR7 (the western stretch from the Grim Gully fork) are dark grey on Figure 6: fireballs do not reach them.

// Grim Gully fork (Low Road / High Road split) and gully down to Great Sway Bluff.
const FORK: SpaceDef = { id: 'GG0', x: 173, y: 160, trail: 'GG', safe: true };
const GG = chain('GG', 'GG', [[180, 184], [188, 208]], { 2: { dark: true } }).map((s) => ({ ...s, safe: true }));

// High Road: from the fork east, parallel to the Low Road, ending at the fork above Fireflash Chute.
// HR1..HR6 (up to cave 5) are not reached by fireballs (dark grey on Figure 6).
const HR = chain('HR', 'HR', [
  [206, 156], [232, 151], [260, 147], [290, 144], [318, 142], [346, 150], [369, 142], [392, 134],
  [416, 142], [440, 156], [464, 167], [490, 170], [514, 180], [538, 192], [560, 182], [582, 172],
  [596, 190],
], { 6: { caveEntry: 5 }, 8: { dark: true }, 14: { dark: true } }).map((s, i) => (i < 6 ? { ...s, safe: true } : s));

// Skeleton Head Beach trail: from the High Road fork north-east to the beach hub.
const SB = chain('SB', 'SHB', [
  [620, 180], [648, 172], [682, 168], [712, 178], [746, 164], [782, 158], [818, 166],
], { 1: { caveEntry: 3 }, 4: { rockChip: 'C' }, 6: { dark: true } });

// Fireflash Chute: from the High Road fork south down the chute to Vul-Kar Point.
const FC = chain('FC', 'FC', [
  [600, 218], [612, 248], [634, 272], [650, 298], [654, 326], [636, 352], [606, 358], [578, 356],
], { 2: { dark: true } });

const VKP: SpaceDef = { id: 'VKP', x: 540, y: 350, trail: 'VKP', safe: true, special: 'vulkar' };

// Blister Run: from Vul-Kar Point south, east along the bottom of the crater, then north to the beach.
const BR = chain('BR', 'BR', [
  [506, 410], [509, 446], [526, 480], [556, 506], [588, 518], [618, 522], [648, 528], [680, 540],
  [710, 540], [738, 528], [750, 500], [742, 470], [732, 440], [722, 410], [718, 378], [730, 350],
  [752, 325], [768, 296], [778, 268], [796, 240], [818, 214], [842, 192],
], { 7: { dark: true }, 14: { dark: true }, 19: { dark: true } });

// Spur from Blister Run west to cave 6 (safe).
const C6 = chain('S', 'C6', [[700, 436], [668, 428], [636, 430], [608, 446]], { 4: { caveEntry: 6 } }).map((s) => ({ ...s, safe: true }));

// Great Sway Bluff: five trail spaces climbing from the water's edge to the top of the bluff.
const GSB = chain('GSB', 'GSB', [[138, 292], [122, 268], [162, 262], [198, 262], [192, 234]]).map((s) => ({ ...s, safe: true }));
const WATER: SpaceDef = { id: 'W', x: 95, y: 300, trail: 'W', safe: true, special: 'water' };

// Chasm Peak: three spaces on the peak between the two bridges (safe).
const CP = chain('CP', 'CP', [[346, 257], [356, 280], [363, 303]]).map((s) => ({ ...s, safe: true }));
const BRIDGE1: SpaceDef = { id: 'BRIDGE1', x: 268, y: 246, trail: 'BRIDGE', bridge: true };
const BRIDGE2: SpaceDef = { id: 'BRIDGE2', x: 332, y: 326, trail: 'BRIDGE', bridge: true };

// Viper Pass: from the second bridge south to the junction by Dead Man's Plateau.
const VP = chain('VP', 'VP', [
  [304, 346], [282, 360], [262, 376], [245, 390], [222, 410], [198, 432], [194, 460], [204, 488],
  [218, 514], [232, 540], [238, 568],
], { 4: { rockChip: 'E' }, 6: { dark: true }, 10: { rockChip: 'F' } });

// Junction and Dock Run (north-west up to the Dock).
const J: SpaceDef = { id: 'J', x: 244, y: 598, trail: 'DR' };
const DR = chain('DR', 'DR', [
  [208, 590], [178, 564], [156, 536], [141, 502], [140, 466], [139, 428], [139, 392], [140, 364],
], { 3: { dark: true } });
const DOCK: SpaceDef = { id: 'DOCK', x: 110, y: 358, trail: 'DOCK', safe: true, special: 'dock' };

export const SPACES: SpaceDef[] = [
  DMP, ...WT, WS, ...TA, SHB, ...LR, FORK, ...GG, ...HR, ...SB, ...FC, VKP, ...BR, ...C6,
  ...GSB, WATER, ...CP, BRIDGE1, BRIDGE2, ...VP, J, ...DR, DOCK,
];

export const SPACE: Record<string, SpaceDef> = Object.fromEntries(SPACES.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// Adjacency (undirected)
// ---------------------------------------------------------------------------

function seq(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < ids.length; i++) out.push([ids[i], ids[i + 1]]);
  return out;
}
const ids = (arr: SpaceDef[]) => arr.map((s) => s.id);

const EDGES: [string, string][] = [
  ['DMP', 'WT1'], ...seq(ids(WT)), ['WT19', 'WS'], ['WS', 'TA1'], ...seq(ids(TA)), ['TA13', 'SHB'],
  ['SHB', 'LR21'], ...seq(ids(LR)), ['LR1', 'GG0'], ['GG0', 'HR1'], ...seq(ids(HR)),
  ['HR17', 'SB1'], ...seq(ids(SB)), ['SB7', 'SHB'],
  ['HR17', 'FC1'], ...seq(ids(FC)), ['FC8', 'VKP'],
  ['VKP', 'BR1'], ...seq(ids(BR)), ['BR22', 'SHB'],
  ['BR13', 'S1'], ...seq(ids(C6)),
  ['GG0', 'GG1'], ['GG1', 'GG2'], ['GG2', 'GSB5'], ['GSB5', 'GSB4'], ['GSB4', 'GSB3'], ['GSB3', 'GSB2'],
  ['GSB2', 'GSB1'], ['GSB1', 'W'],
  ['GSB5', 'BRIDGE1'], ['BRIDGE1', 'CP1'], ['CP1', 'CP2'], ['CP2', 'CP3'], ['CP3', 'BRIDGE2'], ['BRIDGE2', 'VP1'],
  ...seq(ids(VP)), ['VP11', 'J'], ['J', 'DMP'], ['J', 'DR1'], ...seq(ids(DR)), ['DR8', 'DOCK'],
];

export const ADJ: Record<string, string[]> = {};
for (const s of SPACES) ADJ[s.id] = [];
for (const [a, b] of EDGES) {
  if (!SPACE[a] || !SPACE[b]) throw new Error(`bad edge ${a}-${b}`);
  ADJ[a].push(b);
  ADJ[b].push(a);
}

// ---------------------------------------------------------------------------
// Caves, pits, fireballs
// ---------------------------------------------------------------------------

export const CAVES: CaveDef[] = [
  { n: 1, x: 537, y: 532, entry: 'WT8' },
  { n: 2, x: 838, y: 288, entry: 'TA10' },
  { n: 3, x: 628, y: 206, entry: 'SB1' },
  { n: 4, x: 480, y: 270 }, // dead end
  { n: 5, x: 332, y: 167, entry: 'HR6' },
  { n: 6, x: 582, y: 432, entry: 'S4' },
];
export const CAVE: Record<CaveNum, CaveDef> = Object.fromEntries(CAVES.map((c) => [c.n, c])) as Record<CaveNum, CaveDef>;

export const PITS: PitDef[] = [
  { id: 'A', x: 470, y: 600, rockChip: 'WT5', name: 'Smolder Pit A' },
  { id: 'B', x: 818, y: 368, rockChip: 'TA6', name: 'Smolder Pit B' },
  { id: 'C', x: 720, y: 158, rockChip: 'SB4', name: 'Smolder Pit C' },
  { id: 'D', x: 486, y: 116, rockChip: 'LR10', name: 'Smolder Pit D' },
  { id: 'E', x: 254, y: 418, rockChip: 'VP4', name: 'Smolder Pit E' },
  { id: 'F', x: 212, y: 550, rockChip: 'VP10', name: 'Smolder Pit F' },
];
export const PIT: Record<string, PitDef> = Object.fromEntries(PITS.map((p) => [p.id, p]));

export const RUIN = { x: 876, y: 570 };
export const JEWEL_REST = { x: 556, y: 366 };

export const FIREBALLS: FireballDef[] = [
  { id: 'V', x: 540, y: 350, name: 'Vul-Kar' },
  { id: 'A', x: 478, y: 505, name: 'Witchlord Trail fireball' },
  { id: 'B', x: 834, y: 510, name: 'Witchlord Step fireball' },
  { id: 'C', x: 315, y: 200, name: 'Chasm Peak fireball' },
  { id: 'D', x: 668, y: 258, name: 'Fireflash Chute fireball' },
];
export const FIREBALL: Record<FireballId, FireballDef> = Object.fromEntries(FIREBALLS.map((f) => [f.id, f])) as Record<FireballId, FireballDef>;

const range = (prefix: string, from: number, to: number): string[] => {
  const out: string[] = [];
  const step = from <= to ? 1 : -1;
  for (let i = from; i !== to + step; i += step) out.push(`${prefix}${i}`);
  return out;
};

/** Trailways and rollways from rulebook Figure 6. */
export const ROUTES: FireballRoute[] = [
  { id: 'A-west', fireball: 'A', label: 'Witchlord Trail toward the Plateau', spaces: range('WT', 5, 1) },
  { id: 'A-east', fireball: 'A', label: 'Witchlord Trail toward Witchlord Step', spaces: range('WT', 5, 19) },
  { id: 'B-west', fireball: 'B', label: 'Down Witchlord Trail', spaces: range('WT', 19, 1) },
  { id: 'B-north', fireball: 'B', label: 'Up Thunder Alley', spaces: range('TA', 1, 13) },
  { id: 'C-bridge', fireball: 'C', label: 'Across the Great Sway Bluff bridge', spaces: ['BRIDGE1'] },
  { id: 'C-highroad', fireball: 'C', label: 'Down the High Road and Fireflash Chute', spaces: [...range('HR', 7, 17), ...range('FC', 1, 8)], lead: [{ x: 360, y: 215 }, { x: 400, y: 190 }] },
  { id: 'C-lowroad', fireball: 'C', label: 'Onto the Low Road toward Skeleton Head Beach', spaces: range('LR', 8, 21), lead: [{ x: 350, y: 178 }, { x: 395, y: 122 }] },
  { id: 'D-highroad', fireball: 'D', label: 'West along the High Road', spaces: range('HR', 17, 7), lead: [{ x: 640, y: 230 }] },
  { id: 'D-chute', fireball: 'D', label: 'Down Fireflash Chute toward Vul-Kar', spaces: range('FC', 1, 8), lead: [{ x: 640, y: 236 }] },
  { id: 'D-beach', fireball: 'D', label: 'To Skeleton Head Beach and down Blister Run', spaces: [...range('SB', 1, 7), 'SHB', ...range('BR', 22, 13)], lead: [{ x: 640, y: 210 }] },
  { id: 'D-lowroad', fireball: 'D', label: 'Up onto the Low Road toward the beach', spaces: range('LR', 14, 21), lead: [{ x: 660, y: 190 }, { x: 640, y: 150 }] },
  { id: 'V-south', fireball: 'V', facing: 'S', label: 'Vul-Kar faces south: down Blister Run', spaces: range('BR', 1, 12), lead: [{ x: 528, y: 386 }] },
  { id: 'V-southwest', fireball: 'V', facing: 'SW', label: 'Vul-Kar faces south-west: down the lava channel to Witchlord Trail', spaces: range('WT', 5, 19), lead: [{ x: 470, y: 400 }, { x: 462, y: 460 }, { x: 478, y: 505 }] },
  { id: 'V-west', fireball: 'V', facing: 'W', label: 'Vul-Kar faces west: over the bridge, down Viper Pass and Dock Run', spaces: ['BRIDGE2', ...range('VP', 1, 11), 'J', ...range('DR', 1, 8)], lead: [{ x: 450, y: 375 }, { x: 400, y: 360 }] },
  { id: 'V-east', fireball: 'V', facing: 'E', label: 'Vul-Kar faces east: up Fireflash Chute', spaces: range('FC', 8, 1) },
  { id: 'V-northeast', fireball: 'V', facing: 'NE', label: 'Vul-Kar faces north-east: to Skeleton Head Beach and Blister Run', spaces: [...range('SB', 1, 7), 'SHB', ...range('BR', 22, 13)], lead: [{ x: 600, y: 300 }, { x: 640, y: 262 }, { x: 640, y: 210 }] },
];
export const ROUTE: Record<string, FireballRoute> = Object.fromEntries(ROUTES.map((r) => [r.id, r]));

for (const r of ROUTES) for (const s of r.spaces) if (!SPACE[s]) throw new Error(`route ${r.id} has unknown space ${s}`);
for (const p of PITS) if (!SPACE[p.rockChip]) throw new Error(`pit ${p.id} bad rock chip`);
for (const c of CAVES) if (c.entry && !SPACE[c.entry]) throw new Error(`cave ${c.n} bad entry`);

/** Pit (or water) a piece standing on the given space is sent to when fireballed; undefined if safe. */
export function pitForSpace(id: string): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'W' | undefined {
  const s = SPACE[id];
  if (!s || s.safe) return undefined;
  return TRAIL_PIT[s.trail];
}

export function caveEntriesFrom(spaceId: string): CaveNum[] {
  const s = SPACE[spaceId];
  return s?.caveEntry ? [s.caveEntry] : [];
}

export function trailName(id: string): string {
  const s = SPACE[id];
  return s ? TRAIL_NAMES[s.trail] : id;
}
