import { GameType } from '../../../types';
import { getBotMove } from './botEngine';
import { createDelta, createInitialState, resolveRewards, submitMove, timeoutMove } from './matchEngine';
import { GameStateDelta, MatchEvent, MatchResult, MatchSubscriptionResult, MultiplayerGameState, OnlineApi } from '../types';

const TIMEOUT_MS = 5000;

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

function emitEvent(store: MatchStore, type: MatchEvent['type']) {
  const event: MatchEvent = {
    eventId: store.nextEventId++,
    type,
    matchId: store.state.matchId,
    revision: store.state.revision,
    timestamp: Date.now(),
    delta: store.state,
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
    if (!store || store.state.status !== 'PLAYING') return;
    const active = store.state.players[store.state.turnIndex];
    if (!active || !active.isBot) return;

    const { cardId } = await getBotMove(store.state, active.seat);
    const latest = matches.get(matchId);
    if (!latest || latest.state.status !== 'PLAYING') return;
    if (latest.state.turnIndex !== active.seat) return;

    latest.previous = latest.state;
    latest.state = submitMove(latest.state, active.seat, cardId, TIMEOUT_MS);
    emitEvent(latest, latest.state.currentTrick.length === 0 ? 'TRICK_COMPLETED' : 'CARD_PLAYED');
    if (latest.state.status === 'COMPLETED') {
      emitEvent(latest, 'MATCH_COMPLETED');
      return;
    }
    emitEvent(latest, 'TURN_CHANGED');
  }
}

export const localOnlineApi: OnlineApi = {
  async createLobby(input: { gameType: GameType; region?: string }) {
    return { lobbyId: `l_${input.gameType.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}` };
  },

  async findMatch(input: { gameType: GameType; lobbyId?: string; playerName?: string; autoMoveOnTimeout?: boolean }) {
    const created = await this.createMatch({
      gameType: input.gameType,
      playerName: input.playerName || 'YOU',
      autoMoveOnTimeout: input.autoMoveOnTimeout,
    });
    return { matchId: created.matchId, seat: created.seat };
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
    emitEvent(store, 'MATCH_STARTED');
    emitEvent(store, 'TURN_CHANGED');
    void runBotTurnChain(matchId);
    return { matchId, seat: 0 };
  },

  async joinMatch(_input: { matchId: string; playerName: string }) {
    return { seat: 2 };
  },

  async submitMove(input) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    if (input.expectedRevision !== store.state.revision) throw new Error('Revision conflict');

    store.previous = store.state;
    store.state = submitMove(store.state, input.seat, input.cardId, TIMEOUT_MS);
    emitEvent(store, store.state.currentTrick.length === 0 ? 'TRICK_COMPLETED' : 'CARD_PLAYED');
    if (store.state.status === 'COMPLETED') emitEvent(store, 'MATCH_COMPLETED');
    else emitEvent(store, 'TURN_CHANGED');
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
      emitEvent(store, store.state.currentTrick.length === 0 ? 'TRICK_COMPLETED' : 'CARD_PLAYED');
      if (store.state.status === 'COMPLETED') emitEvent(store, 'MATCH_COMPLETED');
      else emitEvent(store, 'TURN_CHANGED');
    }
    await runBotTurnChain(input.matchId);
    return currentDelta(input.matchId);
  },

  async endMatch(input): Promise<MatchResult> {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    store.state.status = 'COMPLETED';
    emitEvent(store, 'MATCH_COMPLETED');
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
    emitEvent(store, 'PLAYER_RECONNECTED');
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
  emitEvent(store, 'PLAYER_DISCONNECTED');
  void runBotTurnChain(matchId);
}
