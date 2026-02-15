import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __testOnlySetDeadline,
  __testOnlyStore,
  createMatch,
  endMatch,
  getState,
  reconnect,
  submitMove,
  timeoutMove,
  updateCoins,
} from '../../../server/playfab/cloudscript/handlers.js';

test('timeout handling auto-moves after 5s deadline', () => {
  const created = createMatch({ gameType: 'HEARTS', playerName: 'A' }, { currentPlayerId: 'P1' });
  __testOnlySetDeadline(created.matchId, Date.now() - 1);
  const delta = timeoutMove({ matchId: created.matchId });
  assert.equal(delta.changed.currentTrick.length, 1);
});

test('invalid move rejection rejects out-of-turn move', () => {
  const created = createMatch({ gameType: 'SPADES', playerName: 'A' }, { currentPlayerId: 'P2' });
  assert.throws(() => submitMove({ matchId: created.matchId, seat: 2, cardId: '2-CLUBS', expectedRevision: 1 }));
});

test('reconnect sync restores seat and full state delta', () => {
  const created = createMatch({ gameType: 'CALLBREAK', playerName: 'A' }, { currentPlayerId: 'P3' });
  const info = reconnect({ matchId: created.matchId, playFabId: 'P3' });
  assert.equal(info.seat, 0);
  assert.ok(info.delta.changed.players);
});

test('economy updates apply coin deltas', () => {
  const before = updateCoins({ playFabId: 'PX', delta: 0 });
  const after = updateCoins({ playFabId: 'PX', delta: 25 });
  assert.equal(after.coins, before.coins + 25);
});

test('leaderboard gets populated at end match', () => {
  const created = createMatch({ gameType: 'SPADES', playerName: 'A' }, { currentPlayerId: 'P4' });
  endMatch({ matchId: created.matchId });
  const store = __testOnlyStore();
  assert.ok(store.leaderboard.get(created.matchId));
  const current = getState({ matchId: created.matchId, sinceRevision: 0 });
  assert.equal(current.changed.status, 'COMPLETED');
});
