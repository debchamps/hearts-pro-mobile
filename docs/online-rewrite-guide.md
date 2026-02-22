1. Architecture Diagram (text)
------------------------------
Server-authoritative flow | Client renders only server deltas | Events kept in match object

```
                       +-----------------------------+
        Client         |      PlayFab CloudScript     |
  (anti-cheat client)  | +---------------------------+|
   - send actionType    |> loadMatch(matchId, seat)   ||
   - cardId             |  validateAction             ||
   - wait for response  |  applyMove                  ||
                       |  appendEvent(nextEventId)    ||
                       |  version++                  ||
                       |  SetObjects({expectedVersion}) |
                       +---------------------------+|
  <- delta/Event log   |      Entity Objects (Title)  |
                       +-----------------------------+
```

2. New Match Schema
-------------------
Match is a single object stored per-Game and includes an inner entity version number for optimistic concurrency control.

```ts
type MatchState = {
  matchId: string;
  version: number;
  gameType: 'HEARTS' | 'SPADES' | 'CALLBREAK';
  players: PlayerMeta[];
  turn: number;
  trick: Array<{ seat: number; card: Card }>;
  hands: Record<number, Card[]>;
  scores: Record<number, number>;
  phase: 'WAITING' | 'PASSING' | 'BIDDING' | 'PLAYING' | 'COMPLETED';
  state: 'ACTIVE' | 'ENDED';
  events: MatchEvent[];
  lastMoveTime: number;
  trickLeader: number | null;
  leadSuit: Suit | null;
};
```

3. Server Handlers
------------------
CloudScript entrypoints follow the 6-steps outlined above. Each handler loads the object, validates, updates, increments version, appends events, and saves with `SetObjects`.

```js
function submitMove(params) {
  const match = loadMatch(params.matchId);
  assert(match.phase === 'PLAYING', 'Match not active');
  assert(params.seat === match.turn, 'Not your turn');
  const rules = rulesByGame[match.gameType];
  const card = match.hands[params.seat].find((c) => c.id === params.cardId);
  assert(card, 'Card missing');
  assert(rules.isLegal(move), 'Illegal move');
  applyCard(match, params.seat, card);
  emitEvent(match, { type: 'PLAY', seat: params.seat, cardId: card.id });
  match.version += 1;
  saveMatch(match, params.expectedVersion);
  return createDelta(match, params.seat);
}
```

4. Storage Layer
----------------
The storage layer sits on top of PlayFab Entity Objects (Title) and handles optimistic concurrency using `Version` metadata.

```js
function loadMatch(matchId) {
  const response = server.GetObjects({
    Entity: { Id: 'match_' + matchId, Type: 'title' },
    Keys: ['state'],
  });
  const obj = response.Objects?.[0];
  if (!obj?.DataObject?.state) throw new Error('Match not found');
  return JSON.parse(obj.DataObject.state);
}

function saveMatch(match, expectedVersion) {
  server.SetObjects({
    Entity: { Id: matchIdToEntity(match.matchId), Type: 'title' },
    Objects: [{
      ObjectName: 'state',
      DataObject: { state: match },
      Version: expectedVersion,
    }],
  });
}
```

5. Validation Layer
-------------------
The validation layer enforces turn order, move ownership, and per-game rules.

```js
function validateMove(match, seat, cardId) {
  if (seat !== match.turn) throw new Error('Not your turn');
  const rules = rulesByGame[match.gameType];
  const card = match.hands[seat].find((c) => c.id === cardId);
  if (!card) throw new Error('Card not in hand');
  if (!rules.isLegal(match, seat, card)) throw new Error('Illegal move');
}
```

6. Event System
---------------
Events are append-only objects stored inside the match. Each event stores a sequential ID and actor info.

```js
function emitEvent(match, payload) {
  const eventId = match.events.length ? match.events[match.events.length - 1].id + 1 : 1;
  match.events.push({ id: eventId, matchId: match.matchId, payload, timestamp: Date.now() });
  if (match.events.length > 300) match.events.shift();
}
```

7. Client Sync Layer
--------------------
The client polls `getSnapshot` and subscribes for events. All changes come from server-provided deltas. Input buttons stay disabled while awaiting confirmation.

```ts
class ClientSyncManager {
  async submitMove(cardId) {
    if (this.pending) throw new Error('Awaiting server');
    this.pending = true;
    const delta = await api.submitMove({ matchId: this.matchId, expectedVersion: this.state.version, cardId });
    this.state = applyDelta(this.state, delta);
    this.pending = false;
    return this.state;
  }
}
```

8. UI Input Control
-------------------
The UI displays explicit turn indicators, highlights the last played card, shows a countdown timer, move log, and disables inputs until server confirms.

```tsx
{ state.turn === seat && <div className="turn-anchor">Your turn</div> }
<CardView highlighted={lastPlayedCard?.cardId === card.id} />
<button disabled={pendingAction}>Play</button>
<MoveLog events={state.events} />
```

9. Migration Strategy
---------------------
Steps to migrate existing data:

1. Export TitleData matches (if any) and persist to new entity objects via a migration script.
2. Deploy CloudScript with new handlers referencing `server.GetObjects`/`SetObjects`.
3. Update API clients to call new handlers.
4. Once verified, delete TitleData keys and remove chunked storage code.

10. Explanation of Changes
--------------------------
This rewrite isolates online play into an authoritative flow: server-driven rules, atomic entity storage, optimistic concurrency, and append-only events. Clients render only confirmed state and follow strict UX rules to avoid desync, duplicates, and animation glitches. The plan also includes migration steps to move away from TitleData and chunked storage.
