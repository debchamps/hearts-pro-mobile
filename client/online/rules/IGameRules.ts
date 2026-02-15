import { Card, GameType, Suit } from '../../../types';
import { MultiplayerGameState } from '../types';

export interface TrickContext {
  leadSuit: Suit | null;
  trick: Array<{ seat: number; card: Card }>;
}

export interface IGameRules {
  readonly gameType: GameType;
  getLegalMoves(state: MultiplayerGameState, seat: number): Card[];
  getTimeoutMove(state: MultiplayerGameState, seat: number): Card;
  resolveTrickWinner(trick: Array<{ seat: number; card: Card }>, leadSuit: Suit | null): number;
}
