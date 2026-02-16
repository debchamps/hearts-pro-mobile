import { GameSettings, Card, Suit, TrickCard, Player } from '../types';
import { BotEngine, createContextFromLegacy } from './bot';

const engine = new BotEngine();

/**
 * Hearts bot move selection through shared rule-based bot engine.
 * Uses only visible information and local memory/inference.
 */
export function getBestMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  heartsBroken: boolean,
  isFirstTrick: boolean,
  players: Player[],
  turnIndex: number,
  settings: GameSettings
): string {
  const context = createContextFromLegacy({
    gameType: 'HEARTS',
    seatId: turnIndex,
    hand,
    currentTrick,
    leadSuit,
    players,
    settings,
    isFirstTrick,
    heartsBroken,
  });

  return engine.chooseMove({ context }).cardId;
}

export function getHeartsPassCards(hand: Card[], players: Player[], turnIndex: number, settings: GameSettings): string[] {
  const context = createContextFromLegacy({
    gameType: 'HEARTS',
    seatId: turnIndex,
    hand,
    currentTrick: [],
    leadSuit: null,
    players,
    settings,
  });
  return engine.choosePass(context);
}
