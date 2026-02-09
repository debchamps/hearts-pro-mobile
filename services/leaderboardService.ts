
import { Preferences } from '@capacitor/preferences';
import { GameType } from '../types';

const RANKS_CACHE_KEY = 'LOCAL_LEADERBOARD_CACHE';

/**
 * A simplified local-first leaderboard service.
 * Strictly avoids any native Play Games SDK calls to fix build issues.
 */
export const leaderboardService = {
  async ensureAuthenticated(): Promise<boolean> {
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
    // No-op for local mode
  },

  async getRank(gameType: GameType): Promise<number | null> {
    try {
      const { value } = await Preferences.get({ key: RANKS_CACHE_KEY });
      if (value) {
        const cache = JSON.parse(value);
        // Returns 1 just to show "Ranked" status if a score exists
        return cache[gameType] ? 1 : null; 
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  async openLeaderboard(gameType: GameType) {
    alert(`Local high scores are saved! Native leaderboard services are disabled for build stability.`);
  }
};
