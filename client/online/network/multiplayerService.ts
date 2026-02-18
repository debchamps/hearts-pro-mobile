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
  private eventPumpInFlight = false;
  private emptyEventLoops = 0;
  private waitingRecoveryInFlight = false;
  private gameType: GameType | null = null;
  private playerName = 'YOU';
  private autoMoveOnTimeout = true;

  private static readonly EVENT_PUMP_FAST_MS = 35;
  private static readonly EVENT_PUMP_IDLE_MS = 110;
  private static readonly EVENT_PUMP_ERROR_MS = 220;
  private static readonly EVENT_PUMP_WAITING_MS = 800;  // Poll slower when WAITING (saves API calls)
  private static readonly EMPTY_LOOPS_RESYNC_WAITING = 3; // Resync after 3 empty loops (~2.4s) when WAITING
  private static readonly EMPTY_LOOPS_RESYNC_OTHER = 10;  // Resync after 10 empty loops when in other phases
  private static readonly DEBUG_SYNC = true;

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

    const callFindOrCreate = async (retries = 3): Promise<{ matchId: string; seat: number; snapshot?: import('../types').GameStateDelta }> => {
      try {
        return api.findMatch
          ? await api.findMatch({ gameType, playerName, autoMoveOnTimeout: options?.autoMoveOnTimeout })
          : await api.createMatch({ gameType, playerName, autoMoveOnTimeout: options?.autoMoveOnTimeout });
      } catch (e) {
        const msg = (e as Error).message || '';
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

    // Use the inline snapshot from findMatch/createMatch if available,
    // avoiding a separate getSnapshot call that can fail due to TitleData replication lag.
    if (created.snapshot) {
      this.state = applyDelta(null, created.snapshot);
      return this.state;
    }

    // Fallback: getSnapshot with retry
    const getSnapshotWithRetry = async (retries = 3, delayMs = 300): Promise<import('../types').GameStateDelta> => {
      try {
        return await api.getSnapshot({ matchId: created.matchId, seat: created.seat });
      } catch (e) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
          return getSnapshotWithRetry(retries - 1, delayMs * 2);
        }
        throw e;
      }
    };
    const delta = await getSnapshotWithRetry();
    this.state = applyDelta(null, delta);
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
        this.state = applyDelta(this.state, snapshot);
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
    } catch {}
    this.waitingRecoveryInFlight = false;
  }

  async syncSnapshot() {
    const next = await this.resyncSnapshot();
    this.notify([]);
    this.kickEventPumpNow();
    return next;
  }

  async subscribeToMatch(listener: (state: MultiplayerGameState, events: MatchEvent[]) => void) {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    this.listeners.add(listener);
    this.emptyEventLoops = 0;
    const res = await api.subscribeToMatch({
      matchId: this.matchId,
      sinceEventId: this.lastEventId,
      sinceRevision: this.state?.revision || 0,
      seat: this.seat,
      subscriptionId: this.subscriptionId ?? undefined,
    });
    this.subscriptionId = res.subscriptionId;
    this.lastEventId = Math.max(this.lastEventId, res.latestEventId || 0);
    this.applyEvents(res.events);
    if (this.state) listener(this.state, res.events);
    this.startEventPump();
    this.kickEventPumpNow();
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
    if (MultiplayerService.DEBUG_SYNC) {
      try {
        console.log('[OnlineSync] events', events.map((e) => ({ id: e.eventId, type: e.type, rev: e.revision, actorSeat: e.actorSeat })));
      } catch {}
    }
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

  private startEventPump() {
    if (this.eventPumpRunning) return;
    this.eventPumpRunning = true;
    const tick = async () => {
      if (!this.eventPumpRunning || !this.matchId || !this.subscriptionId) return;
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
        if (events.length === 0) {
          if (MultiplayerService.DEBUG_SYNC && this.state) {
            try {
              console.log('[OnlineSync] empty-loop', {
                matchId: this.matchId,
                sub: this.subscriptionId,
                lastEventId: this.lastEventId,
                revision: this.state.revision,
                status: this.state.status,
                phase: this.state.phase,
                turnIndex: this.state.turnIndex,
              });
            } catch {}
          }
          this.emptyEventLoops += 1;
          const isWaiting = this.state && this.state.status === 'WAITING';
          const threshold = isWaiting
            ? MultiplayerService.EMPTY_LOOPS_RESYNC_WAITING
            : MultiplayerService.EMPTY_LOOPS_RESYNC_OTHER;
          if (
            this.emptyEventLoops >= threshold &&
            this.state &&
            (isWaiting || this.state.phase === 'BIDDING' || this.state.phase === 'PASSING')
          ) {
            this.emptyEventLoops = 0;
            try {
              const prevStatus = this.state.status;
              const prevRevision = this.state.revision;
              await this.resyncSnapshot();
              this.notify([]);
              // If status changed from WAITING, the game started!
              if (prevStatus === 'WAITING' && this.state.status !== 'WAITING') {
                if (MultiplayerService.DEBUG_SYNC) {
                  console.log('[OnlineSync] WAITING→STARTED detected via resync', {
                    oldRev: prevRevision,
                    newRev: this.state.revision,
                    newStatus: this.state.status,
                    newPhase: this.state.phase,
                  });
                }
              } else if (isWaiting) {
                await this.tryWaitingRecovery();
              }
            } catch {}
          }
        } else {
          this.emptyEventLoops = 0;
        }
        if (this.eventPumpRunning) {
          const isWaitingNow = this.state && this.state.status === 'WAITING';
          const nextDelay = events.length > 0
            ? MultiplayerService.EVENT_PUMP_FAST_MS
            : isWaitingNow
              ? MultiplayerService.EVENT_PUMP_WAITING_MS
              : MultiplayerService.EVENT_PUMP_IDLE_MS;
          this.eventPumpTimer = window.setTimeout(tick, nextDelay);
        }
      } catch {
        try {
          await this.resyncSnapshot();
          this.notify([]);
        } catch {}
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
    if (!this.eventPumpRunning) return;
    if (this.eventPumpInFlight) return;
    if (this.eventPumpTimer !== null) {
      window.clearTimeout(this.eventPumpTimer);
      this.eventPumpTimer = null;
    }
    this.eventPumpTimer = window.setTimeout(async () => {
      if (!this.eventPumpRunning || !this.matchId || !this.subscriptionId || this.eventPumpInFlight) return;
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
        if (events.length === 0 && this.state && this.state.status === 'WAITING') {
          try {
            await this.resyncSnapshot();
            this.notify([]);
            await this.tryWaitingRecovery();
          } catch {}
        }
      } catch {
      } finally {
        this.eventPumpInFlight = false;
      }
    }, 0);
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
      this.kickEventPumpNow();
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
      this.kickEventPumpNow();
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
      this.kickEventPumpNow();
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
    this.kickEventPumpNow();
    return this.state;
  }

  async finish() {
    if (!this.matchId) throw new Error('No active match');
    const api = await this.ensureApi();
    return api.endMatch({ matchId: this.matchId });
  }
}
