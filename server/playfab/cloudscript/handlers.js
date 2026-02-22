const STARTING_COINS = 1000;
const EVENT_HISTORY_LIMIT = 256;
const DEFAULT_TIMEOUTS = {
  PASSING: 15000,
  BIDDING: 12000,
  PLAYING: 11000,
  WAITING: 20000,
};
const ENTITY_TYPE = 'title';
const MATCH_PREFIX = 'match_';
const MATCH_OBJECT_KEY = 'state';
const SUITS = ['CLUBS', 'DIAMONDS', 'SPADES', 'HEARTS'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
const SUIT_PRIORITY = { CLUBS: 0, DIAMONDS: 1, SPADES: 2, HEARTS: 3 };
const WAITING_MATCHES = { HEARTS: null, SPADES: null, CALLBREAK: null };
const SUBSCRIPTIONS = new Map();
let subscriptionCounter = 0;

function ensureServerApi() {
  if (typeof globalThis === 'undefined' || typeof globalThis.server === 'undefined') {
    throw new Error('PlayFab server API unavailable');
  }
  return globalThis.server;
}

function entityIdForMatch(matchId) {
  return `${MATCH_PREFIX}${matchId}`;
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneState(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function seededRandom(seed) {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

function seededShuffle(items, seed) {
  const rnd = seededRandom(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function sortCardsBySuitThenRankAsc(cards) {
  return [...cards].sort((a, b) => {
    if (a.suit !== b.suit) return SUIT_PRIORITY[a.suit] - SUIT_PRIORITY[b.suit];
    return a.value - b.value;
  });
}

function buildDeck() {
  const deck = [];
  SUITS.forEach((suit) => {
    RANKS.forEach((rank) => {
      deck.push({
        id: `${rank}-${suit}`,
        suit,
        rank,
        value: RANK_VALUE[rank],
        points: suit === 'HEARTS' ? 1 : suit === 'SPADES' && rank === 'Q' ? 13 : 0,
      });
    });
  });
  return deck;
}

function getPassingDirection(roundNumber) {
  const cycle = (roundNumber - 1) % 4;
  return ['LEFT', 'RIGHT', 'ACROSS', 'NONE'][cycle];
}

function lowCard(cards) {
  return cards.reduce((best, card) => {
    if (!best) return card;
    if (card.value < best.value) return card;
    if (card.value === best.value && SUIT_PRIORITY[card.suit] < SUIT_PRIORITY[best.suit]) return card;
    return best;
  }, null);
}

function legalByLead(state, seat) {
  const hand = state.hands[seat] || [];
  if (!state.leadSuit) return hand;
  const sameSuit = hand.filter((c) => c.suit === state.leadSuit);
  return sameSuit.length > 0 ? sameSuit : hand;
}

function resolveWinnerWithTrump(trick, leadSuit, trumpSuit) {
  if (!trick.length) return 0;
  let winner = trick[0];
  for (let i = 1; i < trick.length; i += 1) {
    const current = trick[i];
    const winnerTrump = trumpSuit ? winner.card.suit === trumpSuit : false;
    const currentTrump = trumpSuit ? current.card.suit === trumpSuit : false;
    if (currentTrump && !winnerTrump) {
      winner = current;
      continue;
    }
    if (winnerTrump === currentTrump) {
      const compareSuit = winnerTrump ? trumpSuit : leadSuit;
      if (
        compareSuit &&
        current.card.suit === compareSuit &&
        winner.card.suit === compareSuit &&
        current.card.value > winner.card.value
      ) {
        winner = current;
      }
    }
  }
  return winner.seat;
}

const RULES = {
  HEARTS: {
    isLegal: (state, seat, card) => legalByLead(state, seat).some((c) => c.id === card.id),
    getTimeoutMove: (state, seat) => {
      const legal = legalByLead(state, seat);
      return lowCard(legal);
    },
    resolveTrickWinner: (trick, leadSuit) => resolveWinnerWithTrump(trick, leadSuit, null),
  },
  SPADES: {
    isLegal: (state, seat, card) => legalByLead(state, seat).some((c) => c.id === card.id),
    getTimeoutMove: (state, seat) => {
      const legal = legalByLead(state, seat);
      const nonTrump = legal.filter((c) => c.suit !== 'SPADES');
      return nonTrump.length > 0 ? lowCard(nonTrump) : lowCard(legal);
    },
    resolveTrickWinner: (trick, leadSuit) => resolveWinnerWithTrump(trick, leadSuit, 'SPADES'),
  },
  CALLBREAK: {
    isLegal: (state, seat, card) => legalByLead(state, seat).some((c) => c.id === card.id),
    getTimeoutMove: (state, seat) => {
      const legal = legalByLead(state, seat);
      const spades = legal.filter((c) => c.suit === 'SPADES');
      return spades.length > 0 ? lowCard(spades) : lowCard(legal);
    },
    resolveTrickWinner: (trick, leadSuit) => resolveWinnerWithTrump(trick, leadSuit, 'SPADES'),
  },
};

function ensureMatchEvents(match) {
  if (!Array.isArray(match.events)) match.events = [];
}

function createEventPayload(match) {
  const payload = cloneState(match);
  delete payload.events;
  return payload;
}

function emitEvent(match, type, actorSeat = -1) {
  ensureMatchEvents(match);
  const nextId = match.events.length ? match.events[match.events.length - 1].eventId + 1 : 1;
  match.events.push({
    eventId: nextId,
    type,
    matchId: match.matchId,
    revision: match.version,
    timestamp: Date.now(),
    actorSeat,
    payload: createEventPayload(match),
  });
  if (match.events.length > EVENT_HISTORY_LIMIT) {
    match.events.splice(0, match.events.length - EVENT_HISTORY_LIMIT);
  }
}

function latestEventId(match) {
  if (!match.events || !match.events.length) return 0;
  return match.events[match.events.length - 1].eventId;
}

function loadMatch(matchId) {
  const serverApi = ensureServerApi();
  const response = serverApi.GetObjects({
    Entity: { Id: entityIdForMatch(matchId), Type: ENTITY_TYPE },
    Keys: [MATCH_OBJECT_KEY],
  });
  const obj = response.Objects && response.Objects[0];
  if (!obj || !obj.DataObject) {
    throw new Error('Match not found');
  }
  return { match: obj.DataObject, entityVersion: obj.Version || 0 };
}

function saveMatch(match, expectedVersion) {
  const serverApi = ensureServerApi();
  const response = serverApi.SetObjects({
    Entity: { Id: entityIdForMatch(match.matchId), Type: ENTITY_TYPE },
    Objects: [
      {
        ObjectName: MATCH_OBJECT_KEY,
        DataObject: match,
        Version: expectedVersion,
      },
    ],
  });
  const saved = response.Objects && response.Objects[0];
  return saved ? (saved.Version || expectedVersion || 0) : expectedVersion;
}

function createMatchState(gameType, playerId, playerName, options = {}) {
  const now = Date.now();
  const seed = options.seed || now;
  const deck = seededShuffle(buildDeck(), seed);
  const hands = { 0: [], 1: [], 2: [], 3: [] };
  for (let seat = 0; seat < 4; seat += 1) {
    hands[seat] = sortCardsBySuitThenRankAsc(deck.slice(seat * 13, seat * 13 + 13));
  }

  const phase = gameType === 'HEARTS'
    ? 'PASSING'
    : (gameType === 'SPADES' || gameType === 'CALLBREAK')
      ? 'BIDDING'
      : 'PLAYING';
  const dealerIndex = 0;
  const initialTurn = phase === 'BIDDING' ? (dealerIndex + 1) % 4 : 0;

  const matchId = randomId('pfm');
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUTS[phase];

  return {
    matchId,
    version: 1,
    gameType,
    state: 'ACTIVE',
    status: 'WAITING',
    phase,
    roundNumber: 1,
    seed,
    players: [
      { seat: 0, playFabId: playerId, name: playerName || 'YOU', isBot: false, disconnected: false, pingMs: 40 },
      { seat: 1, playFabId: 'BOT_1', name: 'BOT 1', isBot: true, disconnected: false, pingMs: 10 },
      { seat: 2, playFabId: 'PENDING_PLAYER', name: 'REMOTE PLAYER', isBot: false, disconnected: false, pingMs: 40 },
      { seat: 3, playFabId: 'BOT_3', name: 'BOT 3', isBot: true, disconnected: false, pingMs: 10 },
    ],
    dealerIndex,
    turn: initialTurn,
    turnIndex: initialTurn,
    trickLeader: 0,
    leadSuit: null,
    currentTrick: [],
    trickWins: { 0: 0, 1: 0, 2: 0, 3: 0 },
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    bids: { 0: null, 1: null, 2: null, 3: null },
    hands,
    passingSelections: { 0: [], 1: [], 2: [], 3: [] },
    passingDirection: getPassingDirection(1),
    passingComplete: { 0: false, 1: false, 2: false, 3: false },
    bidsComplete: { 0: false, 1: false, 2: false, 3: false },
    trickHistory: [],
    lastPlayedCard: null,
    lastCompletedTrick: null,
    events: [],
    lastMoveTime: now,
    turnDeadlineMs: now + timeoutMs,
    serverTimeMs: now,
    timeoutMs,
    autoMoveOnTimeout: options.autoMoveOnTimeout !== false,
    passingDirectionHistory: [],
  };
}

function persistNewMatch(match) {
  return saveMatch(match, 0);
}

function assignRemotePlayer(match, playFabId, name) {
  const remoteSlot = match.players.find((p) => p.seat === 2);
  if (!remoteSlot) return;
  remoteSlot.playFabId = playFabId;
  remoteSlot.name = name || remoteSlot.name;
  remoteSlot.isBot = false;
}

function startMatch(match) {
  match.status = 'PLAYING';
  match.state = 'ACTIVE';
  match.serverTimeMs = Date.now();
  match.turnDeadlineMs = Date.now() + match.timeoutMs;
}

function createDelta(match) {
  return {
    matchId: match.matchId,
    revision: match.version,
    changed: cloneState(match),
    serverTimeMs: match.serverTimeMs,
  };
}

function applyMove(match, seat, cardId) {
  if (match.phase !== 'PLAYING') throw new Error('Match not active');
  if (seat !== match.turn) throw new Error('Not your turn');
  const hand = match.hands[seat] || [];
  const index = hand.findIndex((c) => c.id === cardId);
  if (index === -1) throw new Error('Card not in hand');
  const card = hand[index];
  if (!RULES[match.gameType].isLegal(match, seat, card)) throw new Error('Illegal move');

  match.hands[seat] = hand.filter((_, idx) => idx !== index);
  match.currentTrick.push({ seat, card });
  if (!match.leadSuit) match.leadSuit = card.suit;
  match.lastMoveTime = Date.now();
  match.lastPlayedCard = { seat, cardId: card.id, timestamp: Date.now() };

  if (match.currentTrick.length < 4) {
    const next = (seat + 1) % 4;
    match.turn = next;
    match.turnIndex = next;
    match.turnDeadlineMs = Date.now() + match.timeoutMs;
    return { trickCompleted: false };
  }

  const winner = RULES[match.gameType].resolveTrickWinner(match.currentTrick, match.leadSuit);
  const trickScore = match.currentTrick.reduce((sum, play) => sum + (play.card.points || 0), 0);
  match.trickWins[winner] = (match.trickWins[winner] || 0) + 1;
  match.scores[winner] = (match.scores[winner] || 0) + trickScore;
  match.lastCompletedTrick = {
    trick: [...match.currentTrick],
    winner,
    at: Date.now(),
  };
  match.trickHistory = [...match.trickHistory, match.lastCompletedTrick];
  match.currentTrick = [];
  match.leadSuit = null;
  match.turn = winner;
  match.turnIndex = winner;
  match.turnDeadlineMs = Date.now() + match.timeoutMs;

  const roundComplete = [0, 1, 2, 3].every((seatIndex) => (match.hands[seatIndex] || []).length === 0);
  if (roundComplete) {
    match.phase = 'COMPLETED';
    match.status = 'COMPLETED';
    match.state = 'ENDED';
  }

  return { trickCompleted: true, trickWinner: winner, trickScore, roundComplete };
}

function applyPass(match, seat, cardIds) {
  if (match.phase !== 'PASSING') throw new Error('Not in passing phase');
  if (seat !== match.turn) throw new Error('Not your turn to pass');
  if (!Array.isArray(cardIds) || cardIds.length !== 3) throw new Error('Must pass exactly 3 cards');
  const hand = match.hands[seat] || [];
  const missing = cardIds.some((id) => !hand.some((c) => c.id === id));
  if (missing) throw new Error('Invalid passing selection');

  match.passingSelections[seat] = [...cardIds];
  match.passingComplete[seat] = true;
  match.hands[seat] = hand.filter((c) => !cardIds.includes(c.id));
  const next = (seat + 1) % 4;
  match.turn = next;
  match.turnIndex = next;
  match.turnDeadlineMs = Date.now() + match.timeoutMs;

  const allPassed = Object.values(match.passingComplete).every(Boolean);
  if (!allPassed) return { passingComplete: false };

  const dir = match.passingDirection || 'LEFT';
  const passes = {};
  for (let s = 0; s < 4; s += 1) {
    const ids = match.passingSelections[s] || [];
    passes[s] = ids.map((id) => (match.hands[s] || []).find((c) => c.id === id)).filter(Boolean);
  }
  for (let s = 0; s < 4; s += 1) {
    const ids = match.passingSelections[s] || [];
    match.hands[s] = (match.hands[s] || []).filter((c) => !ids.includes(c.id));
  }
  for (let s = 0; s < 4; s += 1) {
    const target = dir === 'LEFT' ? (s + 1) % 4 : dir === 'RIGHT' ? (s + 3) % 4 : (s + 2) % 4;
    match.hands[target] = sortCardsBySuitThenRankAsc([...(match.hands[target] || []), ...passes[s]]);
  }
    match.phase = 'PLAYING';
    match.passingSelections = { 0: [], 1: [], 2: [], 3: [] };
    match.passingComplete = { 0: false, 1: false, 2: false, 3: false };
    match.turn = match.players.find((p) => (match.hands[p.seat] || []).some((c) => c.id === '2-CLUBS'))?.seat ?? 0;
    match.turnIndex = match.turn;
    match.turnDeadlineMs = Date.now() + match.timeoutMs;
    return { passingComplete: true };
}

function applyBid(match, seat, bid) {
  if (match.phase !== 'BIDDING') throw new Error('Not in bidding phase');
  if (seat !== match.turn) throw new Error('Not your bidding turn');
  if (typeof bid !== 'number' || bid < 0) throw new Error('Invalid bid');

  match.bids[seat] = bid;
  match.bidsComplete[seat] = true;
  const next = (seat + 1) % 4;
  match.turn = next;
  match.turnIndex = next;
  match.turnDeadlineMs = Date.now() + match.timeoutMs;

  const allBid = Object.values(match.bidsComplete).every(Boolean);
  if (allBid) {
    match.phase = 'PLAYING';
    match.turn = (match.dealerIndex + 1) % 4;
    match.turnIndex = match.turn;
    match.turnDeadlineMs = Date.now() + match.timeoutMs;
    return { biddingComplete: true };
  }
  return { biddingComplete: false };
}

function atomicUpdate(matchId, expectedRevision, mutate) {
  const { match, entityVersion } = loadMatch(matchId);
  if (expectedRevision !== undefined && match.version !== expectedRevision) {
    throw new Error('Revision mismatch');
  }
  const result = mutate(match) || {};
  match.version += 1;
  match.serverTimeMs = Date.now();
  if (Array.isArray(result.events)) {
    result.events.forEach((evt) => emitEvent(match, evt.type, evt.actorSeat));
  }
  saveMatch(match, entityVersion);
  return match;
}

function getInvokerId(args) {
  if (args && typeof args.playFabId === 'string' && args.playFabId) return args.playFabId;
  if (args && typeof args.playerId === 'string' && args.playerId) return args.playerId;
  if (typeof globalThis !== 'undefined' && typeof globalThis.currentPlayerId === 'string' && globalThis.currentPlayerId) {
    return globalThis.currentPlayerId;
  }
  return 'UNKNOWN_PLAYER';
}

function getInvokerName(args) {
  return (args && args.playerName) || 'REMOTE PLAYER';
}

function createMatchHandler(args) {
  const invokerId = getInvokerId(args);
  const match = createMatchState(args.gameType, invokerId, getInvokerName(args), { autoMoveOnTimeout: args.autoMoveOnTimeout });
  emitEvent(match, 'MATCH_CREATED', 0);
  persistNewMatch(match);
  WAITING_MATCHES[match.gameType] = match.matchId;
  return { matchId: match.matchId, seat: 0, snapshot: createDelta(match) };
}

function findMatchHandler(args) {
  const invokerId = getInvokerId(args);
  const gameType = args.gameType;
  if (!gameType) throw new Error('Missing gameType');

  if (args.currentMatchId) {
    try {
      const { match } = loadMatch(args.currentMatchId);
      const seatInfo = match.players.find((p) => p.playFabId === invokerId);
      if (seatInfo) {
        return { matchId: match.matchId, seat: seatInfo.seat, snapshot: createDelta(match) };
      }
    } catch (e) {
      // Ignore missing match while recheck is in flight
    }
  }

  const queuedMatchId = WAITING_MATCHES[gameType];
  if (queuedMatchId) {
    try {
      const { match, entityVersion } = loadMatch(queuedMatchId);
      const pendingSeat = match.players[2];
      if (match.status === 'WAITING' && pendingSeat && (pendingSeat.playFabId === 'PENDING_PLAYER' || pendingSeat.isBot)) {
        assignRemotePlayer(match, invokerId, getInvokerName(args));
        startMatch(match);
        match.version += 1;
        match.serverTimeMs = Date.now();
        emitEvent(match, 'MATCH_STARTED', 2);
        saveMatch(match, entityVersion);
        WAITING_MATCHES[gameType] = null;
        return { matchId: match.matchId, seat: 2, snapshot: createDelta(match) };
      }
    } catch (e) {
      // Fall through and create new match
    }
  }

  return createMatchHandler(args);
}

function submitMoveHandler(args) {
  const match = atomicUpdate(args.matchId, args.expectedRevision, (match) => {
    const moveResult = applyMove(match, args.seat, args.cardId);
    const events = [{ type: 'CARD_PLAYED', actorSeat: args.seat }];
    if (moveResult.trickCompleted) {
      events.push({ type: 'TRICK_COMPLETED', actorSeat: moveResult.trickWinner });
      if (moveResult.roundComplete) {
        events.push({ type: 'ROUND_COMPLETED', actorSeat: moveResult.trickWinner });
        events.push({ type: 'MATCH_COMPLETED', actorSeat: moveResult.trickWinner });
      }
    }
    return { events };
  });
  return createDelta(match);
}

function submitPassHandler(args) {
  const match = atomicUpdate(args.matchId, args.expectedRevision, (match) => {
    const passResult = applyPass(match, args.seat, args.cardIds || []);
    const events = [{ type: 'PASSING_COMPLETED', actorSeat: args.seat }];
    if (passResult.passingComplete) {
      events.push({ type: 'CARDS_DISTRIBUTED', actorSeat: args.seat });
    }
    return { events };
  });
  return createDelta(match);
}

function submitBidHandler(args) {
  const match = atomicUpdate(args.matchId, args.expectedRevision, (match) => {
    const bidResult = applyBid(match, args.seat, args.bid);
    const events = [{ type: 'BID_SUBMITTED', actorSeat: args.seat }];
    if (bidResult.biddingComplete) {
      events.push({ type: 'BIDDING_COMPLETED', actorSeat: args.seat });
    }
    return { events };
  });
  return createDelta(match);
}

function getSnapshotHandler(args) {
  const { match } = loadMatch(args.matchId);
  return createDelta(match);
}

function timeoutMoveHandler(args) {
  const { match } = loadMatch(args.matchId);
  if (Date.now() < match.turnDeadlineMs) {
    return createDelta(match);
  }
  const updated = atomicUpdate(args.matchId, undefined, (match) => {
    const events = [];
    if (match.phase === 'PASSING') {
      const seat = match.turn;
      const hand = match.hands[seat] || [];
      const sorted = [...hand].sort((a, b) => b.value - a.value);
      const autoIds = sorted.slice(0, 3).map((c) => c.id);
      applyPass(match, seat, autoIds);
      events.push({ type: 'PASSING_COMPLETED', actorSeat: seat });
      events.push({ type: 'CARDS_DISTRIBUTED', actorSeat: seat });
    } else if (match.phase === 'BIDDING') {
      const seat = match.turn;
      applyBid(match, seat, 1);
      events.push({ type: 'BID_SUBMITTED', actorSeat: seat });
      events.push({ type: 'BIDDING_COMPLETED', actorSeat: seat });
    } else {
      const seat = match.turn;
      const move = RULES[match.gameType].getTimeoutMove(match, seat);
      if (move) {
        const moveResult = applyMove(match, seat, move.id);
        events.push({ type: 'CARD_PLAYED', actorSeat: seat });
        if (moveResult.trickCompleted) {
          events.push({ type: 'TRICK_COMPLETED', actorSeat: moveResult.trickWinner });
          if (moveResult.roundComplete) {
            events.push({ type: 'ROUND_COMPLETED', actorSeat: moveResult.trickWinner });
            events.push({ type: 'MATCH_COMPLETED', actorSeat: moveResult.trickWinner });
          }
        }
      }
    }
    return { events };
  });
  return createDelta(updated);
}

function endMatchHandler(args) {
  const match = atomicUpdate(args.matchId, args.expectedRevision, (match) => {
    match.phase = 'COMPLETED';
    match.status = 'COMPLETED';
    match.state = 'ENDED';
    return { events: [{ type: 'MATCH_COMPLETED', actorSeat: -1 }] };
  });
  return createDelta(match);
}

function updateCoinsHandler(args) {
  return { coins: STARTING_COINS };
}

function reconnectHandler(args) {
  const { match, entityVersion } = loadMatch(args.matchId);
  const seat = match.players.find((p) => p.playFabId === args.playFabId)?.seat ?? 0;
  match.players[seat].disconnected = false;
  match.lastMoveTime = Date.now();
  match.version += 1;
  match.serverTimeMs = Date.now();
  emitEvent(match, 'PLAYER_RECONNECTED', seat);
  saveMatch(match, entityVersion);
  return { seat, delta: createDelta(match) };
}

function joinMatchHandler(args) {
  const invokerId = getInvokerId(args);
  const { match, entityVersion } = loadMatch(args.matchId);
  const remote = match.players.find((p) => p.seat === 2);
  if (!remote || remote.playFabId !== 'PENDING_PLAYER') {
    throw new Error('Match already full');
  }
  assignRemotePlayer(match, invokerId, getInvokerName(args));
  startMatch(match);
  match.version += 1;
  match.serverTimeMs = Date.now();
  emitEvent(match, 'MATCH_STARTED', 2);
  saveMatch(match, entityVersion);
  WAITING_MATCHES[match.gameType] = null;
  return { seat: 2 };
}

function subscribeToMatchHandler(args) {
  const { match } = loadMatch(args.matchId);
  const sinceEventId = Number(args.sinceEventId || 0);
  const sinceRevision = Number(args.sinceRevision || 0);
  const filtered = (match.events || []).filter((evt) => evt.eventId > sinceEventId).map((evt) => cloneState(evt));
  let events = filtered;
  if (!events.length && sinceRevision < match.version) {
    const fallbackId = latestEventId(match);
    const fallback = {
      eventId: fallbackId,
      type: 'TURN_CHANGED',
      matchId: match.matchId,
      revision: match.version,
      timestamp: Date.now(),
      actorSeat: match.turnIndex ?? -1,
      payload: createEventPayload(match),
    };
    events = [fallback];
  }
  let subId = args.subscriptionId;
  if (!subId || SUBSCRIPTIONS.get(subId) !== match.matchId) {
    subId = `${match.matchId}_sub_${++subscriptionCounter}`;
  }
  SUBSCRIPTIONS.set(subId, match.matchId);
  return {
    subscriptionId: subId,
    latestEventId: latestEventId(match),
    events,
  };
}

function unsubscribeFromMatchHandler(args) {
  if (args && args.subscriptionId) {
    SUBSCRIPTIONS.delete(args.subscriptionId);
  }
  return { ok: true };
}

if (typeof globalThis !== 'undefined') {
  globalThis.handlers = {
    createMatch: createMatchHandler,
    findMatch: findMatchHandler,
    joinMatch: joinMatchHandler,
    submitMove: submitMoveHandler,
    submitPass: submitPassHandler,
    submitBid: submitBidHandler,
    getSnapshot: getSnapshotHandler,
    subscribeToMatch: subscribeToMatchHandler,
    unsubscribeFromMatch: unsubscribeFromMatchHandler,
    timeoutMove: timeoutMoveHandler,
    endMatch: endMatchHandler,
    updateCoins: updateCoinsHandler,
    reconnect: reconnectHandler,
  };
}
