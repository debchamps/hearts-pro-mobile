import { Card } from '../../../types';
import { lowestCard } from '../utils';
import { MultiplayerGameState } from '../types';
import { IGameRules } from './IGameRules';
import { legalByLead, resolveWinnerWithTrump } from './baseRules';

export class HeartsRules implements IGameRules {
  readonly gameType = 'HEARTS' as const;

  getLegalMoves(state: MultiplayerGameState, seat: number): Card[] {
    return legalByLead(state, seat);
  }

  getTimeoutMove(state: MultiplayerGameState, seat: number): Card {
    const legal = this.getLegalMoves(state, seat);
    return lowestCard(legal);
  }

  resolveTrickWinner(trick: Array<{ seat: number; card: Card }>, leadSuit: any): number {
    return resolveWinnerWithTrump(trick, leadSuit, null);
  }
}
