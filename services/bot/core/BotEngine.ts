import { StrategyRouter } from './StrategyRouter.ts';
import { MemoryTracker } from './MemoryTracker.ts';
import { legalMoves } from './rules.ts';
import type { BotEngineInput, BotEngineOutput, BotTurnContext, PublicBotPlayer } from './types.ts';
import type { Card, Player, TrickCard, GameSettings, Suit, GameType } from '../../../types.ts';

function toVisiblePlayers(players: Player[]): PublicBotPlayer[] {
  return players.map((p) => ({
    id: p.id,
    score: p.score,
    currentRoundScore: p.currentRoundScore || 0,
    tricksWon: p.tricksWon || 0,
    bid: p.bid,
    isHuman: p.isHuman,
    teamId: p.teamId,
    handCount: p.hand?.length || 0,
  }));
}

export function createContextFromLegacy(input: {
  gameType: GameType;
  seatId: number;
  hand: Card[];
  currentTrick: TrickCard[];
  leadSuit: Suit | null;
  players: Player[];
  settings: GameSettings;
  roundNumber?: number;
  isFirstTrick?: boolean;
  heartsBroken?: boolean;
  spadesBroken?: boolean;
  mandatoryOvertrump?: boolean;
}): BotTurnContext {
  return {
    gameType: input.gameType,
    seatId: input.seatId,
    hand: input.hand,
    currentTrick: input.currentTrick,
    leadSuit: input.leadSuit,
    players: toVisiblePlayers(input.players),
    settings: input.settings,
    roundNumber: input.roundNumber,
    isFirstTrick: input.isFirstTrick,
    heartsBroken: input.heartsBroken,
    spadesBroken: input.spadesBroken,
    mandatoryOvertrump: input.mandatoryOvertrump,
  };
}

export class BotEngine {
  private readonly router = new StrategyRouter();

  chooseMove(input: BotEngineInput): BotEngineOutput {
    const strategy = this.router.getStrategy(input.context.gameType);
    const memory = new MemoryTracker(input.context);
    const knowledge = memory.update(input.context);

    const legal = legalMoves(input.context);
    if (legal.length === 0) {
      return {
        cardId: input.context.hand[0]?.id || '',
        intent: 'LOSE_SAFE',
        reason: 'fallback_no_legal_moves_found',
      };
    }

    const decision = strategy.pickMove(input.context, legal, knowledge);
    return {
      cardId: decision.cardId,
      intent: decision.intent,
      reason: decision.reason,
    };
  }

  chooseBid(context: BotTurnContext): number {
    const strategy = this.router.getStrategy(context.gameType);
    const memory = new MemoryTracker(context);
    const knowledge = memory.update(context);
    if (!strategy.pickBid) return 1;
    return strategy.pickBid(context, knowledge).bid;
  }

  choosePass(context: BotTurnContext): string[] {
    const strategy = this.router.getStrategy(context.gameType);
    const memory = new MemoryTracker(context);
    const knowledge = memory.update(context);
    if (!strategy.pickPassCards) return context.hand.slice(0, 3).map((c) => c.id);
    return strategy.pickPassCards(context, knowledge);
  }
}
