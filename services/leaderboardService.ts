
import { Preferences } from '@capacitor/preferences';
import { GameType, PendingScore } from '../types';

const PENDING_SCORES_KEY = 'PENDING_LEADERBOARD_SCORES';
const RANKS_CACHE_KEY = 'LEADERBOARD_RANKS_CACHE';

const LEADERBOARD_IDS: Record<GameType, string> = {
  HEARTS: 'CgkI_hearts_leaderboard_id',
  SPADES: 'CgkI_spades_leaderboard_id',
  CALLBREAK: 'CgkI_callbreak_leaderboard_id',
};

// Mock of the expected Google Play Games capacitor plugin interface
// In a real app, this would be imported from a package like '@capacitor-community/play-games'
const PlayGames = (window as any).PlayGames || {
  submitScore: async (options: { leaderboardId: string; score: number }) => {
    console.log(`[GPGS Mock] Submitting ${options.score} to ${options.leaderboardId}`);
    if (!navigator.onLine) throw new Error('Offline');
    return { success: true };
  },
  showLeaderboard: async (options: { leaderboardId: string }) => {
    console.log(`[GPGS Mock] Opening leaderboard ${options.leaderboardId}`);
  },
  getPlayerRank: async (options: { leaderboardId: string }) => {
    // Mocking rank retrieval
    return { rank: Math.floor(Math.random() * 1000) + 1 };
  },
  isAuthenticated: async () => ({ isAuthenticated: true })
};

export const leaderboardService = {
  async submitGameScore(gameType: GameType, score: number) {
    if (score <= 0) return;

    try {
      const { isAuthenticated } = await PlayGames.isAuthenticated();
      if (isAuthenticated && navigator.onLine) {
        await PlayGames.submitScore({
          leaderboardId: LEADERBOARD_IDS[gameType],
          score: Math.round(score),
        });
        console.log(`Score ${score} submitted for ${gameType}`);
      } else {
        await this.queueOfflineScore(gameType, score);
      }
    } catch (error) {
      console.warn('Leaderboard submission failed, queuing for later:', error);
      await this.queueOfflineScore(gameType, score);
    }
  },

  async queueOfflineScore(gameType: GameType, score: number) {
    const { value } = await Preferences.get({ key: PENDING_SCORES_KEY });
    const pending: PendingScore[] = value ? JSON.parse(value) : [];
    pending.push({ gameType, score, timestamp: Date.now() });
    await Preferences.set({ key: PENDING_SCORES_KEY, value: JSON.stringify(pending) });
  },

  async syncPendingScores() {
    if (!navigator.onLine) return;
    
    const { value } = await Preferences.get({ key: PENDING_SCORES_KEY });
    if (!value) return;

    const pending: PendingScore[] = JSON.parse(value);
    if (pending.length === 0) return;

    console.log(`Syncing ${pending.length} pending scores...`);
    const successfulIndices: number[] = [];

    for (let i = 0; i < pending.length; i++) {
      try {
        await PlayGames.submitScore({
          leaderboardId: LEADERBOARD_IDS[pending[i].gameType],
          score: Math.round(pending[i].score),
        });
        successfulIndices.push(i);
      } catch (e) {
        // Keep in queue if failed
      }
    }

    const remaining = pending.filter((_, idx) => !successfulIndices.includes(idx));
    await Preferences.set({ key: PENDING_SCORES_KEY, value: JSON.stringify(remaining) });
  },

  async getRank(gameType: GameType): Promise<number | null> {
    try {
      const { rank } = await PlayGames.getPlayerRank({ leaderboardId: LEADERBOARD_IDS[gameType] });
      // Cache the rank locally
      const { value } = await Preferences.get({ key: RANKS_CACHE_KEY });
      const cache = value ? JSON.parse(value) : {};
      cache[gameType] = rank;
      await Preferences.set({ key: RANKS_CACHE_KEY, value: JSON.stringify(cache) });
      return rank;
    } catch (e) {
      const { value } = await Preferences.get({ key: RANKS_CACHE_KEY });
      if (value) {
        const cache = JSON.parse(value);
        return cache[gameType] || null;
      }
      return null;
    }
  },

  async openLeaderboard(gameType: GameType) {
    try {
      await PlayGames.showLeaderboard({ leaderboardId: LEADERBOARD_IDS[gameType] });
    } catch (e) {
      console.error('Could not open leaderboard', e);
    }
  }
};
