import React from 'react';
import { Suit, Rank, Card, GameSettings } from './types';

export const SUITS: Suit[] = ['CLUBS', 'DIAMONDS', 'SPADES', 'HEARTS'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

export const SUIT_COLORS: Record<Suit, string> = {
  HEARTS: 'text-red-600',
  DIAMONDS: 'text-blue-500',
  CLUBS: 'text-gray-800',
  SPADES: 'text-gray-900',
};

export const SUIT_SYMBOLS: Record<Suit, React.ReactNode> = {
  HEARTS: <span className="text-2xl">♥</span>,
  DIAMONDS: <span className="text-2xl">♦</span>,
  CLUBS: <span className="text-2xl">♣</span>,
  SPADES: <span className="text-2xl">♠</span>,
};

export const createDeck = (settings: GameSettings): Card[] => {
  const deck: Card[] = [];
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      let points = 0;
      if (suit === 'HEARTS') points = 1;
      if (suit === 'SPADES' && rank === 'Q') points = 13;
      if (settings.jackOfDiamonds && suit === 'DIAMONDS' && rank === 'J') points = -10;

      deck.push({
        id: `${rank}-${suit}`,
        suit,
        rank,
        value: RANK_VALUES[rank],
        points
      });
    });
  });
  return deck;
};

export const shuffle = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};