import { Card, Suit } from '../types';

const SUIT_PRIORITY: Record<Suit, number> = {
  CLUBS: 0,
  DIAMONDS: 1,
  SPADES: 2,
  HEARTS: 3,
};

export function compareCardsBySuitThenRankAsc(a: Card, b: Card): number {
  if (a.suit !== b.suit) {
    return SUIT_PRIORITY[a.suit] - SUIT_PRIORITY[b.suit];
  }
  return a.value - b.value;
}

export function sortCardsBySuitThenRankAsc(cards: Card[]): Card[] {
  return [...cards].sort(compareCardsBySuitThenRankAsc);
}
