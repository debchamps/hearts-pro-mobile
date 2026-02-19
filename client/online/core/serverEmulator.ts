import { GameType, Card } from '../../../types';
import { getBotMove } from './botEngine';
import { createDelta, resolveRewards, submitMove, submitPass, submitBid, timeoutMove } from './matchEngine';
import { createDeck } from '../../../constants';
import { sortCardsBySuitThenRankAsc } from '../../../services/cardSort';
import { getRules } from '../rules';
import { seededShuffle } from '../utils';
import { GameStateDelta, MatchEvent, MatchResult, MatchSubscriptionResult, MultiplayerGameState, OnlineApi, OnlinePlayerMeta, MatchConfig } from '../types';

// ────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────
const TIMEOUT_MS = 9000;
const RECONNECT_WINDOW_MS = 30_000; // 30 seconds to rejoin
const MATCH_STALE_MS = 90_000; // 90s waiting match expiry
const STORAGE_PREFIX = 'emu_';
const TEAM_BY_SEAT: Record<number, 0 | 1> = { 0: 0, 1: 1, 2: 0, 3: 1 };

// ────────────────────────────────────────────────
//  Utility
// ────────────────────────────────────────────────
function createMatchId() {
  return `m_${Math.random().toString(36).slice(2, 10)}`;
}

function createSubscriptionId() {
  return `sub_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneState<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function getPassingDirection(round: number): 'LEFT' | 'RIGHT' | 'ACROSS' | 'NONE' {
  const cycle = ((round - 1) % 4);
  return cycle === 0 ? 'LEFT' : cycle === 1 ? 'RIGHT' : cycle === 2 ? 'ACROSS' : 'NONE';
}

// ────────────────────────────────────────────────
//  Cross-tab storage helpers (localStorage)
// ────────────────────────────────────────────────
function storageGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch { return null; }
}

function storageSet(key: string, value: unknown) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {}
}

function storageRemove(key: string) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {}
}

// ────────────────────────────────────────────────
//  BroadcastChannel for cross-tab communication
// ────────────────────────────────────────────────
interface MatchMessage {
  type: 'PLAYER_JOINED' | 'STATE_UPDATED' | 'MATCH_STARTED';
  matchId: string;
  state?: MultiplayerGameState;
  events?: MatchEvent[];
  seat?: number;
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel('emu_match_channel');
  }
  return channel;
}

function broadcastMessage(msg: MatchMessage) {
  try {
    getChannel().postMessage(msg);
  } catch {}
}

// ────────────────────────────────────────────────
//  Local in-memory match store
// ────────────────────────────────────────────────
interface MatchStore {
  state: MultiplayerGameState;
  previous: MultiplayerGameState | null;
  events: MatchEvent[];
  nextEventId: number;
  subscriptions: Record<string, string>;
}

const matches = new Map<string, MatchStore>();
const wallet = new Map<string, number>();

// Track which match this tab is in (for reconnect)
let currentTabMatchId: string | null = null;
let currentTabSeat: number = 0;
let currentTabPlayerId: string = 'LOCAL_PLAYER';

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

// ────────────────────────────────────────────────
//  Match initialization (WAITING state)
// ────────────────────────────────────────────────
interface WaitingMarker {
  matchId: string;
  gameType: GameType;
  ownerPlayerId: string;
  ownerName: string;
  createdAt: number;
  state: MultiplayerGameState; // embedded snapshot
}

interface DisconnectMarker {
  matchId: string;
  playerId: string;
  seat: number;
  disconnectedAt: number;
  gameType: GameType;
  state: MultiplayerGameState;
}

function createWaitingState(matchId: string, gameType: GameType, playerName: string): MultiplayerGameState {
  return {
    matchId,
    gameType,
    revision: 1,
    seed: Date.now(),
    deck: [],
    players: [
      { seat: 0, playFabId: currentTabPlayerId, name: playerName || 'YOU', isBot: false, disconnected: false, pingMs: 42, rankBadge: 'Rookie', coins: 1000, teamId: 0 },
      { seat: 1, playFabId: 'BOT_1', name: 'BOT 1', isBot: true, disconnected: false, pingMs: 10, rankBadge: 'BOT', coins: 1000, teamId: 1, botDifficulty: 'medium' },
      { seat: 2, playFabId: 'PENDING_HUMAN', name: 'OPPONENT', isBot: false, disconnected: false, pingMs: 57, rankBadge: 'Rookie', coins: 1000, teamId: 0 },
      { seat: 3, playFabId: 'BOT_3', name: 'BOT 3', isBot: true, disconnected: false, pingMs: 12, rankBadge: 'BOT', coins: 1000, teamId: 1, botDifficulty: 'medium' },
    ] as OnlinePlayerMeta[],
    hands: { 0: [], 1: [], 2: [], 3: [] },
    turnIndex: 0,
    currentTrick: [],
    trickLeaderIndex: 0,
    leadSuit: null,
    trickWins: { 0: 0, 1: 0, 2: 0, 3: 0 },
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    bids: { 0: null, 1: null, 2: null, 3: null },
    roundNumber: 1,
    status: 'WAITING',
    phase: 'WAITING',
    passingSelections: { 0: [], 1: [], 2: [], 3: [] },
    passingDirection: getPassingDirection(1),
    turnDeadlineMs: Date.now() + TIMEOUT_MS,
    dealerIndex: 0,
    serverTimeMs: Date.now(),
  };
}

function startMatch(state: MultiplayerGameState): MultiplayerGameState {
  const seed = Date.now();
  const deck = seededShuffle(
    createDeck({ targetScore: 0, shootTheMoon: false, noPassing: true, jackOfDiamonds: false }),
    seed
  );

  const hands: Record<number, Card[]> = { 0: [], 1: [], 2: [], 3: [] };
  for (let seat = 0; seat < 4; seat++) {
    hands[seat] = sortCardsBySuitThenRankAsc(deck.slice(seat * 13, seat * 13 + 13));
  }

  const phase = state.gameType === 'HEARTS'
    ? 'PASSING' as const
    : (state.gameType === 'SPADES' || state.gameType === 'CALLBREAK')
      ? 'BIDDING' as const
      : 'PLAYING' as const;

  const dealerIndex = 0;
  const initialTurnIndex = phase === 'BIDDING' ? (dealerIndex + 1) % 4 : 0;

  return {
    ...state,
    seed,
    deck,
    hands,
    status: 'PLAYING',
    phase,
    turnIndex: initialTurnIndex,
    trickLeaderIndex: 0,
    leadSuit: null,
    currentTrick: [],
    trickWins: { 0: 0, 1: 0, 2: 0, 3: 0 },
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    bids: { 0: null, 1: null, 2: null, 3: null },
    passingSelections: { 0: [], 1: [], 2: [], 3: [] },
    passingDirection: getPassingDirection(1),
    turnDeadlineMs: Date.now() + TIMEOUT_MS,
    dealerIndex,
    serverTimeMs: Date.now(),
    revision: state.revision + 1,
  };
}

// ────────────────────────────────────────────────
//  Bot automation chains
// ────────────────────────────────────────────────
async function runBotTurnChain(matchId: string) {
  for (;;) {
    const store = matches.get(matchId);
    if (!store || store.state.status === 'COMPLETED') return;

    if (store.state.phase === 'PASSING') {
      await runBotPassingPhase(matchId);
      const afterPass = matches.get(matchId);
      if (!afterPass || afterPass.state.phase === 'PASSING') return;
      continue;
    }

    if (store.state.phase === 'BIDDING') {
      await runBotBiddingChain(matchId);
      const afterBid = matches.get(matchId);
      if (!afterBid || afterBid.state.phase === 'BIDDING') return;
      continue;
    }

    if (store.state.phase !== 'PLAYING') return;

    const active = store.state.players[store.state.turnIndex];
    if (!active || !active.isBot) return;

    const { cardId, simulatedDelayMs } = await getBotMove(store.state, active.seat);
    await new Promise((r) => setTimeout(r, Math.min(simulatedDelayMs, 800)));

    const latest = matches.get(matchId);
    if (!latest || latest.state.status === 'COMPLETED' || latest.state.phase !== 'PLAYING') return;
    if (latest.state.turnIndex !== active.seat) return;

    latest.previous = latest.state;
    latest.state = submitMove(latest.state, active.seat, cardId, TIMEOUT_MS);

    const isTrickComplete = latest.state.currentTrick.length === 0;
    emitEvent(latest, isTrickComplete ? 'TRICK_COMPLETED' : 'CARD_PLAYED', active.seat, {
      currentTrick: latest.state.currentTrick,
      hands: latest.state.hands,
      turnIndex: latest.state.turnIndex,
      leadSuit: latest.state.leadSuit,
      trickWins: latest.state.trickWins,
      scores: latest.state.scores,
      lastCompletedTrick: latest.state.lastCompletedTrick,
    });

    if (latest.state.status === 'COMPLETED') {
      emitEvent(latest, 'MATCH_COMPLETED', active.seat, {
        status: latest.state.status,
        phase: latest.state.phase,
        scores: latest.state.scores,
        trickWins: latest.state.trickWins,
      });
      syncToStorage(matchId);
      broadcastMessage({ type: 'STATE_UPDATED', matchId, state: latest.state });
      return;
    }

    emitEvent(latest, 'TURN_CHANGED', latest.state.turnIndex, {
      turnIndex: latest.state.turnIndex,
      turnDeadlineMs: latest.state.turnDeadlineMs,
      phase: latest.state.phase,
    });

    syncToStorage(matchId);
    broadcastMessage({ type: 'STATE_UPDATED', matchId, state: latest.state });

    if (isTrickComplete) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function runBotPassingPhase(matchId: string) {
  for (;;) {
    const store = matches.get(matchId);
    if (!store || store.state.phase !== 'PASSING') return;

    const seat = store.state.turnIndex;
    const player = store.state.players[seat];
    if (!player || !player.isBot) return;

    const selections = store.state.passingSelections || { 0: [], 1: [], 2: [], 3: [] };
    if ((selections[seat] || []).length === 3) return;

    const hand = store.state.hands[seat] || [];
    const sorted = [...hand].sort((a, b) => b.value - a.value);
    const autoIds = sorted.slice(0, 3).map((c) => c.id);

    await new Promise((r) => setTimeout(r, 200));
    const latest = matches.get(matchId);
    if (!latest || latest.state.phase !== 'PASSING') return;

    latest.previous = latest.state;
    latest.state = submitPass(latest.state, seat, autoIds, TIMEOUT_MS);

    if (latest.state.phase === 'PLAYING') {
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
      syncToStorage(matchId);
      broadcastMessage({ type: 'STATE_UPDATED', matchId, state: latest.state });
      return;
    } else {
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
    if (!active || !active.isBot) return;

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
      syncToStorage(matchId);
      broadcastMessage({ type: 'STATE_UPDATED', matchId, state: latest.state });
      return;
    }
  }
}

// ────────────────────────────────────────────────
//  Storage sync helpers
// ────────────────────────────────────────────────
function syncToStorage(matchId: string) {
  const store = matches.get(matchId);
  if (!store) return;
  storageSet(`match_${matchId}`, {
    state: store.state,
    events: store.events,
    nextEventId: store.nextEventId,
  });
}

function loadFromStorage(matchId: string): MatchStore | null {
  const data = storageGet<{ state: MultiplayerGameState; events: MatchEvent[]; nextEventId: number }>(`match_${matchId}`);
  if (!data) return null;
  return {
    state: data.state,
    previous: null,
    events: data.events || [],
    nextEventId: data.nextEventId || 1,
    subscriptions: {},
  };
}

// ────────────────────────────────────────────────
//  Setup BroadcastChannel listener
// ────────────────────────────────────────────────
function setupChannelListener() {
  const ch = getChannel();
  ch.onmessage = (event: MessageEvent<MatchMessage>) => {
    const msg = event.data;
    if (!msg || !msg.matchId) return;

    const store = matches.get(msg.matchId);
    if (!store) return;

    // Apply remote state updates if they have a higher revision
    if (msg.state && (msg.state.revision || 0) > (store.state.revision || 0)) {
      store.previous = store.state;
      store.state = msg.state;

      // If match just started, run bot chain
      if (msg.type === 'MATCH_STARTED') {
        void runBotTurnChain(msg.matchId);
      }
    }

    // Merge events we don't have yet
    if (msg.events) {
      for (const evt of msg.events) {
        if (evt.eventId >= store.nextEventId) {
          store.events.push(evt);
          store.nextEventId = evt.eventId + 1;
        }
      }
    }
  };
}

// Initialize channel listener
setupChannelListener();

// ────────────────────────────────────────────────
//  The local emulator API
// ────────────────────────────────────────────────
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
    const playerName = input.playerName || 'YOU';
    const gameType = input.gameType;

    // 1. Check if we can reconnect to a recent disconnected match
    const disconnectKey = `disconnect_${gameType}`;
    const disconnect = storageGet<DisconnectMarker>(disconnectKey);
    if (disconnect && disconnect.matchId && (Date.now() - disconnect.disconnectedAt) < RECONNECT_WINDOW_MS) {
      // Reconnect to the existing match
      storageRemove(disconnectKey);
      let store = matches.get(disconnect.matchId) || loadFromStorage(disconnect.matchId);
      if (store) {
        matches.set(disconnect.matchId, store);
        // Mark player as reconnected
        store.state.players = store.state.players.map((p) =>
          p.seat === disconnect.seat ? { ...p, disconnected: false, isBot: false } : p
        );
        store.state.revision++;
        store.state.serverTimeMs = Date.now();
        currentTabMatchId = disconnect.matchId;
        currentTabSeat = disconnect.seat;
        syncToStorage(disconnect.matchId);
        emitEvent(store, 'PLAYER_RECONNECTED', disconnect.seat, { players: store.state.players });
        broadcastMessage({ type: 'STATE_UPDATED', matchId: disconnect.matchId, state: store.state });
        return {
          matchId: disconnect.matchId,
          seat: disconnect.seat,
          snapshot: {
            matchId: disconnect.matchId,
            revision: store.state.revision,
            changed: store.state,
            serverTimeMs: Date.now(),
          },
        };
      }
    }

    // 2. Check if there's a WAITING match from another tab we can join
    const waitKey = `waiting_${gameType}`;
    const waiting = storageGet<WaitingMarker>(waitKey);
    if (waiting && waiting.matchId && (Date.now() - waiting.createdAt) < MATCH_STALE_MS) {
      // Don't join our own match
      if (waiting.ownerPlayerId !== currentTabPlayerId) {
        // Load or create the store from the waiting marker snapshot
        let store = matches.get(waiting.matchId);
        if (!store) {
          store = loadFromStorage(waiting.matchId);
        }
        if (!store) {
          // Use the embedded snapshot
          store = {
            state: cloneState(waiting.state),
            previous: null,
            events: [],
            nextEventId: 1,
            subscriptions: {},
          };
        }
        matches.set(waiting.matchId, store);

        if (store.state.status === 'WAITING') {
          // Join as seat 2
          store.state.players[2] = {
            ...store.state.players[2],
            playFabId: currentTabPlayerId,
            name: playerName,
            isBot: false,
            disconnected: false,
          };

          // Start the match!
          store.previous = store.state;
          store.state = startMatch(store.state);

          // Clear waiting marker
          storageRemove(waitKey);

          currentTabMatchId = waiting.matchId;
          currentTabSeat = 2;

          // Emit events
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

          syncToStorage(waiting.matchId);
          broadcastMessage({
            type: 'MATCH_STARTED',
            matchId: waiting.matchId,
            state: store.state,
            events: store.events,
            seat: 2,
          });

          // Start bot chain
          void runBotTurnChain(waiting.matchId);

          return {
            matchId: waiting.matchId,
            seat: 2,
            snapshot: {
              matchId: waiting.matchId,
              revision: store.state.revision,
              changed: store.state,
              serverTimeMs: Date.now(),
            },
          };
        }
      }
    }

    // 3. If we have a currentMatchId, re-read the waiting marker to check if someone joined
    if (input.currentMatchId) {
      const store = matches.get(input.currentMatchId) || loadFromStorage(input.currentMatchId);
      if (store) {
        matches.set(input.currentMatchId, store);
        // Check if the state has been updated (e.g., someone joined via BroadcastChannel)
        if (store.state.status !== 'WAITING') {
          currentTabMatchId = input.currentMatchId;
          return {
            matchId: input.currentMatchId,
            seat: currentTabSeat,
            snapshot: {
              matchId: input.currentMatchId,
              revision: store.state.revision,
              changed: store.state,
              serverTimeMs: Date.now(),
            },
          };
        }
        // Still waiting — return same match
        return {
          matchId: input.currentMatchId,
          seat: currentTabSeat,
          snapshot: {
            matchId: input.currentMatchId,
            revision: store.state.revision,
            changed: store.state,
            serverTimeMs: Date.now(),
          },
        };
      }
    }

    // 4. Create a new WAITING match
    const matchId = createMatchId();
    const waitingState = createWaitingState(matchId, gameType, playerName);

    const store: MatchStore = {
      state: waitingState,
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

    currentTabMatchId = matchId;
    currentTabSeat = 0;

    // Write waiting marker to localStorage for other tabs to find
    const marker: WaitingMarker = {
      matchId,
      gameType,
      ownerPlayerId: currentTabPlayerId,
      ownerName: playerName,
      createdAt: Date.now(),
      state: cloneState(waitingState),
    };
    storageSet(waitKey, marker);
    syncToStorage(matchId);

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

  async createMatch(input: { gameType: GameType; playerName: string; autoMoveOnTimeout?: boolean }) {
    // Delegate to findMatch which handles the full flow
    return this.findMatch({
      gameType: input.gameType,
      playerName: input.playerName,
      autoMoveOnTimeout: input.autoMoveOnTimeout,
    });
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
    emitEvent(store, isTrickComplete ? 'TRICK_COMPLETED' : 'CARD_PLAYED', input.seat, {
      currentTrick: store.state.currentTrick,
      hands: store.state.hands,
      turnIndex: store.state.turnIndex,
      leadSuit: store.state.leadSuit,
      trickWins: store.state.trickWins,
      scores: store.state.scores,
      lastCompletedTrick: store.state.lastCompletedTrick,
    });

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

    syncToStorage(input.matchId);
    broadcastMessage({ type: 'STATE_UPDATED', matchId: input.matchId, state: store.state });
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

    syncToStorage(input.matchId);
    broadcastMessage({ type: 'STATE_UPDATED', matchId: input.matchId, state: store.state });
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

    syncToStorage(input.matchId);
    broadcastMessage({ type: 'STATE_UPDATED', matchId: input.matchId, state: store.state });
    await runBotTurnChain(input.matchId);
    return currentDelta(input.matchId);
  },

  async getSnapshot(input) {
    // Try in-memory first, then storage
    let store = matches.get(input.matchId);
    if (!store) {
      store = loadFromStorage(input.matchId) || undefined;
      if (store) matches.set(input.matchId, store);
    }
    if (!store) throw new Error('Match not found');
    return {
      matchId: input.matchId,
      revision: store.state.revision,
      changed: store.state,
      serverTimeMs: Date.now(),
    };
  },

  async subscribeToMatch(input): Promise<MatchSubscriptionResult> {
    let store = matches.get(input.matchId);
    if (!store) {
      store = loadFromStorage(input.matchId) || undefined;
      if (store) matches.set(input.matchId, store);
    }
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
    syncToStorage(input.matchId);
    broadcastMessage({ type: 'STATE_UPDATED', matchId: input.matchId, state: store.state });
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
    syncToStorage(input.matchId);
    broadcastMessage({ type: 'STATE_UPDATED', matchId: input.matchId, state: store.state });
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
    let store = matches.get(input.matchId);
    if (!store) {
      store = loadFromStorage(input.matchId) || undefined;
      if (store) matches.set(input.matchId, store);
    }
    if (!store) throw new Error('Match not found');
    const seat = store.state.players.find((p) => p.playFabId === input.playFabId || p.seat === 0)?.seat ?? 0;
    store.state.players = store.state.players.map((p) => (p.seat === seat ? { ...p, disconnected: false, isBot: false } : p));
    store.state.revision++;
    store.state.serverTimeMs = Date.now();
    emitEvent(store, 'PLAYER_RECONNECTED', seat, { players: store.state.players });
    syncToStorage(input.matchId);
    broadcastMessage({ type: 'STATE_UPDATED', matchId: input.matchId, state: store.state });
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

// ────────────────────────────────────────────────
//  Disconnect tracking
// ────────────────────────────────────────────────
export function markDisconnected(matchId: string, seat: number) {
  const store = matches.get(matchId);
  if (!store) return;
  store.state.players = store.state.players.map((p) => (p.seat === seat ? { ...p, disconnected: true, isBot: true } : p));
  store.state.revision++;
  store.state.serverTimeMs = Date.now();
  emitEvent(store, 'PLAYER_DISCONNECTED', seat, { players: store.state.players });
  syncToStorage(matchId);
  broadcastMessage({ type: 'STATE_UPDATED', matchId, state: store.state });

  // Save disconnect marker for reconnect
  const gameType = store.state.gameType;
  const player = store.state.players[seat];
  if (player && !player.isBot) {
    const marker: DisconnectMarker = {
      matchId,
      playerId: player.playFabId,
      seat,
      disconnectedAt: Date.now(),
      gameType,
      state: cloneState(store.state),
    };
    storageSet(`disconnect_${gameType}`, marker);
  }

  void runBotTurnChain(matchId);
}

// ────────────────────────────────────────────────
//  Assign unique player ID per tab
// ────────────────────────────────────────────────
// Each browser tab gets a unique player ID so the emulator can distinguish
// between the two human players in a match.
(function assignTabPlayerId() {
  const key = 'emu_tab_player_id';
  // Use sessionStorage (per-tab) so each tab gets its own identity
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `player_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, id);
  }
  currentTabPlayerId = id;
})();
