import { GameType } from '../../../types';
import { applyDelta } from '../core/matchEngine';
import { createOnlineApiAsync } from './playfabApi';
import { MatchEvent, MultiplayerGameState, OnlineApi } from '../types';

export class MultiplayerService {
  private api: OnlineApi | null = null;
  private state: MultiplayerGameState | null = null;
  private matchId: string | null = null;
  private seat = 0;
  private subscriptionId: string | null = null;
  private lastEventId = 0;
  private listeners = new Set<(state: MultiplayerGameState, events: MatchEvent[]) => void>();
  private eventPumpTimer: number | null = null;
  private eventPumpRunning = false;

  private async ensureApi() {
    if (!this.api) {
      this.api = await createOnlineApiAsync();
    }
    return this.api;
  }

  async createMatch(gameType: GameType, playerName: string, options?: { autoMoveOnTimeout?: boolean }): Promise<MultiplayerGameState> {
    const api = await this.ensureApi();
    const created = api.findMatch
      ? await api.findMatch({ gameType, playerName, autoMoveOnTimeout: options?.autoMoveOnTimeout })
      : await api.createMatch({ gameType, playerName, autoMoveOnTimeout: options?.autoMoveOnTimeout });

    this.matchId = created.matchId;
    this.seat = created.seat;
    const delta = await api.getSnapshot({ matchId: created.matchId, seat: created.seat });
    this.state = applyDelta(null, delta);
    return this.state;
  }

  getSeat() {
    return this.seat;
  }

  getState() {
    return this.state;
  }

  private notify(events: MatchEvent[] = []) {
    if (!this.state) return;
    this.listeners.forEach((listener) => listener(this.state!, events));
  }

  private async resyncSnapshot() {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    const snapshot = await api.getSnapshot({ matchId: this.matchId, seat: this.seat });
    this.state = applyDelta(this.state, snapshot);
    return this.state!;
  }

  async syncSnapshot() {
    const next = await this.resyncSnapshot();
    this.notify([]);
    return next;
  }

  async subscribeToMatch(listener: (state: MultiplayerGameState, events: MatchEvent[]) => void) {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    this.listeners.add(listener);
    const res = await api.subscribeToMatch({
      matchId: this.matchId,
      sinceEventId: this.lastEventId,
      seat: this.seat,
      subscriptionId: this.subscriptionId ?? undefined,
    });
    this.subscriptionId = res.subscriptionId;
    this.lastEventId = Math.max(this.lastEventId, res.latestEventId || 0);
    this.applyEvents(res.events);
    if (this.state) listener(this.state, res.events);
    this.startEventPump();
  }

  async unsubscribeFromMatch(listener?: (state: MultiplayerGameState, events: MatchEvent[]) => void) {
    if (listener) this.listeners.delete(listener);
    if (this.listeners.size === 0) this.stopEventPump();
    if (!this.matchId || !this.subscriptionId || this.listeners.size > 0) return;
    const api = await this.ensureApi();
    await api.unsubscribeFromMatch({ matchId: this.matchId, subscriptionId: this.subscriptionId });
    this.subscriptionId = null;
  }

  private applyEvents(events: MatchEvent[]) {
    if (!events.length) return;
    for (const evt of events) {
      this.state = applyDelta(this.state, {
        matchId: evt.matchId,
        revision: evt.revision,
        changed: evt.delta,
        serverTimeMs: evt.timestamp,
      });
    }
    this.notify(events);
  }

  private startEventPump() {
    if (this.eventPumpRunning) return;
    this.eventPumpRunning = true;
    const tick = async () => {
      if (!this.eventPumpRunning || !this.matchId || !this.subscriptionId) return;
      try {
        const api = await this.ensureApi();
        const res = await api.subscribeToMatch({
          matchId: this.matchId,
          sinceEventId: this.lastEventId,
          seat: this.seat,
          subscriptionId: this.subscriptionId,
        });
        this.subscriptionId = res.subscriptionId;
        this.lastEventId = Math.max(this.lastEventId, res.latestEventId || 0);
        this.applyEvents(res.events || []);
      } catch {
        try {
          await this.resyncSnapshot();
          this.notify([]);
        } catch {}
      } finally {
        if (this.eventPumpRunning) {
          this.eventPumpTimer = window.setTimeout(tick, 220);
        }
      }
    };
    this.eventPumpTimer = window.setTimeout(tick, 220);
  }

  private stopEventPump() {
    this.eventPumpRunning = false;
    if (this.eventPumpTimer !== null) {
      window.clearTimeout(this.eventPumpTimer);
      this.eventPumpTimer = null;
    }
  }

  async submitMove(cardId: string): Promise<MultiplayerGameState> {
    if (!this.state || !this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();

    const trySubmit = async () => {
      const delta = await api.submitMove({
        matchId: this.matchId!,
        seat: this.seat,
        cardId,
        expectedRevision: this.state!.revision,
      });
      this.state = applyDelta(this.state, delta);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      if (!msg.includes('Revision mismatch')) throw e;

      // Resync full state then retry once.
      await this.resyncSnapshot();
      return trySubmit();
    }
  }

  async submitPass(cardIds: string[]): Promise<MultiplayerGameState> {
    if (!this.state || !this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    if (!api.submitPass) throw new Error('Pass API not available');

    const trySubmit = async () => {
      const delta = await api.submitPass!({
        matchId: this.matchId!,
        seat: this.seat,
        cardIds,
        expectedRevision: this.state!.revision,
      });
      this.state = applyDelta(this.state, delta);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      if (!msg.includes('Revision mismatch')) throw e;
      await this.resyncSnapshot();
      return trySubmit();
    }
  }

  async submitBid(bid: number): Promise<MultiplayerGameState> {
    if (!this.state || !this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    if (!api.submitBid) throw new Error('Bid API not available');

    const trySubmit = async () => {
      const delta = await api.submitBid!({
        matchId: this.matchId!,
        seat: this.seat,
        bid,
        expectedRevision: this.state!.revision,
      });
      this.state = applyDelta(this.state, delta);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      if (!msg.includes('Revision mismatch')) throw e;
      await this.resyncSnapshot();
      return trySubmit();
    }
  }

  async forceTimeout() {
    if (!this.matchId || !this.state) return this.state;
    const api = await this.ensureApi();
    const delta = await api.timeoutMove({ matchId: this.matchId });
    this.state = applyDelta(this.state, delta);
    this.notify([]);
    return this.state;
  }

  async finish() {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    return api.endMatch({ matchId: this.matchId });
  }
}
