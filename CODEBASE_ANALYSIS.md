# Codebase Analysis - Card Adda Multiplayer Extension

## Existing Structure (Analyzed)
- UI shell: `App.tsx`, `Home.tsx`
- Offline game implementations:
  - `HeartsGame.tsx`
  - `SpadesGame.tsx`
  - `CallbreakGame.tsx`
- Reusable visual system:
  - `SharedComponents.tsx` (`CardView`, `Avatar`, overlays, history/scorecard modals)
- Card model and state contracts:
  - `types.ts`
  - `constants.tsx` (deck + shuffle)
- Offline AI services:
  - `services/heartsAi.ts`
  - `services/spadesAi.ts`
  - `services/callbreakAi.ts`
- Persistence and local leaderboard:
  - `services/persistence.ts`
  - `services/leaderboardService.ts`

## Reuse Strategy
- Preserve all current offline screens and behavior unchanged.
- Reuse card rendering (`CardView`) and styling primitives in online mode UI.
- Keep existing game-specific logic available and isolated; online mode introduces server-authoritative orchestration without replacing offline path.

## Gaps Identified (Before Changes)
- No client/server separation for authoritative multiplayer.
- No deterministic seed-based state replay for network sync.
- No timeout auto-move path for server turns.
- No PlayFab auth/lobby/match/cloud API integration.
- No delta sync protocol.
- No disconnect takeover/reconnect resync mechanism.

## Implemented Additions
- `/client/online` deterministic multiplayer core and networking adapter.
- `/server/playfab/cloudscript/handlers.js` CloudScript API handlers for required endpoints.
- `/docs` architecture, state model, sequence flow, and deployment documentation.
- `App.tsx` + `Home.tsx` online mode entry without altering offline routes.
- Existing game entry components now accept `onlineMode` and route to online orchestration:
  - `HeartsGame.tsx`
  - `SpadesGame.tsx`
  - `CallbreakGame.tsx`

## Constraint Compliance
- Existing offline gameplay/UI preserved.
- Added multiplayer orchestration as extension, not rewrite.
- Shared card visuals reused in online screen.
