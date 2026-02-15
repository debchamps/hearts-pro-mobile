import { createDeck } from '../../../constants';
import { Card, GameType, Suit } from '../../../types';
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
    hands[seat] = deck
      .slice(seat * 13, seat * 13 + 13)
      .sort((a, b) => (a.suit === b.suit ? a.value - b.value : a.suit.localeCompare(b.suit)));
  }

  return {
    matchId,
    gameType: config.gameType,
    revision: 1,
    seed,
    deck,
    players,
    hands,
    turnIndex: 0,
    trickLeaderIndex: 0,
    leadSuit: null,
    currentTrick: [],
    trickWins: { 0: 0, 1: 0, 2: 0, 3: 0 },
    scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    bids: { 0: null, 1: null, 2: null, 3: null },
    roundNumber: 1,
    status: 'PLAYING',
    turnDeadlineMs: Date.now() + config.timeoutMs,
    serverTimeMs: Date.now(),
  };
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

  const rules = getRules(state.gameType);
  const winner = rules.resolveTrickWinner(next.currentTrick, next.leadSuit);
  const trickScore = next.currentTrick.reduce((sum, play) => sum + scoreCard(state.gameType, play.card), 0);
  next.trickWins = { ...next.trickWins, [winner]: (next.trickWins[winner] || 0) + 1 };
  next.scores = { ...next.scores, [winner]: (next.scores[winner] || 0) + trickScore };
  next.currentTrick = [];
  next.leadSuit = null;
  next.turnIndex = winner;
  next.trickLeaderIndex = winner;
  next.turnDeadlineMs = Date.now() + timeoutMs;

  if ((next.hands[0] || []).length === 0) {
    next.status = 'COMPLETED';
  }

  return next;
}

export function timeoutMove(state: MultiplayerGameState, timeoutMs: number): MultiplayerGameState {
  if (state.status !== 'PLAYING') return state;
  if (Date.now() <= state.turnDeadlineMs) return state;

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
  if (!base) return delta.changed as MultiplayerGameState;
  return {
    ...base,
    ...delta.changed,
    revision: delta.revision,
    serverTimeMs: delta.serverTimeMs,
  };
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
