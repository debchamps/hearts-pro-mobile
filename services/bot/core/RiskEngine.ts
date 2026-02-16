import type { BotTurnContext } from './types.ts';

export class RiskEngine {
  computeRiskTolerance(context: BotTurnContext): number {
    const me = context.players.find((p) => p.id === context.seatId);
    if (!me) return 0.5;

    const maxOther = Math.max(...context.players.filter((p) => p.id !== me.id).map((p) => p.score));
    const gap = me.score - maxOther;

    // Lower is safer, higher is riskier.
    let risk = 0.5;
    if (gap > 20) risk -= 0.18;
    if (gap < -20) risk += 0.22;
    if ((context.roundNumber || 1) >= 4) risk += gap < 0 ? 0.1 : -0.08;

    return Math.max(0.15, Math.min(0.9, risk));
  }
}
