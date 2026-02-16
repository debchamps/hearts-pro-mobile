# Bot Engine Architecture

## Modules
- `services/bot/core/BotEngine.ts`
- `services/bot/core/StrategyRouter.ts`
- `services/bot/core/MemoryTracker.ts`
- `services/bot/core/CardEvaluator.ts`
- `services/bot/core/BidEvaluator.ts`
- `services/bot/core/RiskEngine.ts`
- `services/bot/strategies/HeartsStrategy.ts`
- `services/bot/strategies/SpadesStrategy.ts`
- `services/bot/strategies/CallbreakStrategy.ts`

## Decision Pipeline
1. Rule filtering (`core/rules.ts`)
2. Memory/inference update (`MemoryTracker`)
3. Intent selection (game strategy)
4. Tactical score calculation (`CardEvaluator`)
5. Deterministic best-card selection

## Non-cheating model
- Opponent hands are never read by the engine.
- Input players are transformed to public state (`handCount`, scores, bids, tricks).
- Inference relies only on observed trick cards and follow-suit behavior.

## Integration
- `services/heartsAi.ts` wraps BotEngine for move/pass.
- `services/spadesAi.ts` wraps BotEngine for bid/move.
- `services/callbreakAi.ts` wraps BotEngine for bid/move.

## Tuning source of truth
- `bot_intelligence_metadata.json`
