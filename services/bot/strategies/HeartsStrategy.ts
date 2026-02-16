import type { Card } from '../../../types.ts';
import { CardEvaluator } from '../core/CardEvaluator.ts';
import { BOT_METADATA } from '../core/metadata.ts';
import type { BotIntent, BotTurnContext, GameStrategy, StrategyDecision, SuitKnowledge } from '../core/types.ts';

function intentForHearts(context: BotTurnContext, memory: SuitKnowledge): BotIntent {
  const me = context.players.find((p) => p.id === context.seatId);
  if (!me) return 'AVOID_PENALTY';

  const maxOpp = Math.max(...context.players.filter((p) => p.id !== me.id).map((p) => p.score));
  const trailing = me.score < maxOpp;
  const qsPlayed = memory.playedCards.has('Q-SPADES');

  if (!qsPlayed && context.hand.some((c) => c.id === 'Q-SPADES')) return 'AVOID_PENALTY';
  if (trailing) return 'FORCE_MISTAKE';
  if (context.currentTrick.some((t) => t.card.points > 0)) return 'LOSE_SAFE';
  return 'BURN_HIGH';
}

function sortAsc(a: Card, b: Card): number {
  if (a.value !== b.value) return a.value - b.value;
  return String(a.suit).localeCompare(String(b.suit));
}

function sortDesc(a: Card, b: Card): number {
  if (a.value !== b.value) return b.value - a.value;
  return String(a.suit).localeCompare(String(b.suit));
}

function highestRemainingOfSuit(memory: SuitKnowledge, suit: Card['suit']): number {
  const played = new Set<number>();
  memory.playedCards.forEach((id) => {
    const [rank, s] = id.split('-');
    if (s !== suit) return;
    const map: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
    played.add(map[rank] || 0);
  });
  for (let v = 14; v >= 2; v--) {
    if (!played.has(v)) return v;
  }
  return 2;
}

function currentWinningCard(context: BotTurnContext): Card | null {
  if (!context.currentTrick.length) return null;
  const lead = context.currentTrick[0].card.suit;
  let winner = context.currentTrick[0].card;
  for (let i = 1; i < context.currentTrick.length; i++) {
    const c = context.currentTrick[i].card;
    if (c.suit === lead && winner.suit === lead && c.value > winner.value) winner = c;
  }
  return winner;
}

function isShootMoonPossible(context: BotTurnContext): boolean {
  let count = 0;
  context.players.forEach((p) => {
    if ((p.currentRoundScore || 0) > 0) count += 1;
  });
  return count <= 1;
}

function isPlayerTryingShootMoon(context: BotTurnContext, playerId: number): boolean {
  if (!isShootMoonPossible(context)) return false;
  const p = context.players.find((x) => x.id === playerId);
  return (p?.currentRoundScore || 0) >= 2;
}

function preferredLeadCard(context: BotTurnContext, memory: SuitKnowledge): { card: Card; reason: string } {
  const hand = context.hand.slice();
  const grouped = {
    CLUBS: hand.filter((c) => c.suit === 'CLUBS'),
    DIAMONDS: hand.filter((c) => c.suit === 'DIAMONDS'),
    SPADES: hand.filter((c) => c.suit === 'SPADES'),
    HEARTS: hand.filter((c) => c.suit === 'HEARTS'),
  };

  // First trick lead hard-rule mirror.
  if (context.isFirstTrick) {
    const twoClubs = hand.find((c) => c.id === '2-CLUBS');
    if (twoClubs) return { card: twoClubs, reason: 'first_move_mandatory_two_clubs' };
  }

  // Lead a safe low spade below Q if Q/A/K is not in hand.
  const highSpades = grouped.SPADES.filter((c) => c.value >= 12);
  if (!highSpades.length) {
    const smallSpades = grouped.SPADES.filter((c) => c.value <= 11).sort(sortAsc);
    if (smallSpades.length) return { card: smallSpades[0], reason: 'first_move_low_spade_below_q' };
  }

  // Diamond/club high push if we own highest remaining of suit, else low.
  for (const suit of ['DIAMONDS', 'CLUBS'] as const) {
    const suitCards = grouped[suit].slice().sort(sortDesc);
    if (!suitCards.length) continue;
    const top = suitCards[0];
    const highestRemaining = highestRemainingOfSuit(memory, suit);
    if (top.value === highestRemaining && top.value >= 11) {
      return { card: top, reason: 'first_move_highest_remaining_non_penalty_suit' };
    }
    const low = grouped[suit].slice().sort(sortAsc)[0];
    if (low) return { card: low, reason: 'first_move_low_non_penalty_suit' };
  }

  const smallHearts = grouped.HEARTS.filter((c) => c.value <= 4).sort(sortAsc);
  if (smallHearts.length) return { card: smallHearts[0], reason: 'first_move_small_heart' };

  return { card: hand.slice().sort(sortAsc)[0], reason: 'first_move_default_low' };
}

function subsequentHeartsCard(context: BotTurnContext): { card: Card; reason: string } {
  const cards = context.hand.filter((c) => c.suit === 'HEARTS').sort(sortDesc);
  if (!cards.length) return { card: context.hand.slice().sort(sortAsc)[0], reason: 'subsequent_heart_fallback_low' };
  if (cards.length === 1) return { card: cards[0], reason: 'subsequent_heart_singleton' };

  const winner = currentWinningCard(context);
  if (!winner) return { card: cards[cards.length - 1], reason: 'subsequent_heart_no_winner_low' };

  const lower = cards.filter((c) => c.value < winner.value).sort(sortDesc);
  const higher = cards.filter((c) => c.value > winner.value).sort(sortDesc);

  if (lower.length) {
    const currentWinnerSeat = context.currentTrick.reduce((best, t) => (t.card.suit === 'HEARTS' && t.card.value > best.card.value ? t : best), context.currentTrick[0]).playerId;
    if (isPlayerTryingShootMoon(context, currentWinnerSeat)) return { card: lower[lower.length - 1], reason: 'subsequent_heart_block_moon_with_low' };
    return { card: lower[0], reason: 'subsequent_heart_highest_losing_dump' };
  }

  if (isShootMoonPossible(context) && higher.length > 1) return { card: higher[1], reason: 'subsequent_heart_second_highest_when_moon_open' };
  return { card: higher[0] || cards[cards.length - 1], reason: 'subsequent_heart_forced_win' };
}

function subsequentSpadesCard(context: BotTurnContext): { card: Card; reason: string } {
  const cards = context.hand.filter((c) => c.suit === 'SPADES').sort(sortDesc);
  if (!cards.length) return { card: context.hand.slice().sort(sortAsc)[0], reason: 'subsequent_spade_fallback_low' };
  const winner = currentWinningCard(context);
  if (!winner) return { card: cards[cards.length - 1], reason: 'subsequent_spade_no_winner_low' };
  const lower = cards.filter((c) => c.value < winner.value).sort(sortDesc);
  const higher = cards.filter((c) => c.value > winner.value).sort(sortDesc);
  const hasQS = cards.some((c) => c.id === 'Q-SPADES');

  if (winner.value >= 13 && hasQS) return { card: cards.find((c) => c.id === 'Q-SPADES')!, reason: 'subsequent_spade_dump_q_under_ak' };
  if (winner.value === 12) return { card: (lower[0] || higher[higher.length - 1] || cards[cards.length - 1]), reason: 'subsequent_spade_under_or_over_q' };

  const nonQ = cards.filter((c) => c.id !== 'Q-SPADES');
  if (context.currentTrick.length === 3 && !context.currentTrick.some((t) => t.card.points > 0) && nonQ.length) {
    return { card: nonQ.sort(sortDesc)[0], reason: 'subsequent_spade_fourth_avoid_q_when_zero_points' };
  }
  if (lower.length) return { card: lower[0], reason: 'subsequent_spade_highest_losing' };
  if (nonQ.length) return { card: nonQ.sort(sortAsc)[0], reason: 'subsequent_spade_low_non_q' };
  return { card: cards[cards.length - 1], reason: 'subsequent_spade_default_low' };
}

function subsequentClubDiamondCard(context: BotTurnContext, memory: SuitKnowledge): { card: Card; reason: string } {
  const leadSuit = context.leadSuit as Card['suit'];
  const cards = context.hand.filter((c) => c.suit === leadSuit).sort(sortDesc);
  if (!cards.length) return { card: context.hand.slice().sort(sortAsc)[0], reason: 'subsequent_minor_fallback_low' };
  const winner = currentWinningCard(context);
  if (!winner) return { card: cards[cards.length - 1], reason: 'subsequent_minor_no_winner_low' };

  const higher = cards.filter((c) => c.value > winner.value).sort(sortAsc);
  const lower = cards.filter((c) => c.value < winner.value).sort(sortDesc);
  const top = cards[0];
  const highestRemaining = highestRemainingOfSuit(memory, leadSuit);
  if (top.value === highestRemaining && higher.length) return { card: higher[0], reason: 'subsequent_minor_capture_with_smallest_winner' };
  if (lower.length) return { card: lower[0], reason: 'subsequent_minor_highest_losing' };
  return { card: cards[cards.length - 1], reason: 'subsequent_minor_default_low' };
}

function offSuitCard(context: BotTurnContext): { card: Card; reason: string } {
  const hand = context.hand.slice();
  const qs = hand.find((c) => c.id === 'Q-SPADES');
  if (qs) return { card: qs, reason: 'offsuit_dump_q_spades' };

  const highHearts = hand.filter((c) => c.suit === 'HEARTS').sort(sortDesc);
  if (highHearts.length) return { card: highHearts[0], reason: 'offsuit_dump_high_heart' };

  const highSpades = hand.filter((c) => c.suit === 'SPADES' && c.value >= 13).sort(sortDesc);
  if (highSpades.length) return { card: highSpades[0], reason: 'offsuit_dump_high_spade' };

  return { card: hand.sort(sortDesc)[0], reason: 'offsuit_dump_highest_card' };
}

export class HeartsStrategy implements GameStrategy {
  readonly gameType = 'HEARTS' as const;

  private readonly evaluator = new CardEvaluator();

  pickMove(context: BotTurnContext, legalMoves: Card[], memory: SuitKnowledge): StrategyDecision {
    const intent = intentForHearts(context, memory);
    const risk = 0.35;
    let picked: { card: Card; reason: string };

    if (context.currentTrick.length === 0) {
      picked = preferredLeadCard({ ...context, hand: legalMoves }, memory);
    } else if (legalMoves.every((c) => c.suit === (context.leadSuit || c.suit))) {
      if (context.leadSuit === 'HEARTS') picked = subsequentHeartsCard({ ...context, hand: legalMoves });
      else if (context.leadSuit === 'SPADES') picked = subsequentSpadesCard({ ...context, hand: legalMoves });
      else picked = subsequentClubDiamondCard({ ...context, hand: legalMoves }, memory);
    } else {
      picked = offSuitCard({ ...context, hand: legalMoves });
    }

    const score = this.evaluator.scoreCard(picked.card, intent, context, memory, risk);
    if (picked.card.id === 'Q-SPADES') score.total -= BOT_METADATA.heuristics.hearts.queenDangerBoost;
    if (picked.card.suit === 'HEARTS' && context.currentTrick.length < 2) score.total -= BOT_METADATA.heuristics.hearts.earlyHighCardPenalty / 10;

    return {
      intent,
      cardId: picked.card.id,
      score,
      reason: picked.reason,
    };
  }

  pickPassCards(context: BotTurnContext): string[] {
    const danger = [...context.hand].sort((a, b) => {
      const riskA = (a.id === 'Q-SPADES' ? 50 : 0) + (a.suit === 'HEARTS' ? 20 : 0) + a.value;
      const riskB = (b.id === 'Q-SPADES' ? 50 : 0) + (b.suit === 'HEARTS' ? 20 : 0) + b.value;
      return riskB - riskA;
    });
    const picked: Card[] = [];
    const twoClubs = context.hand.find((c) => c.id === '2-CLUBS');
    if (twoClubs) picked.push(twoClubs);
    for (const card of danger) {
      if (picked.find((c) => c.id === card.id)) continue;
      picked.push(card);
      if (picked.length >= 3) break;
    }
    return picked.slice(0, 3).map((c) => c.id);
  }
}
