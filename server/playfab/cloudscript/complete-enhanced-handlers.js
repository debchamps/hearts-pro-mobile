// PlayFab Classic CloudScript - Enhanced with Proper Phase Management
// Deploy this file to PlayFab CloudScript

var STARTING_COINS = 1000;
var ENTRY_FEE = 50;
var REWARDS = { 1: 100, 2: 75, 3: 25, 4: 0 };
var HUMAN_TIMEOUT_MS = 9000;
var BOT_TIMEOUT_MS = 900;
var CALLBREAK_HUMAN_TIMEOUT_EXTRA_MS = 5000;
var PASSING_TIMEOUT_MS = 15000;
var BIDDING_TIMEOUT_MS = 12000;
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

// Essential PlayFab functions
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

function cloneState(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Enhanced Event System
var EventDispatcher = {
  getStream: function(matchId) {
    if (!cache.events[matchId]) {
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

function bump(match) {
  match.revision += 1;
  match.serverTimeMs = Date.now();
  return match;
}

function deltaFor(match) {
  return {
    matchId: match.matchId,
    revision: match.revision,
    changed: match,
    serverTimeMs: Date.now()
  };
}

// Enhanced Match Creation with Phase Support
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
    bids: { 0: null, 1: null, 2: null, 3: null },
    roundNumber: 1,
    status: 'WAITING',
    phase: 'WAITING',
    // Enhanced phase management
    phaseData: {
      passingSelections: { 0: [], 1: [], 2: [], 3: [] },
      passingDirection: 'LEFT',
      passingComplete: { 0: false, 1: false, 2: false, 3: false },
      biddingComplete: { 0: false, 1: false, 2: false, 3: false },
      currentPhaseStartTime: now
    },
    heartsBroken: false,
    spadesBroken: false,
    playedBySuit: { CLUBS: 0, DIAMONDS: 0, HEARTS: 0, SPADES: 0 },
    playedCardIds: {},
    autoMoveOnTimeoutBySeat: { 0: true, 1: true, 2: true, 3: true },
    turnDeadlineMs: now + HUMAN_TIMEOUT_MS,
    serverTimeMs: now
  };
}

function isRealHumanPlayerId(playFabId) {
  return playFabId && playFabId !== 'PENDING_HUMAN' && !playFabId.startsWith('BOT_');
}

function startMatchIfReady(match) {
  if (match.status !== 'WAITING') return false;
  var seat2Ready = isRealHumanPlayerId(match.players[2].playFabId);
  if (!seat2Ready) return false;

  // Initialize game based on type
  if (match.gameType === 'HEARTS') {
    match.phase = 'PASSING';
    initializePassingPhase(match);
  } else if (match.gameType === 'SPADES' || match.gameType === 'CALLBREAK') {
    match.phase = 'BIDDING';
    initializeBiddingPhase(match);
  } else {
    match.phase = 'PLAYING';
  }
  
  match.status = 'PLAYING';
  return true;
}

// Phase Management Functions
function initializePassingPhase(match) {
  match.phaseData.passingSelections = { 0: [], 1: [], 2: [], 3: [] };
  match.phaseData.passingComplete = { 0: false, 1: false, 2: false, 3: false };
  match.phaseData.passingDirection = getPassingDirection(match.roundNumber);
  match.turnIndex = 0;
  match.turnDeadlineMs = Date.now() + PASSING_TIMEOUT_MS;
  
  // Auto-pass for bots
  for (var seat = 0; seat < 4; seat++) {
    if (match.players[seat].isBot) {
      autoSelectPassingCards(match, seat);
      match.phaseData.passingComplete[seat] = true;
    }
  }
  
  EventDispatcher.emit(match, 'PASSING_STARTED', -1, {
    passingDirection: match.phaseData.passingDirection,
    timeoutMs: PASSING_TIMEOUT_MS
  });
}

function getPassingDirection(roundNumber) {
  var cycle = (roundNumber - 1) % 4;
  return ['LEFT', 'RIGHT', 'ACROSS', 'NONE'][cycle];
}

function autoSelectPassingCards(match, seat) {
  var hand = match.hands[seat] || [];
  var sorted = hand.slice().sort(function(a, b) {
    if (a.id === 'Q-SPADES') return -1;
    if (b.id === 'Q-SPADES') return 1;
    if (a.suit === 'HEARTS' && b.suit !== 'HEARTS') return -1;
    if (b.suit === 'HEARTS' && a.suit !== 'HEARTS') return 1;
    return b.value - a.value;
  });
  
  match.phaseData.passingSelections[seat] = sorted.slice(0, 3).map(function(c) { return c.id; });
}

function initializeBiddingPhase(match) {
  match.bids = { 0: null, 1: null, 2: null, 3: null };
  match.phaseData.biddingComplete = { 0: false, 1: false, 2: false, 3: false };
  match.turnIndex = 0;
  match.turnDeadlineMs = Date.now() + BIDDING_TIMEOUT_MS;
  
  EventDispatcher.emit(match, 'BIDDING_STARTED', -1, {
    startingSeat: match.turnIndex,
    timeoutMs: BIDDING_TIMEOUT_MS
  });
}

function isPassingComplete(match) {
  if (match.phaseData.passingDirection === 'NONE') return true;
  return match.phaseData.passingComplete[0] && match.phaseData.passingComplete[1] && 
         match.phaseData.passingComplete[2] && match.phaseData.passingComplete[3];
}

function isBiddingComplete(match) {
  return match.phaseData.biddingComplete[0] && match.phaseData.biddingComplete[1] && 
         match.phaseData.biddingComplete[2] && match.phaseData.biddingComplete[3];
}

// Main Handler Functions - These are called by the client
function findMatch(args) {
  var gameType = args.gameType;
  var playerId = getCurrentPlayerId(currentPlayerId);
  var queueKey = gameType + '_WAITING';
  var waiting = cache.lobbies[queueKey];

  if (waiting && waiting.ownerPlayFabId !== playerId) {
    var existing = cache.matches[waiting.matchId];
    if (existing) {
      existing.players[2] = {
        seat: 2,
        playFabId: playerId,
        name: args.playerName || 'OPPONENT',
        isBot: false,
        disconnected: false,
        pingMs: 57,
        rankBadge: 'Rookie',
        coins: STARTING_COINS
      };
      
      // Start the match if ready
      if (startMatchIfReady(existing)) {
        bump(existing);
        EventDispatcher.emit(existing, 'MATCH_STARTED', -1, existing);
      }
      
      delete cache.lobbies[queueKey];
      return { matchId: existing.matchId, seat: 2 };
    }
  }

  var match = newMatch(gameType, args.playerName, playerId);
  cache.matches[match.matchId] = match;
  cache.lobbies[queueKey] = {
    ownerPlayFabId: playerId,
    matchId: match.matchId,
    createdAt: Date.now()
  };
  
  EventDispatcher.emit(match, 'MATCH_CREATED', -1, { status: match.status });
  return { matchId: match.matchId, seat: 0 };
}

function createMatch(args) {
  var playerId = getCurrentPlayerId(currentPlayerId);
  var match = newMatch(args.gameType, args.playerName, playerId);
  cache.matches[match.matchId] = match;
  EventDispatcher.emit(match, 'MATCH_CREATED', -1, { status: match.status });
  return { matchId: match.matchId, seat: 0 };
}

function joinMatch(args) {
  var match = cache.matches[args.matchId];
  if (!match) throw new Error('Match not found');
  
  var seat = 2;
  match.players[seat].name = args.playerName || match.players[seat].name;
  match.players[seat].playFabId = getCurrentPlayerId(currentPlayerId);
  match.players[seat].isBot = false;
  
  if (startMatchIfReady(match)) {
    bump(match);
    EventDispatcher.emit(match, 'MATCH_STARTED', -1, match);
  }
  
  return { seat: seat };
}

function getSnapshot(args) {
  var match = cache.matches[args.matchId];
  if (!match) throw new Error('Match not found');
  return deltaFor(match);
}

// Enhanced Move Submission with Phase Support
function submitMove(args) {
  var match = cache.matches[args.matchId];
  if (!match) throw new Error('Match not found');
  if (args.expectedRevision !== match.revision) throw new Error('Revision mismatch');
  
  switch (match.phase) {
    case 'PLAYING':
      return submitPlayingMove(match, args);
    default:
      throw new Error('Invalid phase for move submission: ' + match.phase);
  }
}

function submitPass(args) {
  var match = cache.matches[args.matchId];
  if (!match) throw new Error('Match not found');
  if (match.gameType !== 'HEARTS') throw new Error('Passing only available in Hearts');
  if (match.phase !== 'PASSING') throw new Error('Not in passing phase');
  if (args.expectedRevision !== match.revision) throw new Error('Revision mismatch');
  
  var seat = args.seat;
  var cardIds = args.cardIds || [];
  
  if (cardIds.length !== 3) throw new Error('Must pass exactly 3 cards');
  
  match.phaseData.passingSelections[seat] = cardIds;
  match.phaseData.passingComplete[seat] = true;
  
  bump(match);
  EventDispatcher.emit(match, 'CARDS_PASSED', seat, {
    seat: seat,
    cardCount: cardIds.length,
    passingComplete: match.phaseData.passingComplete
  });
  
  // Check if passing phase is complete
  if (isPassingComplete(match)) {
    finalizePassingPhase(match);
    match.phase = 'PLAYING';
    EventDispatcher.emit(match, 'PHASE_CHANGED', -1, { 
      previousPhase: 'PASSING', 
      currentPhase: 'PLAYING'
    });
  }
  
  return deltaFor(match);
}

function submitBid(args) {
  var match = cache.matches[args.matchId];
  if (!match) throw new Error('Match not found');
  if (match.gameType !== 'SPADES' && match.gameType !== 'CALLBREAK') {
    throw new Error('Bidding only available in Spades and Callbreak');
  }
  if (match.phase !== 'BIDDING') throw new Error('Not in bidding phase');
  if (args.expectedRevision !== match.revision) throw new Error('Revision mismatch');
  
  var seat = args.seat;
  var bid = args.bid;
  
  if (match.turnIndex !== seat) throw new Error('Not your turn to bid');
  
  // Validate bid range
  var minBid = match.gameType === 'CALLBREAK' ? 1 : 0;
  var maxBid = match.gameType === 'CALLBREAK' ? 8 : 13;
  
  if (bid < minBid || bid > maxBid) {
    throw new Error('Bid must be between ' + minBid + ' and ' + maxBid);
  }
  
  match.bids[seat] = bid;
  match.phaseData.biddingComplete[seat] = true;
  
  // Advance to next bidder
  match.turnIndex = (match.turnIndex + 1) % 4;
  match.turnDeadlineMs = Date.now() + BIDDING_TIMEOUT_MS;
  
  bump(match);
  EventDispatcher.emit(match, 'BID_SUBMITTED', seat, {
    seat: seat,
    bid: bid,
    nextTurn: match.turnIndex,
    bids: match.bids
  });
  
  // Check if bidding phase is complete
  if (isBiddingComplete(match)) {
    match.phase = 'PLAYING';
    match.turnIndex = 0;
    EventDispatcher.emit(match, 'BIDDING_COMPLETED', -1, { bids: match.bids });
    EventDispatcher.emit(match, 'PHASE_CHANGED', -1, { 
      previousPhase: 'BIDDING', 
      currentPhase: 'PLAYING'
    });
  }
  
  return deltaFor(match);
}

function submitPlayingMove(match, args) {
  if (match.turnIndex !== args.seat) throw new Error('Not your turn');
  
  // Simple card play logic for now
  match.currentTrick.push({ seat: args.seat, card: { id: args.cardId, suit: 'CLUBS', rank: '2', value: 2, points: 0 } });
  match.turnIndex = (match.turnIndex + 1) % 4;
  match.turnDeadlineMs = Date.now() + HUMAN_TIMEOUT_MS;
  
  bump(match);
  EventDispatcher.emit(match, 'CARD_PLAYED', args.seat, match);
  return deltaFor(match);
}

function finalizePassingPhase(match) {
  // Simple passing logic - just clear selections for now
  match.phaseData.passingSelections = { 0: [], 1: [], 2: [], 3: [] };
  match.turnIndex = 0;
  EventDispatcher.emit(match, 'PASSING_COMPLETED', -1, {
    direction: match.phaseData.passingDirection
  });
}

function subscribeToMatch(args) {
  var match = cache.matches[args.matchId];
  if (!match) throw new Error('Match not found');
  
  var stream = EventDispatcher.getStream(match.matchId);
  var subscriptionId = args.subscriptionId || randomId('sub');
  var sinceEventId = Number(args.sinceEventId || 0);
  var events = EventDispatcher.since(match.matchId, sinceEventId);
  
  return {
    subscriptionId: subscriptionId,
    events: events,
    latestEventId: EventDispatcher.latestId(match.matchId)
  };
}

function unsubscribeFromMatch(args) {
  return { ok: true };
}

function timeoutMove(args) {
  var match = cache.matches[args.matchId];
  if (!match) throw new Error('Match not found');
  
  if (Date.now() < match.turnDeadlineMs) {
    return deltaFor(match);
  }
  
  switch (match.phase) {
    case 'PASSING':
      return timeoutPassingMove(match);
    case 'BIDDING':
      return timeoutBiddingMove(match);
    case 'PLAYING':
      return timeoutPlayingMove(match);
    default:
      return deltaFor(match);
  }
}

function timeoutPassingMove(match) {
  // Auto-complete passing for any incomplete players
  for (var seat = 0; seat < 4; seat++) {
    if (!match.phaseData.passingComplete[seat]) {
      autoSelectPassingCards(match, seat);
      match.phaseData.passingComplete[seat] = true;
    }
  }
  
  finalizePassingPhase(match);
  match.phase = 'PLAYING';
  bump(match);
  return deltaFor(match);
}

function timeoutBiddingMove(match) {
  var seat = match.turnIndex;
  
  if (!match.phaseData.biddingComplete[seat]) {
    var autoBid = match.gameType === 'CALLBREAK' ? 1 : 0;
    match.bids[seat] = autoBid;
    match.phaseData.biddingComplete[seat] = true;
    
    EventDispatcher.emit(match, 'BID_TIMEOUT', seat, {
      seat: seat,
      bid: autoBid,
      auto: true
    });
  }
  
  match.turnIndex = (match.turnIndex + 1) % 4;
  match.turnDeadlineMs = Date.now() + BIDDING_TIMEOUT_MS;
  
  if (isBiddingComplete(match)) {
    match.phase = 'PLAYING';
    match.turnIndex = 0;
  }
  
  bump(match);
  return deltaFor(match);
}

function timeoutPlayingMove(match) {
  // Simple timeout - just play a dummy card
  match.currentTrick.push({ seat: match.turnIndex, card: { id: '2-CLUBS', suit: 'CLUBS', rank: '2', value: 2, points: 0 } });
  match.turnIndex = (match.turnIndex + 1) % 4;
  match.turnDeadlineMs = Date.now() + HUMAN_TIMEOUT_MS;
  bump(match);
  return deltaFor(match);
}

function endMatch(args) {
  var match = cache.matches[args.matchId];
  if (!match) throw new Error('Match not found');
  
  match.status = 'COMPLETED';
  bump(match);
  
  var standings = [
    { seat: 0, score: 100, rank: 1 },
    { seat: 1, score: 75, rank: 2 },
    { seat: 2, score: 50, rank: 3 },
    { seat: 3, score: 25, rank: 4 }
  ];
  
  var rewards = [
    { seat: 0, coinsDelta: 50 },
    { seat: 1, coinsDelta: 25 },
    { seat: 2, coinsDelta: -25 },
    { seat: 3, coinsDelta: -50 }
  ];
  
  return { standings: standings, rewards: rewards };
}