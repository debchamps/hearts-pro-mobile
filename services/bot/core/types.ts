import type { Card, GameType, GameSettings, Player, Suit, TrickCard } from '../../../types.ts';

export type BotIntent =
  | 'WIN_TRICK'
  | 'LOSE_SAFE'
  | 'BURN_HIGH'
  | 'BAIT_OPPONENT'
  | 'DRAW_TRUMP'
  | 'AVOID_PENALTY'
  | 'PROTECT_BID'
  | 'FORCE_MISTAKE';

export interface VisiblePlayerState {
  id: number;
  score: number;
  currentRoundScore?: number;
  tricksWon: number;
  bid?: number;
  handCount: number;
  isHuman: boolean;
  teamId?: number;
}

export interface BotTurnContext {
  gameType: GameType;
  seatId: number;
  hand: Card[];
  currentTrick: TrickCard[];
  leadSuit: Suit | null;
  settings: GameSettings;
  players: VisiblePlayerState[];
  roundNumber?: number;
  isFirstTrick?: boolean;
  heartsBroken?: boolean;
  spadesBroken?: boolean;
  mandatoryOvertrump?: boolean;
}

export interface SuitKnowledge {
  voidSuits: Record<number, Set<Suit>>;
  playedCards: Set<string>;
  highCardPressure: Record<Suit, number>;
  behaviorTendency: Record<number, { aggressive: number; conservative: number }>;
}

export interface CardScoreBreakdown {
  trickWinValue: number;
  safetyValue: number;
  futureHandValue: number;
  opponentReadValue: number;
  scorePressure: number;
  penaltyRisk: number;
  total: number;
}

export interface StrategyDecision {
  intent: BotIntent;
  cardId: string;
  score: CardScoreBreakdown;
  reason: string;
}

export interface BidDecision {
  bid: number;
  expectedTricks: number;
  confidence: number;
  reason: string;
}

export interface GameStrategy {
  readonly gameType: GameType;
  pickMove(context: BotTurnContext, legalMoves: Card[], memory: SuitKnowledge): StrategyDecision;
  pickBid?(context: BotTurnContext, memory: SuitKnowledge): BidDecision;
  pickPassCards?(context: BotTurnContext, memory: SuitKnowledge): string[];
}

export interface BotEngineInput {
  context: BotTurnContext;
  settings?: {
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
    personality?: 'SAFE' | 'BALANCED' | 'AGGRESSIVE';
  };
}

export interface BotEngineOutput {
  cardId: string;
  intent: BotIntent;
  reason: string;
}

export interface PublicBotPlayer extends Pick<Player, 'id' | 'score' | 'currentRoundScore' | 'bid' | 'isHuman' | 'teamId'> {
  tricksWon: number;
  handCount: number;
}
