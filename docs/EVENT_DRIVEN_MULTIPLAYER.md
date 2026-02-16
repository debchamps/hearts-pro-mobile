# Event-Driven Turn Architecture (PlayFab Classic CloudScript)

## Overview
The multiplayer sync path was refactored from `getState` polling to a turn-triggered event model.

Core principles:
- Server-authoritative state and turn resolution
- No client-side polling loops
- State persisted only on mutation
- Revision-based idempotency retained
- Delta-based state transfer retained

## Server Modules
### Event Dispatcher
Implemented in `/Users/debarghy/Desktop/GamesV2/hearts-pro-mobile/server/playfab/cloudscript/handlers.playfab.js` as `EventDispatcher`.

Responsibilities:
- Maintain per-match event stream (`eventId`, `type`, `matchId`, `revision`, `timestamp`, `delta`)
- Persist stream in TitleData key `events_<matchId>`
- Return stream slices with `sinceEventId`
- Bound stream size (`EVENT_LIMIT_PER_MATCH`)

### Subscription Manager
Implemented in `/Users/debarghy/Desktop/GamesV2/hearts-pro-mobile/server/playfab/cloudscript/handlers.playfab.js` as `SubscriptionManager`.

Responsibilities:
- Register match subscriptions (`subscribeToMatch`)
- Remove subscriptions (`unsubscribeFromMatch`)
- Keep lightweight in-memory subscriber bookkeeping

## Server API Changes
- Added `getSnapshot(matchId)` for full authoritative resync.
- Added `subscribeToMatch(matchId, sinceEventId)` for event backlog retrieval.
- Added `unsubscribeFromMatch(matchId, subscriptionId)`.
- Kept `getState` as compatibility alias to `getSnapshot` with no turn advancement side effects.

## Turn Processing Changes
### Previous
- One server move processed inside `getState` poll.

### Current
- Turn chains execute on mutation handlers (`submitMove`, `submitPass`, `submitBid`, `timeoutMove`, disconnect/reconnect transitions).
- `runServerTurnChain` resolves all immediately playable bot/disconnected turns in one server execution.
- Bot turns are immediate; no “one move per poll” dependency.

## Event Types Emitted
- `MATCH_STARTED`
- `TURN_CHANGED`
- `CARD_PLAYED`
- `TRICK_COMPLETED`
- `ROUND_COMPLETED`
- `MATCH_COMPLETED`
- `PLAYER_DISCONNECTED`
- `PLAYER_RECONNECTED`

All events include:
- `matchId`
- `revision`
- `timestamp`
- `delta`

## Client Flow (Pseudocode)
```ts
onMatchOpen(gameType):
  state = api.findMatch/createMatch(...)
  snapshot = api.getSnapshot(matchId)
  render(snapshot)
  sub = api.subscribeToMatch(matchId, lastEventId)
  applyEvents(sub.events)

onPlayerAction(action):
  delta = api.submitMove/submitBid/submitPass(...)
  applyDelta(delta)
  // no polling

onTurnDeadlineReached():
  delta = api.timeoutMove(matchId)
  applyDelta(delta)

onReconnect():
  reconnectResult = api.reconnect(matchId, playFabId)
  snapshot = api.getSnapshot(matchId)
  render(snapshot)
  sub = api.subscribeToMatch(matchId, lastEventId)
  applyEvents(sub.events)

onLeaveMatch():
  api.unsubscribeFromMatch(matchId, subscriptionId)
```

## Idempotency and Safety
- Revision checks still gate move acceptance.
- Duplicate events are safe: client applies only newer revisions.
- Snapshot resync path (`getSnapshot`) is authoritative recovery for revision conflicts or missed events.

## PlayFab Compatibility
- Uses Classic CloudScript handlers only.
- No external infra/services added.
- Event streams and match snapshots persisted via PlayFab server APIs already in use.
