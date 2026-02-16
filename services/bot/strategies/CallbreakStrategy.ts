import type { Card } from '../../../types.ts';
import { BidEvaluator } from '../core/BidEvaluator.ts';
import { CardEvaluator } from '../core/CardEvaluator.ts';
import type { BotIntent, BotTurnContext, GameStrategy, StrategyDecision, SuitKnowledge } from '../core/types.ts';

function determineIntent(context: BotTurnContext): BotIntent {
  const me = context.players.find((p) => p.id === context.seatId);
  const bid = me?.bid || 0;
  const won = me?.tricksWon || 0;

  if (won < bid) return 'WIN_TRICK';
  if (context.currentTrick.length === 0) return 'BAIT_OPPONENT';
  if ((context.mandatoryOvertrump || false) && context.currentTrick.some((t) => t.card.suit === 'SPADES')) return 'FORCE_MISTAKE';
  return 'PROTECT_BID';
}

function sortLowestCard(a: Card, b: Card): number {
  if (a.value !== b.value) return a.value - b.value;
  // When tied, preserve trump if possible.
  if (a.suit === 'SPADES' && b.suit !== 'SPADES') return 1;
  if (a.suit !== 'SPADES' && b.suit === 'SPADES') return -1;
  return String(a.suit).localeCompare(String(b.suit));
}

function currentWinningCard(context: BotTurnContext): Card | null {
  if (!context.currentTrick.length) return null;
  const lead = context.currentTrick[0].card.suit;
  let winner = context.currentTrick[0].card;
  for (let i = 1; i < context.currentTrick.length; i++) {
    const c = context.currentTrick[i].card;
    const winnerTrump = winner.suit === 'SPADES';
    const currTrump = c.suit === 'SPADES';
    if (currTrump && !winnerTrump) {
      winner = c;
      continue;
    }
    if (currTrump === winnerTrump) {
      const cmpSuit = winnerTrump ? 'SPADES' : lead;
      if (c.suit === cmpSuit && winner.suit === cmpSuit && c.value > winner.value) winner = c;
    }
  }
  return winner;
}

function canWinCurrentTrick(context: BotTurnContext, card: Card): boolean {
  if (!context.currentTrick.length) return true;
  const winner = currentWinningCard(context);
  if (!winner) return true;
  const winnerTrump = winner.suit === 'SPADES';
  const cardTrump = card.suit === 'SPADES';
  if (cardTrump && !winnerTrump) return true;
  if (cardTrump === winnerTrump && card.suit === winner.suit && card.value > winner.value) return true;
  return false;
}

function highestCard(cards: Card[]): Card {
  return [...cards].sort((a, b) => b.value - a.value)[0];
}

function lowestCard(cards: Card[]): Card {
  return [...cards].sort(sortLowestCard)[0];
}

function parseCardId(cardId: string): { suit: Card['suit']; value: number } {
  const [rank, suit] = cardId.split('-');
  const rankToValue: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    J: 11, Q: 12, K: 13, A: 14,
  };
  return { suit: suit as Card['suit'], value: rankToValue[rank] || 0 };
}

function highestRemainingOfSuit(context: BotTurnContext, memory: SuitKnowledge, suit: Card['suit']): number {
  const playedValues = new Set<number>();
  memory.playedCards.forEach((id) => {
    const parsed = parseCardId(id);
    if (parsed.suit === suit) playedValues.add(parsed.value);
  });
  for (let v = 14; v >= 2; v--) {
    if (!playedValues.has(v)) return v;
  }
  return 2;
}

function allOpponentsLikelyFollowSuit(context: BotTurnContext, memory: SuitKnowledge, suit: Card['suit']): boolean {
  return context.players
    .filter((p) => p.id !== context.seatId)
    .every((p) => !memory.voidSuits[p.id]?.has(suit));
}

function hasSuitLedBefore(memory: SuitKnowledge, suit: Card['suit']): boolean {
  let seen = false;
  memory.playedCards.forEach((id) => {
    if (seen) return;
    if (parseCardId(id).suit === suit) seen = true;
  });
  return seen;
}

function pickAceLead(context: BotTurnContext): Card | null {
  const aces = context.hand.filter((c) => c.value === 14);
  for (const ace of aces) {
    const suited = context.hand.filter((c) => c.suit === ace.suit);
    const hasK = suited.some((c) => c.value === 13);
    const hasQ = suited.some((c) => c.value === 12);
    // Mirror original logic: avoid bare A+Q pattern, prefer when K support exists.
    if (!hasQ || hasK) return ace;
  }
  return null;
}

function pickKQSetupLead(context: BotTurnContext, memory: SuitKnowledge): Card | null {
  const candidates = context.hand.filter((c) => c.value === 13 || c.value === 12);
  for (const kq of candidates) {
    const suited = context.hand.filter((c) => c.suit === kq.suit);
    const hasAce = suited.some((c) => c.value === 14);
    if (hasAce) continue;
    if (hasSuitLedBefore(memory, kq.suit)) continue;
    if (suited.length < 2) continue;
    const lower = suited.filter((c) => c.value < kq.value).sort((a, b) => b.value - a.value);
    if (lower.length) return lower[0];
  }
  return null;
}

function pickWinningSpadeLead(context: BotTurnContext, memory: SuitKnowledge): Card | null {
  if ((context.roundNumber || 1) < 3) return null;
  const spades = context.hand.filter((c) => c.suit === 'SPADES');
  if (!spades.length) return null;
  if (spades.length < Math.floor(context.hand.length / 2) - 1) return null;

  const highSpade = highestCard(spades);
  const topRemainingSpade = highestRemainingOfSuit(context, memory, 'SPADES');
  if (highSpade.value === topRemainingSpade) return highSpade;
  return null;
}

function pickWinningNonSpadeLead(context: BotTurnContext, memory: SuitKnowledge): Card | null {
  const grouped = new Map<Card['suit'], Card[]>();
  context.hand.forEach((c) => {
    if (c.suit === 'SPADES') return;
    const arr = grouped.get(c.suit) || [];
    arr.push(c);
    grouped.set(c.suit, arr);
  });

  for (const [suit, cards] of grouped.entries()) {
    const hi = highestCard(cards);
    const highestRemaining = highestRemainingOfSuit(context, memory, suit);
    if (hi.value !== highestRemaining) continue;
    if (hi.value === 14) continue; // preserve A lead unless needed.
    if (!allOpponentsLikelyFollowSuit(context, memory, suit)) continue;
    return hi;
  }
  return null;
}

function pickLeadCard(context: BotTurnContext, memory: SuitKnowledge): { card: Card; intent: BotIntent; reason: string } {
  const winSpade = pickWinningSpadeLead(context, memory);
  if (winSpade) return { card: winSpade, intent: 'WIN_TRICK', reason: 'first_move_winning_spade_pressure' };

  const ace = pickAceLead(context);
  if (ace) return { card: ace, intent: 'WIN_TRICK', reason: 'first_move_ace_extraction' };

  const kqSetup = pickKQSetupLead(context, memory);
  if (kqSetup) return { card: kqSetup, intent: 'BAIT_OPPONENT', reason: 'first_move_kq_setup_with_lower_card' };

  const winning = pickWinningNonSpadeLead(context, memory);
  if (winning) return { card: winning, intent: 'WIN_TRICK', reason: 'first_move_untrumped_highest_remaining_non_spade' };

  const nonSpades = context.hand.filter((c) => c.suit !== 'SPADES');
  if (nonSpades.length) return { card: lowestCard(nonSpades), intent: 'LOSE_SAFE', reason: 'first_move_low_non_spade_default' };
  return { card: lowestCard(context.hand), intent: 'LOSE_SAFE', reason: 'first_move_lowest_default' };
}

function pickSubsequentCard(context: BotTurnContext, legalMoves: Card[], memory: SuitKnowledge): { card: Card; intent: BotIntent; reason: string } {
  const leadSuit = context.leadSuit;
  const position = context.currentTrick.length + 1;
  const hasLeadSuitCards = !!leadSuit && legalMoves.every((c) => c.suit === leadSuit);

  if (hasLeadSuitCards) {
    if (legalMoves.length === 1) return { card: legalMoves[0], intent: 'PROTECT_BID', reason: 'subsequent_forced_single_follow' };

    if (position === 4) {
      return { card: lowestCard(legalMoves), intent: 'LOSE_SAFE', reason: 'subsequent_4th_position_dump_lowest' };
    }

    const winning = currentWinningCard(context);
    const ace = legalMoves.find((c) => c.value === 14);
    if (ace && winning && winning.suit === leadSuit) {
      return { card: ace, intent: 'WIN_TRICK', reason: 'subsequent_follow_suit_ace_capture' };
    }

    const hi = highestCard(legalMoves);
    const topRemaining = highestRemainingOfSuit(context, memory, hi.suit);
    if (hi.value === topRemaining && canWinCurrentTrick(context, hi)) {
      return { card: hi, intent: 'WIN_TRICK', reason: 'subsequent_follow_suit_highest_remaining_capture' };
    }

    return { card: lowestCard(legalMoves), intent: 'LOSE_SAFE', reason: 'subsequent_follow_suit_default_low' };
  }

  const nonSpades = legalMoves.filter((c) => c.suit !== 'SPADES');
  if (nonSpades.length) {
    return { card: lowestCard(nonSpades), intent: 'LOSE_SAFE', reason: 'subsequent_void_non_spade_discard' };
  }

  return { card: lowestCard(legalMoves), intent: 'LOSE_SAFE', reason: 'subsequent_trump_only_lowest' };
}

export class CallbreakStrategy implements GameStrategy {
  readonly gameType = 'CALLBREAK' as const;

  private readonly evaluator = new CardEvaluator();
  private readonly bidder = new BidEvaluator();

  pickMove(context: BotTurnContext, legalMoves: Card[], memory: SuitKnowledge): StrategyDecision {
    const canAnyWin = legalMoves.some((card) => canWinCurrentTrick(context, card));

    // Tactical floor: if no legal card can win this trick, dump the lowest legal card.
    if (context.currentTrick.length > 0 && !canAnyWin) {
      const card = lowestCard(legalMoves);
      const score = this.evaluator.scoreCard(card, 'LOSE_SAFE', context, memory, 0.24);
      return {
        intent: 'LOSE_SAFE',
        cardId: card.id,
        score,
        reason: 'no_winning_line_available_dump_lowest_card',
      };
    }

    // Borrowed from MoveManager: separate lead and subsequent move intelligence.
    const scripted = context.currentTrick.length === 0
      ? pickLeadCard(context, memory)
      : pickSubsequentCard(context, legalMoves, memory);

    const dynamicIntent = determineIntent(context);
    const finalIntent: BotIntent = scripted.intent === 'LOSE_SAFE' && dynamicIntent === 'WIN_TRICK'
      ? 'PROTECT_BID'
      : scripted.intent;
    const risk = finalIntent === 'WIN_TRICK' ? 0.7 : 0.42;
    const score = this.evaluator.scoreCard(scripted.card, finalIntent, context, memory, risk);

    return {
      intent: finalIntent,
      cardId: scripted.card.id,
      score,
      reason: scripted.reason,
    };
  }

  pickBid(context: BotTurnContext) {
    return this.bidder.evaluateCallbreakBid(context);
  }
}
