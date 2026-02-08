
export type Suit = 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
  points: number;
}

export type GameType = 'HEARTS' | 'SPADES';

export interface GameSettings {
  shootTheMoon: boolean;
  noPassing: boolean;
  jackOfDiamonds: boolean;
  targetScore: number;
}

export interface Player {
  id: number;
  name: string;
  avatar: string;
  hand: Card[];
  score: number;
  currentRoundScore: number;
  isHuman: boolean;
  bid?: number;
  tricksWon?: number;
  teamId?: number; // 0 for Team Blue (0, 2), 1 for Team Red (1, 3)
}

export interface TrickCard {
  playerId: number;
  card: Card;
}

export interface HistoryItem {
  trick: TrickCard[];
  winnerId: number;
  leadSuit: Suit | null;
}

export interface SpadesRoundSummary {
  roundNumber: number;
  team0: {
    bid: number;
    tricks: number;
    scoreChange: number;
    bags: number;
    nilResults: { playerId: number; success: boolean }[];
    bagPenalty: boolean;
  };
  team1: {
    bid: number;
    tricks: number;
    scoreChange: number;
    bags: number;
    nilResults: { playerId: number; success: boolean }[];
    bagPenalty: boolean;
  };
}

export type GamePhase = 'DEALING' | 'PASSING' | 'BIDDING' | 'PLAYING' | 'ROUND_END' | 'GAME_OVER';
export type ScreenState = 'HOME' | 'MENU' | 'GAME' | 'SETTINGS';

export interface GameState {
  gameType: GameType;
  players: Player[];
  dealerIndex: number;
  turnIndex: number;
  leadSuit: Suit | null;
  currentTrick: TrickCard[];
  heartsBroken: boolean;
  spadesBroken: boolean;
  phase: GamePhase;
  roundNumber: number;
  passingCards: string[];
  settings: GameSettings;
  teamScores: [number, number]; // [Team Blue, Team Red]
  teamBags: [number, number]; // [Team Blue, Team Red]
  trickHistory: HistoryItem[];
  spadesHistory?: SpadesRoundSummary[];
}
