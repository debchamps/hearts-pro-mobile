import { createDeck } from '../../../constants';
import { Card, GameType, Suit } from '../../../types';
import { sortCardsBySuitThenRankAsc } from '../../../services/cardSort';
import { getRules } from '../rules';
import { GameStateDelta, MatchConfig, MatchResult, MultiplayerGameState, OnlinePlayerMeta } from '../types';
import { seededShuffle } from '../utils';

const TEAM_BY_SEAT: Record<number, 0 | 1> = { 0: 0, 1: 1, 2: 0, 3: 1 };

export function createInitialState(matchId: string, config: MatchConfig): MultiplayerGameState {
  const seed = config.seed ?? Date.now();
  const deck = seededShuffle(
    createDeck({ targetScore: 0, shootTheMoon: false, noPassing: true, jackOfDiamonds: false }),
    seed
  );

  const seats = getSeatTemplate(config.gameType);
  const players: OnlinePlayerMeta[] = seats.map((s, seat) => ({
    seat,
    playFabId: s.playFabId,
    name: s.name,
    isBot: s.isBot,
    disconnected: false,
    pingMs: 40 + seat * 10,
    rankBadge: s.isBot ? 'BOT' : 'Rookie',
    coins: 1000,
    teamId: TEAM_BY_SEAT[seat],
    botDifficulty: s.botDifficulty,
  }));

  const hands: Record<number, Card[]> = { 0: [], 1: [], 2: [], 3: [] };
  for (let seat = 0; seat < 4; seat++) {
    hands[seat] = sortCardsBySuitThenRankAsc(deck.slice(seat * 13, seat * 13 + 13));
  }

  const phase = config.gameType === 'HEARTS'
    ? 'PASSING' as const
    : (config.gameType === 'SPADES' || config.gameType === 'CALLBREAK')
      ? 'BIDDING' as const
      : 'PLAYING' as const;

  // For bidding games, bidding starts at dealer+1; for Hearts passing, turnIndex is irrelevant (all pass simultaneously)
  const dealerIndex = 0;
  const initialTurnIndex = phase === 'BIDDING' ? (dealerIndex + 1) % 4 : 0;

  return {
    matchId,
    gameType: config.gameType,
    revision: 1,
    seed,
    deck,
    players,
    hands,
    turnIndex: initialTurnIndex,
    trickLeaderIndex: 0,
    leadSuit: null,
    currentTrick: [],
    trickWins: { 0: 0, 1: 0, 2: 0, 3: 0 },
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    bids: { 0: null, 1: null, 2: null, 3: null },
    roundNumber: 1,
    status: 'PLAYING',
    phase,
    passingSelections: { 0: [], 1: [], 2: [], 3: [] },
    passingDirection: getPassingDirection(1),
    turnDeadlineMs: Date.now() + config.timeoutMs,
    dealerIndex,
    serverTimeMs: Date.now(),
  };
}

function getPassingDirection(roundNumber: number): 'LEFT' | 'RIGHT' | 'ACROSS' | 'NONE' {
  const cycle = (roundNumber - 1) % 4;
  return (['LEFT', 'RIGHT', 'ACROSS', 'NONE'] as const)[cycle];
}

function getSeatTemplate(gameType: GameType): Array<{ playFabId: string; name: string; isBot: boolean; botDifficulty?: 'EASY' | 'MEDIUM' | 'HARD' }> {
  const opponentSeat = gameType === 'HEARTS' ? 1 : 2;
  const humanSeats = gameType === 'HEARTS' ? [0, 2] : [0, opponentSeat];
  return [0, 1, 2, 3].map((seat) => {
    const isHuman = humanSeats.includes(seat);
    if (isHuman && seat === 0) return { playFabId: 'LOCAL_PLAYER', name: 'YOU', isBot: false };
    if (isHuman) return { playFabId: 'REMOTE_PLAYER', name: 'OPPONENT', isBot: false };
    const botDifficulty = seat % 2 === 0 ? 'HARD' : 'MEDIUM';
    return { playFabId: `BOT_${seat}`, name: `BOT ${seat}`, isBot: true, botDifficulty };
  });
}

function isLegalMove(state: MultiplayerGameState, seat: number, card: Card): boolean {
  const rules = getRules(state.gameType);
  return rules.getLegalMoves(state, seat).some((c) => c.id === card.id);
}

function scoreCard(gameType: GameType, card: Card): number {
  if (gameType === 'HEARTS') {
    if (card.suit === 'HEARTS') return 1;
    if (card.id === 'Q-SPADES') return 13;
  }
  return 0;
}

export function submitMove(state: MultiplayerGameState, seat: number, cardId: string, timeoutMs: number): MultiplayerGameState {
  if (state.status !== 'PLAYING') throw new Error('Match not active');
  if (state.phase && state.phase !== 'PLAYING') throw new Error('Round setup in progress');
  if (seat !== state.turnIndex) throw new Error('Not your turn');

  const hand = state.hands[seat] || [];
  const card = hand.find((c) => c.id === cardId);
  if (!card) throw new Error('Card not in hand');
  if (!isLegalMove(state, seat, card)) throw new Error('Illegal move');

  const next: MultiplayerGameState = {
    ...state,
    hands: { ...state.hands, [seat]: hand.filter((c) => c.id !== cardId) },
    currentTrick: [...state.currentTrick, { seat, card }],
    leadSuit: state.currentTrick.length === 0 ? card.suit : state.leadSuit,
    serverTimeMs: Date.now(),
    revision: state.revision + 1,
  };

  if (next.currentTrick.length < 4) {
    next.turnIndex = (seat + 1) % 4;
    next.turnDeadlineMs = Date.now() + timeoutMs;
    return next;
  }

  // Trick is complete — resolve winner and store completed trick for animation
  const rules = getRules(state.gameType);
  const winner = rules.resolveTrickWinner(next.currentTrick, next.leadSuit);
  const trickScore = next.currentTrick.reduce((sum, play) => sum + scoreCard(state.gameType, play.card), 0);
  next.trickWins = { ...next.trickWins, [winner]: (next.trickWins[winner] || 0) + 1 };
  next.scores = { ...next.scores, [winner]: (next.scores[winner] || 0) + trickScore };

  // Store completed trick data before clearing for UI animation
  next.lastCompletedTrick = {
    trick: [...next.currentTrick],
    winner,
    at: Date.now(),
  };

  next.currentTrick = [];
  next.leadSuit = null;
  next.turnIndex = winner;
  next.trickLeaderIndex = winner;
  next.turnDeadlineMs = Date.now() + timeoutMs;

  // Check if round is over (all cards played)
  const allHandsEmpty = [0, 1, 2, 3].every((s) => (next.hands[s] || []).length === 0);
  if (allHandsEmpty) {
    next.status = 'COMPLETED';
    next.phase = 'COMPLETED';
  }

  return next;
}

export function submitPass(state: MultiplayerGameState, seat: number, cardIds: string[], timeoutMs: number): MultiplayerGameState {
  if (state.phase !== 'PASSING') throw new Error('Not in passing phase');
  // Passing is turn-based on the server: each seat passes when it's their turn
  if (seat !== state.turnIndex) throw new Error('Not your turn');
  const existingSelections = state.passingSelections || { 0: [], 1: [], 2: [], 3: [] };
  if ((existingSelections[seat] || []).length === 3) throw new Error('Already passed');
  const hand = state.hands[seat] || [];
  const validCards = cardIds.every((id) => hand.some((c) => c.id === id));
  if (!validCards || cardIds.length !== 3) throw new Error('Must pass exactly 3 cards from your hand');

  const selections = { ...(state.passingSelections || { 0: [], 1: [], 2: [], 3: [] }) };
  selections[seat] = cardIds;

  // Advance turnIndex to next seat
  const nextTurn = (seat + 1) % 4;

  const next: MultiplayerGameState = {
    ...state,
    passingSelections: selections,
    turnIndex: nextTurn,
    turnDeadlineMs: Date.now() + timeoutMs,
    revision: state.revision + 1,
    serverTimeMs: Date.now(),
  };

  // Check if all players have passed
  const allPassed = [0, 1, 2, 3].every((s) => (selections[s] || []).length === 3);
  if (!allPassed) return next;

  // Finalize passing: redistribute cards
  const newHands: Record<number, Card[]> = {};
  const passes: Record<number, Card[]> = {};
  for (let s = 0; s < 4; s++) {
    const ids = selections[s] || [];
    passes[s] = ids.map((id) => (state.hands[s] || []).find((c) => c.id === id)!).filter(Boolean);
    newHands[s] = (state.hands[s] || []).filter((c) => !ids.includes(c.id));
  }

  const dir = state.passingDirection || 'LEFT';
  for (let s = 0; s < 4; s++) {
    const target = dir === 'LEFT' ? (s + 1) % 4 : dir === 'RIGHT' ? (s + 3) % 4 : (s + 2) % 4;
    newHands[target] = sortCardsBySuitThenRankAsc([...newHands[target], ...passes[s]]);
  }

  // Find who has 2 of clubs for Hearts
  let starter = 0;
  for (let s = 0; s < 4; s++) {
    if (newHands[s].some((c) => c.id === '2-CLUBS')) { starter = s; break; }
  }

  return {
    ...next,
    hands: newHands,
    phase: 'PLAYING',
    passingSelections: { 0: [], 1: [], 2: [], 3: [] },
    turnIndex: starter,
    turnDeadlineMs: Date.now() + timeoutMs,
  };
}

export function submitBid(state: MultiplayerGameState, seat: number, bid: number, timeoutMs: number): MultiplayerGameState {
  if (state.phase !== 'BIDDING') throw new Error('Not in bidding phase');
  if (seat !== state.turnIndex) throw new Error('Not your turn to bid');

  const bids = { ...(state.bids || { 0: null, 1: null, 2: null, 3: null }) };
  bids[seat] = bid;

  const nextTurn = (seat + 1) % 4;
  const allBid = [0, 1, 2, 3].every((s) => bids[s] !== null && bids[s] !== undefined);

  // When all bids are in, start playing from dealer+1 (same as offline)
  const firstPlayerAfterBidding = allBid ? (state.dealerIndex !== undefined ? (state.dealerIndex + 1) % 4 : 0) : nextTurn;

  return {
    ...state,
    bids,
    turnIndex: firstPlayerAfterBidding,
    phase: allBid ? 'PLAYING' : 'BIDDING',
    revision: state.revision + 1,
    serverTimeMs: Date.now(),
    turnDeadlineMs: Date.now() + timeoutMs,
  };
}

export function timeoutMove(state: MultiplayerGameState, timeoutMs: number): MultiplayerGameState {
  if (state.status !== 'PLAYING') return state;
  if (Date.now() <= state.turnDeadlineMs) return state;

  // Handle bidding timeout
  if (state.phase === 'BIDDING') {
    const defaultBid = state.gameType === 'CALLBREAK' ? 1 : 1;
    return submitBid(state, state.turnIndex, defaultBid, timeoutMs);
  }

  // Handle passing timeout — auto-select 3 highest cards for current turn player
  if (state.phase === 'PASSING') {
    const seat = state.turnIndex;
    const hand = state.hands[seat] || [];
    const sorted = [...hand].sort((a, b) => b.value - a.value);
    const autoIds = sorted.slice(0, 3).map((c) => c.id);
    return submitPass(state, seat, autoIds, timeoutMs);
  }

  const rules = getRules(state.gameType);
  const move = rules.getTimeoutMove(state, state.turnIndex);
  return submitMove(state, state.turnIndex, move.id, timeoutMs);
}

export function createDelta(prev: MultiplayerGameState | null, next: MultiplayerGameState): GameStateDelta {
  if (!prev) {
    return {
      matchId: next.matchId,
      revision: next.revision,
      changed: next,
      serverTimeMs: next.serverTimeMs,
    };
  }

  const changed: Partial<MultiplayerGameState> = {};
  (Object.keys(next) as Array<keyof MultiplayerGameState>).forEach((key) => {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      changed[key] = next[key] as never;
    }
  });

  return {
    matchId: next.matchId,
    revision: next.revision,
    changed,
    serverTimeMs: next.serverTimeMs,
  };
}

export function applyDelta(base: MultiplayerGameState | null, delta: GameStateDelta): MultiplayerGameState {
  // Ignore stale deltas so local revision never moves backwards.
  if (base && typeof delta.revision === 'number' && delta.revision < base.revision) {
    return base;
  }

  const merged = base
    ? { ...base, ...delta.changed, revision: delta.revision, serverTimeMs: delta.serverTimeMs }
    : (delta.changed as MultiplayerGameState);

  // Normalise server field: tricksWon → trickWins (server uses tricksWon, client uses trickWins)
  if ((merged as any).tricksWon && !merged.trickWins) {
    merged.trickWins = (merged as any).tricksWon;
  } else if ((merged as any).tricksWon) {
    // Merge tricksWon into trickWins, preferring the latest values
    merged.trickWins = { ...merged.trickWins, ...(merged as any).tricksWon };
  }

  return merged;
}

export function resolveRewards(state: MultiplayerGameState): MatchResult {
  const standings = (Object.entries(state.scores) as Array<[string, number]>)
    .map(([seat, score]) => ({ seat: Number(seat), score }))
    .sort((a, b) => b.score - a.score)
    .map((item, idx) => ({ ...item, rank: (idx + 1) as 1 | 2 | 3 | 4 }));

  const rewardMap: Record<1 | 2 | 3 | 4, number> = { 1: 100, 2: 75, 3: 25, 4: 0 };
  const rewards = standings.map((s) => ({ seat: s.seat, coinsDelta: rewardMap[s.rank] - 50 }));
  return { standings, rewards };
}
