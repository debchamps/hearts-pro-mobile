
import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { GameType, PendingScore } from '../types';

const PENDING_SCORES_KEY = 'PENDING_LEADERBOARD_SCORES';
const RANKS_CACHE_KEY = 'LEADERBOARD_RANKS_CACHE';

// These IDs must match exactly what you created in the Google Play Console
const LEADERBOARD_IDS: Record<GameType, string> = {
  HEARTS: 'CgkI_hearts_leaderboard_id',
  SPADES: 'CgkI_spades_leaderboard_id',
  CALLBREAK: 'CgkI_callbreak_leaderboard_id',
};

// Define the interface for the community plugin
interface PlayGamesPlugin {
  signIn(): Promise<{ isAuthenticated: boolean }>;
  showLeaderboard(options: { leaderboardId: string }): Promise<void>;
  submitScore(options: { leaderboardId: string; score: number }): Promise<void>;
  getPlayerRank(options: { leaderboardId: string }): Promise<{ rank: number }>;
  isAuthenticated(): Promise<{ isAuthenticated: boolean }>;
}

// Register the actual native bridge
const PlayGames = registerPlugin<PlayGamesPlugin>('PlayGames');

export const leaderboardService = {
  /**
   * Helper to ensure user is signed in before performing PGS actions
   */
  async ensureAuthenticated(): Promise<boolean> {
    try {
      const { isAuthenticated } = await PlayGames.isAuthenticated();
      if (isAuthenticated) return true;
      
      const result = await PlayGames.signIn();
      return result.isAuthenticated;
    } catch (e) {
      console.error('PGS Sign-in failed', e);
      return false;
    }
  },

  async submitGameScore(gameType: GameType, score: number) {
    if (score <= 0) return;

    try {
      const auth = await this.ensureAuthenticated();
      if (auth && navigator.onLine) {
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

    const auth = await this.ensureAuthenticated();
    if (!auth) return;

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
        // Stop sync if auth lost or network fails during loop
        break;
      }
    }

    const remaining = pending.filter((_, idx) => !successfulIndices.includes(idx));
    await Preferences.set({ key: PENDING_SCORES_KEY, value: JSON.stringify(remaining) });
  },

  async getRank(gameType: GameType): Promise<number | null> {
    try {
      const auth = await this.ensureAuthenticated();
      if (!auth) throw new Error('Not authenticated');

      const { rank } = await PlayGames.getPlayerRank({ leaderboardId: LEADERBOARD_IDS[gameType] });
      
      // Cache the rank locally for offline viewing
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
      const auth = await this.ensureAuthenticated();
      if (auth) {
        await PlayGames.showLeaderboard({ leaderboardId: LEADERBOARD_IDS[gameType] });
      } else {
        alert("Please sign in to Google Play Games to view leaderboards.");
      }
    } catch (e) {
      console.error('Could not open leaderboard', e);
    }
  }
};
