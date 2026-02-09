
import { Preferences } from '@capacitor/preferences';
import { GameType } from '../types';

const RANKS_CACHE_KEY = 'LOCAL_LEADERBOARD_CACHE';

/**
 * A simplified local-first leaderboard service 
 * to ensure app stability across different builds.
 * Strictly avoids any native Play Games SDK calls.
 */
export const leaderboardService = {
  async ensureAuthenticated(): Promise<boolean> {
    // Always authenticated in local mode
    return true; 
  },

  async submitGameScore(gameType: GameType, score: number) {
    if (score <= 0) return;
    try {
      const { value } = await Preferences.get({ key: RANKS_CACHE_KEY });
      const cache = value ? JSON.parse(value) : {};
      const currentBest = cache[gameType] || 0;
      if (score > currentBest) {
          cache[gameType] = score;
          await Preferences.set({ key: RANKS_CACHE_KEY, value: JSON.stringify(cache) });
      }
    } catch (e) {
      console.warn('Local score storage failed', e);
    }
  },

  async syncPendingScores() {
    // No-op for local-only mode
  },

  async getRank(gameType: GameType): Promise<number | null> {
    try {
      const { value } = await Preferences.get({ key: RANKS_CACHE_KEY });
      if (value) {
        const cache = JSON.parse(value);
        return cache[gameType] ? 1 : null; 
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  async openLeaderboard(gameType: GameType) {
    // UI-only fallback as native boards are disabled to fix build issues
    alert(`Local records only for ${gameType}. Native services are currently disabled for stability.`);
  }
};
