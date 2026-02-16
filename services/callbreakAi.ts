import { Card, Player, Suit, TrickCard } from '../types';
import { BotEngine, createContextFromLegacy } from './bot';

const engine = new BotEngine();

export async function getCallbreakBid(hand: Card[]): Promise<number> {
  const context = {
    gameType: 'CALLBREAK' as const,
    seatId: 1,
    hand,
    currentTrick: [],
    leadSuit: null,
    settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump: false },
    players: [
      { id: 0, score: 0, tricksWon: 0, handCount: 13, isHuman: true },
      { id: 1, score: 0, tricksWon: 0, handCount: 13, isHuman: false },
      { id: 2, score: 0, tricksWon: 0, handCount: 13, isHuman: true },
      { id: 3, score: 0, tricksWon: 0, handCount: 13, isHuman: false },
    ],
  };
  return engine.chooseBid(context as any);
}

export async function getCallbreakMove(
  hand: Card[],
  currentTrick: TrickCard[],
  leadSuit: Suit | null,
  mandatoryOvertrump: boolean = false,
  players?: Player[],
  turnIndex: number = 1
): Promise<string> {
  const ps = players || [
    { id: 0, name: 'P0', avatar: '', hand: [], score: 0, currentRoundScore: 0, isHuman: true, tricksWon: 0 },
    { id: 1, name: 'P1', avatar: '', hand: [], score: 0, currentRoundScore: 0, isHuman: false, tricksWon: 0 },
    { id: 2, name: 'P2', avatar: '', hand: [], score: 0, currentRoundScore: 0, isHuman: true, tricksWon: 0 },
    { id: 3, name: 'P3', avatar: '', hand: [], score: 0, currentRoundScore: 0, isHuman: false, tricksWon: 0 },
  ];

  const context = createContextFromLegacy({
    gameType: 'CALLBREAK',
    seatId: turnIndex,
    hand,
    currentTrick,
    leadSuit,
    players: ps,
    settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump },
    mandatoryOvertrump,
  });

  return engine.chooseMove({ context }).cardId;
}
