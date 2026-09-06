// Player-specific views: hide other players' hands and the deck order.
import type { Card, GameState, PlayerId } from './types.ts';

export interface PlayerView {
  id: PlayerId;
  name: string;
  color: string;
  handCount: number;
  loc: GameState['players'][number]['loc'];
  hasJewel: boolean;
  hasToken: boolean;
  tokenCollected: boolean;
  extraTurns: number;
  pendingMoveBack: number;
}

export interface GameView {
  me: PlayerId | null;
  myHand: Card[];
  players: PlayerView[];
  phase: GameState['phase'];
  turn: number;
  active: PlayerId;
  jewel: GameState['jewel'];
  tokensInRuin: number;
  deckCount: number;
  discardTop?: Card;
  window: GameState['window'];
  cardStack: GameState['cardStack'];
  lastRoll?: number;
  lastRollRaw?: number;
  lastCaveRoll?: number;
  doubleNextRoll: boolean;
  forcedSteps?: number;
  move?: GameState['move'];
  fireball?: GameState['fireball'];
  moveBack?: GameState['moveBack'];
  cave?: GameState['cave'];
  steal?: GameState['steal'];
  vulkarFacing: GameState['vulkarFacing'];
  winner?: PlayerId;
  skippedTurn?: boolean;
  log: GameState['log'];
}

export function viewFor(state: GameState, me: PlayerId | null): GameView {
  return {
    me,
    myHand: me === null ? [] : state.players[me].hand.slice(),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      handCount: p.hand.length,
      loc: p.loc,
      hasJewel: p.hasJewel,
      hasToken: p.hasToken,
      tokenCollected: p.tokenCollected,
      extraTurns: p.extraTurns,
      pendingMoveBack: p.pendingMoveBack.length,
    })),
    phase: state.phase,
    turn: state.turn,
    active: state.active,
    jewel: state.jewel,
    tokensInRuin: state.tokensInRuin,
    deckCount: state.deck.length,
    discardTop: state.discard[state.discard.length - 1],
    window: state.window,
    cardStack: state.cardStack,
    lastRoll: state.lastRoll,
    lastRollRaw: state.lastRollRaw,
    lastCaveRoll: state.lastCaveRoll,
    doubleNextRoll: state.doubleNextRoll,
    forcedSteps: state.forcedSteps,
    move: state.move,
    fireball: state.fireball,
    moveBack: state.moveBack,
    cave: state.cave,
    steal: state.steal,
    vulkarFacing: state.vulkarFacing,
    winner: state.winner,
    skippedTurn: state.skippedTurn,
    log: state.log.slice(-60),
  };
}
