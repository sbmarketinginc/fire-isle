// Core types for the Fire Isle rules engine (faithful to the 1986 Fireball Island rulebook).

export type PlayerId = 0 | 1 | 2 | 3;

export type TrailId =
  | 'DMP' // Dead Man's Plateau (start)
  | 'WT' // Witchlord Trail
  | 'WS' // Witchlord Step
  | 'TA' // Thunder Alley
  | 'SHB' // Skeleton Head Beach (hub + beach trail)
  | 'LR' // Low Road
  | 'HR' // High Road (east part is fireball-affected)
  | 'GG' // Grim Gully (fork + gully)
  | 'FC' // Fireflash Chute
  | 'VKP' // Vul-Kar Point
  | 'BR' // Blister Run
  | 'C6' // spur to cave 6
  | 'GSB' // Great Sway Bluff
  | 'CP' // Chasm Peak
  | 'BRIDGE'
  | 'VP' // Viper Pass
  | 'DR' // Dock Run
  | 'DOCK'
  | 'W'; // water penalty area at the bottom of Great Sway Bluff

export type PitId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type CaveNum = 1 | 2 | 3 | 4 | 5 | 6;
export type FireballId = 'V' | 'A' | 'B' | 'C' | 'D';

export interface SpaceDef {
  id: string;
  x: number; // board photo coordinates (0..1024)
  y: number; // (0..744)
  trail: TrailId;
  /** dark trail space: landing here draws a card */
  dark?: boolean;
  /** this is the Rock Chip space next to the given smolder pit */
  rockChip?: PitId;
  bridge?: boolean;
  /** cave reachable from this trail space */
  caveEntry?: CaveNum;
  /** fireballs cannot touch pieces here */
  safe?: boolean;
  special?: 'start' | 'vulkar' | 'dock' | 'witchlordStep' | 'beach' | 'water';
}

export interface CaveDef {
  n: CaveNum;
  x: number;
  y: number;
  /** trail space you enter from / exit to (undefined for the dead-end cave 4) */
  entry?: string;
}

export interface PitDef {
  id: PitId;
  x: number;
  y: number;
  rockChip: string;
  name: string;
}

export interface FireballRoute {
  id: string;
  fireball: FireballId;
  label: string;
  /** which way Vul-Kar must face for a Vul-Kar fireball */
  facing?: 'S' | 'SW' | 'W' | 'E' | 'NE';
  /** ordered list of trail space ids the fireball rolls over (bridges included) */
  spaces: string[];
  /** extra path points (board px) for animation before the first space */
  lead?: { x: number; y: number }[];
}

export interface FireballDef {
  id: FireballId;
  x: number;
  y: number;
  name: string;
}

export type CardType =
  | 'FIREBALL'
  | 'FAKE_JEWEL'
  | 'CANCEL'
  | 'TALISMAN'
  | 'REROLL'
  | 'EXTRA_TURN'
  | 'TAKE_CARD'
  | 'MOVE_AHEAD'
  | 'MOVE_BACK'
  | 'DOUBLE';

export interface Card {
  uid: number;
  type: CardType;
  /** spaces for MOVE_AHEAD / MOVE_BACK */
  n?: number;
}

export type Location =
  | { kind: 'space'; id: string }
  | { kind: 'cave'; n: CaveNum }
  | { kind: 'pit'; pit: PitId; down: boolean }
  | { kind: 'water' };

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  hand: Card[];
  loc: Location;
  hasJewel: boolean;
  hasToken: boolean;
  tokenCollected: boolean;
  extraTurns: number;
  /** move-back penalties queued to apply after this player's current move */
  pendingMoveBack: { by: PlayerId; n: number }[];
}

export type JewelLoc =
  | { kind: 'vulkar' }
  | { kind: 'player'; player: PlayerId }
  | { kind: 'space'; id: string }; // dropped on a Rock Chip space or a bridge

export type Phase =
  | 'lobby'
  | 'preRoll'
  | 'awaitRoll'
  | 'postRoll'
  | 'awaitMove'
  | 'chooseFireball'
  | 'preFireball'
  | 'stealAttempt'
  | 'postCaveRoll'
  | 'chooseMoveBackPath'
  | 'postMove'
  | 'postTurn'
  | 'cardResponse'
  | 'gameOver';

export interface PlayedCard {
  card: Card;
  player: PlayerId;
  target?: PlayerId;
  /** phase that was interrupted by this card play */
  resume: Phase;
}

export interface WindowState {
  passed: PlayerId[];
}

export interface FireballPending {
  /** who chooses / rolls the fireball */
  by: PlayerId;
  /** why: rolled a 1, a FIREBALL card, or the capture bonus */
  reason: 'rolledOne' | 'card' | 'capture';
  route?: string;
  /** phase to resume once the fireball is resolved (for card-triggered fireballs) */
  resume: Phase;
  /** player whose piece is the declared target set (for talisman eligibility) */
  hits?: PlayerId[];
}

export interface CaveDecision {
  /** the player is in a cave and must declare before rolling */
  choice?: 'newCave' | 'exit';
}

export interface MoveContext {
  steps: number;
  /** true when the count came from a MOVE AHEAD card (no die roll happened) */
  fromCard: boolean;
  /** the active player is exiting a cave / pit / water this move */
  from: 'space' | 'cave' | 'pit' | 'water';
  /** legal paths (list of space ids; a cave entry ends with 'CAVE:n') */
  legal: string[][];
  /** a path being executed that paused for a steal attempt */
  executing?: { path: string[]; index: number; passedStep: boolean };
}

export interface MoveBackContext {
  by: PlayerId;
  target: PlayerId;
  n: number;
  legal: string[][];
  resume: Phase;
}

export interface LogEvent {
  t: number;
  type: string;
  player?: PlayerId;
  text: string;
  data?: Record<string, unknown>;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  phase: Phase;
  turn: number;
  active: PlayerId;
  players: PlayerState[];
  playerCount: number;
  jewel: JewelLoc;
  tokensInRuin: number;
  deck: Card[];
  discard: Card[];
  window: WindowState;
  /** cards played and awaiting cancel responses (bottom = first played) */
  cardStack: PlayedCard[];
  /** die value for the current movement (after doubling) */
  lastRoll?: number;
  lastRollRaw?: number;
  lastCaveRoll?: number;
  doubleNextRoll: boolean;
  /** a MOVE AHEAD card forced the active player's movement count */
  forcedSteps?: number;
  move?: MoveContext;
  fireball?: FireballPending;
  moveBack?: MoveBackContext;
  cave?: CaveDecision;
  steal?: { thief: PlayerId; owner: PlayerId };
  vulkarFacing: 'S' | 'SW' | 'W' | 'E' | 'NE';
  winner?: PlayerId;
  log: LogEvent[];
  /** the turn just skipped because the player was lying in a pit */
  skippedTurn?: boolean;
}

export type Action =
  | { type: 'ROLL' }
  | { type: 'DECLARE_CAVE'; choice: 'newCave' | 'exit' }
  | { type: 'MOVE'; path: string[] }
  | { type: 'CHOOSE_FIREBALL'; route: string }
  | { type: 'PLAY_CARD'; uid: number; target?: PlayerId }
  | { type: 'CHOOSE_MOVE_BACK'; path: string[] }
  | { type: 'TRADE_TOKEN' }
  | { type: 'PASS' };

export interface ActionResult {
  ok: boolean;
  error?: string;
  state: GameState;
  events: LogEvent[];
}
