const STARTING_COINS = 1000;
const ENTRY_FEE = 50;
const REWARDS = { 1: 100, 2: 75, 3: 25, 4: 0 };
const TIMEOUT_MS = 5000;
const DEFAULT_REGION = 'US';
const DEFAULT_CURRENCY_ID = 'CO';
const QUICK_MATCH_TICKET_TIMEOUT_SEC = 20;
const RECONNECT_WINDOW_MS = 120000;
const QUICK_MATCH_QUEUES = {
  HEARTS: 'quickmatch-hearts',
  SPADES: 'quickmatch-spades',
  CALLBREAK: 'quickmatch-callbreak',
};
const STAT_KEYS = {
  COINS: 'coins_co_balance',
  MMR: 'rank_mmr_global',
  MATCHES_PLAYED: 'matches_played_total',
  WINS_TOTAL: 'wins_total',
  HEARTS_BEST: 'hearts_best_score',
  SPADES_BEST: 'spades_best_score',
  CALLBREAK_BEST: 'callbreak_best_score',
};

const stateStore = {
  matches: new Map(),
  lobbies: new Map(),
  coins: new Map(),
  stats: new Map(),
  leaderboard: new Map(),
  events: new Map(),
  subscriptions: new Map(),
};

function ensureEventStream(matchId) {
  if (!stateStore.events.has(matchId)) {
    stateStore.events.set(matchId, { nextEventId: 1, events: [] });
  }
  return stateStore.events.get(matchId);
}

function cloneState(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function emitEvent(match, type, actorSeat = -1, payload = {}) {
  const stream = ensureEventStream(match.matchId);
  const evt = {
    eventId: stream.nextEventId++,
    type,
    matchId: match.matchId,
    revision: match.revision,
    timestamp: Date.now(),
    actorSeat,
    payload: cloneState(payload || {}),
  };
  stream.events.push(evt);
  if (stream.events.length > 200) stream.events.splice(0, stream.events.length - 200);
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function canUsePlayFabServerApi() {
  return typeof globalThis !== 'undefined' && typeof globalThis.server !== 'undefined';
}

function persistMatchSnapshot(match) {
  if (!canUsePlayFabServerApi()) return;
  try {
    globalThis.server.SetTitleData({
      Key: `match_${match.matchId}`,
      Value: JSON.stringify(match),
    });
  } catch {}
}

function newMatch(gameType, playerName, playerId) {
  const now = Date.now();
  return {
    matchId: randomId('pfm'),
    gameType,
    revision: 1,
    seed: now,
    deck: [],
    players: [
      { seat: 0, playFabId: playerId, name: playerName || 'YOU', isBot: false, disconnected: false, pingMs: 42, rankBadge: 'Rookie', coins: STARTING_COINS },
      { seat: 1, playFabId: 'BOT_1', name: 'BOT 1', isBot: true, disconnected: false, pingMs: 10, rankBadge: 'BOT', coins: STARTING_COINS },
      { seat: 2, playFabId: 'REMOTE_PLAYER', name: 'OPPONENT', isBot: false, disconnected: false, pingMs: 57, rankBadge: 'Rookie', coins: STARTING_COINS },
      { seat: 3, playFabId: 'BOT_3', name: 'BOT 3', isBot: true, disconnected: false, pingMs: 12, rankBadge: 'BOT', coins: STARTING_COINS },
    ],
    hands: { 0: [], 1: [], 2: [], 3: [] },
    turnIndex: 0,
    currentTrick: [],
    trickLeaderIndex: 0,
    leadSuit: null,
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    roundNumber: 1,
    status: 'PLAYING',
    turnDeadlineMs: now + TIMEOUT_MS,
    serverTimeMs: now,
  };
}

function deltaFor(match) {
  return {
    matchId: match.matchId,
    revision: match.revision,
    changed: match,
    serverTimeMs: Date.now(),
  };
}

function bump(match) {
  match.revision += 1;
  match.serverTimeMs = Date.now();
  return match;
}

function assertMatch(matchId) {
  const m = stateStore.matches.get(matchId);
  if (!m) throw new Error('Match not found');
  return m;
}

function assertLobby(lobbyId) {
  const l = stateStore.lobbies.get(lobbyId);
  if (!l) throw new Error('Lobby not found');
  return l;
}

function getCoins(playFabId) {
  return stateStore.coins.get(playFabId) ?? STARTING_COINS;
}

function setCoins(playFabId, coins) {
  stateStore.coins.set(playFabId, coins);
  return coins;
}

function getStats(playFabId) {
  if (!stateStore.stats.has(playFabId)) {
    stateStore.stats.set(playFabId, {
      [STAT_KEYS.COINS]: STARTING_COINS,
      [STAT_KEYS.MMR]: 1000,
      [STAT_KEYS.MATCHES_PLAYED]: 0,
      [STAT_KEYS.WINS_TOTAL]: 0,
      [STAT_KEYS.HEARTS_BEST]: 0,
      [STAT_KEYS.SPADES_BEST]: 0,
      [STAT_KEYS.CALLBREAK_BEST]: 0,
    });
  }
  return stateStore.stats.get(playFabId);
}

function setStat(playFabId, key, value) {
  const bag = getStats(playFabId);
  bag[key] = value;
}

function updatePostMatchStats(gameType, player, rank, score, coinsAfter) {
  if (player.isBot) return;
  const bag = getStats(player.playFabId);
  bag[STAT_KEYS.MATCHES_PLAYED] += 1;
  if (rank === 1) bag[STAT_KEYS.WINS_TOTAL] += 1;
  bag[STAT_KEYS.COINS] = coinsAfter;
  bag[STAT_KEYS.MMR] = Math.max(0, bag[STAT_KEYS.MMR] + (rank === 1 ? 20 : rank === 2 ? 10 : rank === 3 ? -5 : -12));

  const bestKey = gameType === 'HEARTS' ? STAT_KEYS.HEARTS_BEST : gameType === 'SPADES' ? STAT_KEYS.SPADES_BEST : STAT_KEYS.CALLBREAK_BEST;
  bag[bestKey] = Math.max(bag[bestKey], score);
}

export function createMatch(args, context = {}) {
  const playerId = context?.currentPlayerId || 'LOCAL_PLAYER';
  const match = newMatch(args.gameType, args.playerName, playerId);
  setCoins(playerId, getCoins(playerId) - ENTRY_FEE);
  setStat(playerId, STAT_KEYS.COINS, getCoins(playerId));
  stateStore.matches.set(match.matchId, match);
  emitEvent(match, 'MATCH_CREATED', -1, { status: match.status });
  persistMatchSnapshot(match);
  return { matchId: match.matchId, seat: 0 };
}

export function createLobby(args, context = {}) {
  const playerId = context?.currentPlayerId || 'LOCAL_PLAYER';
  const lobbyId = randomId('lobby');
  const gameType = args.gameType;
  stateStore.lobbies.set(lobbyId, {
    lobbyId,
    gameType,
    queueName: QUICK_MATCH_QUEUES[gameType] || QUICK_MATCH_QUEUES.HEARTS,
    ticketTimeoutSec: QUICK_MATCH_TICKET_TIMEOUT_SEC,
    region: args.region || DEFAULT_REGION,
    isPublicQuickMatch: true,
    members: [playerId],
    createdAt: Date.now(),
  });
  return {
    lobbyId,
    queueName: QUICK_MATCH_QUEUES[gameType] || QUICK_MATCH_QUEUES.HEARTS,
    ticketTimeoutSec: QUICK_MATCH_TICKET_TIMEOUT_SEC,
    region: args.region || DEFAULT_REGION,
  };
}

export function findMatch(args) {
  const gameType = args.gameType;
  const playerId = args.playFabId || 'LOCAL_PLAYER';
  const queueKey = `${gameType}_WAITING`;
  const waiting = stateStore.lobbies.get(queueKey);

  if (waiting && waiting.ownerPlayFabId !== playerId) {
    const existing = stateStore.matches.get(waiting.matchId);
    if (!existing) {
      // Stale waiting marker — clear and fall through to create a new match.
      stateStore.lobbies.delete(queueKey);
    } else {
      existing.players[2] = {
        ...existing.players[2],
        playFabId: playerId,
        name: args.playerName || 'OPPONENT',
        isBot: false,
        rankBadge: 'Rookie',
        pingMs: 57,
      };
      bump(existing);
      stateStore.lobbies.delete(queueKey);
      return { matchId: existing.matchId, seat: 2 };
    }
  }

  const match = newMatch(gameType, args.playerName, playerId);
  stateStore.matches.set(match.matchId, match);
  stateStore.lobbies.set(queueKey, {
    ownerPlayFabId: playerId,
    matchId: match.matchId,
    createdAt: Date.now(),
  });
  return { matchId: match.matchId, seat: 0 };
}

export function joinMatch(args) {
  const match = assertMatch(args.matchId);
  const seat = 2;
  match.players[seat].name = args.playerName || match.players[seat].name;
  bump(match);
  persistMatchSnapshot(match);
  return { seat };
}

export function submitMove(args) {
  const match = assertMatch(args.matchId);
  if (match.turnIndex !== args.seat) throw new Error('Not your turn');
  if (args.expectedRevision !== match.revision) throw new Error('Revision mismatch');

  match.currentTrick.push({ seat: args.seat, card: { id: args.cardId, suit: 'CLUBS', rank: '2', value: 2, points: 0 } });
  match.turnIndex = (match.turnIndex + 1) % 4;
  match.turnDeadlineMs = Date.now() + TIMEOUT_MS;
  bump(match);
  emitEvent(match, 'CARD_PLAYED', args.seat, match);
  persistMatchSnapshot(match);
  return deltaFor(match);
}

export function getSnapshot(args) {
  const match = assertMatch(args.matchId);
  return deltaFor(match);
}

export function getState(args) {
  return getSnapshot(args);
}

export function subscribeToMatch(args, context = {}) {
  const match = assertMatch(args.matchId);
  const stream = ensureEventStream(match.matchId);
  if (!stateStore.subscriptions.has(match.matchId)) stateStore.subscriptions.set(match.matchId, {});
  const bucket = stateStore.subscriptions.get(match.matchId);
  const requestedId = args.subscriptionId && bucket[args.subscriptionId] ? args.subscriptionId : null;
  const subscriptionId = requestedId || randomId('sub');
  if (!requestedId) {
    bucket[subscriptionId] = { playerId: context?.currentPlayerId || 'LOCAL_PLAYER', createdAt: Date.now() };
  }
  const sinceEventId = Number(args.sinceEventId || 0);
  const sinceRevision = Number(args.sinceRevision || 0);
  const events = stream.events.filter((evt) => evt.eventId > sinceEventId);
  if (events.length === 0 && sinceRevision < match.revision) {
    return {
      subscriptionId,
      events: [{
        eventId: stream.events.length ? stream.events[stream.events.length - 1].eventId : 0,
        type: 'TURN_CHANGED',
        matchId: match.matchId,
        revision: match.revision,
        timestamp: Date.now(),
        actorSeat: typeof match.turnIndex === 'number' ? match.turnIndex : -1,
        payload: cloneState(match),
      }],
      latestEventId: stream.events.length ? stream.events[stream.events.length - 1].eventId : 0,
    };
  }
  return {
    subscriptionId,
    events,
    latestEventId: stream.events.length ? stream.events[stream.events.length - 1].eventId : 0,
  };
}

export function unsubscribeFromMatch(args) {
  const bucket = stateStore.subscriptions.get(args.matchId) || {};
  delete bucket[args.subscriptionId];
  stateStore.subscriptions.set(args.matchId, bucket);
  return { ok: true };
}

export function timeoutMove(args) {
  const match = assertMatch(args.matchId);
  if (Date.now() < match.turnDeadlineMs) {
    return {
      matchId: match.matchId,
      revision: match.revision,
      changed: {},
      serverTimeMs: Date.now(),
    };
  }

  match.currentTrick.push({ seat: match.turnIndex, card: { id: '2-CLUBS', suit: 'CLUBS', rank: '2', value: 2, points: 0 } });
  match.turnIndex = (match.turnIndex + 1) % 4;
  match.turnDeadlineMs = Date.now() + TIMEOUT_MS;
  bump(match);
  emitEvent(match, 'TURN_CHANGED', match.turnIndex, match);
  persistMatchSnapshot(match);
  return deltaFor(match);
}

export function endMatch(args) {
  const match = assertMatch(args.matchId);
  match.status = 'COMPLETED';
  bump(match);

  const standings = Object.keys(match.scores)
    .map((seat) => ({ seat: Number(seat), score: match.scores[seat] }))
    .sort((a, b) => b.score - a.score)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  const rewards = standings.map((row) => ({ seat: row.seat, coinsDelta: REWARDS[row.rank] - ENTRY_FEE }));
  rewards.forEach((reward) => {
    const p = match.players[reward.seat];
    const next = getCoins(p.playFabId) + reward.coinsDelta;
    setCoins(p.playFabId, next);
    const standing = standings.find((s) => s.seat === reward.seat);
    updatePostMatchStats(match.gameType, p, standing.rank, standing.score, next);
  });

  stateStore.leaderboard.set(match.matchId, standings);
  persistMatchSnapshot(match);
  return { standings, rewards, currencyId: DEFAULT_CURRENCY_ID };
}

export function updateCoins(args) {
  const coins = setCoins(args.playFabId, getCoins(args.playFabId) + args.delta);
  return { coins };
}

export function reconnect(args) {
  const match = assertMatch(args.matchId);
  const seat = match.players.find((p) => p.playFabId === args.playFabId)?.seat ?? 0;
  const disconnectedAt = match.players[seat].disconnectedAt || 0;
  if (disconnectedAt && Date.now() - disconnectedAt > RECONNECT_WINDOW_MS) {
    throw new Error('Reconnect window expired');
  }
  match.players[seat].disconnected = false;
  delete match.players[seat].disconnectedAt;
  bump(match);
  emitEvent(match, 'PLAYER_RECONNECTED', seat, match);
  persistMatchSnapshot(match);
  return { seat, delta: deltaFor(match) };
}

export function markDisconnected(args) {
  const match = assertMatch(args.matchId);
  const seat = Number(args.seat || 0);
  match.players[seat].disconnected = true;
  match.players[seat].disconnectedAt = Date.now();
  bump(match);
  persistMatchSnapshot(match);
  return { ok: true, reconnectWindowMs: RECONNECT_WINDOW_MS };
}

export function __testOnlySetDeadline(matchId, deadlineMs) {
  const match = assertMatch(matchId);
  match.turnDeadlineMs = deadlineMs;
}

export function __testOnlyStore() {
  return stateStore;
}

if (typeof globalThis !== 'undefined') {
  globalThis.handlers = {
    createLobby,
    findMatch,
    createMatch,
    joinMatch,
    submitMove,
    getSnapshot,
    getState,
    subscribeToMatch,
    unsubscribeFromMatch,
    timeoutMove,
    endMatch,
    updateCoins,
    reconnect,
    markDisconnected,
  };
}
