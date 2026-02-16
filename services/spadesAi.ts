import { Card, Player, Suit, TrickCard } from '../types';
import { BotEngine, createContextFromLegacy } from './bot';

const engine = new BotEngine();

export async function getSpadesBid(hand: Card[]): Promise<number> {
  const context = {
    gameType: 'SPADES' as const,
    seatId: 1,
    hand,
    currentTrick: [],
    leadSuit: null,
    settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false },
    players: [
      { id: 0, score: 0, tricksWon: 0, handCount: 13, isHuman: true, teamId: 0 },
      { id: 1, score: 0, tricksWon: 0, handCount: 13, isHuman: false, teamId: 1 },
      { id: 2, score: 0, tricksWon: 0, handCount: 13, isHuman: true, teamId: 0 },
      { id: 3, score: 0, tricksWon: 0, handCount: 13, isHuman: false, teamId: 1 },
    ],
  };
  return engine.chooseBid(context as any);
}

export async function getSpadesMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  spadesBroken: boolean,
  players: Player[],
  turnIndex: number
): Promise<string> {
  const context = createContextFromLegacy({
    gameType: 'SPADES',
    seatId: turnIndex,
    hand,
    currentTrick,
    leadSuit,
    players,
    settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false },
    spadesBroken,
  });

  return engine.chooseMove({ context }).cardId;
}
