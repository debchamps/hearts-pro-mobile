// PlayFab Classic CloudScript (deploy this file)
// Title: EF824

var STARTING_COINS = 1000;
var ENTRY_FEE = 50;
var REWARDS = { 1: 100, 2: 75, 3: 25, 4: 0 };
var HUMAN_TIMEOUT_MS = 9000;
var BOT_TIMEOUT_MS = 900;
var CALLBREAK_HUMAN_TIMEOUT_EXTRA_MS = 5000;
var DEFAULT_REGION = 'US';
var DEFAULT_CURRENCY_ID = 'CO';
var QUICK_MATCH_TICKET_TIMEOUT_SEC = 20;
var RECONNECT_WINDOW_MS = 120000;
var QUICK_MATCH_QUEUES = {
  HEARTS: 'quickmatch-hearts',
  SPADES: 'quickmatch-spades',
  CALLBREAK: 'quickmatch-callbreak'
};
var STAT_KEYS = {
  COINS: 'coins_co_balance',
  MMR: 'rank_mmr_global',
  MATCHES_PLAYED: 'matches_played_total',
  WINS_TOTAL: 'wins_total',
  HEARTS_BEST: 'hearts_best_score',
  SPADES_BEST: 'spades_best_score',
  CALLBREAK_BEST: 'callbreak_best_score'
};
var SUITS = ['CLUBS', 'DIAMONDS', 'SPADES', 'HEARTS'];
var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
var RANK_VALUE = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
var SUIT_PRIORITY = { CLUBS: 0, DIAMONDS: 1, SPADES: 2, HEARTS: 3 };

var cache = {
  matches: {},
  lobbies: {},
  coins: {},
  stats: {},
  leaderboard: {},
  events: {},
  subscriptions: {}
};

var EVENT_LIMIT_PER_MATCH = 256;
var MATCH_CHUNK_SIZE = 6000;
var ENABLE_SYNC_DEBUG = true;

function randomId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

function getCurrentPlayerId(context) {
  return (context && context.currentPlayerId) || currentPlayerId;
}

function titleDataGet(key) {
  try {
    var out = server.GetTitleData({ Keys: [key] });
    if (!out || !out.Data || !out.Data[key]) return null;
    return JSON.parse(out.Data[key]);
  } catch (e) {
    return null;
  }
}

function titleDataSet(key, value) {
  try {
    server.SetTitleData({ Key: key, Value: JSON.stringify(value) });
  } catch (e) {}
}

function titleDataSetRaw(key, value) {
  try {
    server.SetTitleData({ Key: key, Value: String(value) });
  } catch (e) {}
}

function titleDataGetRaw(key) {
  try {
    var out = server.GetTitleData({ Keys: [key] });
    if (!out || !out.Data) return null;
    if (typeof out.Data[key] !== 'string') return null;
    return out.Data[key];
  } catch (e) {
    return null;
  }
}

function appendSyncDebug(matchId, step, data) {
  if (!ENABLE_SYNC_DEBUG || !matchId) return;
  try {
    var key = 'debug_match_' + matchId;
    var list = titleDataGet(key);
    if (!Array.isArray(list)) list = [];
    list.push({
      ts: Date.now(),
      step: step,
      data: data || {}
    });
    if (list.length > 180) {
      list = list.slice(list.length - 180);
    }
    titleDataSet(key, list);
  } catch (e) {}
}

function cloneState(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function persistMatchChunked(match) {
  try {
    var json = JSON.stringify(match);
    var parts = Math.max(1, Math.ceil(json.length / MATCH_CHUNK_SIZE));
    var i;
    for (i = 0; i < parts; i++) {
      var start = i * MATCH_CHUNK_SIZE;
      var end = Math.min(json.length, start + MATCH_CHUNK_SIZE);
      titleDataSetRaw('match_' + match.matchId + '_p_' + i, json.slice(start, end));
    }
    titleDataSet('match_' + match.matchId + '_idx', {
      parts: parts,
      revision: match.revision || 0,
      updatedAt: Date.now()
    });
  } catch (e) {}
}

function loadMatchChunked(matchId) {
  var idx = titleDataGet('match_' + matchId + '_idx');
  if (!idx || !idx.parts || idx.parts < 1) return null;
  var parts = [];
  var i;
  for (i = 0; i < idx.parts; i++) {
    var raw = titleDataGetRaw('match_' + matchId + '_p_' + i);
    if (raw === null) return null;
    parts.push(raw);
  }
  try {
    return JSON.parse(parts.join(''));
  } catch (e) {
    return null;
  }
}

function buildChangedState(before, after) {
  if (!before) return after;
  var changed = {};
  var k;
  for (k in after) {
    if (!after.hasOwnProperty(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      changed[k] = after[k];
    }
  }
  return changed;
}

var EventDispatcher = {
  refreshFromStorage: function(matchId) {
    var local = cache.events[matchId];
    var loaded = titleDataGet('events_' + matchId);
    if (!loaded) return local || null;
    if (!local) {
      cache.events[matchId] = loaded;
      return loaded;
    }
    var localLatest = local.events && local.events.length ? local.events[local.events.length - 1].eventId : 0;
    var loadedLatest = loaded.events && loaded.events.length ? loaded.events[loaded.events.length - 1].eventId : 0;
    if (loadedLatest > localLatest || (loaded.nextEventId || 0) > (local.nextEventId || 0)) {
      cache.events[matchId] = loaded;
      return loaded;
    }
    return local;
  },
  getStream: function(matchId) {
    var refreshed = EventDispatcher.refreshFromStorage(matchId);
    if (!refreshed) {
      cache.events[matchId] = { nextEventId: 1, events: [] };
    }
    return cache.events[matchId];
  },
  emit: function(match, type, actorSeat, payload) {
    var stream = EventDispatcher.getStream(match.matchId);
    var event = {
      eventId: stream.nextEventId++,
      type: type,
      matchId: match.matchId,
      revision: match.revision,
      timestamp: Date.now(),
      actorSeat: typeof actorSeat === 'number' ? actorSeat : -1,
      payload: cloneState(payload || {})
    };
    stream.events.push(event);
    if (stream.events.length > EVENT_LIMIT_PER_MATCH) {
      stream.events.splice(0, stream.events.length - EVENT_LIMIT_PER_MATCH);
    }
    titleDataSet('events_' + match.matchId, stream);
    return event;
  },
  since: function(matchId, sinceEventId) {
    var stream = EventDispatcher.getStream(matchId);
    var id = Number(sinceEventId || 0);
    return stream.events.filter(function(evt) { return evt.eventId > id; });
  },
  latestId: function(matchId) {
    var stream = EventDispatcher.getStream(matchId);
    if (!stream.events.length) return 0;
    return stream.events[stream.events.length - 1].eventId;
  }
};

var SubscriptionManager = {
  ensure: function(matchId) {
    if (!cache.subscriptions[matchId]) {
      cache.subscriptions[matchId] = {};
    }
    return cache.subscriptions[matchId];
  },
  subscribe: function(matchId, playerId) {
    var store = SubscriptionManager.ensure(matchId);
    var subId = randomId('sub');
    store[subId] = {
      playerId: playerId,
      createdAt: Date.now()
    };
    return subId;
  },
  isActive: function(matchId, subId) {
    var store = SubscriptionManager.ensure(matchId);
    return !!store[subId];
  },
  unsubscribe: function(matchId, subId) {
    var store = SubscriptionManager.ensure(matchId);
    delete store[subId];
  }
};

function getCoins(playFabId) {
  if (cache.coins[playFabId] === undefined) {
    cache.coins[playFabId] = STARTING_COINS;
  }
  return cache.coins[playFabId];
}

function setCoins(playFabId, coins) {
  cache.coins[playFabId] = coins;
  return coins;
}

function getStats(playFabId) {
  if (!cache.stats[playFabId]) {
    cache.stats[playFabId] = {};
    cache.stats[playFabId][STAT_KEYS.COINS] = STARTING_COINS;
    cache.stats[playFabId][STAT_KEYS.MMR] = 1000;
    cache.stats[playFabId][STAT_KEYS.MATCHES_PLAYED] = 0;
    cache.stats[playFabId][STAT_KEYS.WINS_TOTAL] = 0;
    cache.stats[playFabId][STAT_KEYS.HEARTS_BEST] = 0;
    cache.stats[playFabId][STAT_KEYS.SPADES_BEST] = 0;
    cache.stats[playFabId][STAT_KEYS.CALLBREAK_BEST] = 0;
  }
  return cache.stats[playFabId];
}

function publishPlayerStats(playFabId) {
  var bag = getStats(playFabId);
  var list = [];
  var k;
  for (k in bag) {
    if (bag.hasOwnProperty(k)) {
      list.push({ StatisticName: k, Value: Math.floor(bag[k]) });
    }
  }
  if (list.length > 0) {
    try {
      server.UpdatePlayerStatistics({ PlayFabId: playFabId, Statistics: list });
    } catch (e) {}
  }
}

function newMatch(gameType, playerName, playerId) {
  var now = Date.now();
  return {
    matchId: randomId('pfm'),
    gameType: gameType,
    revision: 1,
    seed: now,
    deck: [],
    players: [
      { seat: 0, playFabId: playerId, name: playerName || 'YOU', isBot: false, disconnected: false, pingMs: 42, rankBadge: 'Rookie', coins: STARTING_COINS },
      { seat: 1, playFabId: 'BOT_1', name: 'BOT 1', isBot: true, disconnected: false, pingMs: 10, rankBadge: 'BOT', coins: STARTING_COINS },
      { seat: 2, playFabId: 'PENDING_HUMAN', name: 'OPPONENT', isBot: false, disconnected: false, pingMs: 57, rankBadge: 'Rookie', coins: STARTING_COINS },
      { seat: 3, playFabId: 'BOT_3', name: 'BOT 3', isBot: true, disconnected: false, pingMs: 12, rankBadge: 'BOT', coins: STARTING_COINS }
    ],
    hands: { 0: [], 1: [], 2: [], 3: [] },
    turnIndex: 0,
    currentTrick: [],
    lastCompletedTrick: null,
    trickLeaderIndex: 0,
    leadSuit: null,
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 },
    roundNumber: 1,
    status: 'WAITING',
    phase: 'WAITING',
    heartsBroken: false,
    playedBySuit: { CLUBS: 0, DIAMONDS: 0, HEARTS: 0, SPADES: 0 },
    playedCardIds: {},
    passingSelections: { 0: [], 1: [], 2: [], 3: [] },
    autoMoveOnTimeoutBySeat: { 0: true, 1: true, 2: true, 3: true },
    passingDirection: 'LEFT',
    turnDeadlineMs: now + HUMAN_TIMEOUT_MS,
    serverTimeMs: now
  };
}

function ensureTracking(match) {
  if (!match.playedBySuit) match.playedBySuit = { CLUBS: 0, DIAMONDS: 0, HEARTS: 0, SPADES: 0 };
  if (!match.playedCardIds) match.playedCardIds = {};
  if (match.heartsBroken === undefined || match.heartsBroken === null) match.heartsBroken = false;
  if (!match.tricksWon) match.tricksWon = { 0: 0, 1: 0, 2: 0, 3: 0 };
  if (!match.autoMoveOnTimeoutBySeat) match.autoMoveOnTimeoutBySeat = { 0: true, 1: true, 2: true, 3: true };
  if (match.autoMoveOnTimeoutBySeat[0] === undefined) match.autoMoveOnTimeoutBySeat[0] = true;
  if (match.autoMoveOnTimeoutBySeat[1] === undefined) match.autoMoveOnTimeoutBySeat[1] = true;
  if (match.autoMoveOnTimeoutBySeat[2] === undefined) match.autoMoveOnTimeoutBySeat[2] = true;
  if (match.autoMoveOnTimeoutBySeat[3] === undefined) match.autoMoveOnTimeoutBySeat[3] = true;
}

function getTurnTimeout(match, seat) {
  var p = match.players[seat];
  if (!p) return HUMAN_TIMEOUT_MS;
  var isBotTurn = !!p.isBot || !!p.disconnected;
  if (!isBotTurn && match.gameType === 'CALLBREAK') {
    return HUMAN_TIMEOUT_MS + CALLBREAK_HUMAN_TIMEOUT_EXTRA_MS;
  }
  return isBotTurn ? BOT_TIMEOUT_MS : HUMAN_TIMEOUT_MS;
}

function compareHandCards(a, b) {
  if (a.suit !== b.suit) return SUIT_PRIORITY[a.suit] - SUIT_PRIORITY[b.suit];
  return a.value - b.value;
}

function sortHandCards(cards) {
  return (cards || []).slice().sort(compareHandCards);
}

function buildDeck(gameType) {
  var deck = [];
  var si;
  var ri;
  for (si = 0; si < SUITS.length; si++) {
    for (ri = 0; ri < RANKS.length; ri++) {
      var suit = SUITS[si];
      var rank = RANKS[ri];
      var points = 0;
      if (gameType === 'HEARTS') {
        if (suit === 'HEARTS') points = 1;
        if (suit === 'SPADES' && rank === 'Q') points = 13;
      }
      deck.push({
        id: rank + '-' + suit,
        suit: suit,
        rank: rank,
        value: RANK_VALUE[rank],
        points: points
      });
    }
  }
  return deck;
}

function shuffle(deck, seed) {
  var arr = deck.slice();
  var x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  function nextRand() {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  }
  var i;
  for (i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(nextRand() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function startMatchIfReady(match) {
  if (match.status !== 'WAITING') return false;
  var seat2Ready = isRealHumanPlayerId(match.players[2].playFabId);
  if (!seat2Ready) return false;

  var seed = Date.now();
  var deck = shuffle(buildDeck(match.gameType), seed);
  var seat;
  for (seat = 0; seat < 4; seat++) {
    match.hands[seat] = sortHandCards(deck.slice(seat * 13, seat * 13 + 13));
  }
  match.seed = seed;
  match.deck = deck;
  match.currentTrick = [];
  match.leadSuit = null;
  match.heartsBroken = false;
  match.playedBySuit = { CLUBS: 0, DIAMONDS: 0, HEARTS: 0, SPADES: 0 };
  match.playedCardIds = {};
  match.turnIndex = 0;
  match.trickLeaderIndex = 0;
  match.passingSelections = { 0: [], 1: [], 2: [], 3: [] };
  match.bids = { 0: null, 1: null, 2: null, 3: null };
  match.tricksWon = { 0: 0, 1: 0, 2: 0, 3: 0 };
  if (match.gameType === 'HEARTS') {
    match.phase = 'PASSING';
  } else if (match.gameType === 'CALLBREAK' || match.gameType === 'SPADES') {
    match.phase = 'BIDDING';
  } else {
    match.phase = 'PLAYING';
  }
  match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
  match.status = 'PLAYING';
  return true;
}

function ensureMatchStartedAndPublished(match, context) {
  if (match.status !== 'WAITING') return false;
  var started = startMatchIfReady(match);
  if (!started) return false;
  bump(match);
  EventDispatcher.emit(match, 'MATCH_STARTED', -1, match);
  EventDispatcher.emit(match, 'CARDS_DISTRIBUTED', -1, match);
  EventDispatcher.emit(match, 'TURN_CHANGED', match.turnIndex, match);
  runServerTurnChain(match, match.revision);
  saveMatch(match, context);
  return true;
}

function isSeatBotOrDisconnected(match, seat) {
  var p = match.players[seat];
  return !!(p && (p.isBot || p.disconnected));
}

function autoSelectPass(match, seat) {
  var hand = (match.hands[seat] || []).slice().sort(function(a, b) { return b.value - a.value; });
  match.passingSelections[seat] = hand.slice(0, 3).map(function(c) { return c.id; });
}

function finalizePassing(match) {
  var seat;
  var passes = { 0: [], 1: [], 2: [], 3: [] };
  for (seat = 0; seat < 4; seat++) {
    var sel = match.passingSelections[seat] || [];
    var chosen = [];
    var hand = match.hands[seat] || [];
    var i;
    for (i = 0; i < hand.length; i++) {
      if (sel.indexOf(hand[i].id) >= 0) chosen.push(hand[i]);
    }
    passes[seat] = chosen.slice(0, 3);
    match.hands[seat] = hand.filter(function(c) { return sel.indexOf(c.id) < 0; });
  }

  for (seat = 0; seat < 4; seat++) {
    var target = (seat + 1) % 4; // pass left
    match.hands[target] = (match.hands[target] || []).concat(passes[seat] || []);
  }

  for (seat = 0; seat < 4; seat++) {
    match.hands[seat] = sortHandCards(match.hands[seat] || []);
  }
  match.passingSelections = { 0: [], 1: [], 2: [], 3: [] };
  match.phase = 'PLAYING';
  match.turnIndex = 0;
  match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
}

function autoBid(match, seat) {
  var hand = match.hands[seat] || [];
  var spades = hand.filter(function(c) { return c.suit === 'SPADES'; });
  var sides = ['CLUBS', 'DIAMONDS', 'HEARTS'].map(function(suit) {
    return hand.filter(function(c) { return c.suit === suit; });
  });

  function hasVal(cards, value) {
    var i;
    for (i = 0; i < cards.length; i++) if (cards[i].value === value) return true;
    return false;
  }
  function nonTrumpProb(card, suitCards) {
    var suitedCount = suitCards.length;
    var hasAce = hasVal(suitCards, 14);
    if (card.value === 14) return 1.0;
    if (card.value === 13) {
      if (hasAce) {
        if (suitedCount === 2) return 1.0;
        if (suitedCount === 3) return 0.8;
        if (suitedCount === 4) return 0.3;
        return 0.1;
      }
      if (suitedCount === 1) return 0;
      if (suitedCount === 2) return 0.5;
      if (suitedCount === 3) return 0.6;
      if (suitedCount === 4) return 0.3;
      return 0.1;
    }
    if (card.value === 12) {
      if (hasAce) {
        if (suitedCount === 2 || suitedCount === 3) return 0.4;
        if (suitedCount === 4) return 0.1;
        return 0;
      }
      if (suitedCount === 1) return 0;
      if (suitedCount === 2) return 0.4;
      if (suitedCount === 3) return 0.3;
      return 0;
    }
    return 0;
  }

  var nonTrump = 0;
  sides.forEach(function(suitCards) {
    suitCards.forEach(function(card) {
      nonTrump += nonTrumpProb(card, suitCards);
    });
  });
  var trumpable = sides.reduce(function(acc, suitCards) { return acc + Math.max(0, 3 - suitCards.length); }, 0);
  var trumpPoint = 0;
  if (spades.length === 2) trumpPoint = Math.min(1, trumpable);
  else if (spades.length === 3) trumpPoint = Math.min(2, trumpable);
  else if (spades.length > 3) trumpPoint = Math.min(3, trumpable);
  var extraSpade = Math.max(0, spades.length - (hasVal(spades, 14) && hasVal(spades, 13) ? 4 : hasVal(spades, 14) ? 4.5 : 5));
  var base = nonTrump + trumpPoint + extraSpade;
  var deduction = base >= 8 ? 2 : base >= 5 ? 1 : 0;
  var initial = Math.round(base - deduction);
  var nilSafe = (function() {
    if (spades.length > 3) return false;
    if (spades.some(function(c) { return c.value > 11; })) return false;
    var i;
    for (i = 0; i < sides.length; i++) {
      var suitCards = sides[i];
      if (suitCards.length <= 3 && suitCards.some(function(c) { return c.value > 11; })) return false;
    }
    return true;
  })();

  var bid;
  if (match.gameType === 'SPADES') {
    var knownOtherBids = 0;
    var si;
    for (si = 0; si < 4; si++) {
      if (si === seat) continue;
      var b = match.bids && match.bids[si];
      if (typeof b === 'number') knownOtherBids += b;
    }
    var maxAllowed = Math.max(0, 13 - knownOtherBids);
    bid = initial <= 1 && nilSafe ? 0 : Math.max(1, initial);
    bid = Math.min(13, Math.min(maxAllowed, bid));
  } else {
    bid = Math.max(1, Math.min(8, Math.round((base - deduction) * 0.92)));
  }
  match.bids[seat] = bid;
}

function finalizeBidding(match) {
  var i;
  for (i = 0; i < 4; i++) {
    if (match.bids[i] === null || match.bids[i] === undefined) return false;
  }
  match.phase = 'PLAYING';
  match.turnIndex = 0;
  match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
  return true;
}

function resolveTrickWinner(match) {
  if (!match.currentTrick || match.currentTrick.length < 4) return match.turnIndex;
  var leadSuit = match.currentTrick[0].card.suit;
  var trumpSuit = match.gameType === 'HEARTS' ? null : 'SPADES';
  var winner = match.currentTrick[0];
  var i;
  for (i = 1; i < match.currentTrick.length; i++) {
    var curr = match.currentTrick[i];
    var winnerTrump = trumpSuit && winner.card.suit === trumpSuit;
    var currTrump = trumpSuit && curr.card.suit === trumpSuit;
    if (currTrump && !winnerTrump) {
      winner = curr;
      continue;
    }
    if (currTrump === winnerTrump) {
      var cmpSuit = winnerTrump ? trumpSuit : leadSuit;
      if (curr.card.suit === cmpSuit && winner.card.suit === cmpSuit && curr.card.value > winner.card.value) {
        winner = curr;
      }
    }
  }
  return winner.seat;
}

function fallbackCard(match, seat) {
  var hand = legalMovesForSeat(match, seat);
  if (hand.length > 0) {
    hand.sort(function(a, b) { return a.value - b.value; });
    return hand[0];
  }
  return { id: '2-CLUBS', suit: 'CLUBS', rank: '2', value: 2, points: 0 };
}

function highestRemainingValue(match, suit) {
  ensureTracking(match);
  var v;
  for (v = 14; v >= 2; v--) {
    var rank = v <= 10 ? String(v) : (v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : 'A');
    if (!match.playedCardIds[rank + '-' + suit]) return v;
  }
  return 2;
}

function lowestCard(cards) {
  var sorted = cards.slice().sort(function(a, b) {
    if (a.value !== b.value) return a.value - b.value;
    return String(a.suit).localeCompare(String(b.suit));
  });
  return sorted[0];
}

function highestCard(cards) {
  var sorted = cards.slice().sort(function(a, b) { return b.value - a.value; });
  return sorted[0];
}

function currentWinnerCard(match) {
  if (!match.currentTrick || !match.currentTrick.length) return null;
  var leadSuit = match.currentTrick[0].card.suit;
  var winner = match.currentTrick[0].card;
  var i;
  for (i = 1; i < match.currentTrick.length; i++) {
    var c = match.currentTrick[i].card;
    if (c.suit === leadSuit && winner.suit === leadSuit && c.value > winner.value) winner = c;
  }
  return winner;
}

function legalMovesForSeat(match, seat) {
  var hand = (match.hands[seat] || []).slice();
  if (!hand.length) return [];
  var leadSuit = match.leadSuit;
  if (!leadSuit) {
    if (match.gameType === 'HEARTS') {
      var totalCards = 0;
      var i;
      for (i = 0; i < 4; i++) totalCards += (match.hands[i] || []).length;
      var has2C = hand.some(function(c) { return c.id === '2-CLUBS'; });
      if (totalCards === 52 && has2C) return hand.filter(function(c) { return c.id === '2-CLUBS'; });
      if (!match.heartsBroken) {
        var nonHearts = hand.filter(function(c) { return c.suit !== 'HEARTS'; });
        return nonHearts.length ? nonHearts : hand;
      }
    }
    return hand;
  }
  var follow = hand.filter(function(c) { return c.suit === leadSuit; });
  if (follow.length) return follow;
  if (match.gameType === 'CALLBREAK') {
    var spades = hand.filter(function(c) { return c.suit === 'SPADES'; });
    if (spades.length) return spades;
  }
  return hand;
}

function chooseHeartsBotCard(match, seat, legal) {
  ensureTracking(match);
  var hand = legal.slice();
  if (!hand.length) return '';

  if (match.currentTrick.length === 0) {
    var smallSpade = hand.filter(function(c) { return c.suit === 'SPADES' && c.value <= 11; });
    var highSpade = hand.filter(function(c) { return c.suit === 'SPADES' && c.value >= 12; });
    if (smallSpade.length && !highSpade.length) return lowestCard(smallSpade).id;

    var dOrC = ['DIAMONDS', 'CLUBS'];
    var si;
    for (si = 0; si < dOrC.length; si++) {
      var suit = dOrC[si];
      var suited = hand.filter(function(c) { return c.suit === suit; });
      if (!suited.length) continue;
      var hi = highestCard(suited);
      if (hi.value === highestRemainingValue(match, suit) && hi.value >= 11) return hi.id;
      return lowestCard(suited).id;
    }

    var lowHearts = hand.filter(function(c) { return c.suit === 'HEARTS' && c.value <= 4; });
    if (lowHearts.length) return lowestCard(lowHearts).id;
    return lowestCard(hand).id;
  }

  var leadSuit = match.leadSuit;
  var winner = currentWinnerCard(match);

  if (!hand.every(function(c) { return c.suit === leadSuit; })) {
    var qs = hand.find(function(c) { return c.id === 'Q-SPADES'; });
    if (qs) return qs.id;
    var highHearts = hand.filter(function(c) { return c.suit === 'HEARTS'; });
    if (highHearts.length) return highestCard(highHearts).id;
    return highestCard(hand).id;
  }

  if (leadSuit === 'HEARTS') {
    var lowerH = hand.filter(function(c) { return winner && c.value < winner.value; });
    if (lowerH.length) return highestCard(lowerH).id;
    return lowestCard(hand).id;
  }
  if (leadSuit === 'SPADES') {
    var hasQS = hand.some(function(c) { return c.id === 'Q-SPADES'; });
    if (winner && winner.value >= 13 && hasQS) return 'Q-SPADES';
    var lowerS = hand.filter(function(c) { return winner && c.value < winner.value; });
    var nonQ = hand.filter(function(c) { return c.id !== 'Q-SPADES'; });
    if (lowerS.length) return highestCard(lowerS).id;
    if (nonQ.length) return lowestCard(nonQ).id;
    return lowestCard(hand).id;
  }

  var lowerM = hand.filter(function(c) { return winner && c.value < winner.value; });
  if (lowerM.length) return highestCard(lowerM).id;
  return lowestCard(hand).id;
}

function chooseCallbreakBotCard(match, seat, legal) {
  ensureTracking(match);
  var hand = legal.slice();
  if (!hand.length) return '';

  if (match.currentTrick.length === 0) {
    var trickNo = 14 - ((match.hands[seat] || []).length);
    var spades = hand.filter(function(c) { return c.suit === 'SPADES'; });
    if (trickNo >= 3 && spades.length >= Math.floor((match.hands[seat] || []).length / 2) - 1) {
      var hi = highestCard(spades);
      if (hi.value === highestRemainingValue(match, 'SPADES')) return hi.id;
    }
    var aces = hand.filter(function(c) { return c.value === 14; });
    if (aces.length) return aces[0].id;
    var nonSpades = hand.filter(function(c) { return c.suit !== 'SPADES'; });
    if (nonSpades.length) return lowestCard(nonSpades).id;
    return lowestCard(hand).id;
  }

  var winner = resolveTrickWinningCard(match);
  var canAnyWin = hand.some(function(c) { return canBeatForTrumpGames(c, winner, match.leadSuit); });
  if (!canAnyWin) return lowestCard(hand).id;

  if (hand.every(function(c) { return c.suit === match.leadSuit; })) {
    if (match.currentTrick.length === 3) return lowestCard(hand).id;
    var over = hand.filter(function(c) { return canBeatForTrumpGames(c, winner, match.leadSuit); }).sort(function(a, b) { return a.value - b.value; });
    if (over.length) return over[0].id;
    return lowestCard(hand).id;
  }
  var nonTrump = hand.filter(function(c) { return c.suit !== 'SPADES'; });
  if (nonTrump.length) return lowestCard(nonTrump).id;
  return lowestCard(hand).id;
}

function chooseSpadesBotCard(match, seat, legal) {
  ensureTracking(match);
  var hand = legal.slice();
  if (!hand.length) return '';

  function isNilActive(s) {
    var b = match.bids && match.bids[s];
    var won = (match.tricksWon && match.tricksWon[s]) || 0;
    return b === 0 && won === 0;
  }
  function partnerSeat(s) { return (s + 2) % 4; }
  function hasVal(cards, val) {
    var i;
    for (i = 0; i < cards.length; i++) if (cards[i].value === val) return true;
    return false;
  }
  function aceMove(cards) {
    var aces = cards.filter(function(c) { return c.value === 14; });
    var i;
    for (i = 0; i < aces.length; i++) {
      var ace = aces[i];
      var suited = cards.filter(function(c) { return c.suit === ace.suit; });
      var hasK = hasVal(suited, 13);
      var hasQ = hasVal(suited, 12);
      if (!hasQ || hasK) return ace;
    }
    return null;
  }
  function canBeat(card, winner, leadSuit) {
    if (!winner) return true;
    var winnerTrump = winner.suit === 'SPADES';
    var cardTrump = card.suit === 'SPADES';
    if (cardTrump && !winnerTrump) return true;
    if (cardTrump === winnerTrump && card.suit === winner.suit && card.value > winner.value) return true;
    if (!winnerTrump && card.suit === leadSuit && winner.suit === leadSuit && card.value > winner.value) return true;
    return false;
  }
  function minorLeadWinner(cards) {
    var suits = ['CLUBS', 'DIAMONDS', 'HEARTS'];
    var i;
    for (i = 0; i < suits.length; i++) {
      var suit = suits[i];
      var suited = cards.filter(function(c) { return c.suit === suit; });
      if (!suited.length) continue;
      var hi = highestCard(suited);
      if (hi.value === highestRemainingValue(match, suit) && hi.value !== 14) return hi;
    }
    return null;
  }

  if (match.currentTrick.length === 0) {
    if (isNilActive(seat)) {
      var nonSpadesNil = hand.filter(function(c) { return c.suit !== 'SPADES'; });
      if (nonSpadesNil.length) return lowestCard(nonSpadesNil).id;
      return lowestCard(hand).id;
    }
    var ace = aceMove(hand);
    if (ace) return ace.id;
    var spades = hand.filter(function(c) { return c.suit === 'SPADES'; });
    var trickNo = 14 - ((match.hands[seat] || []).length);
    if (trickNo >= 3 && spades.length >= Math.floor((match.hands[seat] || []).length / 2) - 1) {
      var hiSpade = highestCard(spades);
      if (hiSpade.value === highestRemainingValue(match, 'SPADES')) return hiSpade.id;
    }
    var winMinor = minorLeadWinner(hand);
    if (winMinor) return winMinor.id;
    var nonSpades = hand.filter(function(c) { return c.suit !== 'SPADES'; });
    if (nonSpades.length) return lowestCard(nonSpades).id;
    return lowestCard(hand).id;
  }

  var winner = resolveTrickWinningCard(match);
  var winnerSeat = resolveTrickWinner(match);
  var partner = partnerSeat(seat);
  var partnerWinning = winnerSeat === partner;
  var partnerNil = isNilActive(partner);
  var opponentNil = isNilActive(winnerSeat) && !partnerWinning;

  if (isNilActive(seat)) {
    var losing = hand.filter(function(c) { return !canBeat(c, winner, match.leadSuit); });
    if (losing.length) {
      // Keep the highest guaranteed-losing card to burn risk.
      return highestCard(losing).id;
    }
    var nonTrump = hand.filter(function(c) { return c.suit !== 'SPADES'; });
    if (nonTrump.length) return highestCard(nonTrump).id;
    return lowestCard(hand).id;
  }

  var canAnyWin = hand.some(function(c) { return canBeat(c, winner, match.leadSuit); });
  if (!canAnyWin) return lowestCard(hand).id;

  if (hand.every(function(c) { return c.suit === match.leadSuit; })) {
    if (match.currentTrick.length === 3) {
      if (partnerWinning && !partnerNil) return lowestCard(hand).id;
      var higher4 = hand.filter(function(c) { return canBeat(c, winner, match.leadSuit); }).sort(function(a, b) { return a.value - b.value; });
      if (higher4.length && !opponentNil) return higher4[0].id;
      return lowestCard(hand).id;
    }
    if (partnerWinning) {
      if (partnerNil) {
        var savePartner = hand.filter(function(c) { return canBeat(c, winner, match.leadSuit); }).sort(function(a, b) { return b.value - a.value; });
        if (savePartner.length) return savePartner[0].id;
      }
      return lowestCard(hand).id;
    }
    var aceSuit = hand.find(function(c) { return c.value === 14; });
    if (aceSuit && winner && winner.suit === match.leadSuit) return aceSuit.id;
    var over = hand.filter(function(c) { return canBeat(c, winner, match.leadSuit); }).sort(function(a, b) { return a.value - b.value; });
    if (over.length && !opponentNil) return over[0].id;
    return lowestCard(hand).id;
  }

  // Void in lead suit: trump only if needed and safe for nil dynamics.
  var trumps = hand.filter(function(c) { return c.suit === 'SPADES'; });
  if (trumps.length) {
    if (partnerWinning && !partnerNil) {
      var nonTr = hand.filter(function(c) { return c.suit !== 'SPADES'; });
      if (nonTr.length) return lowestCard(nonTr).id;
      return lowestCard(trumps).id;
    }
    if (opponentNil) {
      var nonTr2 = hand.filter(function(c) { return c.suit !== 'SPADES'; });
      if (nonTr2.length) return lowestCard(nonTr2).id;
      return lowestCard(trumps).id;
    }
    if (!winner || winner.suit !== 'SPADES') return lowestCard(trumps).id;
    var overTrump = trumps.filter(function(c) { return c.value > winner.value; }).sort(function(a, b) { return a.value - b.value; });
    if (overTrump.length) return overTrump[0].id;
  }
  var nonTrumpFallback = hand.filter(function(c) { return c.suit !== 'SPADES'; });
  if (nonTrumpFallback.length) return lowestCard(nonTrumpFallback).id;
  return lowestCard(hand).id;
}

function resolveTrickWinningCard(match) {
  if (!match.currentTrick || !match.currentTrick.length) return null;
  var leadSuit = match.currentTrick[0].card.suit;
  var winner = match.currentTrick[0].card;
  var i;
  for (i = 1; i < match.currentTrick.length; i++) {
    var curr = match.currentTrick[i].card;
    var winnerTrump = winner.suit === 'SPADES';
    var currTrump = curr.suit === 'SPADES';
    if (currTrump && !winnerTrump) {
      winner = curr;
      continue;
    }
    if (currTrump === winnerTrump) {
      var cmpSuit = winnerTrump ? 'SPADES' : leadSuit;
      if (curr.suit === cmpSuit && winner.suit === cmpSuit && curr.value > winner.value) winner = curr;
    }
  }
  return winner;
}

function canBeatForTrumpGames(card, winner, leadSuit) {
  if (!winner) return true;
  var winnerTrump = winner.suit === 'SPADES';
  var cardTrump = card.suit === 'SPADES';
  if (cardTrump && !winnerTrump) return true;
  if (cardTrump === winnerTrump && card.suit === winner.suit && card.value > winner.value) return true;
  if (!winnerTrump && card.suit === leadSuit && winner.suit === leadSuit && card.value > winner.value) return true;
  return false;
}

function chooseBotCard(match, seat) {
  var legal = legalMovesForSeat(match, seat);
  if (!legal.length) return '';
  if (match.gameType === 'HEARTS') return chooseHeartsBotCard(match, seat, legal);
  if (match.gameType === 'SPADES') return chooseSpadesBotCard(match, seat, legal);
  if (match.gameType === 'CALLBREAK') return chooseCallbreakBotCard(match, seat, legal);
  legal.sort(function(a, b) { return a.value - b.value; });
  return legal[0].id;
}

function applyMove(match, seat, cardId, allowFallback) {
  if (match.status !== 'PLAYING') throw new Error('Match not active');
  ensureTracking(match);
  if (match.turnIndex !== seat) throw new Error('Not your turn');
  var hand = match.hands[seat] || [];
  var idx = -1;
  var i;
  for (i = 0; i < hand.length; i++) {
    if (hand[i].id === cardId) {
      idx = i;
      break;
    }
  }
  var card;
  if (idx >= 0) {
    card = hand[idx];
    hand.splice(idx, 1);
  } else if (allowFallback) {
    card = fallbackCard(match, seat);
    // remove chosen fallback if present in hand
    var j;
    for (j = 0; j < hand.length; j++) {
      if (hand[j].id === card.id) {
        hand.splice(j, 1);
        break;
      }
    }
  } else {
    throw new Error('Card not in hand');
  }

  match.currentTrick.push({ seat: seat, card: card });
  if (match.currentTrick.length === 1) match.leadSuit = card.suit;
  match.playedBySuit[card.suit] = (match.playedBySuit[card.suit] || 0) + 1;
  match.playedCardIds[card.id] = true;
  if (card.suit === 'HEARTS') match.heartsBroken = true;

  if (match.currentTrick.length < 4) {
    match.turnIndex = (seat + 1) % 4;
    match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
    return;
  }

  var completedTrick = match.currentTrick.slice();
  var winner = resolveTrickWinner(match);
  var trickPoints = 0;
  var k;
  for (k = 0; k < match.currentTrick.length; k++) {
    trickPoints += match.currentTrick[k].card.points || 0;
  }
  match.scores[winner] = (match.scores[winner] || 0) + trickPoints;
  match.tricksWon[winner] = (match.tricksWon[winner] || 0) + 1;
  match.currentTrick = [];
  match.lastCompletedTrick = {
    trick: completedTrick,
    winner: winner,
    at: Date.now()
  };
  match.leadSuit = null;
  match.turnIndex = winner;
  match.trickLeaderIndex = winner;
  match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);

  if ((match.hands[0] || []).length === 0) {
    match.status = 'COMPLETED';
  }
}

function runServerTurnChain(match, beforeRevision) {
  if (match.status !== 'PLAYING') return false;
  ensureTracking(match);
  if (!match.phase) match.phase = 'PLAYING';

  var changed = false;
  while (match.status === 'PLAYING') {
    if (match.phase === 'PASSING') {
      if (!isSeatBotOrDisconnected(match, match.turnIndex)) break;
      autoSelectPass(match, match.turnIndex);
      match.turnIndex = (match.turnIndex + 1) % 4;
      if ((match.passingSelections[0] || []).length === 3 &&
          (match.passingSelections[1] || []).length === 3 &&
          (match.passingSelections[2] || []).length === 3 &&
          (match.passingSelections[3] || []).length === 3) {
        finalizePassing(match);
      } else {
        match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
      }
      bump(match);
      EventDispatcher.emit(match, 'TURN_CHANGED', match.turnIndex, { phase: match.phase, turnIndex: match.turnIndex, passingSelections: match.passingSelections, turnDeadlineMs: match.turnDeadlineMs });
      changed = true;
      continue;
    }

  if (match.phase === 'BIDDING') {
    if (!isSeatBotOrDisconnected(match, match.turnIndex)) break;
    var biddingWasActive = match.phase === 'BIDDING';
    autoBid(match, match.turnIndex);
    var biddingFinished = finalizeBidding(match);
    if (!biddingFinished) {
      match.turnIndex = (match.turnIndex + 1) % 4;
      match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
    }
    bump(match);
    EventDispatcher.emit(match, 'BID_SUBMITTED', match.turnIndex, { bids: match.bids, turnIndex: match.turnIndex, phase: match.phase });
    if (biddingWasActive && biddingFinished) {
      EventDispatcher.emit(match, 'BIDDING_COMPLETED', match.turnIndex, { bids: match.bids, phase: match.phase, turnIndex: match.turnIndex });
    }
    EventDispatcher.emit(match, 'TURN_CHANGED', match.turnIndex, { phase: match.phase, bids: match.bids, turnIndex: match.turnIndex, turnDeadlineMs: match.turnDeadlineMs });
    changed = true;
    continue;
  }

    var turnSeat = match.turnIndex;
    if (!isSeatBotOrDisconnected(match, turnSeat)) break;
    var beforeTrickCount = match.currentTrick.length;
    var cardId = chooseBotCard(match, turnSeat);
    applyMove(match, turnSeat, cardId, true);
    bump(match);
    EventDispatcher.emit(match, 'CARD_PLAYED', turnSeat, {
      turnIndex: match.turnIndex,
      currentTrick: match.currentTrick,
      hands: match.hands,
      lastCompletedTrick: match.lastCompletedTrick
    });
    EventDispatcher.emit(match, 'BOT_ACTION', turnSeat, { turnIndex: match.turnIndex, phase: match.phase });
    if (beforeTrickCount === 3) {
      EventDispatcher.emit(match, 'TRICK_COMPLETED', turnSeat, {
        lastCompletedTrick: match.lastCompletedTrick,
        scores: match.scores,
        tricksWon: match.tricksWon,
        turnIndex: match.turnIndex
      });
    }
    if (match.status === 'COMPLETED') {
      EventDispatcher.emit(match, 'ROUND_COMPLETED', turnSeat, { scores: match.scores, tricksWon: match.tricksWon });
      EventDispatcher.emit(match, 'MATCH_COMPLETED', turnSeat, { status: match.status, scores: match.scores, tricksWon: match.tricksWon });
    } else {
      EventDispatcher.emit(match, 'TURN_CHANGED', match.turnIndex, { turnIndex: match.turnIndex, turnDeadlineMs: match.turnDeadlineMs, phase: match.phase });
    }
    changed = true;
  }
  return changed || match.revision !== beforeRevision;
}

function isRealHumanPlayerId(playFabId) {
  if (!playFabId) return false;
  if (playFabId.indexOf('BOT_') === 0) return false;
  if (playFabId === 'PENDING_HUMAN') return false;
  if (playFabId === 'REMOTE_PLAYER') return false;
  return true;
}

function saveMatchForPlayer(playFabId, match) {
  if (!isRealHumanPlayerId(playFabId)) return;
  try {
    server.UpdateUserReadOnlyData({
      PlayFabId: playFabId,
      Data: (function() {
        var obj = {};
        obj['match_' + match.matchId] = JSON.stringify(match);
        return obj;
      })()
    });
  } catch (e) {}
}

function saveMatch(match, context) {
  cache.matches[match.matchId] = match;
  var ownerId = match.ownerPlayFabId || getCurrentPlayerId(context);
  match.ownerPlayFabId = ownerId;
  titleDataSet('match_owner_' + match.matchId, { ownerPlayFabId: ownerId });
  saveMatchForPlayer(ownerId, match);
  // Mirror state to all human seats so both clients can read consistently.
  var i;
  for (i = 0; i < match.players.length; i++) {
    saveMatchForPlayer(match.players[i].playFabId, match);
  }
  // best-effort backup only
  titleDataSet('match_' + match.matchId, match);
  persistMatchChunked(match);
  appendSyncDebug(match.matchId, 'saveMatch', {
    revision: match.revision,
    status: match.status,
    phase: match.phase,
    turnIndex: match.turnIndex,
    seat0: match.players[0] && match.players[0].playFabId,
    seat2: match.players[2] && match.players[2].playFabId
  });
}

function getMatch(matchId, context) {
  var cached = cache.matches[matchId] || null;
  var pid = getCurrentPlayerId(context);
  var newest = cached;

  function pickNewest(candidate) {
    if (!candidate) return;
    if (!newest || (candidate.revision || 0) > (newest.revision || 0)) {
      newest = candidate;
    }
  }

  try {
    var ud = server.GetUserReadOnlyData({ PlayFabId: pid, Keys: ['match_' + matchId] });
    var raw = ud && ud.Data && ud.Data['match_' + matchId] && ud.Data['match_' + matchId].Value;
    if (raw) {
      pickNewest(JSON.parse(raw));
    }
  } catch (e) {}

  // Fallback: read from owner's read-only data to avoid relying on large TitleData snapshots.
  try {
    var ownerRef = titleDataGet('match_owner_' + matchId);
    var ownerId = ownerRef && ownerRef.ownerPlayFabId;
    if (ownerId) {
      var oud = server.GetUserReadOnlyData({ PlayFabId: ownerId, Keys: ['match_' + matchId] });
      var oraw = oud && oud.Data && oud.Data['match_' + matchId] && oud.Data['match_' + matchId].Value;
      if (oraw) {
        pickNewest(JSON.parse(oraw));
      }
    }
  } catch (e) {}

  var loadedChunked = loadMatchChunked(matchId);
  pickNewest(loadedChunked);
  var loaded = titleDataGet('match_' + matchId);
  pickNewest(loaded);

  if (newest) {
    cache.matches[matchId] = newest;
    appendSyncDebug(matchId, 'getMatch.selected', {
      playerId: pid,
      selectedRevision: newest.revision || 0,
      selectedStatus: newest.status,
      selectedPhase: newest.phase,
      selectedTurnIndex: newest.turnIndex,
      selectedSeat2: newest.players && newest.players[2] ? newest.players[2].playFabId : null
    });
    return newest;
  }
  appendSyncDebug(matchId, 'getMatch.miss', { playerId: pid });
  throw new Error('Match not found');
}

function bump(match) {
  match.revision += 1;
  match.serverTimeMs = Date.now();
}

function deltaFor(match, changed) {
  return {
    matchId: match.matchId,
    revision: match.revision,
    changed: changed || match,
    serverTimeMs: Date.now()
  };
}

function updatePostMatchStats(gameType, player, rank, score, coinsAfter) {
  if (player.isBot) return;
  var bag = getStats(player.playFabId);
  bag[STAT_KEYS.MATCHES_PLAYED] += 1;
  if (rank === 1) bag[STAT_KEYS.WINS_TOTAL] += 1;
  bag[STAT_KEYS.COINS] = coinsAfter;
  bag[STAT_KEYS.MMR] = Math.max(0, bag[STAT_KEYS.MMR] + (rank === 1 ? 20 : rank === 2 ? 10 : rank === 3 ? -5 : -12));

  var bestKey = STAT_KEYS.CALLBREAK_BEST;
  if (gameType === 'HEARTS') bestKey = STAT_KEYS.HEARTS_BEST;
  else if (gameType === 'SPADES') bestKey = STAT_KEYS.SPADES_BEST;

  if (score > bag[bestKey]) bag[bestKey] = score;
  publishPlayerStats(player.playFabId);
}

handlers.createLobby = function(args, context) {
  var playerId = getCurrentPlayerId(context);
  var gameType = args.gameType;
  var queueName = QUICK_MATCH_QUEUES[gameType] || QUICK_MATCH_QUEUES.HEARTS;
  var lobbyId = randomId('lobby');

  cache.lobbies[lobbyId] = {
    lobbyId: lobbyId,
    gameType: gameType,
    queueName: queueName,
    ticketTimeoutSec: QUICK_MATCH_TICKET_TIMEOUT_SEC,
    region: args.region || DEFAULT_REGION,
    isPublicQuickMatch: true,
    members: [playerId],
    createdAt: Date.now()
  };

  titleDataSet('lobby_' + lobbyId, cache.lobbies[lobbyId]);

  return {
    lobbyId: lobbyId,
    queueName: queueName,
    ticketTimeoutSec: QUICK_MATCH_TICKET_TIMEOUT_SEC,
    region: args.region || DEFAULT_REGION
  };
};

handlers.findMatch = function(args, context) {
  var playerId = (args && args.playFabId) || getCurrentPlayerId(context);
  var gameType = args.gameType;

  // Public quick-match queue by game type.
  var waitKey = 'waiting_' + gameType;
  var waiting = titleDataGet(waitKey);
  if (waiting && waiting.matchId) {
    appendSyncDebug(waiting.matchId, 'findMatch.waitingRead', {
      playerId: playerId,
      waitingOwner: waiting.ownerPlayFabId,
      waitingMatchId: waiting.matchId,
      gameType: gameType
    });
  }
  if (waiting && waiting.matchId && waiting.ownerPlayFabId && waiting.ownerPlayFabId !== playerId) {
    var existing = getMatch(waiting.matchId, context);
    var beforeExisting = cloneState(existing);
    existing.players[2].playFabId = playerId;
    existing.players[2].name = args.playerName || 'OPPONENT';
    existing.players[2].isBot = false;
    existing.players[2].rankBadge = 'Rookie';
    existing.players[2].pingMs = 57;
    ensureTracking(existing);
    existing.autoMoveOnTimeoutBySeat[2] = args.autoMoveOnTimeout !== false;
    var started = startMatchIfReady(existing);
    bump(existing);
    if (started) {
      EventDispatcher.emit(existing, 'MATCH_STARTED', -1, { status: existing.status, phase: existing.phase, turnIndex: existing.turnIndex });
      EventDispatcher.emit(existing, 'CARDS_DISTRIBUTED', -1, { seed: existing.seed, deck: existing.deck, hands: existing.hands });
    }
    EventDispatcher.emit(existing, 'TURN_CHANGED', existing.turnIndex, { turnIndex: existing.turnIndex, phase: existing.phase, turnDeadlineMs: existing.turnDeadlineMs });
    runServerTurnChain(existing, existing.revision);
    saveMatch(existing, context);
    appendSyncDebug(existing.matchId, 'findMatch.joinedExisting', {
      playerId: playerId,
      seat: 2,
      revision: existing.revision,
      status: existing.status,
      phase: existing.phase,
      turnIndex: existing.turnIndex
    });
    titleDataSet(waitKey, { matchId: '', ownerPlayFabId: '', gameType: gameType, createdAt: 0 });
    return { matchId: existing.matchId, seat: 2, revision: existing.revision, changed: buildChangedState(beforeExisting, existing) };
  }

  var match = newMatch(gameType, args.playerName, playerId);
  ensureTracking(match);
  match.autoMoveOnTimeoutBySeat[0] = args.autoMoveOnTimeout !== false;
  EventDispatcher.emit(match, 'MATCH_CREATED', -1, { status: match.status, phase: match.phase });
  saveMatch(match, context);
  appendSyncDebug(match.matchId, 'findMatch.createdWaiting', {
    playerId: playerId,
    seat: 0,
    revision: match.revision,
    status: match.status,
    phase: match.phase
  });
  titleDataSet(waitKey, {
    matchId: match.matchId,
    ownerPlayFabId: playerId,
    gameType: gameType,
    createdAt: Date.now()
  });
  return { matchId: match.matchId, seat: 0 };
};

handlers.createMatch = function(args, context) {
  var playerId = getCurrentPlayerId(context);
  var match = newMatch(args.gameType, args.playerName, playerId);
  ensureTracking(match);
  match.autoMoveOnTimeoutBySeat[0] = args.autoMoveOnTimeout !== false;
  EventDispatcher.emit(match, 'MATCH_CREATED', -1, { status: match.status, phase: match.phase });

  setCoins(playerId, getCoins(playerId) - ENTRY_FEE);
  getStats(playerId)[STAT_KEYS.COINS] = getCoins(playerId);
  publishPlayerStats(playerId);

  saveMatch(match, context);
  return { matchId: match.matchId, seat: 0 };
};

handlers.joinMatch = function(args, context) {
  var match = getMatch(args.matchId, context);
  var before = cloneState(match);
  var seat = 2;
  match.players[seat].name = args.playerName || match.players[seat].name;
  bump(match);
  EventDispatcher.emit(match, 'PLAYER_RECONNECTED', seat, { players: match.players });
  saveMatch(match, context);
  return { seat: seat, delta: deltaFor(match, buildChangedState(before, match)) };
};

handlers.submitMove = function(args, context) {
  var match = getMatch(args.matchId, context);
  var before = cloneState(match);
  if (match.status === 'WAITING') {
    return { matchId: match.matchId, revision: match.revision, changed: {}, serverTimeMs: Date.now() };
  }
  if (match.phase !== 'PLAYING') {
    return { matchId: match.matchId, revision: match.revision, changed: {}, serverTimeMs: Date.now() };
  }
  if (args.expectedRevision !== match.revision) return deltaFor(match, match);
  var beforeTrickCount = match.currentTrick.length;
  applyMove(match, args.seat, args.cardId, false);
  bump(match);
  EventDispatcher.emit(match, 'CARD_PLAYED', args.seat, {
    hands: match.hands,
    currentTrick: match.currentTrick,
    turnIndex: match.turnIndex,
    lastCompletedTrick: match.lastCompletedTrick
  });
  if (beforeTrickCount === 3) {
    EventDispatcher.emit(match, 'TRICK_COMPLETED', args.seat, {
      lastCompletedTrick: match.lastCompletedTrick,
      scores: match.scores,
      tricksWon: match.tricksWon
    });
  }
  if (match.status === 'COMPLETED') {
    EventDispatcher.emit(match, 'ROUND_COMPLETED', args.seat, { scores: match.scores, tricksWon: match.tricksWon });
    EventDispatcher.emit(match, 'MATCH_COMPLETED', args.seat, { status: match.status, scores: match.scores });
  } else {
    EventDispatcher.emit(match, 'TURN_CHANGED', match.turnIndex, { turnIndex: match.turnIndex, turnDeadlineMs: match.turnDeadlineMs, phase: match.phase });
  }
  runServerTurnChain(match, match.revision);
  saveMatch(match, context);
  return deltaFor(match, buildChangedState(before, match));
};

handlers.submitPass = function(args, context) {
  var match = getMatch(args.matchId, context);
  var before = cloneState(match);
  if (match.phase !== 'PASSING') throw new Error('Not in passing phase');
  if (args.expectedRevision !== match.revision) return deltaFor(match, match);
  if (args.seat !== match.turnIndex) throw new Error('Not your turn');
  if (isSeatBotOrDisconnected(match, args.seat)) throw new Error('Bot seat cannot submit pass');
  if (!args.cardIds || args.cardIds.length !== 3) throw new Error('Select exactly 3 cards');

  var hand = match.hands[args.seat] || [];
  var i;
  for (i = 0; i < args.cardIds.length; i++) {
    var found = false;
    var j;
    for (j = 0; j < hand.length; j++) {
      if (hand[j].id === args.cardIds[i]) { found = true; break; }
    }
    if (!found) throw new Error('Card not in hand');
  }

  match.passingSelections[args.seat] = args.cardIds.slice();
  match.turnIndex = (match.turnIndex + 1) % 4;
  match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);

  if ((match.passingSelections[0] || []).length === 3 &&
      (match.passingSelections[1] || []).length === 3 &&
      (match.passingSelections[2] || []).length === 3 &&
      (match.passingSelections[3] || []).length === 3) {
    finalizePassing(match);
  }

  bump(match);
  EventDispatcher.emit(match, 'TURN_CHANGED', args.seat, {
    phase: match.phase,
    passingSelections: match.passingSelections,
    turnIndex: match.turnIndex,
    turnDeadlineMs: match.turnDeadlineMs
  });
  runServerTurnChain(match, match.revision);
  saveMatch(match, context);
  return deltaFor(match, buildChangedState(before, match));
};

handlers.submitBid = function(args, context) {
  var match = getMatch(args.matchId, context);
  var before = cloneState(match);
  if (match.phase !== 'BIDDING') throw new Error('Not in bidding phase');
  if (args.expectedRevision !== match.revision) return deltaFor(match, match);
  if (args.seat !== match.turnIndex) throw new Error('Not your turn');
  if (isSeatBotOrDisconnected(match, args.seat)) throw new Error('Bot seat cannot submit bid');
  if (typeof args.bid !== 'number') throw new Error('Bid must be a number');
  if (match.gameType === 'SPADES') {
    if (args.bid < 0 || args.bid > 13) throw new Error('Bid must be between 0 and 13 for Spades');
  } else {
    if (args.bid < 1 || args.bid > 8) throw new Error('Bid must be between 1 and 8');
  }

  match.bids[args.seat] = Math.floor(args.bid);
  if (!finalizeBidding(match)) {
    match.turnIndex = (match.turnIndex + 1) % 4;
    match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
  }

  bump(match);
  EventDispatcher.emit(match, 'BID_SUBMITTED', args.seat, { bids: match.bids, turnIndex: match.turnIndex, phase: match.phase });
  if (match.phase === 'PLAYING') {
    EventDispatcher.emit(match, 'BIDDING_COMPLETED', args.seat, { bids: match.bids, phase: match.phase, turnIndex: match.turnIndex });
  }
  EventDispatcher.emit(match, 'TURN_CHANGED', args.seat, {
    phase: match.phase,
    bids: match.bids,
    turnIndex: match.turnIndex,
    turnDeadlineMs: match.turnDeadlineMs
  });
  runServerTurnChain(match, match.revision);
  saveMatch(match, context);
  return deltaFor(match, buildChangedState(before, match));
};

handlers.getSnapshot = function(args, context) {
  var match = getMatch(args.matchId, context);
  ensureMatchStartedAndPublished(match, context);
  return deltaFor(match, match);
};

handlers.getState = function(args, context) {
  var match = getMatch(args.matchId, context);
  ensureMatchStartedAndPublished(match, context);
  if (args && typeof args.sinceRevision === 'number' && args.sinceRevision >= match.revision) {
    return { matchId: match.matchId, revision: match.revision, changed: {}, serverTimeMs: Date.now() };
  }
  return deltaFor(match, match);
};

handlers.subscribeToMatch = function(args, context) {
  var match = getMatch(args.matchId, context);
  ensureMatchStartedAndPublished(match, context);
  var playerId = getCurrentPlayerId(context);
  var requestedSub = args && args.subscriptionId;
  var subscriptionId = (requestedSub && SubscriptionManager.isActive(match.matchId, requestedSub))
    ? requestedSub
    : SubscriptionManager.subscribe(match.matchId, playerId);
  var sinceEventId = Number((args && args.sinceEventId) || 0);
  var events = EventDispatcher.since(match.matchId, sinceEventId);
  var sinceRevision = Number((args && args.sinceRevision) || 0);
  if (events.length === 0 && sinceRevision < match.revision) {
    events = [{
      eventId: EventDispatcher.latestId(match.matchId),
      type: 'TURN_CHANGED',
      matchId: match.matchId,
      revision: match.revision,
      timestamp: Date.now(),
      actorSeat: typeof match.turnIndex === 'number' ? match.turnIndex : -1,
      payload: cloneState(match)
    }];
  }
  appendSyncDebug(match.matchId, 'subscribeToMatch.return', {
    playerId: playerId,
    subscriptionId: subscriptionId,
    sinceEventId: sinceEventId,
    sinceRevision: sinceRevision,
    returnedEvents: events.length,
    latestEventId: EventDispatcher.latestId(match.matchId),
    matchRevision: match.revision,
    status: match.status,
    phase: match.phase,
    turnIndex: match.turnIndex
  });
  return {
    subscriptionId: subscriptionId,
    latestEventId: EventDispatcher.latestId(match.matchId),
    events: events
  };
};

handlers.getMatchDebug = function(args, context) {
  var match = getMatch(args.matchId, context);
  return {
    matchId: match.matchId,
    revision: match.revision,
    status: match.status,
    phase: match.phase,
    turnIndex: match.turnIndex,
    seat0: match.players[0] && match.players[0].playFabId,
    seat2: match.players[2] && match.players[2].playFabId,
    latestEventId: EventDispatcher.latestId(match.matchId),
    debug: titleDataGet('debug_match_' + args.matchId) || []
  };
};

handlers.unsubscribeFromMatch = function(args) {
  SubscriptionManager.unsubscribe(args.matchId, args.subscriptionId);
  return { ok: true };
};

handlers.timeoutMove = function(args, context) {
  var match = getMatch(args.matchId, context);
  var before = cloneState(match);
  if (Date.now() < match.turnDeadlineMs) {
    return { matchId: match.matchId, revision: match.revision, changed: {}, serverTimeMs: Date.now() };
  }
  var turnSeat = match.turnIndex;
  var isHumanTurn = !isSeatBotOrDisconnected(match, turnSeat);
  if (isHumanTurn && match.gameType === 'CALLBREAK' && match.autoMoveOnTimeoutBySeat[turnSeat] === false) {
    match.players[turnSeat].disconnected = true;
    match.players[turnSeat].disconnectedAt = Date.now();
    bump(match);
    EventDispatcher.emit(match, 'PLAYER_DISCONNECTED', turnSeat, { players: match.players, turnIndex: match.turnIndex });
    runServerTurnChain(match, match.revision);
  } else {
    var beforeTrickCount = match.currentTrick.length;
    var timeoutCard = chooseBotCard(match, turnSeat);
    applyMove(match, turnSeat, timeoutCard, true);
    bump(match);
    EventDispatcher.emit(match, 'CARD_PLAYED', turnSeat, {
      hands: match.hands,
      currentTrick: match.currentTrick,
      turnIndex: match.turnIndex,
      lastCompletedTrick: match.lastCompletedTrick
    });
    if (beforeTrickCount === 3) {
      EventDispatcher.emit(match, 'TRICK_COMPLETED', turnSeat, {
        lastCompletedTrick: match.lastCompletedTrick,
        scores: match.scores,
        tricksWon: match.tricksWon
      });
    }
    if (match.status === 'COMPLETED') {
      EventDispatcher.emit(match, 'ROUND_COMPLETED', turnSeat, { scores: match.scores, tricksWon: match.tricksWon });
      EventDispatcher.emit(match, 'MATCH_COMPLETED', turnSeat, { status: match.status, scores: match.scores });
    } else {
      EventDispatcher.emit(match, 'TURN_CHANGED', match.turnIndex, { turnIndex: match.turnIndex, turnDeadlineMs: match.turnDeadlineMs, phase: match.phase });
    }
    runServerTurnChain(match, match.revision);
  }
  saveMatch(match, context);
  return deltaFor(match, buildChangedState(before, match));
};

handlers.markDisconnected = function(args, context) {
  var match = getMatch(args.matchId, context);
  var before = cloneState(match);
  var seat = Number(args.seat || 0);
  match.players[seat].disconnected = true;
  match.players[seat].disconnectedAt = Date.now();
  bump(match);
  EventDispatcher.emit(match, 'PLAYER_DISCONNECTED', seat, { players: match.players, turnIndex: match.turnIndex });
  runServerTurnChain(match, match.revision);
  saveMatch(match, context);
  return { ok: true, reconnectWindowMs: RECONNECT_WINDOW_MS, delta: deltaFor(match, buildChangedState(before, match)) };
};

handlers.reconnect = function(args, context) {
  var match = getMatch(args.matchId, context);
  var before = cloneState(match);
  var seat = 0;
  var i;
  for (i = 0; i < match.players.length; i++) {
    if (match.players[i].playFabId === args.playFabId) {
      seat = match.players[i].seat;
      break;
    }
  }

  var disconnectedAt = match.players[seat].disconnectedAt || 0;
  if (disconnectedAt && Date.now() - disconnectedAt > RECONNECT_WINDOW_MS) {
    throw new Error('Reconnect window expired');
  }

  match.players[seat].disconnected = false;
  delete match.players[seat].disconnectedAt;
  bump(match);
  EventDispatcher.emit(match, 'PLAYER_RECONNECTED', seat, { players: match.players, turnIndex: match.turnIndex });
  saveMatch(match, context);
  return { seat: seat, delta: deltaFor(match, buildChangedState(before, match)) };
};

handlers.updateCoins = function(args) {
  var coins = setCoins(args.playFabId, getCoins(args.playFabId) + args.delta);
  getStats(args.playFabId)[STAT_KEYS.COINS] = coins;
  publishPlayerStats(args.playFabId);
  return { coins: coins, currencyId: DEFAULT_CURRENCY_ID };
};

handlers.endMatch = function(args, context) {
  var match = getMatch(args.matchId, context);
  var before = cloneState(match);
  match.status = 'COMPLETED';
  bump(match);
  EventDispatcher.emit(match, 'MATCH_COMPLETED', -1, { status: match.status, scores: match.scores, tricksWon: match.tricksWon });

  var standings = [0, 1, 2, 3]
    .map(function(seat) { return { seat: seat, score: match.scores[seat] || 0 }; })
    .sort(function(a, b) { return b.score - a.score; })
    .map(function(row, idx) { return { seat: row.seat, score: row.score, rank: idx + 1 }; });

  var rewards = standings.map(function(row) {
    return { seat: row.seat, coinsDelta: REWARDS[row.rank] - ENTRY_FEE };
  });

  rewards.forEach(function(reward) {
    var p = match.players[reward.seat];
    var next = getCoins(p.playFabId) + reward.coinsDelta;
    setCoins(p.playFabId, next);

    var standing = standings.find(function(s) { return s.seat === reward.seat; });
    updatePostMatchStats(match.gameType, p, standing.rank, standing.score, next);
  });

  cache.leaderboard[match.matchId] = standings;
  titleDataSet('leaderboard_' + match.matchId, standings);
  saveMatch(match, context);

  return { standings: standings, rewards: rewards, currencyId: DEFAULT_CURRENCY_ID, delta: deltaFor(match, buildChangedState(before, match)) };
};

// Exported by naming convention: handlers.<functionName>
