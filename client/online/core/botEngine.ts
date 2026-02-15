import { getRules } from '../rules';
import { BotDifficulty, MultiplayerGameState } from '../types';
import { highestCard, lowestCard } from '../utils';

function delayByDifficulty(level: BotDifficulty): number {
  if (level === 'EASY') return 1200;
  if (level === 'MEDIUM') return 850;
  return 500;
}

function selectMove(state: MultiplayerGameState, seat: number): string {
  const legal = getRules(state.gameType).getLegalMoves(state, seat);
  const bot = state.players[seat];
  const difficulty = bot.botDifficulty || 'MEDIUM';

  if (difficulty === 'EASY') return lowestCard(legal).id;
  if (difficulty === 'HARD') return highestCard(legal).id;

  const mid = legal[Math.floor(legal.length / 2)] || lowestCard(legal);
  return mid.id;
}

export async function getBotMove(state: MultiplayerGameState, seat: number): Promise<{ cardId: string; simulatedDelayMs: number }> {
  const bot = state.players[seat];
  const difficulty = bot.botDifficulty || 'MEDIUM';
  const simulatedDelayMs = delayByDifficulty(difficulty);
  return {
    cardId: selectMove(state, seat),
    simulatedDelayMs,
  };
}
