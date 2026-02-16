import { GameType } from '../../types';

export const ONLINE_HUMAN_TIMEOUT_MS = 9000;
export const ONLINE_BOT_TIMEOUT_MS = 900;
export const CALLBREAK_HUMAN_TIMEOUT_EXTRA_MS = 5000;

export function getOnlineTurnDurationMs(gameType: GameType, isBotOrDisconnected: boolean): number {
  if (isBotOrDisconnected) return ONLINE_BOT_TIMEOUT_MS;
  if (gameType === 'CALLBREAK') {
    return ONLINE_HUMAN_TIMEOUT_MS + CALLBREAK_HUMAN_TIMEOUT_EXTRA_MS;
  }
  return ONLINE_HUMAN_TIMEOUT_MS;
}
