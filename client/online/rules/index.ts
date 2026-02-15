import { GameType } from '../../../types';
import { IGameRules } from './IGameRules';
import { HeartsRules } from './HeartsRules';
import { SpadesRules } from './SpadesRules';
import { CallbreakRules } from './CallbreakRules';

const RULES: Record<GameType, IGameRules> = {
  HEARTS: new HeartsRules(),
  SPADES: new SpadesRules(),
  CALLBREAK: new CallbreakRules(),
};

export function getRules(gameType: GameType): IGameRules {
  return RULES[gameType];
}
