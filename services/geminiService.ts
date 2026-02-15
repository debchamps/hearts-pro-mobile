
import { GoogleGenAI, Type } from "@google/genai";
import { Card, Suit, TrickCard, GameSettings, Language } from "../types";
import { DEFAULT_TRANSLATIONS } from "./i18n";

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (aiClient) return aiClient;
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
}

const GAME_CONTEXT = `
  Context for the Card Games:
  1. Hearts: A trick-taking game where points are bad. 'Hearts' are worth 1 point each, and the 'Queen of Spades' is worth 13. 'Shooting the Moon' means taking all point cards to give opponents 26 points.
  2. Spades: A partnership game where 'Spades' are always the trump suit. Players 'Bid' on how many tricks they will win. A 'Nil' bid means zero tricks. 'Bags' are overtricks that can lead to a penalty.
  3. Callbreak: A popular South Asian game similar to Spades but played individually. The 'Spade' is the permanent trump. Players must 'Overtrump' (play a higher trump) if possible.
`;

/**
 * Recursively generates a Gemini responseSchema from a source object.
 * This satisfies the requirement that Type.OBJECT must have non-empty properties.
 */
function generateSchemaFromObject(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return { type: Type.STRING };
  }

  const properties: any = {};
  const required: string[] = [];

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        properties[key] = generateSchemaFromObject(obj[key]);
      } else {
        properties[key] = { type: Type.STRING };
      }
      required.push(key);
    }
  }

  return {
    type: Type.OBJECT,
    properties,
    required
  };
}

export async function translateAll(sourceData: any): Promise<Record<Language, any>> {
  const targetLanguages: Language[] = ['hi', 'bn', 'ar', 'es', 'pt'];
  const ai = getAiClient();
  
  try {
    const prompt = `
      ${GAME_CONTEXT}
      
      Task: Translate the following English i18n JSON into:
      - Hindi (hi)
      - Bengali (bn)
      - Arabic (ar) - Ensure RTL compatibility in wording
      - Spanish (es)
      - Portuguese (pt)

      Rules:
      - Maintain the EXACT JSON structure of the source.
      - Use natural, culturally appropriate gaming terminology. 
      - Do NOT translate terms like "Hearts", "Spades", or "Clubs" literally if the local gaming community uses the English terms or specific local names (e.g., 'Hukum' in Hindi for Spades).
      - Keep placeholders like {suit} or {count} exactly as they are.

      Source JSON:
      ${JSON.stringify(sourceData, null, 2)}
    `;

    // Generate a schema that mirrors the actual keys in the source dictionary
    const languageSpecificSchema = generateSchemaFromObject(sourceData);

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hi: languageSpecificSchema,
            bn: languageSpecificSchema,
            ar: languageSpecificSchema,
            es: languageSpecificSchema,
            pt: languageSpecificSchema
          },
          required: targetLanguages,
        },
      },
    });

    // Directly access the .text property from the response
    const translatedData = JSON.parse(response.text || '{}');
    // Ensure English is included in the returned set
    return { ...translatedData, en: sourceData };
  } catch (error) {
    console.error("Gemini Translation failed:", error);
    throw error;
  }
}

export async function getBestMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  heartsBroken: boolean,
  isFirstTrick: boolean,
  playerName: string,
  settings: GameSettings = { shootTheMoon: true, noPassing: false, jackOfDiamonds: false, targetScore: 100 }
): Promise<string> {
  const ai = getAiClient();
  try {
    const prompt = `
      ${GAME_CONTEXT}
      Current Game: Hearts
      Player: ${playerName}
      Hand: ${hand.map(c => `${c.rank} of ${c.suit}`).join(', ')}
      Current Trick: ${currentTrick.length === 0 ? 'Leading' : currentTrick.map(t => `${t.card.rank} of ${t.card.suit}`).join(', ')}
      Lead Suit: ${leadSuit || 'None'}
      Hearts Broken: ${heartsBroken}
      
      Choose the most strategic card ID to play (e.g., 'Q-SPADES'). Return only JSON.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cardId: { type: Type.STRING }
          },
          required: ["cardId"],
        },
      },
    });

    const result = JSON.parse(response.text || '{}');
    if (result.cardId && hand.some(c => c.id === result.cardId)) return result.cardId;
  } catch (error) {}

  // Basic fallback logic
  return hand[0]?.id || '';
}
