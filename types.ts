export type Suit = 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
  points: number;
}

export interface GameSettings {
  shootTheMoon: boolean;
  noPassing: boolean;
  jackOfDiamonds: boolean;
}

export interface Player {
  id: number;
  name: string;
  avatar: string;
  hand: Card[];
  score: number;
  currentRoundScore: number;
  isHuman: boolean;
}

export interface TrickCard {
  playerId: number;
  card: Card;
}

export type GamePhase = 'DEALING' | 'PASSING' | 'PLAYING' | 'ROUND_END' | 'GAME_OVER';
export type ScreenState = 'MENU' | 'GAME' | 'SETTINGS';

export interface GameState {
  players: Player[];
  dealerIndex: number;
  turnIndex: number;
  leadSuit: Suit | null;
  currentTrick: TrickCard[];
  heartsBroken: boolean;
  phase: GamePhase;
  roundNumber: number;
  passingCards: string[]; // IDs of cards selected for passing
  settings: GameSettings;
}