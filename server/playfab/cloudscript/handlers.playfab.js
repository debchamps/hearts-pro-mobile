// PlayFab Classic CloudScript (deploy this file)
// Title: EF824

var STARTING_COINS = 1000;
var ENTRY_FEE = 50;
var REWARDS = { 1: 100, 2: 75, 3: 25, 4: 0 };
var HUMAN_TIMEOUT_MS = 9000;
var BOT_TIMEOUT_MS = 900;
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

var cache = {
  matches: {},
  lobbies: {},
  coins: {},
  stats: {},
  leaderboard: {}
};

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
    roundNumber: 1,
    status: 'WAITING',
    phase: 'WAITING',
    passingSelections: { 0: [], 1: [], 2: [], 3: [] },
    passingDirection: 'LEFT',
    turnDeadlineMs: now + HUMAN_TIMEOUT_MS,
    serverTimeMs: now
  };
}

function getTurnTimeout(match, seat) {
  var p = match.players[seat];
  if (!p) return HUMAN_TIMEOUT_MS;
  var isBotTurn = !!p.isBot || !!p.disconnected;
  return isBotTurn ? BOT_TIMEOUT_MS : HUMAN_TIMEOUT_MS;
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
    match.hands[seat] = deck.slice(seat * 13, seat * 13 + 13);
  }
  match.seed = seed;
  match.deck = deck;
  match.currentTrick = [];
  match.leadSuit = null;
  match.turnIndex = 0;
  match.trickLeaderIndex = 0;
  match.passingSelections = { 0: [], 1: [], 2: [], 3: [] };
  match.bids = { 0: null, 1: null, 2: null, 3: null };
  if (match.gameType === 'HEARTS') {
    match.phase = 'PASSING';
  } else if (match.gameType === 'CALLBREAK') {
    match.phase = 'BIDDING';
  } else {
    match.phase = 'PLAYING';
  }
  match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
  match.status = 'PLAYING';
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
    match.hands[seat] = (match.hands[seat] || []).sort(function(a, b) {
      if (a.suit === b.suit) return a.value - b.value;
      return String(a.suit).localeCompare(String(b.suit));
    });
  }
  match.passingSelections = { 0: [], 1: [], 2: [], 3: [] };
  match.phase = 'PLAYING';
  match.turnIndex = 0;
  match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
}

function autoBid(match, seat) {
  var hand = match.hands[seat] || [];
  var high = hand.filter(function(c) { return c.value >= 11; }).length;
  var bid = Math.max(1, Math.min(8, Math.round(high / 2)));
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
  var hand = match.hands[seat] || [];
  if (hand.length > 0) return hand[0];
  return { id: '2-CLUBS', suit: 'CLUBS', rank: '2', value: 2, points: 0 };
}

function applyMove(match, seat, cardId, allowFallback) {
  if (match.status !== 'PLAYING') throw new Error('Match not active');
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

function runServerTurn(match) {
  if (match.status !== 'PLAYING') return false;
  if (!match.phase) match.phase = 'PLAYING';
  if (Date.now() < match.turnDeadlineMs) return false;
  if (match.phase === 'PASSING') {
    if (!isSeatBotOrDisconnected(match, match.turnIndex)) return false;
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
    return true;
  }

  if (match.phase === 'BIDDING') {
    if (!isSeatBotOrDisconnected(match, match.turnIndex)) return false;
    autoBid(match, match.turnIndex);
    if (!finalizeBidding(match)) {
      match.turnIndex = (match.turnIndex + 1) % 4;
      match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
    }
    return true;
  }

  applyMove(match, match.turnIndex, '', true);
  return true;
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
  saveMatchForPlayer(ownerId, match);
  // Mirror state to all human seats so both clients can read consistently.
  var i;
  for (i = 0; i < match.players.length; i++) {
    saveMatchForPlayer(match.players[i].playFabId, match);
  }
  // best-effort backup only
  titleDataSet('match_' + match.matchId, match);
}

function getMatch(matchId, context) {
  if (cache.matches[matchId]) return cache.matches[matchId];
  var pid = getCurrentPlayerId(context);
  try {
    var ud = server.GetUserReadOnlyData({ PlayFabId: pid, Keys: ['match_' + matchId] });
    var raw = ud && ud.Data && ud.Data['match_' + matchId] && ud.Data['match_' + matchId].Value;
    if (raw) {
      var parsed = JSON.parse(raw);
      cache.matches[matchId] = parsed;
      return parsed;
    }
  } catch (e) {}

  var loaded = titleDataGet('match_' + matchId);
  if (loaded) {
    cache.matches[matchId] = loaded;
    return loaded;
  }
  throw new Error('Match not found');
}

function bump(match) {
  match.revision += 1;
  match.serverTimeMs = Date.now();
}

function deltaFor(match) {
  return {
    matchId: match.matchId,
    revision: match.revision,
    changed: match,
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
  if (waiting && waiting.matchId && waiting.ownerPlayFabId && waiting.ownerPlayFabId !== playerId) {
    var existing = getMatch(waiting.matchId, context);
    existing.players[2].playFabId = playerId;
    existing.players[2].name = args.playerName || 'OPPONENT';
    existing.players[2].isBot = false;
    existing.players[2].rankBadge = 'Rookie';
    existing.players[2].pingMs = 57;
    startMatchIfReady(existing);
    bump(existing);
    saveMatch(existing, context);
    titleDataSet(waitKey, { matchId: '', ownerPlayFabId: '', gameType: gameType, createdAt: 0 });
    return { matchId: existing.matchId, seat: 2 };
  }

  var match = newMatch(gameType, args.playerName, playerId);
  saveMatch(match, context);
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

  setCoins(playerId, getCoins(playerId) - ENTRY_FEE);
  getStats(playerId)[STAT_KEYS.COINS] = getCoins(playerId);
  publishPlayerStats(playerId);

  saveMatch(match, context);
  return { matchId: match.matchId, seat: 0 };
};

handlers.joinMatch = function(args, context) {
  var match = getMatch(args.matchId, context);
  var seat = 2;
  match.players[seat].name = args.playerName || match.players[seat].name;
  bump(match);
  saveMatch(match, context);
  return { seat: seat };
};

handlers.submitMove = function(args, context) {
  var match = getMatch(args.matchId, context);
  if (match.status === 'WAITING') throw new Error('Waiting for second player');
  if (match.phase !== 'PLAYING') throw new Error('Round setup in progress');
  if (args.expectedRevision !== match.revision) throw new Error('Revision mismatch');
  applyMove(match, args.seat, args.cardId, false);
  bump(match);
  saveMatch(match, context);
  return deltaFor(match);
};

handlers.submitPass = function(args, context) {
  var match = getMatch(args.matchId, context);
  if (match.phase !== 'PASSING') throw new Error('Not in passing phase');
  if (args.expectedRevision !== match.revision) throw new Error('Revision mismatch');
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

  while (isSeatBotOrDisconnected(match, match.turnIndex) && (match.passingSelections[match.turnIndex] || []).length < 3) {
    autoSelectPass(match, match.turnIndex);
    match.turnIndex = (match.turnIndex + 1) % 4;
    match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
  }

  if ((match.passingSelections[0] || []).length === 3 &&
      (match.passingSelections[1] || []).length === 3 &&
      (match.passingSelections[2] || []).length === 3 &&
      (match.passingSelections[3] || []).length === 3) {
    finalizePassing(match);
  }

  bump(match);
  saveMatch(match, context);
  return deltaFor(match);
};

handlers.submitBid = function(args, context) {
  var match = getMatch(args.matchId, context);
  if (match.phase !== 'BIDDING') throw new Error('Not in bidding phase');
  if (args.expectedRevision !== match.revision) throw new Error('Revision mismatch');
  if (args.seat !== match.turnIndex) throw new Error('Not your turn');
  if (isSeatBotOrDisconnected(match, args.seat)) throw new Error('Bot seat cannot submit bid');
  if (typeof args.bid !== 'number' || args.bid < 1 || args.bid > 8) throw new Error('Bid must be between 1 and 8');

  match.bids[args.seat] = Math.floor(args.bid);
  if (!finalizeBidding(match)) {
    match.turnIndex = (match.turnIndex + 1) % 4;
    match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
    while (isSeatBotOrDisconnected(match, match.turnIndex) && (match.bids[match.turnIndex] === null || match.bids[match.turnIndex] === undefined)) {
      autoBid(match, match.turnIndex);
      if (finalizeBidding(match)) break;
      match.turnIndex = (match.turnIndex + 1) % 4;
      match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
    }
  }

  bump(match);
  saveMatch(match, context);
  return deltaFor(match);
};

handlers.getState = function(args, context) {
  var match = getMatch(args.matchId, context);
  // Process at most one server-side move per poll so clients can render each move animation.
  var changed = runServerTurn(match);
  if (changed) {
    bump(match);
    saveMatch(match, context);
  }
  if (args.sinceRevision >= match.revision) {
    return { matchId: match.matchId, revision: match.revision, changed: {}, serverTimeMs: Date.now() };
  }
  return deltaFor(match);
};

handlers.timeoutMove = function(args, context) {
  var match = getMatch(args.matchId, context);
  if (Date.now() < match.turnDeadlineMs) {
    return { matchId: match.matchId, revision: match.revision, changed: {}, serverTimeMs: Date.now() };
  }
  applyMove(match, match.turnIndex, '', true);
  bump(match);
  saveMatch(match, context);
  return deltaFor(match);
};

handlers.markDisconnected = function(args, context) {
  var match = getMatch(args.matchId, context);
  var seat = Number(args.seat || 0);
  match.players[seat].disconnected = true;
  match.players[seat].disconnectedAt = Date.now();
  bump(match);
  saveMatch(match, context);
  return { ok: true, reconnectWindowMs: RECONNECT_WINDOW_MS };
};

handlers.reconnect = function(args, context) {
  var match = getMatch(args.matchId, context);
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
  saveMatch(match, context);
  return { seat: seat, delta: deltaFor(match) };
};

handlers.updateCoins = function(args) {
  var coins = setCoins(args.playFabId, getCoins(args.playFabId) + args.delta);
  getStats(args.playFabId)[STAT_KEYS.COINS] = coins;
  publishPlayerStats(args.playFabId);
  return { coins: coins, currencyId: DEFAULT_CURRENCY_ID };
};

handlers.endMatch = function(args, context) {
  var match = getMatch(args.matchId, context);
  match.status = 'COMPLETED';
  bump(match);

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

  return { standings: standings, rewards: rewards, currencyId: DEFAULT_CURRENCY_ID };
};

// Exported by naming convention: handlers.<functionName>
