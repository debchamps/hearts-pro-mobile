import { GameType } from '../../../types';
import { applyDelta } from '../core/matchEngine';
import { createOnlineApiAsync } from './playfabApi';
import { GameStateDelta, MatchEvent, MultiplayerGameState, OnlineApi } from '../types';

// ──────────────────────────────────────────────
//  Debug log — visible in the debug overlay
// ──────────────────────────────────────────────
const MAX_DEBUG_LINES = 200;
const debugLog: string[] = [];
const fullLog: string[] = [];           // never truncated, for copy-all
function dlog(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}`;
  debugLog.push(line);
  if (debugLog.length > MAX_DEBUG_LINES) debugLog.shift();
  fullLog.push(line);
  try { console.log('[OnlineSync]', msg); } catch {}
}
export function getDebugLines(): string[] { return debugLog; }
/** Return FULL log (not truncated) as a single copyable string */
export function getFullDebugLog(): string {
  return fullLog.join('\n');
}

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

  // Guard against concurrent / duplicate createMatch calls (React Strict Mode)
  private createMatchInFlight = false;

  // Track when we entered WAITING so we only try recovery after enough time
  private waitingSince = 0;
  // Count recovery attempts to avoid infinite match creation
  private waitingRecoveryAttempts = 0;
  private static readonly MAX_RECOVERY_ATTEMPTS = 2;
  // Minimum time in WAITING before trying recovery (ms)
  private static readonly WAITING_RECOVERY_DELAY_MS = 20_000;

  private static readonly EVENT_PUMP_FAST_MS = 35;
  private static readonly EVENT_PUMP_IDLE_MS = 110;
  private static readonly EVENT_PUMP_ERROR_MS = 220;
  private static readonly FULL_SYNC_INTERVAL_MS = 4000; // slightly slower to reduce API spam

  private async ensureApi() {
    if (!this.api) {
      this.api = await createOnlineApiAsync();
    }
    return this.api;
  }

  async createMatch(gameType: GameType, playerName: string, options?: { autoMoveOnTimeout?: boolean }): Promise<MultiplayerGameState> {
    // Mutex: reject concurrent calls (e.g. React Strict Mode double-invoking useEffect)
    if (this.createMatchInFlight) {
      dlog('createMatch BLOCKED — already in flight (duplicate call ignored)');
      // Wait for the first call to finish and return its result
      while (this.createMatchInFlight) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.state) return this.state;
      throw new Error('createMatch: first call failed and no state available');
    }
    this.createMatchInFlight = true;

    try {
      return await this._createMatchInner(gameType, playerName, options);
    } finally {
      this.createMatchInFlight = false;
    }
  }

  private async _createMatchInner(gameType: GameType, playerName: string, options?: { autoMoveOnTimeout?: boolean }): Promise<MultiplayerGameState> {
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
        dlog(`findMatch OK matchId=${result.matchId} seat=${result.seat} hasSnap=${!!result.snapshot}`);
        return result;
      } catch (e) {
        const msg = (e as Error).message || '';
        dlog(`findMatch ERR retries=${retries}: ${msg.slice(0, 150)}`);
        if (msg.includes('Match not found') && retries > 0) {
          await new Promise((r) => setTimeout(r, 500 * (4 - retries)));
          return callFindOrCreate(retries - 1);
        }
        throw e;
      }
    };

    const created = await callFindOrCreate();
    this.matchId = created.matchId;
    this.seat = created.seat;

    const applyResult = (result: { matchId: string; seat: number; snapshot?: GameStateDelta }): MultiplayerGameState => {
      this.matchId = result.matchId;
      this.seat = result.seat;
      if (result.snapshot) {
        this.state = applyDelta(null, result.snapshot);
        dlog(`snap OK rev=${this.state.revision} status=${this.state.status} phase=${this.state.phase}`);
      }
      if (this.state?.status === 'WAITING') {
        this.waitingSince = Date.now();
      } else {
        this.waitingSince = 0;
      }
      return this.state!;
    };

    if (created.snapshot) {
      applyResult(created);
    } else {
      dlog('no inline snapshot, fallback getSnapshot');
      const getSnap = async (retries = 3, delayMs = 400): Promise<GameStateDelta> => {
        try {
          return await api.getSnapshot({ matchId: created.matchId, seat: created.seat });
        } catch (e) {
          dlog(`getSnapshot ERR retries=${retries}: ${((e as Error).message || '').slice(0, 100)}`);
          if (retries > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
            return getSnap(retries - 1, delayMs * 2);
          }
          throw e;
        }
      };
      const delta = await getSnap();
      this.state = applyDelta(null, delta);
      dlog(`getSnapshot OK rev=${this.state.revision} status=${this.state.status}`);
      if (this.state.status === 'WAITING') this.waitingSince = Date.now();
    }

    // ── Fast early re-check for concurrent-creation race condition ──
    // If we ended up WAITING at seat 0 (i.e. WE created the match), another player
    // may have also created a match at nearly the same time. Re-call findMatch
    // with our currentMatchId after a short delay so the server can merge us.
    if (this.state?.status === 'WAITING' && this.seat === 0 && api.findMatch) {
      const EARLY_RECHECK_DELAY_MS = 3000;
      dlog(`earlyRecheck: WAITING at seat 0, will re-check in ${EARLY_RECHECK_DELAY_MS}ms`);
      await new Promise((r) => setTimeout(r, EARLY_RECHECK_DELAY_MS));
      try {
        const recheck = await api.findMatch({
          gameType,
          playerName,
          autoMoveOnTimeout: options?.autoMoveOnTimeout,
          currentMatchId: this.matchId,
        });
        dlog(`earlyRecheck OK matchId=${recheck.matchId} seat=${recheck.seat} hasSnap=${!!recheck.snapshot}`);
        if (recheck.matchId !== this.matchId) {
          // Server gave us a different (better) match — switch to it
          dlog(`earlyRecheck: switching ${this.matchId} → ${recheck.matchId}`);
          applyResult(recheck);
        } else if (recheck.snapshot) {
          // Same match but may have updated (e.g., someone joined)
          const recheckState = applyDelta(null, recheck.snapshot);
          if (recheckState.status !== 'WAITING') {
            dlog(`earlyRecheck: same match but status now ${recheckState.status}, applying`);
            this.state = recheckState;
            this.waitingSince = 0;
          }
        }
      } catch (e) {
        dlog(`earlyRecheck ERR: ${((e as Error).message || '').slice(0, 120)}`);
        // Non-fatal — we still have our original match
      }
    }

    return this.state!;
  }

  getSeat() { return this.seat; }
  getState() { return this.state; }

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

  // ──────────────────────────────────────────────
  //  Resync — fetch full snapshot from server
  // ──────────────────────────────────────────────
  private async resyncSnapshot(retries = 2) {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const snapshot = await api.getSnapshot({ matchId: this.matchId, seat: this.seat });
        const prevRev = this.state?.revision ?? 0;
        const prevStatus = this.state?.status ?? 'NA';
        this.state = applyDelta(this.state, snapshot);
        if (this.state.revision > prevRev || this.state.status !== prevStatus) {
          dlog(`resync ${prevRev}→${this.state.revision} ${prevStatus}→${this.state.status} phase=${this.state.phase} turn=${this.state.turnIndex}`);
        }
        // Track WAITING transitions
        if (this.state.status !== 'WAITING') {
          this.waitingSince = 0;
          this.waitingRecoveryAttempts = 0;
        } else if (!this.waitingSince) {
          this.waitingSince = Date.now();
        }
        return this.state!;
      } catch (e) {
        lastError = e as Error;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  // ──────────────────────────────────────────────
  //  Waiting recovery — CONSERVATIVE
  //  Only fires if stuck in WAITING for 20s+ and max 2 attempts
  // ──────────────────────────────────────────────
  private async tryWaitingRecovery() {
    if (this.waitingRecoveryInFlight || !this.gameType) return;
    if (!this.matchId || !this.api || !this.api.findMatch) return;

    // Guard: only try recovery after waiting long enough
    if (!this.waitingSince) return;
    const waitedMs = Date.now() - this.waitingSince;
    if (waitedMs < MultiplayerService.WAITING_RECOVERY_DELAY_MS) {
      return; // not stuck yet, just normal matchmaking wait
    }
    // Guard: limit attempts to avoid match-creation spam
    if (this.waitingRecoveryAttempts >= MultiplayerService.MAX_RECOVERY_ATTEMPTS) {
      dlog(`waitingRecovery: max attempts (${this.waitingRecoveryAttempts}) reached, stop trying`);
      return;
    }

    this.waitingRecoveryInFlight = true;
    this.waitingRecoveryAttempts++;
    dlog(`waitingRecovery: attempt=${this.waitingRecoveryAttempts} waited=${(waitedMs / 1000).toFixed(1)}s matchId=${this.matchId}`);

    const prevMatchId = this.matchId;
    const prevSeat = this.seat;
    const prevState = this.state;
    const prevSub = this.subscriptionId;
    const prevLastEvent = this.lastEventId;

    try {
      const found = await this.api.findMatch({
        gameType: this.gameType,
        playerName: this.playerName,
        autoMoveOnTimeout: this.autoMoveOnTimeout,
        currentMatchId: this.matchId,
      });
      if (found.matchId === this.matchId) {
        dlog(`waitingRecovery: same match returned, still waiting`);
        this.waitingRecoveryInFlight = false;
        return;
      }

      dlog(`waitingRecovery: new match ${found.matchId} seat=${found.seat}`);
      this.matchId = found.matchId;
      this.seat = found.seat;
      this.lastEventId = 0;
      this.subscriptionId = null;

      if (found.snapshot) {
        this.state = applyDelta(null, found.snapshot);
        dlog(`waitingRecovery: snap OK rev=${this.state.revision} status=${this.state.status} phase=${this.state.phase}`);
      } else {
        // Try to get snapshot — if it fails, REVERT to the old match
        try {
          await this.resyncSnapshot(2);
        } catch (e) {
          dlog(`waitingRecovery: snap FAILED for new match, reverting to ${prevMatchId}`);
          this.matchId = prevMatchId;
          this.seat = prevSeat;
          this.state = prevState;
          this.subscriptionId = prevSub;
          this.lastEventId = prevLastEvent;
          this.waitingRecoveryInFlight = false;
          return;
        }
      }

      // Success — try to subscribe to the new match
      if (this.state && this.state.status !== 'WAITING') {
        this.waitingSince = 0;
        this.waitingRecoveryAttempts = 0;
      }
      this.notify([]);
      // Resubscribe to the new match
      await this.tryResubscribe();
    } catch (e) {
      dlog(`waitingRecovery ERR: ${((e as Error).message || '').slice(0, 100)}`);
      // Revert on any error
      this.matchId = prevMatchId;
      this.seat = prevSeat;
      this.state = prevState;
      this.subscriptionId = prevSub;
      this.lastEventId = prevLastEvent;
    }
    this.waitingRecoveryInFlight = false;
  }

  async syncSnapshot() {
    const next = await this.resyncSnapshot();
    this.notify([]);
    this.ensureEventPumpAlive();
    return next;
  }

  // ──────────────────────────────────────────────
  //  Subscribe + Event pump
  // ──────────────────────────────────────────────
  async subscribeToMatch(listener: (state: MultiplayerGameState, events: MatchEvent[]) => void) {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    this.listeners.add(listener);
    this.emptyEventLoops = 0;

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
        dlog(`subscribe ERR attempt=${attempt}: ${(subscribeError.message || '').slice(0, 120)}`);
      }
    }

    this.startEventPump();
    this.startFullSyncTimer();

    if (subscribeError) {
      dlog('subscribe failed after retries, relying on full-sync timer');
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
    try { await api.unsubscribeFromMatch({ matchId: this.matchId, subscriptionId: this.subscriptionId }); } catch {}
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
    if (this.state && this.state.status !== 'WAITING') {
      this.waitingSince = 0;
      this.waitingRecoveryAttempts = 0;
    }
    this.notify(events);
  }

  private ensureEventPumpAlive() {
    if (this.eventPumpRunning && this.subscriptionId) return;
    if (!this.matchId) return;
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
      dlog(`resubscribe ERR: ${((e as Error).message || '').slice(0, 100)}`);
    }
  }

  // ──────────────────────────────────────────────
  //  Full-sync timer
  // ──────────────────────────────────────────────
  private startFullSyncTimer() {
    if (this.syncTimerId !== null) return;
    dlog(`fullSyncTimer started interval=${MultiplayerService.FULL_SYNC_INTERVAL_MS}ms`);
    this.syncTimerId = window.setInterval(async () => {
      if (!this.matchId || !this.state) return;
      if (this.state.status === 'COMPLETED') {
        dlog('fullSync: COMPLETED, stopping timer');
        this.stopFullSyncTimer();
        return;
      }
      try {
        const prevRev = this.state.revision;
        const prevPhase = this.state.phase;
        const prevStatus = this.state.status;
        await this.resyncSnapshot(1);

        if (this.state.revision > prevRev || this.state.phase !== prevPhase || this.state.status !== prevStatus) {
          dlog(`fullSync: state changed rev=${this.state.revision} phase=${this.state.phase} status=${this.state.status}`);
          this.notify([]);
        }

        if (!this.subscriptionId) {
          await this.tryResubscribe();
        }

        // Only try waiting recovery if still WAITING (with built-in guards)
        if (this.state.status === 'WAITING') {
          await this.tryWaitingRecovery();
        }
      } catch (e) {
        dlog(`fullSync ERR: ${((e as Error).message || '').slice(0, 120)}`);
      }
    }, MultiplayerService.FULL_SYNC_INTERVAL_MS);
  }

  private stopFullSyncTimer() {
    if (this.syncTimerId !== null) {
      window.clearInterval(this.syncTimerId);
      this.syncTimerId = null;
    }
  }

  // ──────────────────────────────────────────────
  //  Event pump
  // ──────────────────────────────────────────────
  private startEventPump() {
    if (this.eventPumpRunning) return;
    this.eventPumpRunning = true;
    const tick = async () => {
      if (!this.eventPumpRunning || !this.matchId) return;
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
      } catch (e) {
        const msg = ((e as Error).message || '').slice(0, 80);
        // Only log every 5th error to avoid spam
        if (this.emptyEventLoops % 5 === 0) {
          dlog(`eventPump ERR: ${msg}`);
        }
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

  // ──────────────────────────────────────────────
  //  Player actions
  // ──────────────────────────────────────────────
  async submitMove(cardId: string): Promise<MultiplayerGameState> {
    if (!this.state || !this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    dlog(`submitMove cardId=${cardId} rev=${this.state.revision} turn=${this.state.turnIndex}`);

    const trySubmit = async () => {
      const delta = await api.submitMove({
        matchId: this.matchId!,
        seat: this.seat,
        cardId,
        expectedRevision: this.state!.revision,
      });
      this.state = applyDelta(this.state, delta);
      dlog(`submitMove OK rev=${this.state!.revision} turn=${this.state!.turnIndex} phase=${this.state!.phase} trick=${(this.state!.currentTrick || []).length}`);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      dlog(`submitMove ERR: ${msg.slice(0, 120)}`);
      if (!msg.includes('Revision mismatch')) throw e;
      await this.resyncSnapshot();
      return trySubmit();
    }
  }

  async submitPass(cardIds: string[]): Promise<MultiplayerGameState> {
    if (!this.state || !this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    if (!api.submitPass) throw new Error('Pass API not available');
    dlog(`submitPass cards=${cardIds.length} rev=${this.state.revision}`);

    const trySubmit = async () => {
      const delta = await api.submitPass!({
        matchId: this.matchId!,
        seat: this.seat,
        cardIds,
        expectedRevision: this.state!.revision,
      });
      this.state = applyDelta(this.state, delta);
      dlog(`submitPass OK rev=${this.state!.revision} phase=${this.state!.phase}`);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      dlog(`submitPass ERR: ${msg.slice(0, 120)}`);
      if (!msg.includes('Revision mismatch')) throw e;
      await this.resyncSnapshot();
      return trySubmit();
    }
  }

  async submitBid(bid: number): Promise<MultiplayerGameState> {
    if (!this.state || !this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    if (!api.submitBid) throw new Error('Bid API not available');
    dlog(`submitBid bid=${bid} rev=${this.state.revision} turn=${this.state.turnIndex}`);

    const trySubmit = async () => {
      const delta = await api.submitBid!({
        matchId: this.matchId!,
        seat: this.seat,
        bid,
        expectedRevision: this.state!.revision,
      });
      this.state = applyDelta(this.state, delta);
      dlog(`submitBid OK bid=${bid} rev=${this.state!.revision} phase=${this.state!.phase} turn=${this.state!.turnIndex}`);
      this.notify([]);
      return this.state!;
    };

    try {
      return await trySubmit();
    } catch (e) {
      const msg = (e as Error).message || '';
      dlog(`submitBid ERR: ${msg.slice(0, 120)}`);
      if (!msg.includes('Revision mismatch')) throw e;
      await this.resyncSnapshot();
      return trySubmit();
    }
  }

  async forceTimeout() {
    if (!this.matchId || !this.state) return this.state;
    dlog(`forceTimeout matchId=${this.matchId} rev=${this.state.revision} phase=${this.state.phase} turn=${this.state.turnIndex}`);
    try {
      const api = await this.ensureApi();
      const delta = await api.timeoutMove({ matchId: this.matchId });
      this.state = applyDelta(this.state, delta);
      dlog(`timeout OK rev=${this.state!.revision} phase=${this.state!.phase} turn=${this.state!.turnIndex}`);
      this.notify([]);
    } catch (e) {
      dlog(`timeout ERR: ${((e as Error).message || '').slice(0, 120)}`);
    }
    return this.state;
  }

  async finish() {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    return api.endMatch({ matchId: this.matchId });
  }
}
