import type { GameType } from '../../../types.ts';
import { CallbreakStrategy } from '../strategies/CallbreakStrategy.ts';
import { HeartsStrategy } from '../strategies/HeartsStrategy.ts';
import { SpadesStrategy } from '../strategies/SpadesStrategy.ts';
import type { GameStrategy } from './types.ts';

const STRATEGIES: Record<GameType, GameStrategy> = {
  HEARTS: new HeartsStrategy(),
  SPADES: new SpadesStrategy(),
  CALLBREAK: new CallbreakStrategy(),
};

export class StrategyRouter {
  getStrategy(gameType: GameType): GameStrategy {
    return STRATEGIES[gameType];
  }
}
