import type { Suit, TrickCard } from '../../../types.ts';
import type { BotTurnContext, SuitKnowledge } from './types.ts';

type MemorySlot = {
  knowledge: SuitKnowledge;
  lastTrickSignature: string;
};

const memoryStore = new Map<string, MemorySlot>();

function makeEmptyKnowledge(playerIds: number[]): SuitKnowledge {
  const voidSuits: Record<number, Set<Suit>> = {};
  const behaviorTendency: Record<number, { aggressive: number; conservative: number }> = {};

  playerIds.forEach((id) => {
    voidSuits[id] = new Set<Suit>();
    behaviorTendency[id] = { aggressive: 0, conservative: 0 };
  });

  return {
    voidSuits,
    playedCards: new Set<string>(),
    highCardPressure: { CLUBS: 0, DIAMONDS: 0, HEARTS: 0, SPADES: 0 },
    behaviorTendency,
  };
}

function trickSig(trick: TrickCard[]): string {
  return trick.map((t) => `${t.playerId}:${t.card.id}`).join('|');
}

export class MemoryTracker {
  private readonly key: string;

  constructor(context: BotTurnContext) {
    this.key = `${context.gameType}:${context.seatId}`;
    if (!memoryStore.has(this.key)) {
      memoryStore.set(this.key, {
        knowledge: makeEmptyKnowledge(context.players.map((p) => p.id)),
        lastTrickSignature: '',
      });
    }
  }

  reset(context: BotTurnContext) {
    memoryStore.set(this.key, {
      knowledge: makeEmptyKnowledge(context.players.map((p) => p.id)),
      lastTrickSignature: '',
    });
  }

  update(context: BotTurnContext): SuitKnowledge {
    const slot = memoryStore.get(this.key)!;
    const sig = trickSig(context.currentTrick);

    // Reset memory at likely round boundaries.
    if ((context.roundNumber || 1) === 1 && context.currentTrick.length === 0 && context.hand.length >= 13 && slot.knowledge.playedCards.size > 40) {
      this.reset(context);
      return memoryStore.get(this.key)!.knowledge;
    }

    if (sig === slot.lastTrickSignature) return slot.knowledge;

    context.currentTrick.forEach((t, idx) => {
      slot.knowledge.playedCards.add(t.card.id);

      // If player fails to follow lead suit, mark as void.
      if (idx > 0 && context.currentTrick[0]?.card.suit && t.card.suit !== context.currentTrick[0].card.suit) {
        slot.knowledge.voidSuits[t.playerId]?.add(context.currentTrick[0].card.suit);
      }

      if (t.card.value >= 12) {
        slot.knowledge.highCardPressure[t.card.suit] = Math.max(0, slot.knowledge.highCardPressure[t.card.suit] - 1);
        slot.knowledge.behaviorTendency[t.playerId].aggressive += 1;
      } else {
        slot.knowledge.behaviorTendency[t.playerId].conservative += 1;
      }
    });

    slot.lastTrickSignature = sig;
    return slot.knowledge;
  }
}
