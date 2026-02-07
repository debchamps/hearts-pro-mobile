import { Card, Suit, TrickCard, GameSettings } from "../types";

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
  playerName: string,
  settings: GameSettings = { shootTheMoon: true, noPassing: false, jackOfDiamonds: false }
): Promise<string> {
  // Artificial delay to simulate "thinking"
  await new Promise(r => setTimeout(r, 800));

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
  if (playable.length === 0) return '';

  // Calculate if AI wants to win a trick (e.g. for Jack of Diamonds)
  const isJoDAvailable = settings.jackOfDiamonds;
  
  // LEADING LOGIC
  if (!leadSuit || currentTrick.length === 0) {
    if (isFirstTrick) {
      const startCard = playable.find(c => c.id === '2-CLUBS');
      return startCard ? startCard.id : (playable[0]?.id || '');
    }

    // If Jack of Diamonds is -10, AI might lead a Diamond to draw it out if they can win it
    // but generally, low leads are safer.
    const sortedLowToHigh = [...playable].sort((a, b) => a.value - b.value);
    const lowSpade = playable.find(c => c.suit === 'SPADES' && c.value < 12);
    if (lowSpade) return lowSpade.id;

    return sortedLowToHigh[0]?.id || playable[0]?.id || '';
  }

  // FOLLOWING LOGIC
  const currentLeadSuit = leadSuit;
  const hasLeadSuit = validHand.some(c => c && c.suit === currentLeadSuit);
  const trickHasPoints = currentTrick.some(t => t.card && t.card.points > 0);
  const trickHasJoD = currentTrick.some(t => t.card && t.card.suit === 'DIAMONDS' && t.card.rank === 'J');

  // Find highest card of the lead suit in the trick
  const suitCardsInTrick = currentTrick.filter(t => t.card && t.card.suit === currentLeadSuit);
  const highestInTrick = suitCardsInTrick.sort((a, b) => {
    if (!a.card || !b.card) return 0;
    return b.card.value - a.card.value;
  })[0];

  if (hasLeadSuit && highestInTrick && highestInTrick.card) {
    const suitCards = playable.filter(c => c.suit === currentLeadSuit).sort((a, b) => b.value - a.value); // high to low
    
    // If JoD is present and we can win the trick, we might WANT it.
    if (isJoDAvailable && trickHasJoD) {
       const winners = suitCards.filter(c => c.value > (highestInTrick.card?.value || 0));
       if (winners.length > 0) return winners[0].id; // Win the -10 points!
    }

    if (trickHasPoints || currentTrick.length === 3) {
      // Try to duck points
      const losers = suitCards.filter(c => c.value < (highestInTrick.card?.value || 0));
      if (losers.length > 0) return losers[0].id; 
      return suitCards[suitCards.length - 1].id; 
    } else {
      return suitCards[suitCards.length - 1].id; 
    }
  } else {
    // DISCARDING LOGIC
    // If we have JoD and it's worth -10, we don't want to discard it unless forced.
    // However, if discarding, we throw high cards.
    const qSpades = playable.find(c => c.id === 'Q-SPADES');
    if (qSpades) return qSpades.id;

    const hearts = playable.filter(c => c.suit === 'HEARTS').sort((a, b) => b.value - a.value);
    if (hearts.length > 0) return hearts[0].id;

    // Don't discard J-DIAMONDS if it's points -10, keep it to win a trick!
    const discardables = playable.filter(c => !(settings.jackOfDiamonds && c.suit === 'DIAMONDS' && c.rank === 'J'));
    const targetPlayable = discardables.length > 0 ? discardables : playable;

    const sortedHighToLow = [...targetPlayable].sort((a, b) => b.value - a.value);
    return sortedHighToLow[0]?.id || playable[0]?.id || '';
  }
}