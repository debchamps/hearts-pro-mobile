# Deployment Guide (Android + PlayFab)

## 1. Build client
1. `npm install`
2. `npm run build`
3. `npx cap sync android`
4. `npx cap open android`

## 2. Configure environment
Set in `.env.local`:
- `VITE_PLAYFAB_TITLE_ID=EF824`
- `VITE_PLAYFAB_CUSTOM_ID=<optional-player-identifier>`
- `VITE_PLAYFAB_AUTH_PROVIDER=<CUSTOM|GOOGLE|APPLE|FACEBOOK>` (default is now `GOOGLE`)
- `VITE_PLAYFAB_AUTH_TOKEN=<provider-token-for-testing>`
- `VITE_GOOGLE_WEB_CLIENT_ID=<google-web-client-id-for-native-plugin-init>`
- `VITE_GOOGLE_ID_TOKEN=<optional-dev-bypass-token>`

If missing, app uses local emulator (`client/online/core/serverEmulator.ts`).

## 3. Deploy CloudScript
Upload and publish:
- `server/playfab/cloudscript/handlers.js`

## 4. Validate APIs
Run smoke checks against CloudScript for:
- `createMatch`
- `joinMatch`
- `submitMove`
- `getState`
- `timeoutMove`
- `endMatch`
- `updateCoins`
- `reconnect`

## 5. Android QA checklist
- Online entry from home card
- 5s turn timeout radial animation
- Timeout default move behavior per game
- Invalid move server rejection surfaced
- Disconnect -> bot takeover
- Reconnect -> state restored
- Economy rewards settled at match end
