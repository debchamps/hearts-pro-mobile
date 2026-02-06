import { Card, Suit, TrickCard } from "../types";

/**
 * A highly intelligent rule-based AI for Hearts.
 * Logic based on standard winning strategies: ducking points, bleeding suits, and short-suit discard.
 */
export async function getBestMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  heartsBroken: boolean,
  isFirstTrick: boolean,
  playerName: string
): Promise<string> {
  // Artificial delay to simulate "thinking"
  await new Promise(r => setTimeout(r, 800));

  // Filter out any invalid cards just in case
  const validHand = hand.filter(c => c !== null && c !== undefined);

  const validCards = validHand.filter(card => {
    if (!leadSuit) {
      if (isFirstTrick) return card.id === '2-CLUBS';
      if (!heartsBroken && card.suit === 'HEARTS') {
        return validHand.every(c => c && c.suit === 'HEARTS');
      }
      return true;
    }
    const hasLeadSuit = validHand.some(c => c && c.suit === leadSuit);
    if (hasLeadSuit) return card.suit === leadSuit;
    return true; // Discarding
  });

  const playable = validCards.length > 0 ? validCards : validHand;
  if (playable.length === 0) return ''; // Should not happen in a normal game state

  // LEADING LOGIC
  if (!leadSuit || currentTrick.length === 0) {
    if (isFirstTrick) {
      const startCard = playable.find(c => c.id === '2-CLUBS');
      return startCard ? startCard.id : (playable[0]?.id || '');
    }

    const sortedLowToHigh = [...playable].sort((a, b) => a.value - b.value);
    const lowSpade = playable.find(c => c.suit === 'SPADES' && c.value < 12);
    if (lowSpade) return lowSpade.id;

    return sortedLowToHigh[0]?.id || playable[0]?.id || '';
  }

  // FOLLOWING LOGIC
  const currentLeadSuit = leadSuit;
  const hasLeadSuit = validHand.some(c => c && c.suit === currentLeadSuit);
  const trickHasPoints = currentTrick.some(t => t.card && t.card.points > 0);
  
  // Find highest card of the lead suit in the trick
  const suitCardsInTrick = currentTrick.filter(t => t.card && t.card.suit === currentLeadSuit);
  const highestInTrick = suitCardsInTrick.sort((a, b) => {
    if (!a.card || !b.card) return 0;
    return b.card.value - a.card.value;
  })[0];

  if (hasLeadSuit && highestInTrick && highestInTrick.card) {
    // We must follow suit.
    const suitCards = playable.filter(c => c.suit === currentLeadSuit).sort((a, b) => b.value - a.value); // high to low
    
    if (trickHasPoints || currentTrick.length === 3) {
      // Try to duck
      const losers = suitCards.filter(c => c.value < (highestInTrick.card?.value || 0));
      if (losers.length > 0) return losers[0].id; 
      return suitCards[suitCards.length - 1].id; 
    } else {
      return suitCards[suitCards.length - 1].id; 
    }
  } else {
    // DISCARDING LOGIC
    const qSpades = playable.find(c => c.id === 'Q-SPADES');
    if (qSpades) return qSpades.id;

    const hearts = playable.filter(c => c.suit === 'HEARTS').sort((a, b) => b.value - a.value);
    if (hearts.length > 0) return hearts[0].id;

    const sortedHighToLow = [...playable].sort((a, b) => b.value - a.value);
    return sortedHighToLow[0]?.id || playable[0]?.id || '';
  }
}
