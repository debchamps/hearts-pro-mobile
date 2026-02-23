import { GameType } from '../../../types';
import { applyDelta } from '../core/matchEngine';
import { createOnlineApiAsync, getApiBackend } from './playfabApi';
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
  private timeoutNoProgressCount = 0;
  private syncTimerId: number | null = null;
  private fullSyncInFlight = false;
  private fullSyncErrorStreak = 0;
  private lastProgressMs = Date.now();

  // Guard against concurrent / duplicate createMatch calls (React Strict Mode)
  private createMatchInFlight = false;

  // Track when we entered WAITING so we only try recovery after enough time
  private waitingSince = 0;
  // Count recovery attempts to avoid infinite match creation
  private waitingRecoveryAttempts = 0;
  private static readonly MAX_RECOVERY_ATTEMPTS = 3;
  // Minimum time in WAITING before trying recovery (ms)
  // (earlyRecheck handles the first ~7s, this is the fallback)
  private static readonly WAITING_RECOVERY_DELAY_MS = 15_000;

  private static readonly EVENT_PUMP_FAST_MS = 120;
  private static readonly EVENT_PUMP_IDLE_MS = 500;
  private static readonly EVENT_PUMP_ERROR_MS = 1000;
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

    dlog(`createMatch gameType=${gameType} player=${this.playerName} backend=${getApiBackend()}`);

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
        this.lastProgressMs = Date.now();
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
      this.lastProgressMs = Date.now();
      if (this.state.status === 'WAITING') this.waitingSince = Date.now();
    }

    // ── Fast early re-check for concurrent-creation race condition ──
    // If we ended up WAITING at seat 0 (i.e. WE created the match), another player
    // may have also created a match at nearly the same time. Re-call findMatch
    // with our currentMatchId after short delays so the server can merge us.
    // IMPORTANT: this runs in the BACKGROUND — createMatch returns immediately
    // so the UI can show "Waiting for players..." instead of blocking on "Finding Match".
    if (this.state?.status === 'WAITING' && this.seat === 0 && api.findMatch) {
      void this.runEarlyRechecks(api, gameType, playerName, options);
    }

    return this.state!;
  }

  /** Background early re-check loop — runs after createMatch returns WAITING. */
  private async runEarlyRechecks(
    api: OnlineApi,
    gameType: GameType, playerName: string, options?: { autoMoveOnTimeout?: boolean }
  ) {
    if (!api.findMatch) return;
    const EARLY_RECHECK_DELAYS = [2000, 5000];
    for (const delay of EARLY_RECHECK_DELAYS) {
      if (this.state?.status !== 'WAITING') break; // already matched
      dlog(`earlyRecheck: WAITING at seat 0, will re-check in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      if (this.state?.status !== 'WAITING') break;
      try {
        const recheck = await api.findMatch({
          gameType,
          playerName,
          autoMoveOnTimeout: options?.autoMoveOnTimeout,
          currentMatchId: this.matchId,
        });
        dlog(`earlyRecheck OK matchId=${recheck.matchId} seat=${recheck.seat} hasSnap=${!!recheck.snapshot}`);
        if (recheck.matchId !== this.matchId) {
          dlog(`earlyRecheck: switching ${this.matchId} → ${recheck.matchId}`);
          this.matchId = recheck.matchId;
          this.seat = recheck.seat;
          if (recheck.snapshot) {
            this.state = applyDelta(null, recheck.snapshot);
            dlog(`earlyRecheck snap OK rev=${this.state.revision} status=${this.state.status} phase=${this.state.phase}`);
          }
          if (this.state?.status !== 'WAITING') { this.waitingSince = 0; }
          this.notify([]);
          await this.tryResubscribe();
          break;
        } else if (recheck.snapshot) {
          const recheckState = applyDelta(null, recheck.snapshot);
          if (recheckState.status !== 'WAITING') {
            dlog(`earlyRecheck: same match but status now ${recheckState.status}, applying`);
            this.state = recheckState;
            this.waitingSince = 0;
            this.notify([]);
            break;
          }
        }
      } catch (e) {
        dlog(`earlyRecheck ERR: ${((e as Error).message || '').slice(0, 120)}`);
      }
    }
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
        if (this.state.revision > prevRev) this.lastProgressMs = Date.now();
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

    // CRITICAL: double-check we're actually still WAITING before proceeding.
    // A fullSync or subscription event may have already transitioned us to PLAYING.
    if (this.state && this.state.status !== 'WAITING') {
      dlog('waitingRecovery: state is already ' + this.state.status + ', skipping');
      this.waitingSince = 0;
      this.waitingRecoveryAttempts = 0;
      return;
    }

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

      // Re-check after the async call: state may have changed while we were awaiting
      if (this.state && this.state.status !== 'WAITING') {
        dlog(`waitingRecovery: state became ${this.state.status} during findMatch, aborting switch`);
        this.waitingRecoveryInFlight = false;
        this.waitingSince = 0;
        this.waitingRecoveryAttempts = 0;
        return;
      }

      if (found.matchId === this.matchId) {
        // Same match returned — but check if the snapshot shows it transitioned
        if (found.snapshot) {
          const snapState = applyDelta(null, found.snapshot);
          if (snapState.status !== 'WAITING') {
            dlog(`waitingRecovery: same match but now ${snapState.status}, applying update`);
            this.state = snapState;
            this.waitingSince = 0;
            this.waitingRecoveryAttempts = 0;
            this.notify([]);
            this.waitingRecoveryInFlight = false;
            return;
          }
        }
        dlog(`waitingRecovery: same match returned, still waiting`);
        this.waitingRecoveryInFlight = false;
        return;
      }

      // Different match returned — only switch if the new match is NOT WAITING
      // (switching to another WAITING match just creates orphans)
      if (found.snapshot) {
        const newState = applyDelta(null, found.snapshot);
        if (newState.status === 'WAITING') {
          dlog(`waitingRecovery: new match ${found.matchId} is also WAITING, ignoring`);
          this.waitingRecoveryInFlight = false;
          return;
        }
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
    const appliedEvents: MatchEvent[] = [];
    for (const evt of events) {
      const currentRev = this.state?.revision ?? 0;
      if (evt.revision <= currentRev) continue;
      this.state = applyDelta(this.state, {
        matchId: evt.matchId,
        revision: evt.revision,
        changed: evt.payload,
        serverTimeMs: evt.timestamp,
      });
      appliedEvents.push(evt);
    }
    if (this.state) {
      const combined = [...(this.state.events || []), ...appliedEvents];
      this.state.events = combined.slice(-200);
      if (appliedEvents.length > 0) this.lastProgressMs = Date.now();
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
      if (this.fullSyncInFlight) return;
      this.fullSyncInFlight = true;
      try {
        if (!this.matchId || !this.state) return;
        if (this.state.status === 'COMPLETED') {
          dlog('fullSync: COMPLETED, stopping timer');
          this.stopFullSyncTimer();
          return;
        }
        const prevRev = this.state.revision;
        const prevPhase = this.state.phase;
        const prevStatus = this.state.status;
        await this.resyncSnapshot(1);
        this.fullSyncErrorStreak = 0;

        if (this.state.revision > prevRev || this.state.phase !== prevPhase || this.state.status !== prevStatus) {
          dlog(`fullSync: state changed rev=${this.state.revision} phase=${this.state.phase} status=${this.state.status}`);
          this.notify([]);
          this.lastProgressMs = Date.now();
        } else if (this.state.status === 'PLAYING' && Date.now() - this.lastProgressMs > 45_000) {
          dlog('fullSync: stalled state detected, forcing resubscribe+resync');
          this.subscriptionId = null;
          await this.resyncSnapshot(2);
          await this.tryResubscribe();
          this.lastProgressMs = Date.now();
        }

        if (!this.subscriptionId) {
          await this.tryResubscribe();
        }

        // Only try waiting recovery if still WAITING (with built-in guards)
        if (this.state.status === 'WAITING') {
          await this.tryWaitingRecovery();
        }
      } catch (e) {
        this.fullSyncErrorStreak += 1;
        dlog(`fullSync ERR#${this.fullSyncErrorStreak}: ${((e as Error).message || '').slice(0, 120)}`);
        // After consecutive sync failures, drop stale subscription and force a reconnect cycle.
        if (this.fullSyncErrorStreak >= 3) {
          this.subscriptionId = null;
          await this.tryResubscribe();
        }
      } finally {
        this.fullSyncInFlight = false;
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
        const full = (e as Error).message || '';
        const msg = full.slice(0, 80);
        let backoffMs = MultiplayerService.EVENT_PUMP_ERROR_MS;
        const retryAfter = full.match(/retryAfterSeconds\":\s*([0-9]+)/i);
        if (retryAfter && retryAfter[1]) {
          backoffMs = Math.max(backoffMs, Number(retryAfter[1]) * 1000);
        }
        // Only log every 5th error to avoid spam
        if (this.emptyEventLoops % 5 === 0) {
          dlog(`eventPump ERR: ${msg}${backoffMs > MultiplayerService.EVENT_PUMP_ERROR_MS ? ` backoff=${backoffMs}ms` : ''}`);
        }
        if (this.eventPumpRunning) {
          this.eventPumpTimer = window.setTimeout(tick, backoffMs);
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
      const beforeRev = this.state!.revision;
      const beforeTurn = this.state!.turnIndex;
      const delta = await api.submitMove({
        matchId: this.matchId!,
        seat: this.seat,
        cardId,
        expectedRevision: this.state!.revision,
      }) as any;
      if (delta && typeof delta.result === 'string' && delta.result !== 'APPLIED') {
        const reason = String(delta.reason || '');
        dlog(`submitMove NAK result=${delta.result} reason=${reason} rev=${delta.revision}`);
        throw new Error(`ServerReject:${delta.result}:${reason}:rev=${Number(delta.revision || 0)}`);
      }
      this.state = applyDelta(this.state, delta);
      dlog(`submitMove OK rev=${this.state!.revision} turn=${this.state!.turnIndex} phase=${this.state!.phase} trick=${(this.state!.currentTrick || []).length}`);
      if (this.state!.revision > beforeRev) this.lastProgressMs = Date.now();
      if (this.state!.revision === beforeRev && this.state!.turnIndex === beforeTurn) {
        throw new Error('No progress');
      }
      this.notify([]);
      return this.state!;
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await trySubmit();
      } catch (e) {
        const msg = (e as Error).message || '';
        dlog(`submitMove ERR: ${msg.slice(0, 120)}`);
        if (!msg.includes('Revision mismatch') && !msg.includes('No progress') && !msg.includes('ServerReject:')) throw e;
        if (msg.includes('ServerReject:REJECTED_CONFLICT:')) {
          const m = msg.match(/:rev=([0-9]+)/);
          const serverRev = m ? Number(m[1]) : 0;
          const localRev = this.state?.revision || 0;
          // Server can temporarily lag on cross-region/read-source races; avoid hot-loop retries.
          if (serverRev > 0 && serverRev < localRev) {
            await new Promise((r) => setTimeout(r, 350));
          }
        }
        await this.resyncSnapshot();
      }
    }
    // Avoid surfacing a hard error screen for transient no-progress races.
    dlog('submitMove: no progress after retries, returning latest snapshot');
    this.notify([]);
    return this.state!;
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
      this.lastProgressMs = Date.now();
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
      this.lastProgressMs = Date.now();
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
    const beforeRev = this.state.revision;
    const beforeTurn = this.state.turnIndex;
    dlog(`forceTimeout matchId=${this.matchId} rev=${beforeRev} phase=${this.state.phase} turn=${beforeTurn}`);
    try {
      const api = await this.ensureApi();
      const delta = await api.timeoutMove({ matchId: this.matchId });
      this.state = applyDelta(this.state, delta);
      dlog(`timeout OK rev=${this.state!.revision} phase=${this.state!.phase} turn=${this.state!.turnIndex}`);
      if (this.state!.revision > beforeRev) this.lastProgressMs = Date.now();
      if (this.state!.revision === beforeRev && this.state!.turnIndex === beforeTurn) {
        this.timeoutNoProgressCount += 1;
      } else {
        this.timeoutNoProgressCount = 0;
      }
      if (this.timeoutNoProgressCount >= 3) {
        dlog(`timeout stuck detected (count=${this.timeoutNoProgressCount}) -> resync`);
        await this.resyncSnapshot(1);
        this.timeoutNoProgressCount = 0;
      }
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
