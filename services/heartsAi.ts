
import { Card, Suit, TrickCard, GameSettings, Player } from "../types";

/**
 * A highly intelligent rule-based AI for Hearts.
 * Focuses on risk management, void creation, and avoiding the Queen of Spades.
 */
export function getBestMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  heartsBroken: boolean,
  isFirstTrick: boolean,
  players: Player[],
  turnIndex: number,
  settings: GameSettings
): string {
  const validHand = hand.filter(c => !!c);
  if (validHand.length === 0) return '';

  // 1. Identify valid moves
  let playable = validHand.filter(card => {
    if (!leadSuit) {
      if (isFirstTrick) return card.id === '2-CLUBS';
      if (!heartsBroken && card.suit === 'HEARTS') {
        // Can only lead hearts if only hearts are left
        return validHand.every(c => c.suit === 'HEARTS');
      }
      return true;
    }
    const hasLeadSuit = validHand.some(c => c.suit === leadSuit);
    if (hasLeadSuit) return card.suit === leadSuit;
    return true; // Discarding
  });

  if (playable.length === 0) playable = validHand;

  // 2. LEADING STRATEGY
  if (!leadSuit || currentTrick.length === 0) {
    if (isFirstTrick) {
      const startCard = playable.find(c => c.id === '2-CLUBS');
      return startCard ? startCard.id : playable[0].id;
    }

    // Heuristic: Avoid leading high cards unless trying to draw out the Queen
    // Prefer leading low of a suit you have few of (to create a void)
    const suitCounts: Record<string, number> = {};
    validHand.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);

    const sortedLeads = [...playable].sort((a, b) => {
      // Avoid leading Spades if holding the Queen or high Spades
      if (a.suit === 'SPADES' && a.value >= 12) return 1;
      if (b.suit === 'SPADES' && b.value >= 12) return -1;
      
      // Prefer suits with fewer cards (to create voids)
      const countA = suitCounts[a.suit];
      const countB = suitCounts[b.suit];
      if (countA !== countB) return countA - countB;
      
      // Within same suit, lead low
      return a.value - b.value;
    });

    return sortedLeads[0].id;
  }

  // 3. FOLLOWING / DISCARDING STRATEGY
  const hasLeadSuit = validHand.some(c => c.suit === leadSuit);
  const trickHasPoints = currentTrick.some(t => t.card.points > 0);
  const trickHasQS = currentTrick.some(t => t.card.id === 'Q-SPADES');

  // Identify the highest card of the lead suit currently in the trick
  const leadSuitCardsInTrick = currentTrick.filter(t => t.card.suit === leadSuit);
  const highestInTrick = [...leadSuitCardsInTrick].sort((a, b) => b.card.value - a.card.value)[0];

  if (hasLeadSuit) {
    // We MUST follow suit
    const suitCards = playable.sort((a, b) => b.value - a.value); // High to low
    
    // If the trick has points, try to duck (play highest card that is still lower than the winner)
    if (trickHasPoints || trickHasQS || currentTrick.length === 3) {
      const losers = suitCards.filter(c => c.value < highestInTrick.card.value);
      if (losers.length > 0) return losers[0].id; // Play highest loser to "bleed" power
      return suitCards[0].id; // Forced to win, play highest to get it over with
    }
    
    // No points yet, stay safe with a medium-low card
    return suitCards[suitCards.length - 1].id;
  } else {
    // DISCARDING - Best part of Hearts AI
    // 1. Dump Queen of Spades immediately
    const qs = playable.find(c => c.id === 'Q-SPADES');
    if (qs) return qs.id;

    // 2. Dump high Hearts
    const hearts = playable.filter(c => c.suit === 'HEARTS').sort((a, b) => b.value - a.value);
    if (hearts.length > 0) return hearts[0].id;

    // 3. Dump high cards of other suits
    const otherHigh = [...playable].sort((a, b) => b.value - a.value);
    return otherHigh[0].id;
  }
}
