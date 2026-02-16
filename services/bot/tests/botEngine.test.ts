import { strict as assert } from 'node:assert';
import { BotEngine, createContextFromLegacy } from '../index.ts';
import type { Card, Player, TrickCard } from '../../../types.ts';

const makeCard = (id: string, suit: Card['suit'], value: number): Card => ({
  id,
  suit,
  rank: id.split('-')[0] as Card['rank'],
  value,
  points: suit === 'HEARTS' ? 1 : id === 'Q-SPADES' ? 13 : 0,
});

const players: Player[] = [
  { id: 0, name: 'A', avatar: 'A', hand: [], score: 0, currentRoundScore: 0, isHuman: true, tricksWon: 0, bid: 3 },
  { id: 1, name: 'B', avatar: 'B', hand: [], score: 0, currentRoundScore: 0, isHuman: false, tricksWon: 0, bid: 3 },
  { id: 2, name: 'C', avatar: 'C', hand: [], score: 0, currentRoundScore: 0, isHuman: true, tricksWon: 0, bid: 3 },
  { id: 3, name: 'D', avatar: 'D', hand: [], score: 0, currentRoundScore: 0, isHuman: false, tricksWon: 0, bid: 3 },
];

function testHeartsLegalFollowSuit() {
  const engine = new BotEngine();
  const hand = [makeCard('2-CLUBS', 'CLUBS', 2), makeCard('K-HEARTS', 'HEARTS', 13)];
  const trick: TrickCard[] = [{ playerId: 0, card: makeCard('10-CLUBS', 'CLUBS', 10) }];
  const ctx = createContextFromLegacy({ gameType: 'HEARTS', seatId: 1, hand, currentTrick: trick, leadSuit: 'CLUBS', players, settings: { targetScore: 100, shootTheMoon: true, noPassing: false, jackOfDiamonds: false } });
  const move = engine.chooseMove({ context: ctx });
  assert.equal(move.cardId, '2-CLUBS');
}

function testBidRanges() {
  const engine = new BotEngine();
  const hand = [
    makeCard('A-SPADES', 'SPADES', 14), makeCard('K-SPADES', 'SPADES', 13), makeCard('Q-SPADES', 'SPADES', 12),
    makeCard('A-HEARTS', 'HEARTS', 14), makeCard('K-HEARTS', 'HEARTS', 13), makeCard('A-CLUBS', 'CLUBS', 14),
  ];

  const spadesCtx = createContextFromLegacy({ gameType: 'SPADES', seatId: 1, hand, currentTrick: [], leadSuit: null, players, settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false } });
  const cbCtx = createContextFromLegacy({ gameType: 'CALLBREAK', seatId: 1, hand, currentTrick: [], leadSuit: null, players, settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump: false } });

  const sb = engine.chooseBid(spadesCtx);
  const cb = engine.chooseBid(cbCtx);

  assert.ok(sb >= 0 && sb <= 13);
  assert.ok(cb >= 1 && cb <= 8);
  assert.ok(sb <= 6, `expected conservative spades bid, got ${sb}`);
  assert.ok(cb <= 5, `expected conservative callbreak bid, got ${cb}`);
}

function testSpadesBidNilWhenHandIsNilSafe() {
  const engine = new BotEngine();
  const hand = [
    makeCard('2-SPADES', 'SPADES', 2),
    makeCard('4-SPADES', 'SPADES', 4),
    makeCard('5-CLUBS', 'CLUBS', 5),
    makeCard('8-CLUBS', 'CLUBS', 8),
    makeCard('8-DIAMONDS', 'DIAMONDS', 8),
    makeCard('6-DIAMONDS', 'DIAMONDS', 6),
    makeCard('7-HEARTS', 'HEARTS', 7),
  ];
  const spadesCtx = createContextFromLegacy({
    gameType: 'SPADES',
    seatId: 1,
    hand,
    currentTrick: [],
    leadSuit: null,
    players,
    settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false },
  });
  const bid = engine.chooseBid(spadesCtx);
  assert.equal(bid, 0);
}

function testNoWinningLineDumpsLowestInTrumpGames() {
  const engine = new BotEngine();
  const hand = [
    makeCard('K-CLUBS', 'CLUBS', 13),
    makeCard('J-CLUBS', 'CLUBS', 11),
    makeCard('6-CLUBS', 'CLUBS', 6),
  ];
  const trick: TrickCard[] = [{ playerId: 0, card: makeCard('A-CLUBS', 'CLUBS', 14) }];

  const spadesCtx = createContextFromLegacy({
    gameType: 'SPADES',
    seatId: 1,
    hand,
    currentTrick: trick,
    leadSuit: 'CLUBS',
    players,
    settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false },
  });
  const cbCtx = createContextFromLegacy({
    gameType: 'CALLBREAK',
    seatId: 1,
    hand,
    currentTrick: trick,
    leadSuit: 'CLUBS',
    players,
    settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump: false },
  });

  assert.equal(engine.chooseMove({ context: spadesCtx }).cardId, '6-CLUBS');
  assert.equal(engine.chooseMove({ context: cbCtx }).cardId, '6-CLUBS');
}

function testCallbreakBidStrengthSeparation() {
  const engine = new BotEngine();
  const strong = [
    makeCard('A-SPADES', 'SPADES', 14),
    makeCard('K-SPADES', 'SPADES', 13),
    makeCard('Q-SPADES', 'SPADES', 12),
    makeCard('J-SPADES', 'SPADES', 11),
    makeCard('A-HEARTS', 'HEARTS', 14),
    makeCard('K-CLUBS', 'CLUBS', 13),
    makeCard('A-DIAMONDS', 'DIAMONDS', 14),
  ];
  const weak = [
    makeCard('2-SPADES', 'SPADES', 2),
    makeCard('4-HEARTS', 'HEARTS', 4),
    makeCard('5-HEARTS', 'HEARTS', 5),
    makeCard('6-CLUBS', 'CLUBS', 6),
    makeCard('7-CLUBS', 'CLUBS', 7),
    makeCard('8-DIAMONDS', 'DIAMONDS', 8),
    makeCard('9-DIAMONDS', 'DIAMONDS', 9),
  ];

  const strongCtx = createContextFromLegacy({
    gameType: 'CALLBREAK',
    seatId: 1,
    hand: strong,
    currentTrick: [],
    leadSuit: null,
    players,
    settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump: false },
  });
  const weakCtx = createContextFromLegacy({
    gameType: 'CALLBREAK',
    seatId: 1,
    hand: weak,
    currentTrick: [],
    leadSuit: null,
    players,
    settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump: false },
  });

  const strongBid = engine.chooseBid(strongCtx);
  const weakBid = engine.chooseBid(weakCtx);

  assert.ok(strongBid >= 4, `expected stronger callbreak bid, got ${strongBid}`);
  assert.ok(weakBid <= 2, `expected weak callbreak bid, got ${weakBid}`);
}

function testCallbreakFourthPositionFollowsSuitWithLowestWhenSafe() {
  const engine = new BotEngine();
  const hand = [
    makeCard('A-CLUBS', 'CLUBS', 14),
    makeCard('8-CLUBS', 'CLUBS', 8),
    makeCard('5-CLUBS', 'CLUBS', 5),
  ];
  const trick: TrickCard[] = [
    { playerId: 0, card: makeCard('10-CLUBS', 'CLUBS', 10) },
    { playerId: 2, card: makeCard('Q-CLUBS', 'CLUBS', 12) },
    { playerId: 3, card: makeCard('K-CLUBS', 'CLUBS', 13) },
  ];

  const ctx = createContextFromLegacy({
    gameType: 'CALLBREAK',
    seatId: 1,
    hand,
    currentTrick: trick,
    leadSuit: 'CLUBS',
    players,
    settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump: false },
  });
  assert.equal(engine.chooseMove({ context: ctx }).cardId, '5-CLUBS');
}

function testCallbreakLeadWinningSpadePressureAfterEarlyRounds() {
  const engine = new BotEngine();
  const hand = [
    makeCard('A-SPADES', 'SPADES', 14),
    makeCard('K-SPADES', 'SPADES', 13),
    makeCard('10-SPADES', 'SPADES', 10),
    makeCard('7-SPADES', 'SPADES', 7),
    makeCard('3-SPADES', 'SPADES', 3),
    makeCard('2-CLUBS', 'CLUBS', 2),
    makeCard('4-HEARTS', 'HEARTS', 4),
  ];

  const ctx = createContextFromLegacy({
    gameType: 'CALLBREAK',
    seatId: 1,
    hand,
    currentTrick: [],
    leadSuit: null,
    players,
    settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump: false },
    roundNumber: 4,
  });
  assert.equal(engine.chooseMove({ context: ctx }).cardId, 'A-SPADES');
}

function testHeartsOffSuitDumpsQueenOfSpades() {
  const engine = new BotEngine();
  const hand = [
    makeCard('Q-SPADES', 'SPADES', 12),
    makeCard('A-HEARTS', 'HEARTS', 14),
    makeCard('4-DIAMONDS', 'DIAMONDS', 4),
  ];
  const trick: TrickCard[] = [{ playerId: 0, card: makeCard('10-CLUBS', 'CLUBS', 10) }];
  const ctx = createContextFromLegacy({
    gameType: 'HEARTS',
    seatId: 1,
    hand,
    currentTrick: trick,
    leadSuit: 'CLUBS',
    players,
    settings: { targetScore: 100, shootTheMoon: true, noPassing: false, jackOfDiamonds: false },
  });
  assert.equal(engine.chooseMove({ context: ctx }).cardId, 'Q-SPADES');
}

function testHeartsPassIncludesTwoOfClubsWhenPresent() {
  const engine = new BotEngine();
  const hand = [
    makeCard('2-CLUBS', 'CLUBS', 2),
    makeCard('Q-SPADES', 'SPADES', 12),
    makeCard('A-HEARTS', 'HEARTS', 14),
    makeCard('K-HEARTS', 'HEARTS', 13),
  ];
  const ctx = createContextFromLegacy({
    gameType: 'HEARTS',
    seatId: 1,
    hand,
    currentTrick: [],
    leadSuit: null,
    players,
    settings: { targetScore: 100, shootTheMoon: true, noPassing: false, jackOfDiamonds: false },
  });
  const pass = engine.choosePass(ctx);
  assert.ok(pass.includes('2-CLUBS'));
}

function testSpadesNilAvoidsWinningWhenPossible() {
  const engine = new BotEngine();
  const nilPlayers: Player[] = players.map((p) => ({ ...p, bid: p.id === 1 ? 0 : 3, tricksWon: p.id === 1 ? 0 : 1 }));
  const hand = [
    makeCard('K-CLUBS', 'CLUBS', 13),
    makeCard('3-CLUBS', 'CLUBS', 3),
  ];
  const trick: TrickCard[] = [
    { playerId: 0, card: makeCard('10-CLUBS', 'CLUBS', 10) },
    { playerId: 2, card: makeCard('7-CLUBS', 'CLUBS', 7) },
  ];
  const ctx = createContextFromLegacy({
    gameType: 'SPADES',
    seatId: 1,
    hand,
    currentTrick: trick,
    leadSuit: 'CLUBS',
    players: nilPlayers,
    settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false },
    roundNumber: 5,
  });
  assert.equal(engine.chooseMove({ context: ctx }).cardId, '3-CLUBS');
}

function testSpadesLeadWinningSpadeAfterEarlyTricks() {
  const engine = new BotEngine();
  const hand = [
    makeCard('A-SPADES', 'SPADES', 14),
    makeCard('K-SPADES', 'SPADES', 13),
    makeCard('10-SPADES', 'SPADES', 10),
    makeCard('8-SPADES', 'SPADES', 8),
    makeCard('4-SPADES', 'SPADES', 4),
    makeCard('2-HEARTS', 'HEARTS', 2),
  ];
  const ctx = createContextFromLegacy({
    gameType: 'SPADES',
    seatId: 1,
    hand,
    currentTrick: [],
    leadSuit: null,
    players,
    settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false },
    roundNumber: 4,
  });
  assert.equal(engine.chooseMove({ context: ctx }).cardId, 'A-SPADES');
}

testHeartsLegalFollowSuit();
testBidRanges();
testSpadesBidNilWhenHandIsNilSafe();
testNoWinningLineDumpsLowestInTrumpGames();
testCallbreakBidStrengthSeparation();
testCallbreakFourthPositionFollowsSuitWithLowestWhenSafe();
testCallbreakLeadWinningSpadePressureAfterEarlyRounds();
testHeartsOffSuitDumpsQueenOfSpades();
testHeartsPassIncludesTwoOfClubsWhenPresent();
testSpadesNilAvoidsWinningWhenPossible();
testSpadesLeadWinningSpadeAfterEarlyTricks();
console.log('botEngine tests passed');
