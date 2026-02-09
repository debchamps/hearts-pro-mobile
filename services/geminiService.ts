
import { GoogleGenAI, Type } from "@google/genai";
import { Card, Suit, TrickCard, GameSettings } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function getBestMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  heartsBroken: boolean,
  isFirstTrick: boolean,
  playerName: string,
  settings: GameSettings = { shootTheMoon: true, noPassing: false, jackOfDiamonds: false, targetScore: 100 }
): Promise<string> {
  
  try {
    const prompt = `
      You are playing a professional game of Hearts. 
      Player: ${playerName}
      Your Hand: ${hand.map(c => `${c.rank} of ${c.suit}`).join(', ')}
      Current Trick: ${currentTrick.length === 0 ? 'Leading the trick' : currentTrick.map(t => `Player ${t.playerId}: ${t.card.rank} of ${t.card.suit}`).join(', ')}
      Lead Suit: ${leadSuit || 'None'}
      Hearts Broken: ${heartsBroken}
      Is First Trick: ${isFirstTrick}
      Jack of Diamonds Points Enabled: ${settings.jackOfDiamonds}
      
      Strategy: 
      - If you have 2 of Clubs and it is the first trick, you MUST play it.
      - Follow suit if possible.
      - If you can't follow suit, discard high cards or point cards (Hearts or Queen of Spades).
      - If you are leading, avoid leading high cards unless you want to draw out the Queen of Spades.
      - Decide whether to 'Shoot the Moon' (try to get all 26 points) if your hand is extremely strong.
      
      Respond with ONLY the JSON object of the card ID you choose.
      The card ID format is rank-suit (e.g., '2-CLUBS', 'Q-SPADES').
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
              description: "The ID of the card to play",
            }
          },
          required: ["cardId"],
        },
      },
    });

    const result = JSON.parse(response.text || '{}');
    const selectedCardId = result.cardId;
    if (selectedCardId && hand.some(c => c.id === selectedCardId)) return selectedCardId;
  } catch (error) {
    console.error("Gemini AI failed, using fallback:", error);
  }

  // FALLBACK RULE-BASED LOGIC
  const validHand = hand.filter(c => !!c);
  const playable = validHand.filter(card => {
    if (!leadSuit) {
      if (isFirstTrick) return card.id === '2-CLUBS';
      if (!heartsBroken && card.suit === 'HEARTS') return validHand.every(c => c.suit === 'HEARTS');
      return true;
    }
    return validHand.some(c => c.suit === leadSuit) ? card.suit === leadSuit : true;
  });

  const candidates = playable.length > 0 ? playable : validHand;
  
  // Basic heuristic fallback:
  if (leadSuit) {
    const sorted = [...candidates].sort((a,b) => a.value - b.value);
    // If trick has points, play lowest card.
    return sorted[0].id;
  }
  return candidates[0].id;
}
