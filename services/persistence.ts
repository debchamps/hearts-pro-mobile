
import { Preferences } from '@capacitor/preferences';
import { GameState, GameType } from '../types';

const SAVE_KEY = 'HEARTS_PRO_GAME_DATA';

export interface SavedGameData {
  gameType: GameType;
  gameState: GameState;
  timestamp: number;
}

export const persistenceService = {
  async saveGame(gameType: GameType, gameState: GameState): Promise<void> {
    try {
      const data: SavedGameData = {
        gameType,
        gameState,
        timestamp: Date.now(),
      };
      await Preferences.set({
        key: SAVE_KEY,
        value: JSON.stringify(data),
      });
    } catch (e) {
      console.error('Failed to save game state', e);
    }
  },

  async loadGame(): Promise<SavedGameData | null> {
    try {
      const { value } = await Preferences.get({ key: SAVE_KEY });
      if (!value) return null;
      return JSON.parse(value) as SavedGameData;
    } catch (e) {
      console.error('Failed to load game state', e);
      return null;
    }
  },

  async clearGame(): Promise<void> {
    try {
      await Preferences.remove({ key: SAVE_KEY });
    } catch (e) {
      console.error('Failed to clear game state', e);
    }
  }
};
