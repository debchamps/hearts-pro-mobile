import { GameType, Card } from '../../../types';
import { getBotMove } from './botEngine';
import { createDelta, createInitialState, resolveRewards, submitMove, submitPass, submitBid, timeoutMove } from './matchEngine';
import { GameStateDelta, MatchEvent, MatchResult, MatchSubscriptionResult, MultiplayerGameState, OnlineApi } from '../types';

const TIMEOUT_MS = 9000;

interface MatchStore {
  state: MultiplayerGameState;
  previous: MultiplayerGameState | null;
  events: MatchEvent[];
  nextEventId: number;
  subscriptions: Record<string, string>;
}

const matches = new Map<string, MatchStore>();
const wallet = new Map<string, number>();

function createMatchId() {
  return `m_${Math.random().toString(36).slice(2, 10)}`;
}

function createSubscriptionId() {
  return `sub_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneState<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function emitEvent(store: MatchStore, type: MatchEvent['type'], actorSeat = -1, payload?: Partial<MultiplayerGameState>) {
  const event: MatchEvent = {
    eventId: store.nextEventId++,
    type,
    matchId: store.state.matchId,
    revision: store.state.revision,
    timestamp: Date.now(),
    actorSeat,
    payload: cloneState((payload || store.state) as Partial<MultiplayerGameState>),
  };
  store.events.push(event);
  if (store.events.length > 200) {
    store.events.splice(0, store.events.length - 200);
  }
}

function currentDelta(matchId: string): GameStateDelta {
  const store = matches.get(matchId);
  if (!store) throw new Error('Match not found');
  return createDelta(store.previous, store.state);
}

async function runBotTurnChain(matchId: string) {
  for (;;) {
    const store = matches.get(matchId);
    if (!store || store.state.status === 'COMPLETED') return;

    // Handle bot passing (Hearts) — passing is simultaneous
    if (store.state.phase === 'PASSING') {
      await runBotPassingPhase(matchId);
      // After bot passing, if we're still in PASSING, wait for human — exit chain
      const afterPass = matches.get(matchId);
      if (!afterPass || afterPass.state.phase === 'PASSING') return;
      // If passing completed and transitioned to PLAYING, continue the chain
      continue;
    }

    // Handle bot bidding (Spades/Callbreak) — bidding is turn-based
    if (store.state.phase === 'BIDDING') {
      await runBotBiddingChain(matchId);
      // After bot bidding, if it's now a human's turn or still bidding, exit
      const afterBid = matches.get(matchId);
      if (!afterBid || afterBid.state.phase === 'BIDDING') return;
      // If bidding completed, continue chain for bot plays
      continue;
    }

    // Only continue if in PLAYING phase
    if (store.state.phase !== 'PLAYING') return;

    // Handle bot card play
    const active = store.state.players[store.state.turnIndex];
    if (!active || !active.isBot) return;

    const { cardId, simulatedDelayMs } = await getBotMove(store.state, active.seat);
    // Wait a realistic delay for bots
    await new Promise((r) => setTimeout(r, Math.min(simulatedDelayMs, 800)));

    const latest = matches.get(matchId);
    if (!latest || latest.state.status === 'COMPLETED' || latest.state.phase !== 'PLAYING') return;
    if (latest.state.turnIndex !== active.seat) return;

    latest.previous = latest.state;
    latest.state = submitMove(latest.state, active.seat, cardId, TIMEOUT_MS);

    const isTrickComplete = latest.state.currentTrick.length === 0;
    emitEvent(
      latest,
      isTrickComplete ? 'TRICK_COMPLETED' : 'CARD_PLAYED',
      active.seat,
      {
        currentTrick: latest.state.currentTrick,
        hands: latest.state.hands,
        turnIndex: latest.state.turnIndex,
        leadSuit: latest.state.leadSuit,
        trickWins: latest.state.trickWins,
        scores: latest.state.scores,
        lastCompletedTrick: latest.state.lastCompletedTrick,
      }
    );

    if (latest.state.status === 'COMPLETED') {
      emitEvent(latest, 'MATCH_COMPLETED', active.seat, {
        status: latest.state.status,
        phase: latest.state.phase,
        scores: latest.state.scores,
        trickWins: latest.state.trickWins,
      });
      return;
    }

    emitEvent(latest, 'TURN_CHANGED', latest.state.turnIndex, {
      turnIndex: latest.state.turnIndex,
      turnDeadlineMs: latest.state.turnDeadlineMs,
      phase: latest.state.phase,
    });

    // If the trick just completed, add a small delay before the next bot plays
    if (isTrickComplete) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function runBotPassingPhase(matchId: string) {
  // Passing is turn-based on the server: each seat passes in order
  for (;;) {
    const store = matches.get(matchId);
    if (!store || store.state.phase !== 'PASSING') return;

    const seat = store.state.turnIndex;
    const player = store.state.players[seat];
    if (!player || !player.isBot) return; // Human's turn to pass — exit

    const selections = store.state.passingSelections || { 0: [], 1: [], 2: [], 3: [] };
    if ((selections[seat] || []).length === 3) return; // Already passed

    // Bot auto-selects 3 highest value cards to pass
    const hand = store.state.hands[seat] || [];
    const sorted = [...hand].sort((a, b) => b.value - a.value);
    const autoIds = sorted.slice(0, 3).map((c) => c.id);

    // Small delay to simulate thinking
    await new Promise((r) => setTimeout(r, 200));
    const latest = matches.get(matchId);
    if (!latest || latest.state.phase !== 'PASSING') return;

    latest.previous = latest.state;
    latest.state = submitPass(latest.state, seat, autoIds, TIMEOUT_MS);

    // Emit appropriate events based on whether passing completed
    if (latest.state.phase === 'PLAYING') {
      // All players have passed — cards redistributed, transition to playing
      emitEvent(latest, 'CARDS_DISTRIBUTED', -1, {
        phase: latest.state.phase,
        hands: latest.state.hands,
        passingSelections: latest.state.passingSelections,
        turnIndex: latest.state.turnIndex,
        turnDeadlineMs: latest.state.turnDeadlineMs,
      });
      emitEvent(latest, 'TURN_CHANGED', latest.state.turnIndex, {
        turnIndex: latest.state.turnIndex,
        phase: latest.state.phase,
        hands: latest.state.hands,
      });
      return; // Done with passing
    } else {
      // Still waiting for more players to pass — emit turn change
      emitEvent(latest, 'TURN_CHANGED', latest.state.turnIndex, {
        phase: latest.state.phase,
        passingSelections: latest.state.passingSelections,
        turnIndex: latest.state.turnIndex,
        turnDeadlineMs: latest.state.turnDeadlineMs,
      });
    }
  }
}

async function runBotBiddingChain(matchId: string) {
  for (;;) {
    const store = matches.get(matchId);
    if (!store || store.state.status === 'COMPLETED' || store.state.phase !== 'BIDDING') return;

    const active = store.state.players[store.state.turnIndex];
    if (!active || !active.isBot) return; // Human's turn to bid

    // Simple bot bid logic
    const hand = store.state.hands[active.seat] || [];
    const spades = hand.filter((c) => c.suit === 'SPADES').length;
    const highCards = hand.filter((c) => c.value >= 12).length;
    let bid: number;
    if (store.state.gameType === 'CALLBREAK') {
      bid = Math.max(1, Math.min(8, Math.round((spades + highCards) / 2)));
    } else {
      bid = Math.max(1, Math.min(13, spades + highCards - 2));
    }

    await new Promise((r) => setTimeout(r, 600));
    const latest = matches.get(matchId);
    if (!latest || latest.state.phase !== 'BIDDING' || latest.state.turnIndex !== active.seat) return;

    latest.previous = latest.state;
    latest.state = submitBid(latest.state, active.seat, bid, TIMEOUT_MS);
    emitEvent(latest, 'BID_SUBMITTED', active.seat, {
      bids: latest.state.bids,
      phase: latest.state.phase,
      turnIndex: latest.state.turnIndex,
      turnDeadlineMs: latest.state.turnDeadlineMs,
    });

    if (latest.state.phase === 'PLAYING') {
      // All bids are in — transition to playing
      emitEvent(latest, 'BIDDING_COMPLETED', -1, {
        bids: latest.state.bids,
        phase: latest.state.phase,
        turnIndex: latest.state.turnIndex,
        turnDeadlineMs: latest.state.turnDeadlineMs,
      });
      emitEvent(latest, 'TURN_CHANGED', latest.state.turnIndex, {
        turnIndex: latest.state.turnIndex,
        phase: latest.state.phase,
        turnDeadlineMs: latest.state.turnDeadlineMs,
      });
      return;
    }
  }
}

export const localOnlineApi: OnlineApi = {
  async createLobby(input: { gameType: GameType; region?: string }) {
    return { lobbyId: `l_${input.gameType.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}` };
  },

  async findMatch(input: {
    gameType: GameType;
    lobbyId?: string;
    playerName?: string;
    autoMoveOnTimeout?: boolean;
    currentMatchId?: string;
  }) {
    const created = await this.createMatch({
      gameType: input.gameType,
      playerName: input.playerName || 'YOU',
      autoMoveOnTimeout: input.autoMoveOnTimeout,
    });
    return { matchId: created.matchId, seat: created.seat, snapshot: created.snapshot };
  },

  async createMatch(input: { gameType: GameType; playerName: string; autoMoveOnTimeout?: boolean }) {
    const matchId = createMatchId();
    const state = createInitialState(matchId, {
      gameType: input.gameType,
      entryFee: 50,
      timeoutMs: TIMEOUT_MS,
    });
    state.players[0].name = input.playerName || 'YOU';
    state.players[0].coins = wallet.get('LOCAL_PLAYER') ?? 1000;

    const store: MatchStore = {
      state,
      previous: null,
      events: [],
      nextEventId: 1,
      subscriptions: {},
    };
    matches.set(matchId, store);

    emitEvent(store, 'MATCH_CREATED', -1, {
      status: store.state.status,
      phase: store.state.phase,
      players: store.state.players,
      gameType: store.state.gameType,
      roundNumber: store.state.roundNumber,
    });
    emitEvent(store, 'MATCH_STARTED', -1, {
      status: store.state.status,
      phase: store.state.phase,
      turnIndex: store.state.turnIndex,
    });
    emitEvent(store, 'CARDS_DISTRIBUTED', -1, {
      hands: store.state.hands,
      seed: store.state.seed,
      deck: store.state.deck,
      phase: store.state.phase,
      passingDirection: store.state.passingDirection,
      bids: store.state.bids,
    });
    emitEvent(store, 'TURN_CHANGED', store.state.turnIndex, {
      turnIndex: store.state.turnIndex,
      turnDeadlineMs: store.state.turnDeadlineMs,
      phase: store.state.phase,
    });

    // Start bot automation chain
    void runBotTurnChain(matchId);
    return {
      matchId,
      seat: 0,
      snapshot: {
        matchId,
        revision: store.state.revision,
        changed: store.state,
        serverTimeMs: Date.now(),
      },
    };
  },

  async joinMatch(_input: { matchId: string; playerName: string }) {
    return { seat: 2 };
  },

  async submitMove(input) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    if (input.expectedRevision !== store.state.revision) throw new Error('Revision mismatch');

    store.previous = store.state;
    store.state = submitMove(store.state, input.seat, input.cardId, TIMEOUT_MS);

    const isTrickComplete = store.state.currentTrick.length === 0;
    emitEvent(
      store,
      isTrickComplete ? 'TRICK_COMPLETED' : 'CARD_PLAYED',
      input.seat,
      {
        currentTrick: store.state.currentTrick,
        hands: store.state.hands,
        turnIndex: store.state.turnIndex,
        leadSuit: store.state.leadSuit,
        trickWins: store.state.trickWins,
        scores: store.state.scores,
        lastCompletedTrick: store.state.lastCompletedTrick,
      }
    );

    if (store.state.status === 'COMPLETED') {
      emitEvent(store, 'MATCH_COMPLETED', input.seat, {
        status: store.state.status,
        phase: store.state.phase,
        scores: store.state.scores,
        trickWins: store.state.trickWins,
      });
    } else {
      emitEvent(store, 'TURN_CHANGED', store.state.turnIndex, {
        turnIndex: store.state.turnIndex,
        turnDeadlineMs: store.state.turnDeadlineMs,
        phase: store.state.phase,
      });
    }

    await runBotTurnChain(input.matchId);
    return currentDelta(input.matchId);
  },

  async submitPass(input: { matchId: string; seat: number; cardIds: string[]; expectedRevision: number }) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    if (input.expectedRevision !== store.state.revision) throw new Error('Revision mismatch');

    store.previous = store.state;
    store.state = submitPass(store.state, input.seat, input.cardIds, TIMEOUT_MS);

    if (store.state.phase === 'PLAYING') {
      // All passing complete — cards redistributed
      emitEvent(store, 'CARDS_DISTRIBUTED', input.seat, {
        phase: store.state.phase,
        hands: store.state.hands,
        passingSelections: store.state.passingSelections,
        turnIndex: store.state.turnIndex,
        turnDeadlineMs: store.state.turnDeadlineMs,
      });
      emitEvent(store, 'TURN_CHANGED', store.state.turnIndex, {
        turnIndex: store.state.turnIndex,
        phase: store.state.phase,
        hands: store.state.hands,
      });
    } else {
      emitEvent(store, 'CARD_PLAYED', input.seat, {
        phase: store.state.phase,
        passingSelections: store.state.passingSelections,
      });
    }

    await runBotTurnChain(input.matchId);
    return currentDelta(input.matchId);
  },

  async submitBid(input: { matchId: string; seat: number; bid: number; expectedRevision: number }) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    if (input.expectedRevision !== store.state.revision) throw new Error('Revision mismatch');

    store.previous = store.state;
    store.state = submitBid(store.state, input.seat, input.bid, TIMEOUT_MS);
    emitEvent(store, 'BID_SUBMITTED', input.seat, {
      bids: store.state.bids,
      phase: store.state.phase,
      turnIndex: store.state.turnIndex,
      turnDeadlineMs: store.state.turnDeadlineMs,
    });

    if (store.state.phase === 'PLAYING') {
      emitEvent(store, 'BIDDING_COMPLETED', -1, {
        bids: store.state.bids,
        phase: store.state.phase,
        turnIndex: store.state.turnIndex,
        turnDeadlineMs: store.state.turnDeadlineMs,
      });
      emitEvent(store, 'TURN_CHANGED', store.state.turnIndex, {
        turnIndex: store.state.turnIndex,
        phase: store.state.phase,
        turnDeadlineMs: store.state.turnDeadlineMs,
      });
    }

    await runBotTurnChain(input.matchId);
    return currentDelta(input.matchId);
  },

  async getSnapshot(input) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    return {
      matchId: input.matchId,
      revision: store.state.revision,
      changed: store.state,
      serverTimeMs: Date.now(),
    };
  },

  async subscribeToMatch(input): Promise<MatchSubscriptionResult> {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    const requestedId = input.subscriptionId && store.subscriptions[input.subscriptionId] ? input.subscriptionId : null;
    const subscriptionId = requestedId || createSubscriptionId();
    if (!requestedId) {
      store.subscriptions[subscriptionId] = String(input.seat ?? 0);
    }
    const sinceEventId = input.sinceEventId || 0;
    const events = store.events.filter((event) => event.eventId > sinceEventId);
    const sinceRevision = Number(input.sinceRevision || 0);
    if (events.length === 0 && sinceRevision < store.state.revision) {
      const synthetic: MatchEvent = {
        eventId: store.events.length ? store.events[store.events.length - 1].eventId : 0,
        type: 'TURN_CHANGED',
        matchId: store.state.matchId,
        revision: store.state.revision,
        timestamp: Date.now(),
        actorSeat: store.state.turnIndex,
        payload: cloneState(store.state),
      };
      return {
        subscriptionId,
        events: [synthetic],
        latestEventId: store.events.length ? store.events[store.events.length - 1].eventId : 0,
      };
    }
    return {
      subscriptionId,
      events,
      latestEventId: store.events.length ? store.events[store.events.length - 1].eventId : 0,
    };
  },

  async unsubscribeFromMatch(input) {
    const store = matches.get(input.matchId);
    if (!store) return { ok: true };
    delete store.subscriptions[input.subscriptionId];
    return { ok: true };
  },

  async timeoutMove(input) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    store.previous = store.state;
    store.state = timeoutMove(store.state, TIMEOUT_MS);
    if (store.state.revision !== store.previous.revision) {
      emitEvent(
        store,
        store.state.currentTrick.length === 0 ? 'TRICK_COMPLETED' : 'CARD_PLAYED',
        store.state.turnIndex,
        {
          currentTrick: store.state.currentTrick,
          hands: store.state.hands,
          lastCompletedTrick: store.state.lastCompletedTrick,
          trickWins: store.state.trickWins,
          scores: store.state.scores,
          turnIndex: store.state.turnIndex,
          phase: store.state.phase,
        }
      );
      if (store.state.status === 'COMPLETED') {
        emitEvent(store, 'MATCH_COMPLETED', store.state.turnIndex, {
          status: store.state.status,
          phase: store.state.phase,
          scores: store.state.scores,
          trickWins: store.state.trickWins,
        });
      } else {
        emitEvent(store, 'TURN_CHANGED', store.state.turnIndex, {
          turnIndex: store.state.turnIndex,
          turnDeadlineMs: store.state.turnDeadlineMs,
          phase: store.state.phase,
        });
      }
    }
    await runBotTurnChain(input.matchId);
    return currentDelta(input.matchId);
  },

  async endMatch(input): Promise<MatchResult> {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    store.state.status = 'COMPLETED';
    store.state.phase = 'COMPLETED';
    emitEvent(store, 'MATCH_COMPLETED', -1, {
      status: store.state.status,
      scores: store.state.scores,
    });
    const result = resolveRewards(store.state);
    result.rewards.forEach((reward) => {
      const player = store.state.players[reward.seat];
      const current = wallet.get(player.playFabId) ?? 1000;
      wallet.set(player.playFabId, current + reward.coinsDelta);
    });
    return result;
  },

  async updateCoins(input) {
    const current = wallet.get(input.playFabId) ?? 1000;
    const coins = current + input.delta;
    wallet.set(input.playFabId, coins);
    return { coins };
  },

  async reconnect(input) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    const seat = store.state.players.find((p) => p.playFabId === input.playFabId || p.seat === 0)?.seat ?? 0;
    store.state.players = store.state.players.map((p) => (p.seat === seat ? { ...p, disconnected: false } : p));
    emitEvent(store, 'PLAYER_RECONNECTED', seat, { players: store.state.players });
    return {
      seat,
      delta: {
        matchId: input.matchId,
        revision: store.state.revision,
        changed: store.state,
        serverTimeMs: Date.now(),
      },
    };
  },
};

export function markDisconnected(matchId: string, seat: number) {
  const store = matches.get(matchId);
  if (!store) return;
  store.state.players = store.state.players.map((p) => (p.seat === seat ? { ...p, disconnected: true, isBot: true } : p));
  emitEvent(store, 'PLAYER_DISCONNECTED', seat, { players: store.state.players });
  void runBotTurnChain(matchId);
}
