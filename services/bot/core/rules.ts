import type { Card } from '../../../types.ts';
import type { BotTurnContext } from './types.ts';

export function legalMoves(context: BotTurnContext): Card[] {
  const hand = context.hand;
  if (!context.leadSuit) {
    if (context.gameType === 'HEARTS' && !context.heartsBroken) {
      const nonHearts = hand.filter((c) => c.suit !== 'HEARTS');
      return nonHearts.length > 0 ? nonHearts : hand;
    }
    return hand;
  }

  const follow = hand.filter((c) => c.suit === context.leadSuit);
  if (follow.length > 0) return follow;

  if (context.gameType === 'CALLBREAK') {
    const spades = hand.filter((c) => c.suit === 'SPADES');
    if (spades.length > 0) return spades;
  }

  return hand;
}
