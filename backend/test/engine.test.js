const test = require('node:test');
const assert = require('node:assert');

const deck = require('../src/game/deck');
const E = require('../src/game/engine');
const { KIND } = deck;

// Deterministic RNG so every run deals the same cards.
function seeded(seed = 42) {
  let x = seed;
  return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
}

const P4 = [
  { id: 'a', name: 'Arun' }, { id: 'b', name: 'Bala' },
  { id: 'c', name: 'Chitra' }, { id: 'd', name: 'Deepa' },
];

const game = (players = P4, seed = 7) => E.createGame(players, { rng: seeded(seed) });

// Force a specific card into a hand and make it that player's turn.
function stage(s, playerIdx, card) {
  const c = { id: `staged-${Math.random()}`, value: null, ...card };
  s.players[playerIdx].hand.push(c);
  s.turn = playerIdx;
  s.hasDrawn = false;
  return c;
}

function setTop(s, card) {
  const c = { id: `top-${Math.random()}`, value: null, ...card };
  s.discard.push(c);
  s.activeColor = c.color;
  return c;
}

// ── deck ──────────────────────────────────────────────────

test('deck is exactly 168 cards with the No Mercy composition', () => {
  const cards = deck.buildDeck();
  assert.strictEqual(cards.length, 168);

  const count = (k) => cards.filter((c) => c.kind === k).length;
  assert.strictEqual(count(KIND.NUMBER), 80, '0-9 twice per colour');
  for (const k of [KIND.SKIP, KIND.REVERSE, KIND.DRAW2, KIND.SKIP_ALL, KIND.DISCARD_ALL]) {
    assert.strictEqual(count(k), 8, `${k} appears twice per colour`);
  }
  for (const k of [KIND.WILD, KIND.WILD_DRAW4, KIND.WILD_DRAW6,
                   KIND.WILD_DRAW10, KIND.WILD_REV4, KIND.ROULETTE]) {
    assert.strictEqual(count(k), 8, `${k} x8`);
  }
  assert.strictEqual(new Set(cards.map((c) => c.id)).size, 168, 'ids are unique');
});

test('draw values match the No Mercy card faces', () => {
  assert.strictEqual(deck.drawValue({ kind: KIND.DRAW2 }), 2);
  assert.strictEqual(deck.drawValue({ kind: KIND.WILD_DRAW4 }), 4);
  assert.strictEqual(deck.drawValue({ kind: KIND.WILD_REV4 }), 4);
  assert.strictEqual(deck.drawValue({ kind: KIND.WILD_DRAW6 }), 6);
  assert.strictEqual(deck.drawValue({ kind: KIND.WILD_DRAW10 }), 10);
  assert.strictEqual(deck.drawValue({ kind: KIND.NUMBER }), 0);
});

// ── setup ─────────────────────────────────────────────────

test('deal gives everyone 7 cards and turns over a plain number', () => {
  const s = game();
  assert.strictEqual(s.players.length, 4);
  s.players.forEach((p) => assert.strictEqual(p.hand.length, E.HAND_SIZE));
  assert.strictEqual(E.topCard(s).kind, KIND.NUMBER, 'starter is never an action card');
  assert.strictEqual(s.activeColor, E.topCard(s).color);
  assert.strictEqual(s.deck.length, 168 - 4 * 7 - 1);
  assert.strictEqual(s.status, 'playing');
  assert.strictEqual(s.pendingDraw, 0);
});

// ── legality ──────────────────────────────────────────────

test('matching is by colour, by number, or by symbol', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 5 });
  s.turn = 0;

  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.NUMBER, color: 'red', value: 9 }), null, 'colour match');
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.NUMBER, color: 'blue', value: 5 }), null, 'number match');
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.SKIP, color: 'red' }), null, 'colour match on an action');
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.WILD, color: null }), null, 'wilds always play');
  assert.ok(E.illegalReason(s, 0, { kind: KIND.NUMBER, color: 'blue', value: 9 }), 'no match at all');

  setTop(s, { kind: KIND.SKIP, color: 'green' });
  assert.strictEqual(E.illegalReason(s, 0, { kind: KIND.SKIP, color: 'blue' }), null, 'symbol match across colours');
});

test('a player cannot move out of turn', () => {
  const s = game();
  s.turn = 0;
  assert.strictEqual(E.illegalReason(s, 1, { kind: KIND.WILD, color: null }), 'Not your turn');
  assert.ok(E.draw(s, 2).error);
  assert.ok(E.pass(s, 3).error);
});

// ── stacking ──────────────────────────────────────────────

test('draw cards stack, and only upward', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const d2 = stage(s, 0, { kind: KIND.DRAW2, color: 'red' });
  assert.ok(E.playCard(s, 0, d2.id).ok);
  assert.strictEqual(s.pendingDraw, 2);
  assert.strictEqual(s.turn, 1, 'stack lands on the next player');

  // +2 on a +2 is fine; a number is not.
  const num = stage(s, 1, { kind: KIND.NUMBER, color: 'red', value: 3 });
  assert.match(E.playCard(s, 1, num.id).error, /stack a draw card/);

  const d4 = stage(s, 1, { kind: KIND.WILD_DRAW4, color: null });
  assert.ok(E.playCard(s, 1, d4.id, { color: 'blue' }).ok);
  assert.strictEqual(s.pendingDraw, 6, '2 + 4');

  // Now the showing card is a +4, so a +2 is too small.
  const small = stage(s, 2, { kind: KIND.DRAW2, color: 'blue' });
  assert.match(E.playCard(s, 2, small.id).error, /\+4 or higher/);

  const d10 = stage(s, 2, { kind: KIND.WILD_DRAW10, color: null });
  assert.ok(E.playCard(s, 2, d10.id, { color: 'green' }).ok);
  assert.strictEqual(s.pendingDraw, 16, '2 + 4 + 10');
});

test('taking the stack draws the full total and passes the turn', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const d2 = stage(s, 0, { kind: KIND.DRAW2, color: 'red' });
  E.playCard(s, 0, d2.id);
  const d6 = stage(s, 1, { kind: KIND.WILD_DRAW6, color: null });
  E.playCard(s, 1, d6.id, { color: 'red' });
  assert.strictEqual(s.pendingDraw, 8);

  const before = s.players[2].hand.length;
  const res = E.draw(s, 2);
  assert.strictEqual(res.took, 8);
  assert.strictEqual(s.players[2].hand.length, before + 8);
  assert.strictEqual(s.pendingDraw, 0);
  assert.strictEqual(s.turn, 3);
});

test('Reverse +4 flips direction and hands the stack backwards', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const d2 = stage(s, 1, { kind: KIND.DRAW2, color: 'red' });
  s.turn = 1;
  E.playCard(s, 1, d2.id);
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.pendingDraw, 2);

  const rev4 = stage(s, 2, { kind: KIND.WILD_REV4, color: null });
  assert.ok(E.playCard(s, 2, rev4.id, { color: 'yellow' }).ok);
  assert.strictEqual(s.dir, -1, 'direction flipped');
  assert.strictEqual(s.pendingDraw, 6, '2 + 4');
  assert.strictEqual(s.turn, 1, 'the stack goes back to whoever played into it');
});

// ── special cards ─────────────────────────────────────────

test('Skip jumps one player; Reverse flips; heads-up Reverse acts as a Skip', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const skip = stage(s, 0, { kind: KIND.SKIP, color: 'red' });
  E.playCard(s, 0, skip.id);
  assert.strictEqual(s.turn, 2, 'player 1 was skipped');

  const rev = stage(s, 2, { kind: KIND.REVERSE, color: 'red' });
  E.playCard(s, 2, rev.id);
  assert.strictEqual(s.dir, -1);
  assert.strictEqual(s.turn, 1);

  const duel = E.createGame(P4.slice(0, 2), { rng: seeded(3) });
  setTop(duel, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const r2 = stage(duel, 0, { kind: KIND.REVERSE, color: 'red' });
  E.playCard(duel, 0, r2.id);
  assert.strictEqual(duel.turn, 0, 'with two players a Reverse comes straight back');
});

test('Skip Everyone returns the turn to the player who played it', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const sa = stage(s, 1, { kind: KIND.SKIP_ALL, color: 'red' });
  s.turn = 1;
  E.playCard(s, 1, sa.id);
  assert.strictEqual(s.turn, 1, 'you play again');
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
  assert.deepStrictEqual(s.players[0].hand.map((c) => c.id), ['x3'], 'only the blue card survives');
});

test('Discard All that clears the hand wins the game', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [
    { id: 'r1', kind: KIND.NUMBER, color: 'red', value: 1 },
    { id: 'da', kind: KIND.DISCARD_ALL, color: 'red', value: null },
  ];
  s.turn = 0;
  const res = E.playCard(s, 0, 'da');
  assert.ok(res.won);
  assert.strictEqual(s.status, 'ended');
  assert.strictEqual(s.winner, 0);
});

test('Colour Roulette makes the next player draw until the colour turns up', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const rl = stage(s, 0, { kind: KIND.ROULETTE, color: null });
  const before = s.players[1].hand.length;
  assert.ok(E.playCard(s, 0, rl.id, { color: 'green' }).ok);

  const gained = s.players[1].hand.length - before;
  assert.ok(gained >= 1, 'the victim drew at least one card');
  assert.strictEqual(s.players[1].hand.at(-1).color, 'green', 'they stopped on the named colour');
  assert.strictEqual(s.activeColor, 'green');
  assert.strictEqual(s.turn, 2, 'the victim also loses their turn');
});

test('a wild needs a colour choice', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const w = stage(s, 0, { kind: KIND.WILD, color: null });
  assert.match(E.playCard(s, 0, w.id).error, /Choose a colour/);
  assert.match(E.playCard(s, 0, w.id, { color: 'purple' }).error, /Choose a colour/);
  assert.ok(E.playCard(s, 0, w.id, { color: 'blue' }).ok);
  assert.strictEqual(s.activeColor, 'blue');
});

// ── the 7-0 rule ──────────────────────────────────────────

test('a 7 swaps hands with the chosen player', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [{ id: 's7', kind: KIND.NUMBER, color: 'red', value: 7 },
                       { id: 'k1', kind: KIND.NUMBER, color: 'blue', value: 1 }];
  s.players[2].hand = [{ id: 'z1', kind: KIND.NUMBER, color: 'green', value: 2 }];
  s.turn = 0;

  assert.ok(E.playCard(s, 0, 's7', { targetIdx: 2 }).ok);
  assert.deepStrictEqual(s.players[0].hand.map((c) => c.id), ['z1'], 'took player 2\'s hand');
  assert.deepStrictEqual(s.players[2].hand.map((c) => c.id), ['k1'], 'gave away the rest of theirs');
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
  assert.deepStrictEqual(s.players[1].hand.map((c) => c.id), ['h0'], 'p0 -> p1');
  assert.deepStrictEqual(s.players[2].hand.map((c) => c.id), ['h1'], 'p1 -> p2');
  assert.deepStrictEqual(s.players[3].hand.map((c) => c.id), ['h2'], 'p2 -> p3');
  assert.deepStrictEqual(s.players[0].hand.map((c) => c.id), ['h3'], 'p3 wraps to p0');
});

test('the 7-0 rule can be switched off', () => {
  const s = E.createGame(P4, { rng: seeded(9), sevenZero: false });
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [{ id: 's7', kind: KIND.NUMBER, color: 'red', value: 7 },
                       { id: 'k1', kind: KIND.NUMBER, color: 'blue', value: 1 }];
  const p2 = s.players[2].hand.slice();
  s.turn = 0;
  E.playCard(s, 0, 's7', { targetIdx: 2 });
  assert.deepStrictEqual(s.players[0].hand.map((c) => c.id), ['k1'], 'no swap happened');
  assert.deepStrictEqual(s.players[2].hand, p2);
});

// ── no mercy ──────────────────────────────────────────────

test('reaching 25 cards eliminates a player on the spot', () => {
  const s = game();
  const filler = (n) => Array.from({ length: n }, (_, i) =>
    ({ id: `f${i}-${Math.random()}`, kind: KIND.NUMBER, color: 'blue', value: 4 }));

  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[1].hand = filler(24);
  const d2 = stage(s, 0, { kind: KIND.DRAW2, color: 'red' });
  E.playCard(s, 0, d2.id);              // +2 lands on player 1
  E.draw(s, 1);                          // they take it -> 26 cards

  assert.strictEqual(s.players[1].eliminated, true, `${E.MERCY_LIMIT} is the limit`);
  assert.strictEqual(s.players[1].hand.length, 0, 'their cards return to the pile');
  assert.notStrictEqual(s.turn, 1, 'the turn skips the eliminated seat');
});

test('the last player standing wins', () => {
  const s = game();
  s.players[1].eliminated = true;
  s.players[1].hand = [];
  s.players[3].eliminated = true;
  s.players[3].hand = [];

  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[2].hand = Array.from({ length: 24 }, (_, i) =>
    ({ id: `g${i}`, kind: KIND.NUMBER, color: 'blue', value: 4 }));
  const d2 = stage(s, 0, { kind: KIND.DRAW2, color: 'red' });
  s.turn = 0;
  E.playCard(s, 0, d2.id);
  assert.strictEqual(s.turn, 2, 'only player 2 is left to receive it');
  E.draw(s, 2);

  assert.strictEqual(s.status, 'ended');
  assert.strictEqual(s.winner, 0, 'player 0 is the last one standing');
});

test('emptying your hand wins immediately', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.players[0].hand = [{ id: 'last', kind: KIND.NUMBER, color: 'red', value: 9 }];
  s.turn = 0;
  const res = E.playCard(s, 0, 'last');
  assert.ok(res.won);
  assert.strictEqual(s.winner, 0);
  assert.ok(E.draw(s, 1).error, 'no further moves once the game has ended');
});

// ── draw / pass ───────────────────────────────────────────

test('drawing then passing moves the turn on', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  s.turn = 0;
  const before = s.players[0].hand.length;

  assert.ok(E.pass(s, 0).error, 'cannot pass without drawing');
  assert.ok(E.draw(s, 0).ok);
  assert.strictEqual(s.players[0].hand.length, before + 1);
  assert.ok(E.draw(s, 0).error, 'only one draw per turn');
  assert.ok(E.pass(s, 0).ok);
  assert.strictEqual(s.turn, 1);
  assert.strictEqual(s.hasDrawn, false);
});

test('the draw pile is rebuilt from the discard when it runs out', () => {
  const s = game();
  const spent = s.deck.splice(0, s.deck.length);
  s.discard.unshift(...spent);            // everything but the top card is used up
  assert.strictEqual(s.deck.length, 0);

  const top = E.topCard(s);
  s.turn = 0;
  assert.ok(E.draw(s, 0).ok);
  assert.ok(s.deck.length > 0, 'pile refilled');
  assert.strictEqual(E.topCard(s), top, 'the showing card stays put');
  assert.ok(s.deck.every((c) => !deck.isWild(c) || c.color === null), 'recycled wilds lose their colour');
});

// ── UNO calls ─────────────────────────────────────────────

test('a player on one card who stays quiet can be caught for +2', () => {
  const s = game();
  s.players[1].hand = [{ id: 'one', kind: KIND.NUMBER, color: 'red', value: 1 }];
  s.players[1].calledUno = false;

  assert.ok(E.catchUno(s, 0, 1).ok);
  assert.strictEqual(s.players[1].hand.length, 1 + E.UNO_PENALTY);

  s.players[2].hand = [{ id: 'two', kind: KIND.NUMBER, color: 'red', value: 2 }];
  assert.ok(E.callUno(s, 2).ok);
  assert.match(E.catchUno(s, 0, 2).error, /Nothing to catch/);
  assert.match(E.catchUno(s, 0, 0).error, /cannot catch yourself/);
});

// ── views ─────────────────────────────────────────────────

test('the public view never leaks anyone\'s cards', () => {
  const s = game();
  const view = E.publicView(s);
  const json = JSON.stringify(view);
  assert.ok(!json.includes('"hand"'), 'no hands in the shared view');
  view.players.forEach((p) => {
    assert.strictEqual(p.handCount, 7);
    assert.ok(p.danger > 0 && p.danger < 1);
  });
  assert.strictEqual(view.mercyLimit, E.MERCY_LIMIT);
});

test('the private view lists only that player\'s own legal moves', () => {
  const s = game();
  s.turn = 0;
  const mine = E.privateView(s, 0);
  const theirs = E.privateView(s, 1);

  assert.strictEqual(mine.hand.length, 7);
  assert.ok(mine.yourTurn);
  assert.ok(!theirs.yourTurn);
  assert.deepStrictEqual(theirs.legal, [], 'no move hints while it is not your turn');
  mine.legal.forEach((id) => {
    assert.strictEqual(E.illegalReason(s, 0, mine.hand.find((c) => c.id === id)), null);
  });
});

test('a live stack narrows the private view to draw cards only', () => {
  const s = game();
  setTop(s, { kind: KIND.NUMBER, color: 'red', value: 3 });
  const d10 = stage(s, 0, { kind: KIND.WILD_DRAW10, color: null });
  E.playCard(s, 0, d10.id, { color: 'red' });

  const v = E.privateView(s, 1);
  assert.strictEqual(s.pendingDraw, 10);
  assert.ok(v.canDraw, 'taking the stack is always available');
  assert.ok(!v.canPass, 'you cannot pass out of a stack');
  v.legal.forEach((id) => {
    assert.ok(deck.drawValue(v.hand.find((c) => c.id === id)) >= 10);
  });
});

// ── soak ──────────────────────────────────────────────────

test('200 random games always terminate with a legal winner', () => {
  for (let seed = 0; seed < 200; seed++) {
    const rng = seeded(seed * 977 + 13);
    const s = E.createGame(P4, { rng });

    for (let turn = 0; turn < 4000 && s.status === 'playing'; turn++) {
      const me = s.turn;
      const view = E.privateView(s, me);
      if (!view.yourTurn) { break; }

      if (view.legal.length > 0) {
        const id = view.legal[Math.floor(rng() * view.legal.length)];
        const card = s.players[me].hand.find((c) => c.id === id);
        const others = E.activeIdxs(s).filter((i) => i !== me);
        const res = E.playCard(s, me, id, {
          color: ['red', 'yellow', 'green', 'blue'][Math.floor(rng() * 4)],
          targetIdx: others[Math.floor(rng() * others.length)],
        });
        assert.ok(res.ok, `seed ${seed}: engine rejected a move it advertised as legal (${res.error})`);
      } else if (view.canDraw) {
        assert.ok(E.draw(s, me).ok, `seed ${seed}: draw failed`);
      } else if (view.canPass) {
        assert.ok(E.pass(s, me).ok, `seed ${seed}: pass failed`);
      } else {
        assert.fail(`seed ${seed}: player ${me} had no legal action at all`);
      }

      // Invariants that must hold after every single action.
      assert.ok(s.pendingDraw >= 0);
      s.players.forEach((p) => {
        assert.ok(p.hand.length < E.MERCY_LIMIT || p.eliminated,
          `seed ${seed}: ${p.name} holds ${p.hand.length} and is still in`);
      });
      if (s.status === 'playing') {
        assert.ok(!s.players[s.turn].eliminated, `seed ${seed}: turn sat on an eliminated player`);
      }
    }

    assert.strictEqual(s.status, 'ended', `seed ${seed} never finished`);
    assert.ok(s.winner !== null, `seed ${seed} ended with no winner`);
    assert.ok(!s.players[s.winner].eliminated, `seed ${seed}: winner was eliminated`);
  }
});
