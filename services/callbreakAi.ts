
import { Card, Suit, TrickCard, Player } from "../types";

export async function getCallbreakBid(hand: Card[]): Promise<number> {
  let bid = 0;
  
  const spadeCount = hand.filter(c => c.suit === 'SPADES').length;
  const highSpades = hand.filter(c => c.suit === 'SPADES' && c.value >= 12).length;
  
  // High Spades are almost guaranteed tricks
  bid += highSpades;
  
  // Extra spades might win if long enough
  if (spadeCount > 4) bid += (spadeCount - 4) * 0.5;

  // Aces and Kings in other suits
  const otherSuits: Suit[] = ['CLUBS', 'DIAMONDS', 'HEARTS'];
  otherSuits.forEach(s => {
    const cards = hand.filter(c => c.suit === s).sort((a,b) => b.value - a.value);
    if (cards.length > 0) {
        if (cards[0].value === 14) bid += 0.8; // Ace
        if (cards.length >= 2 && cards[0].value === 13) bid += 0.4; // King
    }
    // Void/Singleton ruffing potential
    if (cards.length === 0 && spadeCount >= 2) bid += 0.8;
    if (cards.length === 1 && spadeCount >= 3) bid += 0.4;
  });

  return Math.max(1, Math.min(8, Math.round(bid))); // AI usually bids conservatively in Callbreak
}

export async function getCallbreakMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  mandatoryOvertrump: boolean = false
): Promise<string> {
  await new Promise(r => setTimeout(r, 600));

  // Determine current trick winner
  let currentWinner: TrickCard | null = null;
  if (currentTrick.length > 0) {
    currentWinner = currentTrick[0];
    for (let i = 1; i < currentTrick.length; i++) {
        const t = currentTrick[i];
        const isSpade = t.card.suit === 'SPADES';
        const winIsSpade = currentWinner.card.suit === 'SPADES';
        if ((isSpade && !winIsSpade) || (t.card.suit === currentWinner.card.suit && t.card.value > currentWinner.card.value)) {
            currentWinner = t;
        }
    }
  }

  const playable = hand.filter(card => {
    if (!leadSuit) return true;
    
    // PRIORITY 1: Follow suit
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);
    if (hasLeadSuit) return card.suit === leadSuit;
    
    // PRIORITY 2: Trump if void of lead suit
    const hasSpades = hand.some(c => c.suit === 'SPADES');
    if (hasSpades) return card.suit === 'SPADES';
    
    // PRIORITY 3: Throw any card if void of both
    return true;
  });

  // Mandatory Overtrump logic:
  // If we are forced to play a Spade (either lead is spade, or we are void of lead suit and have spades)
  // and there's already a spade in the trick, we must play a higher spade if we have one.
  let overtrumpable = playable;
  if (mandatoryOvertrump && currentWinner && currentWinner.card.suit === 'SPADES') {
     const mySpades = playable.filter(c => c.suit === 'SPADES');
     const higherSpades = mySpades.filter(c => c.value > (currentWinner?.card.value || 0));
     if (higherSpades.length > 0) {
        overtrumpable = higherSpades;
     }
  }

  // Strategy:
  // If winning is possible and trick is high-value or we need tricks, win.
  const winners = overtrumpable.filter(c => {
    if (!currentWinner) return true;
    const isSpade = c.suit === 'SPADES';
    const winIsSpade = currentWinner.card.suit === 'SPADES';
    if (isSpade && !winIsSpade) return true;
    return c.suit === currentWinner.card.suit && c.value > currentWinner.card.value;
  }).sort((a,b) => a.value - b.value);

  if (winners.length > 0) {
    // If leading, lead high card of a safe suit.
    // If following, use the smallest winner to conserve high cards.
    if (!currentWinner) return winners[winners.length - 1].id;
    return winners[0].id;
  }

  // Play lowest available if we can't win
  return overtrumpable.sort((a,b) => a.value - b.value)[0].id;
}
