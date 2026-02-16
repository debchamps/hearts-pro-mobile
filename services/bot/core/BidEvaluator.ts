import type { Card, Suit } from '../../../types.ts';
import { BOT_METADATA } from './metadata.ts';
import type { BidDecision, BotTurnContext } from './types.ts';

function bySuit(hand: Card[], suit: Suit): Card[] {
  return hand.filter((c) => c.suit === suit).sort((a, b) => b.value - a.value);
}

function hasRank(cards: Card[], minValue: number): boolean {
  return cards.some((c) => c.value >= minValue);
}

function expectedWinnersInSideSuit(cards: Card[]): { sure: number; likely: number } {
  if (cards.length === 0) return { sure: 0, likely: 0 };

  let sure = 0;
  let likely = 0;
  const hasAce = hasRank(cards, 14);
  const hasKing = hasRank(cards, 13);
  const hasQueen = hasRank(cards, 12);
  const hasJack = hasRank(cards, 11);

  if (hasAce) sure += 0.95;
  if (hasKing) {
    likely += hasAce ? 0.65 : (cards.length <= 3 ? 0.45 : 0.28);
  }
  if (hasQueen) {
    likely += hasAce && hasKing ? 0.45 : (cards.length <= 2 ? 0.25 : 0.12);
  }
  if (hasJack && cards.length <= 2) likely += 0.08;

  return { sure, likely };
}

function expectedWinnersInTrump(trumps: Card[]): { sure: number; likely: number } {
  let sure = 0;
  let likely = 0;
  const trumpLen = trumps.length;

  trumps.forEach((c) => {
    if (c.value === 14) {
      sure += 0.98;
      return;
    }
    if (c.value === 13) {
      likely += trumpLen >= 4 ? 0.78 : 0.6;
      return;
    }
    if (c.value === 12) {
      likely += trumpLen >= 5 ? 0.58 : 0.42;
      return;
    }
    if (c.value === 11) {
      likely += trumpLen >= 5 ? 0.4 : 0.26;
      return;
    }
    if (c.value === 10) {
      likely += trumpLen >= 6 ? 0.28 : 0.16;
    }
  });

  return { sure, likely };
}

function hasCardByValue(cards: Card[], value: number): boolean {
  return cards.some((c) => c.value === value);
}

function nonTrumpCardWinProbability(card: Card, suitCards: Card[]): number {
  const suitedCount = suitCards.length;
  const hasAce = hasCardByValue(suitCards, 14);

  if (card.value === 14) return 1.0;

  if (card.value === 13) {
    if (hasAce) {
      if (suitedCount === 2) return 1.0;
      if (suitedCount === 3) return 0.8;
      if (suitedCount === 4) return 0.3;
      return 0.1;
    }
    if (suitedCount === 1) return 0;
    if (suitedCount === 2) return 0.5;
    if (suitedCount === 3) return 0.6;
    if (suitedCount === 4) return 0.3;
    return 0.1;
  }

  if (card.value === 12) {
    if (hasAce) {
      if (suitedCount === 2 || suitedCount === 3) return 0.4;
      if (suitedCount === 4) return 0.1;
      return 0;
    }
    if (suitedCount === 1) return 0;
    if (suitedCount === 2) return 0.4;
    if (suitedCount === 3) return 0.3;
    return 0;
  }

  return 0;
}

function trumpableVoidPotential(sideSuits: Card[][]): number {
  return sideSuits.reduce((acc, cards) => acc + Math.max(0, 3 - cards.length), 0);
}

function trumpPoint(spades: Card[], sideSuits: Card[][]): number {
  const trumpable = trumpableVoidPotential(sideSuits);
  const spadeCount = spades.length;
  if (spadeCount <= 1) return 0;
  if (spadeCount === 2) return Math.min(1, trumpable);
  if (spadeCount === 3) return Math.min(2, trumpable);
  return Math.min(3, trumpable);
}

function extraTrumpSuitPoint(spades: Card[]): number {
  const hasSpadeAce = hasCardByValue(spades, 14);
  const hasSpadeKing = hasCardByValue(spades, 13);
  let limit = 5;
  if (hasSpadeAce && hasSpadeKing) limit = 4;
  else if (hasSpadeAce) limit = 4.5;
  return Math.max(0, spades.length - limit);
}

export class BidEvaluator {
  evaluateSpadesBid(context: BotTurnContext): BidDecision {
    const hand = context.hand;
    const trumps = bySuit(hand, 'SPADES');
    const sideSuits = (['CLUBS', 'DIAMONDS', 'HEARTS'] as Suit[]).map((suit) => bySuit(hand, suit));

    // Ported core from Spades ComputerBidder.cs:
    // total ~= nonTrumpHonorProbability + trumpPoint + extraTrumpSuitPoint - deduction
    const nonTrumpPoints = sideSuits.reduce((acc, suitCards) => {
      return acc + suitCards.reduce((sum, card) => sum + nonTrumpCardWinProbability(card, suitCards), 0);
    }, 0);
    const trumpPoints = trumpPoint(trumps, sideSuits);
    const extraTrumpPoints = extraTrumpSuitPoint(trumps);
    const baseTotal = nonTrumpPoints + trumpPoints + extraTrumpPoints;
    const bidDeduction = baseTotal >= 8 ? 2 : baseTotal >= 5 ? 1 : 0;
    const initialBid = Math.round(baseTotal - bidDeduction);

    const canProceedWithNil = (() => {
      const nonSpades = sideSuits;
      if (trumps.length > 3) return false;
      if (trumps.some((c) => c.value > 11)) return false; // Q/K/A in spades blocks nil.
      for (const suitCards of nonSpades) {
        if (suitCards.length <= 3 && suitCards.some((c) => c.value > 11)) return false;
      }
      return true;
    })();

    const knownOtherBids = context.players
      .filter((p) => p.id !== context.seatId && typeof p.bid === 'number')
      .reduce((s, p) => s + (p.bid || 0), 0);
    const maxAllowedBid = Math.max(0, 13 - knownOtherBids);

    let bid = initialBid <= 1 && canProceedWithNil ? 0 : Math.max(1, initialBid);
    bid = Math.min(13, Math.min(maxAllowedBid, bid));

    return {
      bid,
      expectedTricks: Number((baseTotal - bidDeduction).toFixed(2)),
      confidence: canProceedWithNil && bid === 0 ? 0.78 : 0.8,
      reason: canProceedWithNil && bid === 0
        ? 'spades_bidder_nil_from_low_spade_risk_and_short_side_suit_high_card_constraints'
        : 'spades_bidder_from_computerbidder_nontrump_prob_trumpability_and_extra_spade_points',
    };
  }

  evaluateCallbreakBid(context: BotTurnContext): BidDecision {
    const hand = context.hand;
    const trumps = bySuit(hand, 'SPADES');
    const sideSuits = (['CLUBS', 'DIAMONDS', 'HEARTS'] as Suit[]).map((suit) => bySuit(hand, suit));
    const trumpEval = expectedWinnersInTrump(trumps);

    // Ported from ComputerBidder.cs:
    // bid ~= nonTrumpHonorProbability + trumpPoint + extraTrumpSuitPoint - deduction.
    const nonTrumpPoints = sideSuits.reduce((acc, suitCards) => {
      return acc + suitCards.reduce((sum, card) => sum + nonTrumpCardWinProbability(card, suitCards), 0);
    }, 0);
    const trumpPoints = trumpPoint(trumps, sideSuits);
    const extraTrumpPoints = extraTrumpSuitPoint(trumps);
    const baseTotal = nonTrumpPoints + trumpPoints + extraTrumpPoints;
    const bidDeduction = baseTotal >= 8 ? 2 : baseTotal >= 5 ? 1 : 0;

    // Modern refinements: account for direct trump winner quality and round pressure.
    let sure = trumpEval.sure;
    let likely = trumpEval.likely;
    sideSuits.forEach((cards) => {
      const suitEval = expectedWinnersInSideSuit(cards);
      sure += suitEval.sure;
      likely += suitEval.likely;
    });
    const refinedWinners = (sure * 0.15) + (likely * 0.08);

    const me = context.players.find((p) => p.id === context.seatId);
    const bestOpp = Math.max(...context.players.filter((p) => p.id !== context.seatId).map((p) => p.score));
    const scorePressure = me && me.score < bestOpp ? 0.18 : -0.04;
    const riskPenalty = context.players.some((p) => p.score >= 4) ? 0.22 : 0.14;

    const rawExpected = baseTotal - bidDeduction + refinedWinners + scorePressure - riskPenalty;
    const conservative = rawExpected * BOT_METADATA.heuristics.callbreak.conservativeBidFactor;
    const bid = Math.max(1, Math.min(8, Math.round(conservative)));

    return {
      bid,
      expectedTricks: Number(rawExpected.toFixed(2)),
      confidence: 0.82,
      reason: 'callbreak_bid_from_computerbidder_nontrump_prob_trumpability_and_refined_trump_quality',
    };
  }
}
