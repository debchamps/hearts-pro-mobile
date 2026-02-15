import { Card } from '../../../types';
import { lowestCard } from '../utils';
import { MultiplayerGameState } from '../types';
import { IGameRules } from './IGameRules';
import { legalByLead, resolveWinnerWithTrump } from './baseRules';

export class CallbreakRules implements IGameRules {
  readonly gameType = 'CALLBREAK' as const;

  getLegalMoves(state: MultiplayerGameState, seat: number): Card[] {
    const basic = legalByLead(state, seat);
    if (!state.leadSuit) return basic;
    if (basic.length !== (state.hands[seat] || []).length) return basic;

    const hand = state.hands[seat] || [];
    const spades = hand.filter((c) => c.suit === 'SPADES');
    return spades.length > 0 ? spades : hand;
  }

  getTimeoutMove(state: MultiplayerGameState, seat: number): Card {
    return lowestCard(this.getLegalMoves(state, seat));
  }

  resolveTrickWinner(trick: Array<{ seat: number; card: Card }>, leadSuit: any): number {
    return resolveWinnerWithTrump(trick, leadSuit, 'SPADES');
  }
}
