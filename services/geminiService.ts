
import { GoogleGenAI, Type } from "@google/genai";
import { Card, Suit, TrickCard, GameSettings } from "../types";

/**
 * Initialize the Gemini API client using the environment variable.
 */
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * A highly intelligent AI for Hearts powered by Gemini.
 * Falls back to rule-based logic if the API call fails or for performance.
 */
export async function getBestMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  heartsBroken: boolean,
  isFirstTrick: boolean,
  playerName: string,
  settings: GameSettings = { shootTheMoon: true, noPassing: false, jackOfDiamonds: false, targetScore: 100 }
): Promise<string> {
  
  // Use Gemini to decide the best move
  try {
    const prompt = `
      You are playing a game of Hearts. 
      Player: ${playerName}
      Your Hand: ${hand.map(c => c.id).join(', ')}
      Current Trick: ${currentTrick.map(t => `Player ${t.playerId}: ${t.card.id}`).join(', ')}
      Lead Suit: ${leadSuit || 'None'}
      Hearts Broken: ${heartsBroken}
      Is First Trick: ${isFirstTrick}
      Jack of Diamonds Points Enabled: ${settings.jackOfDiamonds}
      
      Strategy: Avoid points (Hearts and Queen of Spades) unless you are trying to 'Shoot the Moon'. 
      If you can't follow the lead suit, discard high cards or point cards.
      Choose the best card ID from your hand to play.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cardId: {
              type: Type.STRING,
              description: "The ID of the card to play, e.g., 'A-SPADES'",
            },
            reasoning: {
              type: Type.STRING,
              description: "Short explanation for the move",
            }
          },
          required: ["cardId"],
        },
      },
    });

    const result = JSON.parse(response.text || '{}');
    const selectedCardId = result.cardId;

    // Validate if the AI selected a card that is actually in hand
    if (selectedCardId && hand.some(c => c.id === selectedCardId)) {
      return selectedCardId;
    }
  } catch (error) {
    console.error("Gemini AI error, falling back to rule-based logic:", error);
  }

  // FALLBACK RULE-BASED LOGIC
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

  const isJoDAvailable = settings.jackOfDiamonds;
  
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

  const currentLeadSuit = leadSuit;
  const hasLeadSuit = validHand.some(c => c && c.suit === currentLeadSuit);
  const trickHasPoints = currentTrick.some(t => t.card && t.card.points > 0);
  const trickHasJoD = currentTrick.some(t => t.card && t.card.suit === 'DIAMONDS' && t.card.rank === 'J');

  const suitCardsInTrick = currentTrick.filter(t => t.card && t.card.suit === currentLeadSuit);
  const highestInTrick = suitCardsInTrick.sort((a, b) => {
    if (!a.card || !b.card) return 0;
    return b.card.value - a.card.value;
  })[0];

  if (hasLeadSuit && highestInTrick && highestInTrick.card) {
    const suitCards = playable.filter(c => c.suit === currentLeadSuit).sort((a, b) => b.value - a.value);
    
    if (isJoDAvailable && trickHasJoD) {
       const winners = suitCards.filter(c => c.value > (highestInTrick.card?.value || 0));
       if (winners.length > 0) return winners[0].id;
    }

    if (trickHasPoints || currentTrick.length === 3) {
      const losers = suitCards.filter(c => c.value < (highestInTrick.card?.value || 0));
      if (losers.length > 0) return losers[0].id; 
      return suitCards[suitCards.length - 1].id; 
    } else {
      return suitCards[suitCards.length - 1].id; 
    }
  } else {
    const qSpades = playable.find(c => c.id === 'Q-SPADES');
    if (qSpades) return qSpades.id;
    const hearts = playable.filter(c => c.suit === 'HEARTS').sort((a, b) => b.value - a.value);
    if (hearts.length > 0) return hearts[0].id;
    const discardables = playable.filter(c => !(settings.jackOfDiamonds && c.suit === 'DIAMONDS' && c.rank === 'J'));
    const targetPlayable = discardables.length > 0 ? discardables : playable;
    const sortedHighToLow = [...targetPlayable].sort((a, b) => b.value - a.value);
    return sortedHighToLow[0]?.id || playable[0]?.id || '';
  }
}
