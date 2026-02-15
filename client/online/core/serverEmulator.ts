import { GameType } from '../../../types';
import { getBotMove } from './botEngine';
import { createDelta, createInitialState, resolveRewards, submitMove, timeoutMove } from './matchEngine';
import { GameStateDelta, MatchResult, MultiplayerGameState, OnlineApi } from '../types';

const TIMEOUT_MS = 5000;

interface MatchStore {
  state: MultiplayerGameState;
  previous: MultiplayerGameState | null;
}

const matches = new Map<string, MatchStore>();
const wallet = new Map<string, number>();

function createMatchId() {
  return `m_${Math.random().toString(36).slice(2, 10)}`;
}

async function runBotIfNeeded(matchId: string) {
  const store = matches.get(matchId);
  if (!store) return;
  const state = store.state;
  if (state.status !== 'PLAYING') return;

  const active = state.players[state.turnIndex];
  if (!active || !active.isBot) return;

  const { cardId, simulatedDelayMs } = await getBotMove(state, active.seat);
  await new Promise((r) => setTimeout(r, simulatedDelayMs));

  const latestStore = matches.get(matchId);
  if (!latestStore || latestStore.state.status !== 'PLAYING') return;
  if (latestStore.state.turnIndex !== active.seat) return;

  latestStore.previous = latestStore.state;
  latestStore.state = submitMove(latestStore.state, active.seat, cardId, TIMEOUT_MS);
  void runBotIfNeeded(matchId);
}

function currentDelta(matchId: string): GameStateDelta {
  const store = matches.get(matchId);
  if (!store) throw new Error('Match not found');
  return createDelta(store.previous, store.state);
}

export const localOnlineApi: OnlineApi = {
  async createLobby(input: { gameType: GameType; region?: string }) {
    return { lobbyId: `l_${input.gameType.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}` };
  },

  async findMatch(input: { gameType: GameType; lobbyId?: string; playerName?: string }) {
    const created = await this.createMatch({ gameType: input.gameType, playerName: input.playerName || 'YOU' });
    return { matchId: created.matchId, seat: created.seat };
  },

  async createMatch(input: { gameType: GameType; playerName: string }) {
    const matchId = createMatchId();
    const state = createInitialState(matchId, {
      gameType: input.gameType,
      entryFee: 50,
      timeoutMs: TIMEOUT_MS,
    });

    state.players[0].name = input.playerName || 'YOU';
    state.players[0].coins = wallet.get('LOCAL_PLAYER') ?? 1000;

    matches.set(matchId, { state, previous: null });
    void runBotIfNeeded(matchId);
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
    void runBotIfNeeded(input.matchId);
    return currentDelta(input.matchId);
  },

  async getState(input) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');

    const timed = timeoutMove(store.state, TIMEOUT_MS);
    if (timed !== store.state) {
      store.previous = store.state;
      store.state = timed;
      void runBotIfNeeded(input.matchId);
    }

    if (store.state.revision <= input.sinceRevision) {
      return {
        matchId: input.matchId,
        revision: store.state.revision,
        changed: {},
        serverTimeMs: Date.now(),
      };
    }

    return currentDelta(input.matchId);
  },

  async timeoutMove(input) {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    store.previous = store.state;
    store.state = timeoutMove(store.state, TIMEOUT_MS);
    void runBotIfNeeded(input.matchId);
    return currentDelta(input.matchId);
  },

  async endMatch(input): Promise<MatchResult> {
    const store = matches.get(input.matchId);
    if (!store) throw new Error('Match not found');
    store.state.status = 'COMPLETED';
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
  void runBotIfNeeded(matchId);
}
