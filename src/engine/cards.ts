import type { Card, CardType } from './types.ts';

export interface CardInfo {
  type: CardType;
  title: string;
  text: string;
}

export const CARD_INFO: Record<CardType, CardInfo> = {
  FIREBALL: {
    type: 'FIREBALL',
    title: 'FIREBALL!',
    text: 'Play this card any time on your own turn or on an opponent\'s turn. Then roll a Fireball.',
  },
  FAKE_JEWEL: {
    type: 'FAKE_JEWEL',
    title: 'FAKE JEWEL!',
    text: 'Play this card only when an opponent tries to steal the jewel from you. You keep the jewel, and the opponent must move on — empty-handed!',
  },
  CANCEL: {
    type: 'CANCEL',
    title: 'CANCEL ANY CARD EXCEPT FIREBALL CARD!',
    text: 'You may play this card on top of a card just played — even another CANCEL card — to cancel its effect before any action is taken. EXCEPTION: The FIREBALL! card can never be canceled!',
  },
  TALISMAN: {
    type: 'TALISMAN',
    title: 'MAGIC TALISMAN STOPS A FIREBALL!',
    text: 'This card prevents you or an opponent from rolling any of the 5 Fireballs. Play it when an opponent is just about to roll a Fireball; or play it after you roll a "1" on the die, if your playing piece is the target.',
  },
  REROLL: {
    type: 'REROLL',
    title: 'REROLL THE DIE!',
    text: 'Play this card after you or an opponent rolls the die. The player who rolled must ignore the first roll, and roll again. If the first die roll was a "1", a Fireball is not rolled.',
  },
  EXTRA_TURN: {
    type: 'EXTRA_TURN',
    title: 'TAKE ANOTHER TURN AFTER YOUR TURN!',
    text: 'After any of your turns, play this card for an extra full turn.',
  },
  TAKE_CARD: {
    type: 'TAKE_CARD',
    title: 'TAKE 1 CARD FROM ANY OPPONENT',
    text: 'Play this card on your own turn or on an opponent\'s turn. Then take one card at random from any opponent\'s hand. NOTE: This card can never be played against a player who owns the jewel and the token at the same time!',
  },
  MOVE_AHEAD: {
    type: 'MOVE_AHEAD',
    title: 'MOVE AHEAD {n} SPACES INSTEAD OF ROLLING DIE',
    text: 'Play this card on your turn, to move ahead the indicated number of spaces instead of rolling the die. Or play it on an opponent\'s turn, to force the opponent to move ahead the indicated number of spaces.',
  },
  MOVE_BACK: {
    type: 'MOVE_BACK',
    title: 'MOVE ANY OPPONENT BACK {n} SPACE(S)',
    text: 'Play this card on any opponent\'s turn to move the opponent back on the trail the number of spaces indicated. Played before the opponent rolls: they move back before rolling. Played after: they finish the move, then move back. These cards do not move players out of caves, smolder pits, or the water penalty area. If this card moves an opponent back onto an unoccupied bridge, the opponent must end the move on the bridge.',
  },
  DOUBLE: {
    type: 'DOUBLE',
    title: 'DOUBLE THE NEXT DIE ROLL',
    text: 'Play this card on your own turn or on an opponent\'s turn, to double the next die roll. For example, a die roll of "1" becomes a "2" and a Fireball is not rolled.',
  },
};

export function cardTitle(card: Card): string {
  const t = CARD_INFO[card.type].title;
  return card.n !== undefined ? t.replace('{n}', String(card.n)) : t;
}

export function cardText(card: Card): string {
  return CARD_INFO[card.type].text;
}

/**
 * Deck composition (48 cards). The card faces are documented in the 1986 rulebook;
 * the exact print run per face is not, so the quantities below are a reconstruction
 * that keeps the deck at 48 cards. Adjust here if you have an original deck to count.
 */
export const DECK_COMPOSITION: { type: CardType; n?: number; count: number }[] = [
  { type: 'FIREBALL', count: 8 },
  { type: 'FAKE_JEWEL', count: 2 },
  { type: 'CANCEL', count: 4 },
  { type: 'TALISMAN', count: 4 },
  { type: 'REROLL', count: 4 },
  { type: 'EXTRA_TURN', count: 4 },
  { type: 'TAKE_CARD', count: 4 },
  { type: 'DOUBLE', count: 3 },
  { type: 'MOVE_AHEAD', n: 4, count: 2 },
  { type: 'MOVE_AHEAD', n: 5, count: 2 },
  { type: 'MOVE_AHEAD', n: 6, count: 2 },
  { type: 'MOVE_BACK', n: 1, count: 3 },
  { type: 'MOVE_BACK', n: 2, count: 3 },
  { type: 'MOVE_BACK', n: 3, count: 3 },
];

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let uid = 1;
  for (const c of DECK_COMPOSITION) {
    for (let i = 0; i < c.count; i++) cards.push({ uid: uid++, type: c.type, ...(c.n !== undefined ? { n: c.n } : {}) });
  }
  return cards;
}

export const HAND_LIMIT = 4;
