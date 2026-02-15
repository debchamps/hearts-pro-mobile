# PlayFab CloudScript Integration

## File
- `server/playfab/cloudscript/handlers.playfab.js` (deploy this to PlayFab Classic CloudScript)
- `server/playfab/cloudscript/handlers.js` (local/dev test version)
- `client/online/network/playfabAuth.ts`

## Required PlayFab Services Mapping
- Authentication: PlayFab login + session ticket (client)
- Matchmaking/Lobby: route through `createMatch` and `joinMatch`
- Game servers/state authority: CloudScript handlers
- Leaderboard/Stats: update on `endMatch`
- CloudScript: single endpoint dispatcher via `ExecuteCloudScript`
- Title ID currently targeted: `EF824`

## Deployment Steps
1. Open PlayFab Game Manager.
2. Upload `server/playfab/cloudscript/handlers.playfab.js` as CloudScript revision.
3. Publish revision.
4. Configure client env:
   - `VITE_PLAYFAB_TITLE_ID`
   - `VITE_PLAYFAB_CUSTOM_ID` (optional; generated device id if absent)
5. Validate handler execution in PlayFab API Explorer.

## Production Notes
- Replace in-memory stores with PlayFab Data/Entities.
- Configure lobby/match handlers:
  - `createLobby`
  - `findMatch`
- Default quick-match queues:
  - `quickmatch-hearts`
  - `quickmatch-spades`
  - `quickmatch-callbreak`
- Default quick-match ticket timeout: `20s`
- Default reconnect window: `120s`
- Currency ID: `CO`
- Default stat keys:
  - `coins_co_balance`
  - `rank_mmr_global`
  - `matches_played_total`
  - `wins_total`
  - `hearts_best_score`
  - `spades_best_score`
  - `callbreak_best_score`

## Google Token Plumbing (Client)
- File: `client/online/network/googleAuth.ts`
- Resolution order:
  1. `VITE_GOOGLE_ID_TOKEN`
  2. `window.__PLAYFAB_GOOGLE_ID_TOKEN__`
  3. `localStorage['PLAYFAB_GOOGLE_ID_TOKEN']`
  4. Capacitor `GoogleAuth` plugin (`initialize` + `signIn`) using `VITE_GOOGLE_WEB_CLIENT_ID`
- Fallback: if token unavailable, auth falls back to Custom ID login.
- Persist match snapshots by `matchId` and `revision`.
- Apply anti-cheat guardrails:
  - strict expected revision checks
  - server-only legal move validation
  - idempotency key for repeated submissions
