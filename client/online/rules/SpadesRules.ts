import { Card } from '../../../types';
import { lowestCard } from '../utils';
import { MultiplayerGameState } from '../types';
import { IGameRules } from './IGameRules';
import { legalByLead, resolveWinnerWithTrump } from './baseRules';

export class SpadesRules implements IGameRules {
  readonly gameType = 'SPADES' as const;

  getLegalMoves(state: MultiplayerGameState, seat: number): Card[] {
    return legalByLead(state, seat);
  }

  getTimeoutMove(state: MultiplayerGameState, seat: number): Card {
    const legal = this.getLegalMoves(state, seat);
    const nonTrump = legal.filter((c) => c.suit !== 'SPADES');
    return lowestCard(nonTrump.length > 0 ? nonTrump : legal);
  }

  resolveTrickWinner(trick: Array<{ seat: number; card: Card }>, leadSuit: any): number {
    return resolveWinnerWithTrump(trick, leadSuit, 'SPADES');
  }
}
