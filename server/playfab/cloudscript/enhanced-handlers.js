// Enhanced PlayFab CloudScript Handlers with Proper Phase Management
// This file contains the fixes for online game flow issues

const STARTING_COINS = 1000;
const ENTRY_FEE = 50;
const REWARDS = { 1: 100, 2: 75, 3: 25, 4: 0 };
const HUMAN_TIMEOUT_MS = 9000;
const BOT_TIMEOUT_MS = 900;
const CALLBREAK_HUMAN_TIMEOUT_EXTRA_MS = 5000;
const PASSING_TIMEOUT_MS = 15000;
const BIDDING_TIMEOUT_MS = 12000;

// Enhanced state management with proper phase tracking
function createEnhancedMatch(gameType, playerName, playerId) {
  const now = Date.now();
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

// Enhanced phase transition logic
function transitionToNextPhase(match) {
  const prevPhase = match.phase;
  
  switch (match.phase) {
    case 'WAITING':
      if (isMatchReadyToStart(match)) {
        if (match.gameType === 'HEARTS') {
          match.phase = 'PASSING';
          initializePassingPhase(match);
        } else if (match.gameType === 'SPADES' || match.gameType === 'CALLBREAK') {
          match.phase = 'BIDDING';
          initializeBiddingPhase(match);
        } else {
          match.phase = 'PLAYING';
          initializePlayingPhase(match);
        }
      }
      break;
      
    case 'PASSING':
      if (isPassingComplete(match)) {
        finalizePassingPhase(match);
        match.phase = 'PLAYING';
        initializePlayingPhase(match);
      }
      break;
      
    case 'BIDDING':
      if (isBiddingComplete(match)) {
        finalizeBiddingPhase(match);
        match.phase = 'PLAYING';
        initializePlayingPhase(match);
      }
      break;
      
    case 'PLAYING':
      if (isRoundComplete(match)) {
        if (isGameComplete(match)) {
          match.phase = 'COMPLETED';
          match.status = 'COMPLETED';
        } else {
          // Start next round
          startNextRound(match);
        }
      }
      break;
  }
  
  if (prevPhase !== match.phase) {
    match.phaseData.currentPhaseStartTime = Date.now();
    EventDispatcher.emit(match, 'PHASE_CHANGED', -1, { 
      previousPhase: prevPhase, 
      currentPhase: match.phase,
      phaseData: match.phaseData 
    });
  }
}

// Hearts passing phase management
function initializePassingPhase(match) {
  match.phaseData.passingSelections = { 0: [], 1: [], 2: [], 3: [] };
  match.phaseData.passingComplete = { 0: false, 1: false, 2: false, 3: false };
  match.phaseData.passingDirection = getPassingDirection(match.roundNumber);
  match.turnIndex = 0; // Start with player 0 for passing
  match.turnDeadlineMs = Date.now() + PASSING_TIMEOUT_MS;
  
  // Auto-pass for bots
  for (let seat = 0; seat < 4; seat++) {
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
  const cycle = (roundNumber - 1) % 4;
  return ['LEFT', 'RIGHT', 'ACROSS', 'NONE'][cycle];
}

function autoSelectPassingCards(match, seat) {
  const hand = match.hands[seat] || [];
  // Select 3 highest cards, prioritizing dangerous cards
  const sorted = hand.slice().sort((a, b) => {
    // Prioritize Queen of Spades and high hearts
    if (a.id === 'Q-SPADES') return -1;
    if (b.id === 'Q-SPADES') return 1;
    if (a.suit === 'HEARTS' && b.suit !== 'HEARTS') return -1;
    if (b.suit === 'HEARTS' && a.suit !== 'HEARTS') return 1;
    return b.value - a.value;
  });
  
  match.phaseData.passingSelections[seat] = sorted.slice(0, 3).map(c => c.id);
}

function isPassingComplete(match) {
  if (match.phaseData.passingDirection === 'NONE') return true;
  return Object.values(match.phaseData.passingComplete).every(complete => complete);
}

function finalizePassingPhase(match) {
  if (match.phaseData.passingDirection === 'NONE') return;
  
  const direction = match.phaseData.passingDirection;
  const passes = { 0: [], 1: [], 2: [], 3: [] };
  
  // Collect passed cards
  for (let seat = 0; seat < 4; seat++) {
    const selectedIds = match.phaseData.passingSelections[seat] || [];
    const hand = match.hands[seat] || [];
    passes[seat] = selectedIds.map(id => hand.find(c => c.id === id)).filter(Boolean);
    
    // Remove passed cards from hand
    match.hands[seat] = hand.filter(c => !selectedIds.includes(c.id));
  }
  
  // Distribute passed cards
  for (let seat = 0; seat < 4; seat++) {
    let targetSeat;
    switch (direction) {
      case 'LEFT': targetSeat = (seat + 1) % 4; break;
      case 'RIGHT': targetSeat = (seat + 3) % 4; break;
      case 'ACROSS': targetSeat = (seat + 2) % 4; break;
      default: continue;
    }
    
    match.hands[targetSeat] = [...(match.hands[targetSeat] || []), ...(passes[seat] || [])];
  }
  
  // Re-sort all hands
  for (let seat = 0; seat < 4; seat++) {
    match.hands[seat] = sortHandCards(match.hands[seat] || []);
  }
  
  EventDispatcher.emit(match, 'PASSING_COMPLETED', -1, {
    direction: direction,
    hands: match.hands
  });
}

// Bidding phase management
function initializeBiddingPhase(match) {
  match.bids = { 0: null, 1: null, 2: null, 3: null };
  match.phaseData.biddingComplete = { 0: false, 1: false, 2: false, 3: false };
  match.turnIndex = (match.dealerIndex + 1) % 4 || 0;
  match.turnDeadlineMs = Date.now() + BIDDING_TIMEOUT_MS;
  
  EventDispatcher.emit(match, 'BIDDING_STARTED', -1, {
    startingSeat: match.turnIndex,
    timeoutMs: BIDDING_TIMEOUT_MS
  });
}

function isBiddingComplete(match) {
  return Object.values(match.phaseData.biddingComplete).every(complete => complete);
}

function finalizeBiddingPhase(match) {
  EventDispatcher.emit(match, 'BIDDING_COMPLETED', -1, {
    bids: match.bids,
    totalBid: Object.values(match.bids).reduce((sum, bid) => sum + (bid || 0), 0)
  });
}

// Enhanced move submission with phase awareness
function submitMoveEnhanced(args) {
  const match = assertMatch(args.matchId);
  if (args.expectedRevision !== match.revision) {
    throw new Error('Revision mismatch');
  }
  
  switch (match.phase) {
    case 'PASSING':
      return submitPassingMove(match, args);
    case 'BIDDING':
      return submitBiddingMove(match, args);
    case 'PLAYING':
      return submitPlayingMove(match, args);
    default:
      throw new Error(`Invalid phase for move submission: ${match.phase}`);
  }
}

function submitPassingMove(match, args) {
  if (match.gameType !== 'HEARTS') {
    throw new Error('Passing only available in Hearts');
  }
  
  const seat = args.seat;
  const cardIds = args.cardIds || [];
  
  if (cardIds.length !== 3) {
    throw new Error('Must pass exactly 3 cards');
  }
  
  // Validate cards are in hand
  const hand = match.hands[seat] || [];
  const validCards = cardIds.every(id => hand.some(c => c.id === id));
  if (!validCards) {
    throw new Error('Invalid cards selected for passing');
  }
  
  match.phaseData.passingSelections[seat] = cardIds;
  match.phaseData.passingComplete[seat] = true;
  
  bump(match);
  EventDispatcher.emit(match, 'CARDS_PASSED', seat, {
    seat: seat,
    cardCount: cardIds.length,
    passingComplete: match.phaseData.passingComplete
  });
  
  // Check if passing phase is complete
  transitionToNextPhase(match);
  
  persistMatchSnapshot(match);
  return deltaFor(match);
}

function submitBiddingMove(match, args) {
  if (match.gameType !== 'SPADES' && match.gameType !== 'CALLBREAK') {
    throw new Error('Bidding only available in Spades and Callbreak');
  }
  
  const seat = args.seat;
  const bid = args.bid;
  
  if (match.turnIndex !== seat) {
    throw new Error('Not your turn to bid');
  }
  
  // Validate bid range
  const minBid = match.gameType === 'CALLBREAK' ? 1 : 0;
  const maxBid = match.gameType === 'CALLBREAK' ? 8 : 13;
  
  if (bid < minBid || bid > maxBid) {
    throw new Error(`Bid must be between ${minBid} and ${maxBid}`);
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
  transitionToNextPhase(match);
  
  persistMatchSnapshot(match);
  return deltaFor(match);
}

function submitPlayingMove(match, args) {
  if (match.turnIndex !== args.seat) {
    throw new Error('Not your turn');
  }
  
  const hand = match.hands[args.seat] || [];
  const card = hand.find(c => c.id === args.cardId);
  if (!card) {
    throw new Error('Card not in hand');
  }
  
  // Validate move legality
  if (!isLegalMove(match, args.seat, card)) {
    throw new Error('Illegal move');
  }
  
  // Play the card
  match.hands[args.seat] = hand.filter(c => c.id !== args.cardId);
  match.currentTrick.push({ seat: args.seat, card: card });
  
  // Update game state
  if (match.currentTrick.length === 1) {
    match.leadSuit = card.suit;
    match.trickLeaderIndex = args.seat;
  }
  
  // Update hearts broken status
  if (match.gameType === 'HEARTS' && card.suit === 'HEARTS') {
    match.heartsBroken = true;
  }
  
  // Update spades broken status
  if ((match.gameType === 'SPADES' || match.gameType === 'CALLBREAK') && card.suit === 'SPADES') {
    match.spadesBroken = true;
  }
  
  // Track played cards
  match.playedCardIds[card.id] = true;
  match.playedBySuit[card.suit]++;
  
  bump(match);
  EventDispatcher.emit(match, 'CARD_PLAYED', args.seat, {
    seat: args.seat,
    card: card,
    currentTrick: match.currentTrick,
    leadSuit: match.leadSuit
  });
  
  // Check if trick is complete
  if (match.currentTrick.length === 4) {
    completeTrick(match);
  } else {
    // Advance turn
    match.turnIndex = (match.turnIndex + 1) % 4;
    match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
    
    EventDispatcher.emit(match, 'TURN_CHANGED', match.turnIndex, {
      turnIndex: match.turnIndex,
      turnDeadlineMs: match.turnDeadlineMs
    });
  }
  
  persistMatchSnapshot(match);
  return deltaFor(match);
}

function completeTrick(match) {
  const winner = resolveTrickWinner(match);
  const trickScore = match.currentTrick.reduce((sum, play) => {
    return sum + (play.card.points || 0);
  }, 0);
  
  // Update scores and trick wins
  match.scores[winner] = (match.scores[winner] || 0) + trickScore;
  match.tricksWon[winner] = (match.tricksWon[winner] || 0) + 1;
  
  // Store completed trick for animation
  match.lastCompletedTrick = {
    trick: [...match.currentTrick],
    winner: winner,
    at: Date.now()
  };
  
  // Clear current trick
  match.currentTrick = [];
  match.leadSuit = null;
  
  // Set next turn to winner
  match.turnIndex = winner;
  match.trickLeaderIndex = winner;
  match.turnDeadlineMs = Date.now() + getTurnTimeout(match, winner);
  
  EventDispatcher.emit(match, 'TRICK_COMPLETED', winner, {
    winner: winner,
    trickScore: trickScore,
    lastCompletedTrick: match.lastCompletedTrick,
    scores: match.scores,
    tricksWon: match.tricksWon
  });
  
  // Check if round is complete
  transitionToNextPhase(match);
}

// Enhanced timeout handling with phase awareness
function timeoutMoveEnhanced(args) {
  const match = assertMatch(args.matchId);
  
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
  for (let seat = 0; seat < 4; seat++) {
    if (!match.phaseData.passingComplete[seat]) {
      autoSelectPassingCards(match, seat);
      match.phaseData.passingComplete[seat] = true;
    }
  }
  
  bump(match);
  transitionToNextPhase(match);
  persistMatchSnapshot(match);
  return deltaFor(match);
}

function timeoutBiddingMove(match) {
  const seat = match.turnIndex;
  
  // Auto-bid for the current player
  if (!match.phaseData.biddingComplete[seat]) {
    const autoBid = calculateAutoBid(match, seat);
    match.bids[seat] = autoBid;
    match.phaseData.biddingComplete[seat] = true;
    
    EventDispatcher.emit(match, 'BID_TIMEOUT', seat, {
      seat: seat,
      bid: autoBid,
      auto: true
    });
  }
  
  // Advance turn or complete bidding
  match.turnIndex = (match.turnIndex + 1) % 4;
  match.turnDeadlineMs = Date.now() + BIDDING_TIMEOUT_MS;
  
  bump(match);
  transitionToNextPhase(match);
  persistMatchSnapshot(match);
  return deltaFor(match);
}

function timeoutPlayingMove(match) {
  const seat = match.turnIndex;
  const legal = legalMovesForSeat(match, seat);
  const autoCard = legal.length > 0 ? lowestCard(legal) : fallbackCard(match, seat);
  
  // Submit auto move
  match.hands[seat] = (match.hands[seat] || []).filter(c => c.id !== autoCard.id);
  match.currentTrick.push({ seat: seat, card: autoCard });
  
  if (match.currentTrick.length === 1) {
    match.leadSuit = autoCard.suit;
    match.trickLeaderIndex = seat;
  }
  
  bump(match);
  EventDispatcher.emit(match, 'MOVE_TIMEOUT', seat, {
    seat: seat,
    card: autoCard,
    auto: true
  });
  
  if (match.currentTrick.length === 4) {
    completeTrick(match);
  } else {
    match.turnIndex = (match.turnIndex + 1) % 4;
    match.turnDeadlineMs = Date.now() + getTurnTimeout(match, match.turnIndex);
  }
  
  persistMatchSnapshot(match);
  return deltaFor(match);
}

// Export enhanced handlers
if (typeof globalThis !== 'undefined') {
  globalThis.enhancedHandlers = {
    createMatch: createEnhancedMatch,
    submitMove: submitMoveEnhanced,
    timeoutMove: timeoutMoveEnhanced,
    transitionToNextPhase,
    // ... other enhanced functions
  };
}