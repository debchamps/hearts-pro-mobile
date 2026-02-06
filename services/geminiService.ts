
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

  const validCards = hand.filter(card => {
    if (!leadSuit) {
      if (isFirstTrick) return card.id === '2-CLUBS';
      if (!heartsBroken && card.suit === 'HEARTS') {
        return hand.every(c => c.suit === 'HEARTS');
      }
      return true;
    }
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);
    if (hasLeadSuit) return card.suit === leadSuit;
    return true; // Discarding
  });

  const playable = validCards.length > 0 ? validCards : hand;

  // LEADING LOGIC
  if (!leadSuit) {
    if (isFirstTrick) return '2-CLUBS';

    // Strategy: Lead low cards to stay safe, or lead high if trying to pull out the Queen.
    // Avoid leading high hearts or high spades.
    const sortedLowToHigh = [...playable].sort((a, b) => a.value - b.value);
    
    // Prefer leading a low Spade (not the Queen) to smoke out the Queen or bleed others
    const lowSpade = playable.find(c => c.suit === 'SPADES' && c.value < 12);
    if (lowSpade) return lowSpade.id;

    // Default: play lowest card to avoid taking trick
    return sortedLowToHigh[0].id;
  }

  // FOLLOWING LOGIC
  const currentLeadSuit = leadSuit;
  const hasLeadSuit = hand.some(c => c.suit === currentLeadSuit);
  const trickHasPoints = currentTrick.some(t => t.card.points > 0);
  const highestInTrick = currentTrick
    .filter(t => t.card.suit === currentLeadSuit)
    .sort((a, b) => b.card.value - a.card.value)[0];

  if (hasLeadSuit) {
    // We must follow suit.
    const suitCards = playable.sort((a, b) => b.value - a.value); // high to low
    
    if (trickHasPoints || currentTrick.length === 3) {
      // Try to duck (play lowest card that doesn't win, or lowest if must win)
      const winners = suitCards.filter(c => c.value > highestInTrick.card.value);
      const losers = suitCards.filter(c => c.value < highestInTrick.card.value);
      
      if (losers.length > 0) return losers[0].id; // Play highest loser (ducking effectively)
      return suitCards[suitCards.length - 1].id; // Must win, play lowest winner
    } else {
      // Safe trick so far, play highest possible to bleed others without taking points later?
      // Actually, safest is usually playing mid-range or low.
      return suitCards[suitCards.length - 1].id; // Play low to be safe
    }
  } else {
    // DISCARDING LOGIC (The "Shed")
    // 1. Get rid of Queen of Spades if we have it
    const qSpades = playable.find(c => c.id === 'Q-SPADES');
    if (qSpades) return qSpades.id;

    // 2. Get rid of high Hearts
    const hearts = playable.filter(c => c.suit === 'HEARTS').sort((a, b) => b.value - a.value);
    if (hearts.length > 0) return hearts[0].id;

    // 3. Get rid of other high cards
    const sortedHighToLow = [...playable].sort((a, b) => b.value - a.value);
    return sortedHighToLow[0].id;
  }
}
