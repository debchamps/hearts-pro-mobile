
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
      if (count >= 1 && cards[0].value >= 14) bid += 1.0; // Ace
      if (count >= 2 && cards[0].value >= 13) bid += 0.8; // King
      if (count >= 3 && cards[0].value >= 12) bid += 0.6; // Queen
      if (count > 3) bid += (count - 3) * 0.5;
    } else {
      if (count > 0) {
        if (cards[0].value === 14) bid += 0.8; // Ace
        if (count >= 2 && cards[0].value === 13) bid += 0.4; // King
      }
    }
  });

  // Ruffing potential
  const spadeCount = hand.filter(c => c.suit === 'SPADES').length;
  ['CLUBS', 'DIAMONDS', 'HEARTS'].forEach(s => {
    const count = hand.filter(c => c.suit === s).length;
    if (count === 0 && spadeCount >= 2) bid += 1.0; 
    if (count === 1 && spadeCount >= 3) bid += 0.5;
  });

  return Math.max(1, Math.min(13, Math.round(bid)));
}

/**
 * Strategy-aware move selection implementing the requested intelligent strategies.
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
  await new Promise(r => setTimeout(r, 600));

  const me = players[turnIndex];
  const partnerIdx = (turnIndex + 2) % 4;
  const partner = players[partnerIdx];
  const opponents = [players[(turnIndex + 1) % 4], players[(turnIndex + 3) % 4]];
  
  const teamBid = (me.bid || 0) + (partner.bid || 0);
  const teamTricks = (me.tricksWon || 0) + (partner.tricksWon || 0);
  const tricksNeeded = Math.max(0, teamBid - teamTricks);
  const remainingHandSize = hand.length;
  
  const isPartnerNil = partner.bid === 0;
  const isOpponentNil = opponents.some(o => o.bid === 0);

  // Filter playable cards
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

  if (playable.length === 0) return '';

  // --- LEADING LOGIC ---
  if (!leadSuit || currentTrick.length === 0) {
    // 1. Nil Protection: Lead high to clear path for Nil partner
    if (isPartnerNil) {
      const highCards = playable.filter(c => c.value >= 12).sort((a,b) => b.value - a.value);
      if (highCards.length > 0) return highCards[0].id;
    }

    // 2. Nil Defense: Lead low cards to force the Nil bidder to win
    if (isOpponentNil) {
      const lowCards = playable.filter(c => c.suit !== 'SPADES').sort((a,b) => a.value - b.value);
      if (lowCards.length > 0) return lowCards[0].id;
    }

    // 3. Endgame Certainty: In last 3-4 tricks, lead guaranteed winners if we need them
    if (remainingHandSize <= 4 && tricksNeeded > 0) {
      const highSpades = playable.filter(c => c.suit === 'SPADES' && c.value >= 13);
      if (highSpades.length > 0) return highSpades[0].id;
    }

    // 4. Trump Drain: Lead spades if we have majority and want to exhaust opponents
    const mySpades = playable.filter(c => c.suit === 'SPADES');
    if (spadesBroken && mySpades.length >= 5 && tricksNeeded > 2) {
      return mySpades.sort((a,b) => b.value - a.value)[0].id;
    }

    // 5. Suit Isolation: Lead suits where opponents might be weak
    const suitCounts: Record<string, number> = {};
    hand.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);
    const shortSuits = playable.filter(c => c.suit !== 'SPADES').sort((a,b) => suitCounts[a.suit] - suitCounts[b.suit]);
    if (shortSuits.length > 0) return shortSuits[0].id;

    // Default: Lowest non-spade
    const lowNonSpade = playable.filter(c => c.suit !== 'SPADES').sort((a,b) => a.value - b.value);
    if (lowNonSpade.length > 0) return lowNonSpade[0].id;

    return playable.sort((a,b) => a.value - b.value)[0].id;
  }

  // --- FOLLOWING LOGIC ---
  let winningCard = currentTrick[0].card;
  let winnerId = currentTrick[0].playerId;
  for (let i = 1; i < currentTrick.length; i++) {
    const c = currentTrick[i].card;
    const isSpade = c.suit === 'SPADES';
    const winIsSpade = winningCard.suit === 'SPADES';
    if ((isSpade && !winIsSpade) || (c.suit === winningCard.suit && c.value > winningCard.value)) {
      winningCard = c;
      winnerId = currentTrick[i].playerId;
    }
  }

  const partnerIsWinning = winnerId === partnerIdx;

  // 1. Partner Nil Protection: Overtake partner if they are winning
  if (isPartnerNil && partnerIsWinning) {
    const overtakers = playable.filter(c => {
       const isSpade = c.suit === 'SPADES';
       const winIsSpade = winningCard.suit === 'SPADES';
       if (isSpade && !winIsSpade) return true;
       return c.suit === winningCard.suit && c.value > winningCard.value;
    }).sort((a,b) => a.value - b.value);
    if (overtakers.length > 0) return overtakers[0].id;
  }

  // 2. Ducking: Partner has it, or we don't need it
  if (partnerIsWinning && !isPartnerNil) {
    // If partner has it with an Ace/King, definitely play low
    if (winningCard.value >= 13) return playable.sort((a,b) => a.value - b.value)[0].id;
    // If we have met our bid, play as low as possible (Bag Protection)
    if (tricksNeeded === 0) return playable.sort((a,b) => a.value - b.value)[0].id;
  }

  // 3. Competitive Selection
  const winners = playable.filter(c => {
    const isSpade = c.suit === 'SPADES';
    const winIsSpade = winningCard.suit === 'SPADES';
    if (isSpade && !winIsSpade) return true;
    if (c.suit === winningCard.suit) return c.value > winningCard.value;
    return false;
  }).sort((a,b) => a.value - b.value);

  if (winners.length > 0) {
    // High-Card Conversion: If winning is likely and we need tricks, win with the lowest winner
    if (tricksNeeded > 0 || isOpponentNil) {
      return winners[0].id;
    }
    // If we've already met the bid, don't win unless forced
    return playable.sort((a,b) => a.value - b.value)[0].id;
  }

  // 4. Forced Loss: Play lowest
  return playable.sort((a,b) => a.value - b.value)[0].id;
}
