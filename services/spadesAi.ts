
import { Card, Suit, TrickCard, Player } from "../types";

/**
 * Intelligent bidding based on high cards, spade length, and distribution.
 * Factors in the probability of winning based on suit depth.
 */
export async function getSpadesBid(hand: Card[]): Promise<number> {
  let bid = 0;
  
  // High card expected wins
  const suits: Suit[] = ['CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES'];
  suits.forEach(s => {
    const cards = hand.filter(c => c.suit === s).sort((a, b) => b.value - a.value);
    const count = cards.length;
    
    if (s === 'SPADES') {
      // Trump is more valuable
      if (count >= 1 && cards[0].value >= 14) bid += 1.0; // Ace
      if (count >= 2 && cards[0].value >= 13) bid += 0.9; // King
      if (count >= 3 && cards[0].value >= 12) bid += 0.8; // Queen
      // Extra length beyond the first 3 cards is usually a trick
      if (count > 3) bid += (count - 3) * 0.7;
    } else {
      if (count > 0) {
        if (cards[0].value === 14) bid += 0.8; // Ace of side suit
        if (count >= 2 && cards[0].value === 13) bid += 0.5; // King of side suit
      }
    }
  });

  // Ruffing potential
  const spadeCount = hand.filter(c => c.suit === 'SPADES').length;
  ['CLUBS', 'DIAMONDS', 'HEARTS'].forEach(s => {
    const count = hand.filter(c => c.suit === s).length;
    if (count === 0 && spadeCount >= 2) bid += 1.0; // Void
    if (count === 1 && spadeCount >= 3) bid += 0.5; // Singleton
  });

  return Math.max(1, Math.min(13, Math.round(bid)));
}

/**
 * Strategy-aware move selection.
 * Recognizes team-play: ducks if partner is winning, takes trick if bid not met.
 */
export async function getSpadesMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  spadesBroken: boolean,
  players: Player[],
  turnIndex: number
): Promise<string> {
  // Artificial delay for UX
  await new Promise(r => setTimeout(r, 800));

  const playable = hand.filter(card => {
    if (!leadSuit) {
      if (!spadesBroken && card.suit === 'SPADES') {
        return hand.every(c => c.suit === 'SPADES');
      }
      return true;
    }
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);
    if (hasLeadSuit) return card.suit === leadSuit;
    return true;
  });

  const me = players[turnIndex];
  const partnerIndex = (turnIndex + 2) % 4;
  const partner = players[partnerIndex];
  
  const teamTricks = (me.tricksWon || 0) + (partner.tricksWon || 0);
  const teamBid = (me.bid || 0) + (partner.bid || 0);
  const needTricks = teamTricks < teamBid;

  // 1. LEADING LOGIC
  if (!leadSuit || currentTrick.length === 0) {
    if (needTricks) {
      // Lead winners
      const winners = playable.filter(c => c.value >= 13).sort((a,b) => b.value - a.value);
      if (winners.length > 0) return winners[0].id;
    }
    // Lead low to stay safe or draw out opponents
    return [...playable].sort((a, b) => a.value - b.value)[0].id;
  }

  // 2. IDENTIFY CURRENT WINNER
  let winningCard = currentTrick[0].card;
  let winnerId = currentTrick[0].playerId;
  for (let i = 1; i < currentTrick.length; i++) {
    const c = currentTrick[i].card;
    const isSpade = c.suit === 'SPADES';
    const winIsSpade = winningCard.suit === 'SPADES';
    
    if (isSpade && !winIsSpade) {
      winningCard = c; winnerId = currentTrick[i].playerId;
    } else if (c.suit === winningCard.suit && c.value > winningCard.value) {
      winningCard = c; winnerId = currentTrick[i].playerId;
    }
  }

  const partnerIsWinning = winnerId === partnerIndex;

  // 3. FOLLOWING LOGIC
  if (partnerIsWinning) {
    // If partner is already winning, dump lowest possible card
    return [...playable].sort((a, b) => a.value - b.value)[0].id;
  }

  if (needTricks) {
    // Try to win with the lowest possible winner
    const winners = playable.filter(c => {
      const isSpade = c.suit === 'SPADES';
      const winIsSpade = winningCard.suit === 'SPADES';
      if (isSpade && !winIsSpade) return true;
      if (c.suit === winningCard.suit) return c.value > winningCard.value;
      return false;
    }).sort((a, b) => a.value - b.value);

    if (winners.length > 0) return winners[0].id;
  }

  // Can't win or don't want to (avoiding bags)
  return [...playable].sort((a, b) => a.value - b.value)[0].id;
}
