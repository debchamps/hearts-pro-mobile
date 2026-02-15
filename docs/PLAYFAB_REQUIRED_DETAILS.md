# PlayFab Details Status

Current configuration from you:
- Title ID: `EF824`
- Environment split: single `prod` title for now
- Login strategy: Google/Apple/Facebook linked with PlayFab
- CloudScript runtime: Classic CloudScript
- Match type: Public Quick Match
- Region: `US`
- Currency ID: `CO`
- Economy settlement: entry fee `50`, rewards `100/75/25/0`

Defaults currently wired in code:
- Queues:
  - `quickmatch-hearts`
  - `quickmatch-spades`
  - `quickmatch-callbreak`
- Region fallback: `US`
- Ticket timeout: `20s`
- Reconnect window: `120s`
- Currency key: `CO`
- Stat keys:
  - `coins_co_balance`
  - `rank_mmr_global`
  - `matches_played_total`
  - `wins_total`
  - `hearts_best_score`
  - `spades_best_score`
  - `callbreak_best_score`

Still needed from you to finish production binding:
- Google provider credentials/config in your app stack:
  - Android client configuration for Capacitor GoogleAuth plugin
  - Web client id for token minting (`VITE_GOOGLE_WEB_CLIENT_ID`)
  - If needed during early QA, provide `VITE_GOOGLE_ID_TOKEN` as temporary static token
- PlayFab stats/leaderboard creation in dashboard using the keys above (or share alternatives).

Notes:
- Code already enforces server-settled fee/reward values.
- Online auth layer now defaults to Google and falls back to Custom ID when Google token is unavailable.
