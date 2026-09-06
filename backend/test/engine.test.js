// Rules checked against Mattel instruction sheet HVW18 (©2023).
const test = require('node:test');
const assert = require('node:assert');

const deck = require('../src/game/deck');
const E = require('../src/game/engine');
const { KIND } = deck;

function seeded(seed = 42) {
  let x = seed;
  return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
}

const P4 = [
  { id: 'a', name: 'Arun' }, { id: 'b', name: 'Bala' },
  { id: 'c', name: 'Chitra' }, { id: 'd', name: 'Deepa' },
];

const game = (players = P4, seed = 7) => E.createGame(players, { rng: seeded(seed) });

function stage(s, playerIdx, card) {
  const c = { id: `staged-${Math.random()}`, value: null, ...card };
  s.players[playerIdx].hand.push(c);
  s.turn = playerIdx;
  return c;
}

function setTop(s, card) {
  const c = { id: `top-${Math.random()}`, value: null, ...card };
  s.discard.push(c);
  s.activeColor = c.color;
  return c;
}

// Give a player a hand with nothing playable, so draw() is their only move.
const dud = (n, color = 'green', value = 5) =>
  Array.from({ length: n }, (_, i) => ({ id: `d${i}-${Math.random()}`, kind: KIND.NUMBER, color, value }));

// ── deck ──────────────────────────────────────────────────

test('deck is 168 cards: 80 numbers, 48 colour actions, 40 wilds', () => {
  const cards = deck.buildDeck();
  assert.strictEqual(cards.length, 168);
  assert.strictEqual(cards.filter((c) => c.color).length, 128);
  assert.strictEqual(cards.filter((c) => !c.color).length, 40);

  const count = (k) => cards.filter((c) => c.kind === k).length;
  assert.strictEqual(count(KIND.NUMBER), 80, '0-9 twice per colour');
  // The sheet lists +4 as a COLOUR action, alongside these.
  for (const k of deck.COLOR_ACTIONS) assert.strictEqual(count(k), 8, `${k} twice per colour`);
  assert.strictEqual(count(KIND.DRAW4), 8, '+4 is a colour card, not a wild');
  for (const k of deck.WILD_CARDS) assert.strictEqual(count(k), 8, `${k} x8`);

  assert.strictEqual(new Set(cards.map((c) => c.id)).size, 168, 'ids are unique');
  assert.ok(!cards.some((c) => c.kind === 'wild_draw4'), 'there is no wild +4');
});

test('draw values match the card faces', () => {
  assert.strictEqual(deck.drawValue({ kind: KIND.DRAW2 }), 2);
  assert.strictEqual(deck.drawValue({ kind: KIND.DRAW4 }), 4);
  assert.strictEqual(deck.drawValue({ kind: KIND.WILD_REV4 }), 4);
  assert.strictEqual(deck.drawValue({ kind: KIND.WILD_DRAW6 }), 6);
  assert.strictEqual(deck.drawValue({ kind: KIND.WILD_DRAW10 }), 10);
  assert.strictEqual(deck.drawValue({ kind: KIND.NUMBER }), 0);
});

test('scoring values follow the sheet', () => {
  assert.strictEqual(deck.points({ kind: KIND.NUMBER, value: 7 }), 7, 'numbers score face value');
  assert.strictEqual(deck.points({ kind: KIND.DRAW4, color: 'red' }), 20, 'colour actions are 20');
  assert.strictEqual(deck.points({ kind: KIND.SKIP_ALL, color: 'red' }), 20);
  assert.strictEqual(deck.points({ kind: KIND.WILD_DRAW10 }), 50, 'wilds are 50');
  assert.strictEqual(deck.points({ kind: KIND.ROULETTE }), 50);
});

// ── setup ─────────────────────────────────────────────────

test('deal gives everyone 7 cards and turns over a plain number', () => {
  const s = game();
  s.players.forEach((p) => assert.strictEqual(p.hand.length, E.HAND_SIZE));
  assert.strictEqual(E.topCard(s).kind, KIND.NUMBER, 'action cards are skipped as the starter');
  assert.strictEqual(s.deck.length, 168 - 4 * 7 - 1);
  assert.strictEqual(s.pendingDraw, 0);
});

// ── legality ──────────────────────────────────────────────

test('matching is by colour, by number, or by symbol', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 5 });
  s.turn = 0;
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.NUMBER, color: 'red', value: 9 }), null);
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.NUMBER, color: 'blue', value: 5 }), null);
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.SKIP, color: 'red' }), null);
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.WILD, color: null }), null);
  assert.ok(E.illegalReason(s, 0, { kind: KIND.NUMBER, color: 'blue', value: 9 }));

  // A coloured +4 matches another +4 by symbol, like any other action card.
  setTop(s, { kind: KIND.DRAW4, color: 'green' });
  s.pendingDraw = 0;
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.DRAW4, color: 'blue' }), null);
});

test('a player cannot move out of turn', () => {
  const s = game();
  s.turn = 0;
  assert.strictEqual(E.illegalReason(s, 1, { kind: KIND.WILD, color: null }), 'Not your turn');
  assert.ok(E.draw(s, 2).error);
});

// ── stacking ──────────────────────────────────────────────

test('draw cards stack, and only with equal or higher value', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const d2 = stage(s, 0, { kind: KIND.DRAW2, color: 'red' });
  assert.ok(E.playCard(s, 0, d2.id).ok);
  assert.strictEqual(s.pendingDraw, 2);
  assert.strictEqual(s.turn, 1);

  const num = stage(s, 1, { kind: KIND.NUMBER, color: 'red', value: 3 });
  assert.match(E.playCard(s, 1, num.id).error, /stack a draw card/);

  // A coloured +4 stacks on a +2.
  const d4 = stage(s, 1, { kind: KIND.DRAW4, color: 'blue' });
  assert.ok(E.playCard(s, 1, d4.id).ok);
  assert.strictEqual(s.pendingDraw, 6, '2 + 4');

  const small = stage(s, 2, { kind: KIND.DRAW2, color: 'blue' });
  assert.match(E.playCard(s, 2, small.id).error, /\+4 or higher/);

  const d10 = stage(s, 2, { kind: KIND.WILD_DRAW10, color: null });
  assert.ok(E.playCard(s, 2, d10.id, { color: 'green' }).ok);
  assert.strictEqual(s.pendingDraw, 16, '2 + 4 + 10');
});

test('taking the stack draws the full total and loses the turn', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const d2 = stage(s, 0, { kind: KIND.DRAW2, color: 'red' });
  E.playCard(s, 0, d2.id);
  const d6 = stage(s, 1, { kind: KIND.WILD_DRAW6, color: null });
  E.playCard(s, 1, d6.id, { color: 'red' });
  assert.strictEqual(s.pendingDraw, 8);

  const before = s.players[2].hand.length;
  assert.strictEqual(E.draw(s, 2).took, 8);
  assert.strictEqual(s.players[2].hand.length, before + 8);
  assert.strictEqual(s.pendingDraw, 0);
  assert.strictEqual(s.turn, 3, 'and loses their turn');
});

test('Reverse +4 flips direction and hands the stack to the new next player', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const d2 = stage(s, 1, { kind: KIND.DRAW2, color: 'red' });
  E.playCard(s, 1, d2.id);
  assert.strictEqual(s.turn, 2);

  const rev4 = stage(s, 2, { kind: KIND.WILD_REV4, color: null });
  assert.ok(E.playCard(s, 2, rev4.id, { color: 'yellow' }).ok);
  assert.strictEqual(s.dir, -1);
  assert.strictEqual(s.pendingDraw, 6, '2 + 4');
  assert.strictEqual(s.turn, 1, 'back to whoever played into it');
});

test('heads-up, Reverse +4 sends the penalty back to the player who played it', () => {
  // "With just two players this card skips the other player and makes YOU draw 4."
  const s = E.createGame(P4.slice(0, 2), { rng: seeded(5) });
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const rev4 = stage(s, 0, { kind: KIND.WILD_REV4, color: null });
  assert.ok(E.playCard(s, 0, rev4.id, { color: 'blue' }).ok);
  assert.strictEqual(s.pendingDraw, 4);
  assert.strictEqual(s.turn, 0, 'it comes back to you');

  // "You may use the stacking rule to send the penalty back to the other player."
  const d6 = stage(s, 0, { kind: KIND.WILD_DRAW6, color: null });
  assert.ok(E.playCard(s, 0, d6.id, { color: 'red' }).ok);
  assert.strictEqual(s.pendingDraw, 10);
  assert.strictEqual(s.turn, 1, 'now the other player faces it');
});

// ── special cards ─────────────────────────────────────────

test('Skip jumps one player; heads-up Reverse acts as a Skip', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const skip = stage(s, 0, { kind: KIND.SKIP, color: 'red' });
  E.playCard(s, 0, skip.id);
  assert.strictEqual(s.turn, 2);

  const duel = E.createGame(P4.slice(0, 2), { rng: seeded(3) });
  setTop(duel, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const r2 = stage(duel, 0, { kind: KIND.REVERSE, color: 'red' });
  E.playCard(duel, 0, r2.id);
  assert.strictEqual(duel.turn, 0);
});

test('Skip Everyone returns the turn to the player who played it', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const sa = stage(s, 1, { kind: KIND.SKIP_ALL, color: 'red' });
  E.playCard(s, 1, sa.id);
  assert.strictEqual(s.turn, 1);
});

test('Discard All dumps every card of that colour out of the hand', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [
    { id: 'x1', kind: KIND.NUMBER, color: 'red', value: 1 },
    { id: 'x2', kind: KIND.NUMBER, color: 'red', value: 8 },
    { id: 'x3', kind: KIND.NUMBER, color: 'blue', value: 4 },
    { id: 'x4', kind: KIND.SKIP, color: 'red', value: null },
    { id: 'da', kind: KIND.DISCARD_ALL, color: 'red', value: null },
  ];
  s.turn = 0;
  assert.ok(E.playCard(s, 0, 'da').ok);
  assert.deepStrictEqual(s.players[0].hand.map((c) => c.id), ['x3']);
});

test('Discard All that clears the hand wins the game', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [
    { id: 'r1', kind: KIND.NUMBER, color: 'red', value: 1 },
    { id: 'da', kind: KIND.DISCARD_ALL, color: 'red', value: null },
  ];
  s.turn = 0;
  assert.ok(E.playCard(s, 0, 'da').won);
  assert.strictEqual(s.winner, 0);
});

test('a wild needs a colour, but Colour Roulette does not', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const w = stage(s, 0, { kind: KIND.WILD, color: null });
  assert.match(E.playCard(s, 0, w.id).error, /Choose a colour/);
  assert.match(E.playCard(s, 0, w.id, { color: 'purple' }).error, /Choose a colour/);
  assert.ok(E.playCard(s, 0, w.id, { color: 'blue' }).ok);
  assert.strictEqual(s.activeColor, 'blue');

  const rl = stage(s, 1, { kind: KIND.ROULETTE, color: null });
  assert.ok(E.playCard(s, 1, rl.id).ok, 'the victim names it, so none is needed here');
});

// ── colour roulette ───────────────────────────────────────

test('Colour Roulette: the VICTIM names the colour and digs for it', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const rl = stage(s, 0, { kind: KIND.ROULETTE, color: null });
  assert.ok(E.playCard(s, 0, rl.id).ok);

  assert.deepStrictEqual(s.awaiting, { type: 'roulette_color', playerIdx: 1 });
  assert.strictEqual(s.turn, 1, 'the turn pauses on the victim');
  assert.ok(E.privateView(s, 1).chooseRouletteColor);
  assert.ok(!E.privateView(s, 0).chooseRouletteColor);

  // Nobody else may act while the choice is outstanding.
  assert.ok(E.draw(s, 1).error);
  assert.match(E.chooseColor(s, 2, 'red').error, /Not your choice/);

  const before = s.players[1].hand.length;
  const res = E.chooseColor(s, 1, 'green');
  assert.ok(res.ok);
  assert.strictEqual(s.activeColor, 'green');
  assert.ok(res.drawn >= 1);
  assert.strictEqual(s.players[1].hand.length, before + res.drawn, 'they keep every revealed card');

  const last = s.players[1].hand.at(-1);
  assert.ok(!deck.isWild(last), 'wild cards do not count as a match');
  assert.strictEqual(last.color, 'green');
  assert.strictEqual(s.awaiting, null);
  assert.strictEqual(s.turn, 2, 'and they lose their turn');
});

// ── the 7-0 rule ──────────────────────────────────────────

test('a 7 MUST be swapped, and the target is required', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [{ id: 's7', kind: KIND.NUMBER, color: 'red', value: 7 },
                       { id: 'k1', kind: KIND.NUMBER, color: 'blue', value: 1 }];
  s.players[2].hand = [{ id: 'z1', kind: KIND.NUMBER, color: 'green', value: 2 }];
  s.turn = 0;

  assert.match(E.playCard(s, 0, 's7').error, /Choose the player/, 'the swap is mandatory');
  assert.ok(E.playCard(s, 0, 's7', { targetIdx: 2 }).ok);
  assert.deepStrictEqual(s.players[0].hand.map((c) => c.id), ['z1']);
  assert.deepStrictEqual(s.players[2].hand.map((c) => c.id), ['k1']);
});

test('a 0 passes every hand one seat along the direction of play', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players.forEach((p, i) => { p.hand = [{ id: `h${i}`, kind: KIND.NUMBER, color: 'blue', value: i }]; });
  s.players[0].hand = [{ id: 'z0', kind: KIND.NUMBER, color: 'red', value: 0 },
                       { id: 'h0', kind: KIND.NUMBER, color: 'blue', value: 0 }];
  s.turn = 0;
  s.dir = 1;

  assert.ok(E.playCard(s, 0, 'z0').ok);
  assert.deepStrictEqual(s.players[1].hand.map((c) => c.id), ['h0']);
  assert.deepStrictEqual(s.players[2].hand.map((c) => c.id), ['h1']);
  assert.deepStrictEqual(s.players[3].hand.map((c) => c.id), ['h2']);
  assert.deepStrictEqual(s.players[0].hand.map((c) => c.id), ['h3']);
});

// ── drawing: no passing ───────────────────────────────────

test('with nothing playable you draw until you can play, then must play it', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = dud(3, 'green', 5);   // no red, no 3, no wild
  s.turn = 0;

  const view = E.privateView(s, 0);
  assert.deepStrictEqual(view.legal, []);
  assert.ok(view.canDraw);

  const res = E.draw(s, 0);
  assert.ok(res.ok);
  assert.ok(res.drawn >= 1, 'drew at least one');
  assert.ok(res.mustPlay, 'and turned up something playable');
  assert.strictEqual(s.turn, 0, 'still your turn — there is no passing');

  // Only that card may be played now.
  const after = E.privateView(s, 0);
  assert.deepStrictEqual(after.legal, [res.mustPlay]);
  assert.ok(!after.canDraw, 'you cannot keep drawing');
  assert.match(E.draw(s, 0).error, /Play the card you just drew/);

  const other = s.players[0].hand.find((c) => c.id !== res.mustPlay);
  assert.match(E.playCard(s, 0, other.id).error, /Play the card you just drew/);
  assert.ok(E.playCard(s, 0, res.mustPlay, { color: 'red', targetIdx: 1 }).ok);
  assert.strictEqual(s.mustPlayCardId, null);
});

test('you cannot draw while holding a playable card', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [{ id: 'ok', kind: KIND.NUMBER, color: 'red', value: 9 }];
  s.turn = 0;
  assert.match(E.draw(s, 0).error, /play it/);
  assert.ok(!E.privateView(s, 0).canDraw);
});

test('there is no pass action', () => {
  assert.strictEqual(E.pass, undefined);
  assert.strictEqual(E.privateView(game(), 0).canPass, undefined);
});

test('the draw pile is rebuilt from the discard when it runs out', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = dud(2, 'green', 5);
  const spent = s.deck.splice(0, s.deck.length);
  s.discard.unshift(...spent);
  assert.strictEqual(s.deck.length, 0);

  s.turn = 0;
  assert.ok(E.draw(s, 0).ok);
  assert.ok(s.deck.length > 0 || s.players[0].hand.length > 2, 'pile refilled and drawn from');
  assert.ok(s.deck.every((c) => !deck.isWild(c) || c.color === null), 'recycled wilds lose their colour');
});

// ── no mercy ──────────────────────────────────────────────

test('reaching 25 cards puts a player out of the game', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[1].hand = dud(24);
  const d2 = stage(s, 0, { kind: KIND.DRAW2, color: 'red' });
  E.playCard(s, 0, d2.id);
  E.draw(s, 1);

  assert.strictEqual(s.players[1].eliminated, true);
  assert.strictEqual(s.players[1].hand.length, 0, 'their cards are set aside');
  assert.strictEqual(s.knockouts, 1);
  assert.notStrictEqual(s.turn, 1);
});

test('the last player standing wins', () => {
  const s = game();
  [1, 3].forEach((i) => { s.players[i].eliminated = true; s.players[i].hand = []; });
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[2].hand = dud(24);
  const d2 = stage(s, 0, { kind: KIND.DRAW2, color: 'red' });
  E.playCard(s, 0, d2.id);
  assert.strictEqual(s.turn, 2);
  E.draw(s, 2);
  assert.strictEqual(s.status, 'ended');
  assert.strictEqual(s.winner, 0);
});

test('playing your last card wins immediately', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [{ id: 'last', kind: KIND.NUMBER, color: 'red', value: 9 }];
  s.turn = 0;
  assert.ok(E.playCard(s, 0, 'last').won);
  assert.ok(E.draw(s, 1).error, 'no further moves once the game has ended');
});

// ── UNO calls ─────────────────────────────────────────────

test('a player on one card who stays quiet can be caught for +2', () => {
  const s = game();
  s.players[1].hand = [{ id: 'one', kind: KIND.NUMBER, color: 'red', value: 1 }];
  assert.ok(E.catchUno(s, 0, 1).ok);
  assert.strictEqual(s.players[1].hand.length, 1 + E.UNO_PENALTY);

  s.players[2].hand = [{ id: 'two', kind: KIND.NUMBER, color: 'red', value: 2 }];
  assert.ok(E.callUno(s, 2).ok);
  assert.match(E.catchUno(s, 0, 2).error, /Nothing to catch/);
  assert.match(E.catchUno(s, 0, 0).error, /cannot catch yourself/);
});

// ── optional scoring ──────────────────────────────────────

test('the winner scores the other hands plus 250 per knockout', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[1].hand = [{ id: 'n', kind: KIND.NUMBER, color: 'red', value: 9 },
                       { id: 'a', kind: KIND.DRAW4, color: 'red', value: null }];   // 9 + 20
  s.players[2].hand = [{ id: 'w', kind: KIND.WILD_DRAW10, color: null, value: null }]; // 50
  s.players[3].hand = [];
  s.players[3].eliminated = true;
  s.knockouts = 1;

  s.players[0].hand = [{ id: 'last', kind: KIND.NUMBER, color: 'red', value: 5 }];
  s.turn = 0;
  E.playCard(s, 0, 'last');

  const score = E.scoreRound(s);
  assert.strictEqual(score.winner, 0);
  assert.strictEqual(score.cards, 79, '9 + 20 + 50');
  assert.strictEqual(score.bonus, 250, 'one knockout');
  assert.strictEqual(score.total, 329);
  assert.strictEqual(E.TARGET_SCORE, 1000);
});

// ── views ─────────────────────────────────────────────────

test('the public view never leaks anyone\'s cards', () => {
  const view = E.publicView(game());
  assert.ok(!JSON.stringify(view).includes('"hand"'));
  view.players.forEach((p) => assert.strictEqual(p.handCount, 7));
  assert.strictEqual(view.mercyLimit, 25);
});

test('the private view lists only that player\'s own legal moves', () => {
  const s = game();
  s.turn = 0;
  const mine = E.privateView(s, 0);
  const theirs = E.privateView(s, 1);
  assert.strictEqual(mine.hand.length, 7);
  assert.ok(mine.yourTurn && !theirs.yourTurn);
  assert.deepStrictEqual(theirs.legal, []);
  mine.legal.forEach((id) =>
    assert.strictEqual(E.illegalReason(s, 0, mine.hand.find((c) => c.id === id)), null));
});

test('a live stack narrows the private view to draw cards only', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const d10 = stage(s, 0, { kind: KIND.WILD_DRAW10, color: null });
  E.playCard(s, 0, d10.id, { color: 'red' });

  const v = E.privateView(s, 1);
  assert.strictEqual(s.pendingDraw, 10);
  assert.ok(v.canDraw, 'taking the stack is always available');
  v.legal.forEach((id) => assert.ok(deck.drawValue(v.hand.find((c) => c.id === id)) >= 10));
});

// ── big tables ────────────────────────────────────────────

test('the deck deals a full table, and every size plays to a finish', () => {
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  for (const n of [2, 5, 6, 7, 10, 15, 20]) {
    const rng = seeded(n * 7919 + 1);
    const players = Array.from({ length: n }, (_, i) => ({ id: String(i), name: `P${i}` }));
    const s = E.createGame(players, { rng });

    assert.strictEqual(s.players.length, n);
    s.players.forEach((p) => assert.strictEqual(p.hand.length, E.HAND_SIZE, `${n}: everyone dealt 7`));
    assert.strictEqual(s.deck.length, 168 - n * E.HAND_SIZE - 1, `${n}: deck accounted for`);
    assert.ok(s.activeColor, `${n}: the starting card has a colour`);

    for (let turn = 0; turn < 20000 && s.status === 'playing'; turn++) {
      const me = s.turn;
      const view = E.privateView(s, me);
      let res;
      if (view.chooseRouletteColor) {
        res = E.chooseColor(s, me, pick(rng, deck.COLORS));
      } else if (view.legal.length > 0) {
        const others = E.activeIdxs(s).filter((i) => i !== me);
        res = E.playCard(s, me, pick(rng, view.legal),
          { color: pick(rng, deck.COLORS), targetIdx: pick(rng, others) });
      } else if (view.canDraw) {
        res = E.draw(s, me);
      } else {
        assert.fail(`${n} players: seat ${me} had no legal action`);
      }
      assert.ok(res.ok, `${n} players: rejected an advertised move (${res.error})`);
    }

    assert.strictEqual(s.status, 'ended', `${n} players never finished`);
    assert.ok(s.winner !== null && !s.players[s.winner].eliminated, `${n} players: bad winner`);
  }
});

test('a 0 rotates every hand correctly on a big table', () => {
  const n = 12;
  const players = Array.from({ length: n }, (_, i) => ({ id: String(i), name: `P${i}` }));
  const s = E.createGame(players, { rng: seeded(21) });
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players.forEach((p, i) => { p.hand = [{ id: `h${i}`, kind: KIND.NUMBER, color: 'blue', value: 1 }]; });
  s.players[0].hand = [{ id: 'z0', kind: KIND.NUMBER, color: 'red', value: 0 },
                       { id: 'h0', kind: KIND.NUMBER, color: 'blue', value: 1 }];
  s.turn = 0;
  s.dir = 1;

  assert.ok(E.playCard(s, 0, 'z0').ok);
  for (let i = 1; i < n; i++) {
    assert.deepStrictEqual(s.players[i].hand.map((c) => c.id), [`h${i - 1}`], `seat ${i} took seat ${i - 1}'s hand`);
  }
  assert.deepStrictEqual(s.players[0].hand.map((c) => c.id), [`h${n - 1}`], 'and the last wraps round');
});

// ── soak ──────────────────────────────────────────────────

test('300 random games always terminate with a legal winner', () => {
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  for (let seed = 0; seed < 300; seed++) {
    const rng = seeded(seed * 977 + 13);
    const s = E.createGame(P4, { rng });

    for (let turn = 0; turn < 6000 && s.status === 'playing'; turn++) {
      const me = s.turn;
      const view = E.privateView(s, me);

      let res;
      if (view.chooseRouletteColor) {
        res = E.chooseColor(s, me, pick(rng, deck.COLORS));
      } else if (view.legal.length > 0) {
        const id = pick(rng, view.legal);
        const others = E.activeIdxs(s).filter((i) => i !== me);
        res = E.playCard(s, me, id, { color: pick(rng, deck.COLORS), targetIdx: pick(rng, others) });
      } else if (view.canDraw) {
        res = E.draw(s, me);
      } else {
        assert.fail(`seed ${seed}: player ${me} had no legal action at all`);
      }
      assert.ok(res.ok, `seed ${seed}: engine rejected a move it advertised (${res.error})`);

      // Invariants after every single action.
      assert.ok(s.pendingDraw >= 0);
      s.players.forEach((p) => assert.ok(p.hand.length < E.MERCY_LIMIT || p.eliminated,
        `seed ${seed}: ${p.name} holds ${p.hand.length} and is still in`));
      if (s.status === 'playing') {
        assert.ok(!s.players[s.turn].eliminated, `seed ${seed}: turn sat on an eliminated player`);
      }
    }

    assert.strictEqual(s.status, 'ended', `seed ${seed} never finished`);
    assert.ok(s.winner !== null, `seed ${seed} ended with no winner`);
    assert.ok(!s.players[s.winner].eliminated);
    const score = E.scoreRound(s);
    assert.ok(score.total >= 0 && Number.isFinite(score.total), `seed ${seed}: bad score`);
  }
});
