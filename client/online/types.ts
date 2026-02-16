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

export type MatchEventType =
  | 'MATCH_CREATED'
  | 'MATCH_STARTED'
  | 'CARDS_DISTRIBUTED'
  | 'BID_SUBMITTED'
  | 'BIDDING_COMPLETED'
  | 'CARD_PLAYED'
  | 'TURN_CHANGED'
  | 'TRICK_COMPLETED'
  | 'ROUND_COMPLETED'
  | 'MATCH_COMPLETED'
  | 'PLAYER_DISCONNECTED'
  | 'PLAYER_RECONNECTED'
  | 'BOT_ACTION';

export interface MatchEvent {
  eventId: number;
  type: MatchEventType;
  matchId: string;
  revision: number;
  timestamp: number;
  actorSeat: number;
  payload: Partial<MultiplayerGameState>;
}

export interface MatchSubscriptionResult {
  subscriptionId: string;
  events: MatchEvent[];
  latestEventId: number;
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
  findMatch?(input: {
    gameType: GameType;
    lobbyId?: string;
    playerName?: string;
    autoMoveOnTimeout?: boolean;
    currentMatchId?: string;
  }): Promise<{ matchId: string; seat: number }>;
  createMatch(input: { gameType: GameType; playerName: string; autoMoveOnTimeout?: boolean }): Promise<{ matchId: string; seat: number }>;
  joinMatch(input: { matchId: string; playerName: string }): Promise<{ seat: number }>;
  submitMove(input: MoveSubmission): Promise<GameStateDelta>;
  submitPass?(input: { matchId: string; seat: number; cardIds: string[]; expectedRevision: number }): Promise<GameStateDelta>;
  submitBid?(input: { matchId: string; seat: number; bid: number; expectedRevision: number }): Promise<GameStateDelta>;
  getSnapshot(input: { matchId: string; seat?: number }): Promise<GameStateDelta>;
  subscribeToMatch(input: { matchId: string; sinceEventId?: number; sinceRevision?: number; seat?: number; subscriptionId?: string }): Promise<MatchSubscriptionResult>;
  unsubscribeFromMatch(input: { matchId: string; subscriptionId: string }): Promise<{ ok: boolean }>;
  timeoutMove(input: { matchId: string }): Promise<GameStateDelta>;
  endMatch(input: { matchId: string }): Promise<MatchResult>;
  updateCoins(input: { playFabId: string; delta: number }): Promise<{ coins: number }>;
  reconnect(input: ReconnectPayload): Promise<{ seat: number; delta: GameStateDelta }>;
}
