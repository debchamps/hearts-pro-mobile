import type { Card } from '../../../types.ts';
import { BidEvaluator } from '../core/BidEvaluator.ts';
import { CardEvaluator } from '../core/CardEvaluator.ts';
import type { BotIntent, BotTurnContext, GameStrategy, StrategyDecision, SuitKnowledge } from '../core/types.ts';

function determineIntent(context: BotTurnContext): BotIntent {
  const me = context.players.find((p) => p.id === context.seatId);
  if (!me) return 'PROTECT_BID';

  const bid = me.bid || 0;
  const tricks = me.tricksWon || 0;
  if (tricks < bid) return 'WIN_TRICK';
  if (tricks > bid) return 'LOSE_SAFE';
  if (context.currentTrick.length === 0) return 'DRAW_TRUMP';
  return 'PROTECT_BID';
}

function sortLowestCard(a: Card, b: Card): number {
  if (a.value !== b.value) return a.value - b.value;
  // When tied, preserve trump if possible.
  if (a.suit === 'SPADES' && b.suit !== 'SPADES') return 1;
  if (a.suit !== 'SPADES' && b.suit === 'SPADES') return -1;
  return String(a.suit).localeCompare(String(b.suit));
}

function sortHighestCard(a: Card, b: Card): number {
  if (a.value !== b.value) return b.value - a.value;
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

function currentWinningSeat(context: BotTurnContext): number | null {
  if (!context.currentTrick.length) return null;
  const lead = context.currentTrick[0].card.suit;
  let winner = context.currentTrick[0];
  for (let i = 1; i < context.currentTrick.length; i++) {
    const t = context.currentTrick[i];
    const winnerTrump = winner.card.suit === 'SPADES';
    const currTrump = t.card.suit === 'SPADES';
    if (currTrump && !winnerTrump) {
      winner = t;
      continue;
    }
    if (currTrump === winnerTrump) {
      const cmpSuit = winnerTrump ? 'SPADES' : lead;
      if (t.card.suit === cmpSuit && winner.card.suit === cmpSuit && t.card.value > winner.card.value) winner = t;
    }
  }
  return winner.playerId;
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

function lowest(cards: Card[]): Card {
  return [...cards].sort(sortLowestCard)[0];
}

function highest(cards: Card[]): Card {
  return [...cards].sort(sortHighestCard)[0];
}

function teamKey(context: BotTurnContext, seatId: number): string {
  const p = context.players.find((x) => x.id === seatId);
  if (p && p.teamId !== undefined && p.teamId !== null) return String(p.teamId);
  return String(seatId % 2);
}

function sameTeam(context: BotTurnContext, a: number, b: number): boolean {
  return teamKey(context, a) === teamKey(context, b);
}

function partnerSeat(context: BotTurnContext): number {
  const explicit = context.players.find((p) => p.id !== context.seatId && sameTeam(context, p.id, context.seatId));
  if (explicit) return explicit.id;
  return (context.seatId + 2) % 4;
}

function isNilActive(context: BotTurnContext, seatId: number): boolean {
  const p = context.players.find((x) => x.id === seatId);
  if (!p) return false;
  return (p.bid || 0) === 0 && (p.tricksWon || 0) === 0;
}

function highestRemainingOfSuit(memory: SuitKnowledge, suit: Card['suit']): number {
  const played = new Set<number>();
  memory.playedCards.forEach((id) => {
    const [rank, s] = id.split('-');
    if (s !== suit) return;
    const map: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
    played.add(map[rank] || 0);
  });
  for (let v = 14; v >= 2; v--) if (!played.has(v)) return v;
  return 2;
}

function aceMove(hand: Card[]): Card | null {
  const aces = hand.filter((c) => c.value === 14);
  for (const ace of aces) {
    const suited = hand.filter((c) => c.suit === ace.suit);
    const hasK = suited.some((c) => c.value === 13);
    const hasQ = suited.some((c) => c.value === 12);
    if (!hasQ || hasK) return ace;
  }
  return null;
}

function playWinningSpadeLead(context: BotTurnContext, memory: SuitKnowledge): Card | null {
  const trickNo = context.roundNumber || 1;
  if (trickNo < 3) return null;
  const hand = context.hand;
  const spades = hand.filter((c) => c.suit === 'SPADES');
  if (!spades.length) return null;
  if (spades.length < Math.floor(hand.length / 2) - 1) return null;
  const hi = highest(spades);
  if (hi.value === highestRemainingOfSuit(memory, 'SPADES')) return hi;
  return null;
}

function playKQSetup(context: BotTurnContext, memory: SuitKnowledge): Card | null {
  const hand = context.hand;
  const kq = hand.filter((c) => c.value === 13 || c.value === 12);
  for (const card of kq) {
    const suited = hand.filter((c) => c.suit === card.suit);
    const hasAce = suited.some((c) => c.value === 14);
    const suitLed = Array.from(memory.playedCards).some((id) => id.endsWith('-' + card.suit));
    if (!hasAce && !suitLed && suited.length >= 2) {
      const lower = suited.filter((c) => c.value < card.value).sort(sortHighestCard);
      if (lower.length) return lower[0];
    }
  }
  return null;
}

function playWinningMinorLead(context: BotTurnContext, memory: SuitKnowledge): Card | null {
  const hand = context.hand;
  for (const suit of ['CLUBS', 'DIAMONDS', 'HEARTS'] as const) {
    const suited = hand.filter((c) => c.suit === suit).sort(sortHighestCard);
    if (!suited.length) continue;
    const top = suited[0];
    if (top.value !== highestRemainingOfSuit(memory, suit)) continue;
    const unsafeToLead = context.players
      .filter((p) => p.id !== context.seatId)
      .some((p) => memory.voidSuits[p.id]?.has(suit));
    if (!unsafeToLead && top.value !== 14) return top;
  }
  return null;
}

function playHighestSuitLowCard(context: BotTurnContext): Card {
  const hand = context.hand;
  const nonSpades = hand.filter((c) => c.suit !== 'SPADES').sort(sortHighestCard);
  if (!nonSpades.length) return lowest(hand);
  const partner = partnerSeat(context);
  if (isNilActive(context, partner)) return nonSpades[0];
  return [...nonSpades].sort(sortLowestCard)[0];
}

function nilStrategy(context: BotTurnContext): Card {
  const legal = context.hand.slice();
  const winner = currentWinningCard(context);
  if (!winner) return lowest(legal);

  const leadSuit = context.leadSuit;
  const roundSuitCards = legal.filter((c) => c.suit === leadSuit).sort(sortHighestCard);
  const allSorted = [...legal].sort(sortHighestCard);

  if (winner.suit === 'SPADES' && leadSuit !== 'SPADES') {
    if (roundSuitCards.length) return roundSuitCards[0];
    const highNonSpade = allSorted.find((c) => c.suit !== 'SPADES');
    if (highNonSpade) return highNonSpade;
    const lowSpade = legal.filter((c) => c.suit === 'SPADES').sort(sortLowestCard)[0];
    return lowSpade || lowest(legal);
  }

  if (roundSuitCards.length) {
    const lower = roundSuitCards.filter((c) => c.value < winner.value).sort(sortHighestCard);
    if (lower.length) return lower[0];
    return roundSuitCards.slice().sort(sortLowestCard)[0];
  }

  if (winner.suit === 'SPADES') {
    const spades = legal.filter((c) => c.suit === 'SPADES');
    if (spades.length) {
      const lowerSpades = spades.filter((c) => c.value < winner.value).sort(sortHighestCard);
      if (lowerSpades.length) return lowerSpades[0];
    }
  }
  const highNonSpade = allSorted.find((c) => c.suit !== 'SPADES');
  if (highNonSpade) return highNonSpade;
  return lowest(legal);
}

function suitedStrategy(context: BotTurnContext, legal: Card[], memory: SuitKnowledge): Card {
  if (legal.length === 1) return legal[0];
  const position = context.currentTrick.length + 1;
  const winnerCard = currentWinningCard(context);
  if (!winnerCard) return lowest(legal);
  const winnerSeat = currentWinningSeat(context) ?? ((context.seatId + 3) % 4);
  const partner = partnerSeat(context);
  const partnerWinning = winnerSeat === partner;
  const partnerNil = isNilActive(context, partner);
  const opponentNil = isNilActive(context, winnerSeat) && !partnerWinning;
  const higher = legal.filter((c) => c.value > winnerCard.value).sort(sortLowestCard);
  const lower = legal.filter((c) => c.value < winnerCard.value).sort(sortHighestCard);
  const myHigh = highest(legal);
  const myLow = lowest(legal);
  const highestRem = highestRemainingOfSuit(memory, myHigh.suit);
  const myHighIsTop = myHigh.value === highestRem;

  if (position === 4) {
    if (partnerWinning) {
      if (partnerNil) return higher.length ? higher[0] : myLow;
      return myLow;
    }
    if (higher.length && !opponentNil) return higher[0];
    return myLow;
  }

  if (partnerWinning) {
    if (partnerNil && higher.length) return highest(higher);
    if (myHighIsTop && canWinCurrentTrick(context, myHigh)) return myHigh;
    return myLow;
  }

  const hasAce = legal.find((c) => c.value === 14);
  if (hasAce && winnerCard.suit === context.leadSuit) return hasAce;
  if (myHighIsTop && canWinCurrentTrick(context, myHigh)) return myHigh;
  return myLow;
}

function trumpStrategy(context: BotTurnContext, legal: Card[]): Card | null {
  const partner = partnerSeat(context);
  const winnerSeat = currentWinningSeat(context) ?? ((context.seatId + 3) % 4);
  const partnerWinning = winnerSeat === partner;
  const partnerNil = isNilActive(context, partner);
  const opponentNil = isNilActive(context, winnerSeat) && !partnerWinning;
  const winnerCard = currentWinningCard(context);
  if (!winnerCard) return lowest(legal);

  if (partnerWinning && !partnerNil) return null;
  if (!partnerWinning && opponentNil) return null;

  const spades = legal.filter((c) => c.suit === 'SPADES').sort(sortLowestCard);
  if (!spades.length) return null;
  if (winnerCard.suit !== 'SPADES') return spades[0];

  const over = spades.filter((c) => c.value > winnerCard.value).sort(sortLowestCard);
  if (over.length) return over[0];
  return null;
}

function nonTrumpNonSuit(context: BotTurnContext): Card {
  const nonSpades = context.hand.filter((c) => c.suit !== 'SPADES');
  if (nonSpades.length) return lowest(nonSpades);
  return lowest(context.hand);
}

function playToWin(context: BotTurnContext, memory: SuitKnowledge): Card {
  if (context.currentTrick.length === 0) {
    const ace = aceMove(context.hand);
    if (ace) return ace;
    const winSpade = playWinningSpadeLead(context, memory);
    if (winSpade) return winSpade;
    const kq = playKQSetup(context, memory);
    if (kq) return kq;
    const winMinor = playWinningMinorLead(context, memory);
    if (winMinor) return winMinor;
    return playHighestSuitLowCard(context);
  }

  const legal = context.hand;
  const hasLead = legal.every((c) => c.suit === (context.leadSuit || c.suit));
  if (hasLead) return suitedStrategy(context, legal, memory);
  const trump = trumpStrategy(context, legal);
  if (trump) return trump;
  return nonTrumpNonSuit(context);
}

function chooseSpadesMove(context: BotTurnContext, memory: SuitKnowledge): { card: Card; reason: string; intent: BotIntent } {
  const me = context.players.find((p) => p.id === context.seatId);
  if (!me) return { card: lowest(context.hand), reason: 'spades_fallback_low', intent: 'PROTECT_BID' };
  const partner = partnerSeat(context);
  const teamMembers = context.players.filter((p) => sameTeam(context, p.id, context.seatId));
  const oppMembers = context.players.filter((p) => !sameTeam(context, p.id, context.seatId));
  const teamTarget = teamMembers.reduce((s, p) => s + (p.bid || 0), 0);
  const teamAchieved = teamMembers.reduce((s, p) => s + (p.tricksWon || 0), 0);
  const oppTarget = oppMembers.reduce((s, p) => s + (p.bid || 0), 0);
  const oppAchieved = oppMembers.reduce((s, p) => s + (p.tricksWon || 0), 0);

  if ((me.bid || 0) === 0 && (me.tricksWon || 0) === 0) {
    return { card: nilStrategy(context), reason: 'spades_nil_strategy', intent: 'LOSE_SAFE' };
  }

  if (teamAchieved < teamTarget) {
    return { card: playToWin(context, memory), reason: 'spades_team_under_target_play_to_win', intent: 'WIN_TRICK' };
  }

  if (oppAchieved > oppTarget) {
    return { card: nonTrumpNonSuit(context), reason: 'spades_opponent_bag_pressure_play_safe', intent: 'LOSE_SAFE' };
  }

  // Slightly favor partner nil protection when already on target.
  if (isNilActive(context, partner)) {
    return { card: playToWin(context, memory), reason: 'spades_partner_nil_protection', intent: 'PROTECT_BID' };
  }

  return { card: playToWin(context, memory), reason: 'spades_balanced_play_to_win', intent: determineIntent(context) };
}

export class SpadesStrategy implements GameStrategy {
  readonly gameType = 'SPADES' as const;

  private readonly evaluator = new CardEvaluator();
  private readonly bidder = new BidEvaluator();

  pickMove(context: BotTurnContext, legalMoves: Card[], memory: SuitKnowledge): StrategyDecision {
    // Tactical floor: if no legal card can win this trick, dump the lowest legal card.
    const canAnyWin = legalMoves.some((card) => canWinCurrentTrick(context, card));
    if (context.currentTrick.length > 0 && !canAnyWin) {
      const card = [...legalMoves].sort(sortLowestCard)[0];
      const score = this.evaluator.scoreCard(card, 'LOSE_SAFE', context, memory, 0.22);
      return { intent: 'LOSE_SAFE', cardId: card.id, score, reason: 'no_winning_line_available_dump_lowest_card' };
    }

    const scripted = chooseSpadesMove({ ...context, hand: legalMoves }, memory);
    const intent = scripted.intent;
    const risk = intent === 'WIN_TRICK' ? 0.72 : 0.38;
    const score = this.evaluator.scoreCard(scripted.card, intent, context, memory, risk);

    return {
      intent,
      cardId: scripted.card.id,
      score,
      reason: scripted.reason,
    };
  }

  pickBid(context: BotTurnContext) {
    return this.bidder.evaluateSpadesBid(context);
  }
}
