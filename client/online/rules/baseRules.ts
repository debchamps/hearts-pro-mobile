import { Suit, Card } from '../../../types';
import { MultiplayerGameState } from '../types';

export function legalByLead(state: MultiplayerGameState, seat: number): Card[] {
  const hand = state.hands[seat] || [];
  if (!state.leadSuit) return hand;
  const sameSuit = hand.filter((c) => c.suit === state.leadSuit);
  return sameSuit.length > 0 ? sameSuit : hand;
}

export function resolveWinnerWithTrump(
  trick: Array<{ seat: number; card: Card }>,
  leadSuit: Suit | null,
  trumpSuit: Suit | null
): number {
  if (trick.length === 0) return 0;
  let winner = trick[0];
  for (let i = 1; i < trick.length; i++) {
    const curr = trick[i];
    const winnerTrump = trumpSuit ? winner.card.suit === trumpSuit : false;
    const currTrump = trumpSuit ? curr.card.suit === trumpSuit : false;

    if (currTrump && !winnerTrump) {
      winner = curr;
      continue;
    }

    if (currTrump === winnerTrump) {
      const compareSuit = winnerTrump ? trumpSuit : leadSuit;
      if (compareSuit && curr.card.suit === compareSuit && winner.card.suit === compareSuit && curr.card.value > winner.card.value) {
        winner = curr;
      }
    }
  }
  return winner.seat;
}
