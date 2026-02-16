import type { Card } from '../../../types.ts';
import { BOT_METADATA } from './metadata.ts';
import type { BotIntent, BotTurnContext, CardScoreBreakdown, SuitKnowledge } from './types.ts';

function leadingCardOfTrick(context: BotTurnContext): Card | null {
  return context.currentTrick.length > 0 ? context.currentTrick[0].card : null;
}

export class CardEvaluator {
  scoreCard(card: Card, intent: BotIntent, context: BotTurnContext, memory: SuitKnowledge, riskTolerance: number): CardScoreBreakdown {
    const lead = leadingCardOfTrick(context);
    const weights = BOT_METADATA.scoringWeights;

    let trickWinValue = 0;
    if (!lead) trickWinValue = card.value / 14;
    else if (card.suit === lead.suit) trickWinValue = card.value / 14;
    else if (context.gameType !== 'HEARTS' && card.suit === 'SPADES') trickWinValue = 0.95;

    const safetyValue = 1 - (card.value / 14) * (1 - riskTolerance);
    const futureHandValue = (card.suit === 'SPADES' ? 0.15 : 0.05) + (card.value <= 8 ? 0.25 : 0);

    const opponentReadValue = (() => {
      const nextSeat = (context.seatId + 1) % 4;
      const nextVoidLead = lead ? memory.voidSuits[nextSeat]?.has(lead.suit) : false;
      return nextVoidLead ? 0.35 : 0.05;
    })();

    const scorePressure = (() => {
      const me = context.players.find((p) => p.id === context.seatId);
      if (!me) return 0;
      const worstOpp = Math.max(...context.players.filter((p) => p.id !== me.id).map((p) => p.score));
      return me.score < worstOpp ? 0.25 : -0.1;
    })();

    const penaltyRisk = (() => {
      if (context.gameType !== 'HEARTS') return 0;
      if (card.suit === 'HEARTS') return 0.45;
      if (card.id === 'Q-SPADES') return 0.95;
      return 0.05;
    })();

    const intentBoost = (() => {
      switch (intent) {
        case 'WIN_TRICK': return trickWinValue * 0.25;
        case 'LOSE_SAFE': return safetyValue * 0.22;
        case 'BURN_HIGH': return card.value >= 11 ? 0.18 : 0;
        case 'BAIT_OPPONENT': return opponentReadValue * 0.3;
        case 'DRAW_TRUMP': return card.suit === 'SPADES' ? 0.2 : 0;
        case 'AVOID_PENALTY': return -penaltyRisk * 0.35;
        case 'PROTECT_BID': return trickWinValue * 0.2 + safetyValue * 0.12;
        case 'FORCE_MISTAKE': return opponentReadValue * 0.33 + trickWinValue * 0.12;
        default: return 0;
      }
    })();

    const total =
      trickWinValue * weights.trickWinValue +
      safetyValue * weights.safetyValue +
      futureHandValue * weights.futureHandValue +
      opponentReadValue * weights.opponentReadValue +
      scorePressure * weights.scorePressure -
      penaltyRisk * weights.penaltyRisk +
      intentBoost;

    return {
      trickWinValue,
      safetyValue,
      futureHandValue,
      opponentReadValue,
      scorePressure,
      penaltyRisk,
      total,
    };
  }
}
