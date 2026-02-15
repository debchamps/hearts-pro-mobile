import { GameType } from '../../../types';
import { applyDelta } from '../core/matchEngine';
import { createOnlineApiAsync } from './playfabApi';
import { MultiplayerGameState, OnlineApi } from '../types';

export class MultiplayerService {
  private api: OnlineApi | null = null;
  private state: MultiplayerGameState | null = null;
  private matchId: string | null = null;
  private seat = 0;

  private async ensureApi() {
    if (!this.api) {
      this.api = await createOnlineApiAsync();
    }
    return this.api;
  }

  async createMatch(gameType: GameType, playerName: string): Promise<MultiplayerGameState> {
    const api = await this.ensureApi();
    const created = api.findMatch
      ? await api.findMatch({ gameType, playerName })
      : await api.createMatch({ gameType, playerName });

    this.matchId = created.matchId;
    this.seat = created.seat;
    const delta = await api.getState({ matchId: created.matchId, sinceRevision: 0, seat: created.seat });
    this.state = applyDelta(null, delta);
    return this.state;
  }

  getSeat() {
    return this.seat;
  }

  getState() {
    return this.state;
  }

  async submitMove(cardId: string): Promise<MultiplayerGameState> {
    if (!this.state || !this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();

    const delta = await api.submitMove({
      matchId: this.matchId,
      seat: this.seat,
      cardId,
      expectedRevision: this.state.revision,
    });

    this.state = applyDelta(this.state, delta);
    return this.state;
  }

  async pollDelta(): Promise<MultiplayerGameState | null> {
    if (!this.state || !this.matchId) return null;
    const api = await this.ensureApi();
    const delta = await api.getState({
      matchId: this.matchId,
      sinceRevision: this.state.revision,
      seat: this.seat,
    });

    if (Object.keys(delta.changed).length === 0) return this.state;
    this.state = applyDelta(this.state, delta);
    return this.state;
  }

  async forceTimeout() {
    if (!this.matchId || !this.state) return this.state;
    const api = await this.ensureApi();
    const delta = await api.timeoutMove({ matchId: this.matchId });
    this.state = applyDelta(this.state, delta);
    return this.state;
  }

  async finish() {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    return api.endMatch({ matchId: this.matchId });
  }
}
