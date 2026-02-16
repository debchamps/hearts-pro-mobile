import { Card, GameType, Suit } from '../../types';

export type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface OnlinePlayerMeta {
  seat: number;
  playFabId: string;
  name: string;
  isBot: boolean;
  disconnected: boolean;
  pingMs: number;
  rankBadge: string;
  coins: number;
  teamId: 0 | 1;
  botDifficulty?: BotDifficulty;
}

export interface TrickPlay {
  seat: number;
  card: Card;
}

export interface MultiplayerGameState {
  matchId: string;
  gameType: GameType;
  revision: number;
  seed: number;
  deck: Card[];
  players: OnlinePlayerMeta[];
  hands: Record<number, Card[]>;
  turnIndex: number;
  trickLeaderIndex: number;
  leadSuit: Suit | null;
  currentTrick: TrickPlay[];
  trickWins: Record<number, number>;
  scores: Record<number, number>;
  bids: Record<number, number | null>;
  roundNumber: number;
  status: 'WAITING' | 'PLAYING' | 'COMPLETED';
  phase?: 'WAITING' | 'PASSING' | 'BIDDING' | 'PLAYING' | 'COMPLETED';
  passingSelections?: Record<number, string[]>;
  passingDirection?: 'LEFT' | 'RIGHT' | 'ACROSS';
  turnDeadlineMs: number;
  serverTimeMs: number;
}

export interface GameStateDelta {
  matchId: string;
  revision: number;
  changed: Partial<MultiplayerGameState>;
  serverTimeMs: number;
}

export interface MatchConfig {
  gameType: GameType;
  seed?: number;
  entryFee: number;
  timeoutMs: number;
}

export interface EconomyConfig {
  startingCoins: number;
  entryFee: number;
  rewards: [number, number, number, number];
}

export interface MatchResult {
  standings: Array<{ seat: number; score: number; rank: 1 | 2 | 3 | 4 }>;
  rewards: Array<{ seat: number; coinsDelta: number }>;
}

export interface MoveSubmission {
  matchId: string;
  seat: number;
  cardId: string;
  expectedRevision: number;
}

export interface ReconnectPayload {
  matchId: string;
  playFabId: string;
}

export interface OnlineApi {
  createLobby?(input: { gameType: GameType; region?: string }): Promise<{ lobbyId: string }>;
  findMatch?(input: { gameType: GameType; lobbyId?: string; playerName?: string; autoMoveOnTimeout?: boolean }): Promise<{ matchId: string; seat: number }>;
  createMatch(input: { gameType: GameType; playerName: string; autoMoveOnTimeout?: boolean }): Promise<{ matchId: string; seat: number }>;
  joinMatch(input: { matchId: string; playerName: string }): Promise<{ seat: number }>;
  submitMove(input: MoveSubmission): Promise<GameStateDelta>;
  submitPass?(input: { matchId: string; seat: number; cardIds: string[]; expectedRevision: number }): Promise<GameStateDelta>;
  submitBid?(input: { matchId: string; seat: number; bid: number; expectedRevision: number }): Promise<GameStateDelta>;
  getState(input: { matchId: string; sinceRevision: number; seat?: number }): Promise<GameStateDelta>;
  timeoutMove(input: { matchId: string }): Promise<GameStateDelta>;
  endMatch(input: { matchId: string }): Promise<MatchResult>;
  updateCoins(input: { playFabId: string; delta: number }): Promise<{ coins: number }>;
  reconnect(input: ReconnectPayload): Promise<{ seat: number; delta: GameStateDelta }>;
}
