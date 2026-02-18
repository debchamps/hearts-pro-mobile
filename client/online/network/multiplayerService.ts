import { GameType } from '../../../types';
import { applyDelta } from '../core/matchEngine';
import { createOnlineApiAsync } from './playfabApi';
import { GameStateDelta, MatchEvent, MultiplayerGameState, OnlineApi } from '../types';

/** Circular log buffer visible in debug overlay */
const MAX_DEBUG_LINES = 40;
const debugLog: string[] = [];
function dlog(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}`;
  debugLog.push(line);
  if (debugLog.length > MAX_DEBUG_LINES) debugLog.shift();
  try { console.log('[OnlineSync]', msg); } catch {}
}
export function getDebugLines(): string[] { return debugLog; }

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
  private eventPumpInFlight = false;
  private emptyEventLoops = 0;
  private waitingRecoveryInFlight = false;
  private gameType: GameType | null = null;
  private playerName = 'YOU';
  private autoMoveOnTimeout = true;
  private syncTimerId: number | null = null;

  private static readonly EVENT_PUMP_FAST_MS = 35;
  private static readonly EVENT_PUMP_IDLE_MS = 110;
  private static readonly EVENT_PUMP_ERROR_MS = 220;

  /* How often to do a full-state resync as a safety net (ms) */
  private static readonly FULL_SYNC_INTERVAL_MS = 3000;

  private async ensureApi() {
    if (!this.api) {
      this.api = await createOnlineApiAsync();
    }
    return this.api;
  }

  async createMatch(gameType: GameType, playerName: string, options?: { autoMoveOnTimeout?: boolean }): Promise<MultiplayerGameState> {
    const api = await this.ensureApi();
    this.gameType = gameType;
    this.playerName = playerName || 'YOU';
    this.autoMoveOnTimeout = options?.autoMoveOnTimeout !== false;

    dlog(`createMatch gameType=${gameType} player=${this.playerName}`);

    const callFindOrCreate = async (retries = 3): Promise<{ matchId: string; seat: number; snapshot?: GameStateDelta }> => {
      try {
        const result = api.findMatch
          ? await api.findMatch({ gameType, playerName, autoMoveOnTimeout: options?.autoMoveOnTimeout })
          : await api.createMatch({ gameType, playerName, autoMoveOnTimeout: options?.autoMoveOnTimeout });
        dlog(`findMatch OK matchId=${result.matchId} seat=${result.seat} hasSnapshot=${!!result.snapshot}`);
        return result;
      } catch (e) {
        const msg = (e as Error).message || '';
        dlog(`findMatch ERR retries=${retries}: ${msg.slice(0, 120)}`);
        if (msg.includes('Match not found') && retries > 0) {
          await new Promise((r) => setTimeout(r, 400 * (4 - retries)));
          return callFindOrCreate(retries - 1);
        }
        throw e;
      }
    };

    const created = await callFindOrCreate();
    this.matchId = created.matchId;
    this.seat = created.seat;

    // Use the inline snapshot from findMatch/createMatch if available
    if (created.snapshot) {
      this.state = applyDelta(null, created.snapshot);
      dlog(`snapshot applied rev=${this.state.revision} status=${this.state.status} phase=${this.state.phase}`);
      return this.state;
    }

    // Fallback: getSnapshot with retry
    dlog('no inline snapshot, falling back to getSnapshot');
    const getSnapshotWithRetry = async (retries = 3, delayMs = 300): Promise<GameStateDelta> => {
      try {
        return await api.getSnapshot({ matchId: created.matchId, seat: created.seat });
      } catch (e) {
        dlog(`getSnapshot ERR retries=${retries}: ${((e as Error).message || '').slice(0, 80)}`);
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
          return getSnapshotWithRetry(retries - 1, delayMs * 2);
        }
        throw e;
      }
    };
    const delta = await getSnapshotWithRetry();
    this.state = applyDelta(null, delta);
    dlog(`getSnapshot OK rev=${this.state.revision} status=${this.state.status}`);
    return this.state;
  }

  getSeat() {
    return this.seat;
  }

  getState() {
    return this.state;
  }

  getSyncDebug() {
    return {
      matchId: this.matchId,
      seat: this.seat,
      revision: this.state?.revision ?? 0,
      status: this.state?.status ?? 'NA',
      phase: this.state?.phase ?? 'NA',
      turnIndex: this.state?.turnIndex ?? -1,
      lastEventId: this.lastEventId,
      subscriptionId: this.subscriptionId,
      eventPumpRunning: this.eventPumpRunning,
      eventPumpInFlight: this.eventPumpInFlight,
      emptyEventLoops: this.emptyEventLoops,
    };
  }

  private notify(events: MatchEvent[] = []) {
    if (!this.state) return;
    this.listeners.forEach((listener) => listener(this.state!, events));
  }

  private async resyncSnapshot(retries = 2) {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const snapshot = await api.getSnapshot({ matchId: this.matchId, seat: this.seat });
        const prevRev = this.state?.revision ?? 0;
        this.state = applyDelta(this.state, snapshot);
        if (this.state.revision > prevRev) {
          dlog(`resync rev ${prevRev}→${this.state.revision} phase=${this.state.phase} turn=${this.state.turnIndex}`);
        }
        return this.state!;
      } catch (e) {
        lastError = e as Error;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  private async tryWaitingRecovery() {
    if (this.waitingRecoveryInFlight || !this.gameType) return;
    if (!this.matchId || !this.api || !this.api.findMatch) return;
    this.waitingRecoveryInFlight = true;
    try {
      const found = await this.api.findMatch({
        gameType: this.gameType,
        playerName: this.playerName,
        autoMoveOnTimeout: this.autoMoveOnTimeout,
        currentMatchId: this.matchId,
      });
      if (found.matchId !== this.matchId) {
        dlog(`waitingRecovery: new match ${found.matchId} seat=${found.seat}`);
        this.matchId = found.matchId;
        this.seat = found.seat;
        this.lastEventId = 0;
        this.subscriptionId = null;
        if (found.snapshot) {
          this.state = applyDelta(null, found.snapshot);
        } else {
          await this.resyncSnapshot();
        }
        this.notify([]);
      }
    } catch (e) {
      dlog(`waitingRecovery ERR: ${((e as Error).message || '').slice(0, 80)}`);
    }
    this.waitingRecoveryInFlight = false;
  }

  async syncSnapshot() {
    const next = await this.resyncSnapshot();
    this.notify([]);
    this.ensureEventPumpAlive();
    return next;
  }

  async subscribeToMatch(listener: (state: MultiplayerGameState, events: MatchEvent[]) => void) {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    this.listeners.add(listener);
    this.emptyEventLoops = 0;

    // Retry subscribe up to 3 times with backoff
    let subscribeError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          dlog(`subscribe retry attempt=${attempt}`);
        }
        const res = await api.subscribeToMatch({
          matchId: this.matchId,
          sinceEventId: this.lastEventId,
          sinceRevision: this.state?.revision || 0,
          seat: this.seat,
          subscriptionId: this.subscriptionId ?? undefined,
        });
        this.subscriptionId = res.subscriptionId;
        this.lastEventId = Math.max(this.lastEventId, res.latestEventId || 0);
        dlog(`subscribe OK sub=${this.subscriptionId} evt=${this.lastEventId} events=${res.events?.length ?? 0}`);
        this.applyEvents(res.events);
        if (this.state) listener(this.state, res.events);
        subscribeError = null;
        break;
      } catch (e) {
        subscribeError = e as Error;
        dlog(`subscribe ERR attempt=${attempt}: ${(subscribeError.message || '').slice(0, 100)}`);
      }
    }

    // Start event pump AND full-sync timer regardless of subscribe success
    // The full-sync timer is the safety net that keeps the game running
    this.startEventPump();
    this.startFullSyncTimer();

    if (subscribeError) {
      dlog('subscribe failed after retries, relying on full-sync timer');
      // Don't throw — the full-sync timer will keep the game alive
    }
  }

  async unsubscribeFromMatch(listener?: (state: MultiplayerGameState, events: MatchEvent[]) => void) {
    if (listener) this.listeners.delete(listener);
    if (this.listeners.size === 0) {
      this.stopEventPump();
      this.stopFullSyncTimer();
    }
    if (!this.matchId || !this.subscriptionId || this.listeners.size > 0) return;
    const api = await this.ensureApi();
    try {
      await api.unsubscribeFromMatch({ matchId: this.matchId, subscriptionId: this.subscriptionId });
    } catch {}
    this.subscriptionId = null;
  }

  private applyEvents(events: MatchEvent[]) {
    if (!events || !events.length) return;
    for (const evt of events) {
      this.state = applyDelta(this.state, {
        matchId: evt.matchId,
        revision: evt.revision,
        changed: evt.payload,
        serverTimeMs: evt.timestamp,
      });
    }
    this.notify(events);
  }

  /** Ensure the event pump is running — restarts it if it died */
  private ensureEventPumpAlive() {
    if (this.eventPumpRunning && this.subscriptionId) return;
    if (!this.matchId) return;
    // If we have no subscription, try to get one
    if (!this.subscriptionId) {
      this.tryResubscribe();
    }
  }

  private async tryResubscribe() {
    if (!this.matchId) return;
    try {
      const api = await this.ensureApi();
      const res = await api.subscribeToMatch({
        matchId: this.matchId,
        sinceEventId: this.lastEventId,
        sinceRevision: this.state?.revision || 0,
        seat: this.seat,
      });
      this.subscriptionId = res.subscriptionId;
      this.lastEventId = Math.max(this.lastEventId, res.latestEventId || 0);
      dlog(`resubscribe OK sub=${this.subscriptionId} evt=${this.lastEventId}`);
      this.applyEvents(res.events);
      if (!this.eventPumpRunning) this.startEventPump();
    } catch (e) {
      dlog(`resubscribe ERR: ${((e as Error).message || '').slice(0, 80)}`);
    }
  }

  /**
   * Full-sync timer: unconditionally fetches latest snapshot every N seconds.
   * This is the ultimate safety net — even if events/subscriptions fail, the
   * game state stays current.
   */
  private startFullSyncTimer() {
    if (this.syncTimerId !== null) return;
    this.syncTimerId = window.setInterval(async () => {
      if (!this.matchId || !this.state) return;
      // Don't sync if game is completed
      if (this.state.status === 'COMPLETED') {
        this.stopFullSyncTimer();
        return;
      }
      try {
        const prevRev = this.state.revision;
        const prevPhase = this.state.phase;
        await this.resyncSnapshot(1);

        // If state changed, notify listeners
        if (this.state.revision > prevRev || this.state.phase !== prevPhase) {
          this.notify([]);
        }

        // If we still don't have a subscription, try to get one
        if (!this.subscriptionId) {
          await this.tryResubscribe();
        }

        // If waiting, try recovery
        if (this.state.status === 'WAITING') {
          await this.tryWaitingRecovery();
        }
      } catch (e) {
        dlog(`fullSync ERR: ${((e as Error).message || '').slice(0, 80)}`);
      }
    }, MultiplayerService.FULL_SYNC_INTERVAL_MS);
  }

  private stopFullSyncTimer() {
    if (this.syncTimerId !== null) {
      window.clearInterval(this.syncTimerId);
      this.syncTimerId = null;
    }
  }

  private startEventPump() {
    if (this.eventPumpRunning) return;
    this.eventPumpRunning = true;
    const tick = async () => {
      if (!this.eventPumpRunning || !this.matchId) return;
      // If no subscription, skip but keep the pump alive
      if (!this.subscriptionId) {
        if (this.eventPumpRunning) {
          this.eventPumpTimer = window.setTimeout(tick, MultiplayerService.EVENT_PUMP_ERROR_MS);
        }
        return;
      }
      if (this.eventPumpInFlight) return;
      this.eventPumpInFlight = true;
      try {
        const api = await this.ensureApi();
        const res = await api.subscribeToMatch({
          matchId: this.matchId,
          sinceEventId: this.lastEventId,
          sinceRevision: this.state?.revision || 0,
          seat: this.seat,
          subscriptionId: this.subscriptionId,
        });
        this.subscriptionId = res.subscriptionId;
        this.lastEventId = Math.max(this.lastEventId, res.latestEventId || 0);
        const events = res.events || [];
        this.applyEvents(events);
        this.emptyEventLoops = events.length === 0 ? this.emptyEventLoops + 1 : 0;

        if (this.eventPumpRunning) {
          this.eventPumpTimer = window.setTimeout(tick, events.length > 0
            ? MultiplayerService.EVENT_PUMP_FAST_MS
            : MultiplayerService.EVENT_PUMP_IDLE_MS);
        }
      } catch {
        // On error, keep pump alive but slow down
        if (this.eventPumpRunning) {
          this.eventPumpTimer = window.setTimeout(tick, MultiplayerService.EVENT_PUMP_ERROR_MS);
        }
      } finally {
        this.eventPumpInFlight = false;
      }
    };
    this.eventPumpTimer = window.setTimeout(tick, MultiplayerService.EVENT_PUMP_FAST_MS);
  }

  private stopEventPump() {
    this.eventPumpRunning = false;
    if (this.eventPumpTimer !== null) {
      window.clearTimeout(this.eventPumpTimer);
      this.eventPumpTimer = null;
    }
  }

  private kickEventPumpNow() {
    if (!this.eventPumpRunning || !this.subscriptionId || this.eventPumpInFlight) return;
    if (this.eventPumpTimer !== null) {
      window.clearTimeout(this.eventPumpTimer);
      this.eventPumpTimer = null;
    }
    // The event pump tick will run immediately
    this.startEventPump();
    // Also stop and restart to force immediate tick
    this.eventPumpRunning = false;
    this.startEventPump();
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
      dlog(`submitMove OK rev=${this.state!.revision} turn=${this.state!.turnIndex}`);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      dlog(`submitMove ERR: ${msg.slice(0, 100)}`);
      if (!msg.includes('Revision mismatch')) throw e;
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
      dlog(`submitPass OK rev=${this.state!.revision}`);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      dlog(`submitPass ERR: ${msg.slice(0, 100)}`);
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
      dlog(`submitBid OK bid=${bid} rev=${this.state!.revision} phase=${this.state!.phase}`);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      dlog(`submitBid ERR: ${msg.slice(0, 100)}`);
      if (!msg.includes('Revision mismatch')) throw e;
      await this.resyncSnapshot();
      return trySubmit();
    }
  }

  async forceTimeout() {
    if (!this.matchId || !this.state) return this.state;
    try {
      const api = await this.ensureApi();
      const delta = await api.timeoutMove({ matchId: this.matchId });
      this.state = applyDelta(this.state, delta);
      dlog(`timeout OK rev=${this.state!.revision} phase=${this.state!.phase} turn=${this.state!.turnIndex}`);
      this.notify([]);
    } catch (e) {
      dlog(`timeout ERR: ${((e as Error).message || '').slice(0, 80)}`);
    }
    return this.state;
  }

  async finish() {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    return api.endMatch({ matchId: this.matchId });
  }
}
