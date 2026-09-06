// UNO No Mercy — server-authoritative rules engine.
//
// Pure and synchronous: every function takes state and mutates it in place,
// returning { ok } or { error }. No sockets, no timers, no I/O — so the whole
// rule set is testable without a server.
//
// The signature No Mercy rules implemented here:
//   * draw cards stack, and you may only stack a card worth >= the one showing
//   * a player who reaches MERCY_LIMIT cards is knocked out on the spot
//   * playing a 7 swaps your hand with a player of your choice
//   * playing a 0 passes every hand one seat along the direction of play
//   * Skip Everyone gives the turn straight back to you
//   * Discard All dumps every card of that colour out of your hand
//   * Colour Roulette makes the next player draw until they hit the colour
//   * Reverse +4 flips direction and hands the stack to the new next player

const {
  COLORS, KIND, isWild, drawValue, isDrawCard, label, buildDeck, shuffle,
} = require('./deck');

const HAND_SIZE = 7;
const MERCY_LIMIT = 25;      // hold this many and you are out
const UNO_PENALTY = 2;
const ROULETTE_CAP = 40;     // safety valve if the colour never turns up

// ── helpers ───────────────────────────────────────────────

const activeIdxs = (s) => s.players.map((p, i) => i).filter((i) => !s.players[i].eliminated);

function nextIdx(s, from = s.turn, steps = 1) {
  const live = activeIdxs(s);
  if (live.length === 0) return from;
  // Walk seat by seat so eliminated players are stepped over, not counted.
  let cur = from;
  for (let n = 0; n < steps; n++) {
    do {
      cur = (cur + s.dir + s.players.length) % s.players.length;
    } while (s.players[cur].eliminated);
  }
  return cur;
}

function log(s, text) {
  s.log.push({ t: Date.now(), text });
  if (s.log.length > 60) s.log.shift();
}

// Refill the draw pile from the discard when it runs dry, keeping the top card.
function refill(s) {
  if (s.deck.length > 0 || s.discard.length <= 1) return;
  const top = s.discard.pop();
  const recycled = s.discard.splice(0, s.discard.length);
  // Wilds go back colourless so they can be re-chosen.
  recycled.forEach((c) => { if (isWild(c)) c.color = null; });
  s.deck = shuffle(recycled, s.rng);
  s.discard = [top];
  log(s, 'Draw pile reshuffled');
}

function drawCards(s, playerIdx, count) {
  const player = s.players[playerIdx];
  const drawn = [];
  for (let i = 0; i < count; i++) {
    refill(s);
    if (s.deck.length === 0) break; // genuinely nothing left to give
    drawn.push(s.deck.pop());
  }
  player.hand.push(...drawn);
  if (player.hand.length !== 1) player.calledUno = false;
  return drawn;
}

// Anyone at or past the limit is out. Their cards go back to the discard so the
// deck does not bleed away over a long game.
function applyMercy(s) {
  const knockedOut = [];
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (p.eliminated || p.hand.length < MERCY_LIMIT) continue;
    p.eliminated = true;
    p.eliminatedAt = Date.now();
    s.discard.unshift(...p.hand.splice(0, p.hand.length));
    knockedOut.push(i);
    log(s, `${p.name} hit ${MERCY_LIMIT} cards — NO MERCY, eliminated`);
  }
  return knockedOut;
}

function checkGameOver(s) {
  const live = activeIdxs(s);
  if (live.length <= 1 && s.status === 'playing') {
    s.status = 'ended';
    s.winner = live.length === 1 ? live[0] : null;
    if (s.winner !== null) log(s, `${s.players[s.winner].name} is the last player standing`);
  }
  return s.status === 'ended';
}

const topCard = (s) => s.discard[s.discard.length - 1];

// ── legality ──────────────────────────────────────────────

// Why a card can or cannot be played right now. Returns null when it is legal.
function illegalReason(s, playerIdx, card) {
  if (s.status !== 'playing') return 'Game is over';
  if (s.turn !== playerIdx) return 'Not your turn';

  const top = topCard(s);

  // A live draw stack narrows the options to draw cards of equal or greater value.
  if (s.pendingDraw > 0) {
    if (!isDrawCard(card)) return 'You must stack a draw card or take the stack';
    if (drawValue(card) < drawValue(top)) {
      return `Stack must be +${drawValue(top)} or higher`;
    }
    return null;
  }

  if (isWild(card)) return null;
  if (card.color === s.activeColor) return null;
  if (card.kind === KIND.NUMBER && top.kind === KIND.NUMBER && card.value === top.value) return null;
  if (card.kind !== KIND.NUMBER && card.kind === top.kind) return null;

  return 'Card does not match the colour or symbol';
}

function legalCardIds(s, playerIdx) {
  const p = s.players[playerIdx];
  if (!p || p.eliminated) return [];
  return p.hand.filter((c) => illegalReason(s, playerIdx, c) === null).map((c) => c.id);
}

// ── setup ─────────────────────────────────────────────────

function createGame(players, { rng = Math.random, sevenZero = true } = {}) {
  const s = {
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || '🃏',
      hand: [],
      eliminated: false,
      calledUno: false,
    })),
    deck: shuffle(buildDeck(), rng),
    discard: [],
    activeColor: null,
    dir: 1,
    turn: 0,
    pendingDraw: 0,
    hasDrawn: false,
    status: 'playing',
    winner: null,
    lastAction: null,
    log: [],
    rules: { sevenZero },
    rng,
  };

  s.players.forEach((_, i) => drawCards(s, i, HAND_SIZE));

  // Turn over a starter. Keep going until it is a plain number so the first
  // player is never handed a stack or a colour choice before they have moved.
  let starter = s.deck.pop();
  while (starter.kind !== KIND.NUMBER) {
    s.deck.unshift(starter);
    starter = s.deck.pop();
  }
  s.discard.push(starter);
  s.activeColor = starter.color;
  log(s, `Starting card: ${starter.color} ${label(starter)}`);
  return s;
}

// ── card effects ──────────────────────────────────────────

// Everyone still in passes their hand one seat along the current direction.
function rotateHands(s) {
  const live = activeIdxs(s);
  if (live.length < 2) return;
  const order = s.dir === 1 ? live : live.slice().reverse();
  const hands = order.map((i) => s.players[i].hand);
  order.forEach((seat, n) => {
    s.players[seat].hand = hands[(n - 1 + hands.length) % hands.length];
    s.players[seat].calledUno = false;
  });
}

function applyEffect(s, playerIdx, card, opts) {
  const me = s.players[playerIdx];

  switch (card.kind) {
    case KIND.NUMBER: {
      if (!s.rules.sevenZero) break;
      if (card.value === 7) {
        const target = opts.targetIdx;
        const swappable = activeIdxs(s).filter((i) => i !== playerIdx);
        if (swappable.length > 0) {
          const t = swappable.includes(target) ? target : swappable[0];
          const mine = me.hand;
          me.hand = s.players[t].hand;
          s.players[t].hand = mine;
          me.calledUno = false;
          s.players[t].calledUno = false;
          log(s, `${me.name} played a 7 and swapped hands with ${s.players[t].name}`);
        }
      } else if (card.value === 0) {
        rotateHands(s);
        log(s, `${me.name} played a 0 — everyone passed their hand along`);
      }
      break;
    }

    case KIND.SKIP:
      s.turn = nextIdx(s, playerIdx, 2);
      log(s, `${me.name} skipped ${s.players[nextIdx(s, playerIdx, 1)].name}`);
      return;

    case KIND.REVERSE: {
      s.dir *= -1;
      log(s, `${me.name} reversed the direction`);
      // Heads-up, a reverse is a skip — the turn comes straight back.
      if (activeIdxs(s).length === 2) { s.turn = playerIdx; return; }
      break;
    }

    case KIND.SKIP_ALL:
      log(s, `${me.name} skipped everyone and plays again`);
      s.turn = playerIdx;
      return;

    case KIND.DISCARD_ALL: {
      const dumped = me.hand.filter((c) => c.color === card.color);
      me.hand = me.hand.filter((c) => c.color !== card.color);
      s.discard.unshift(...dumped);
      log(s, `${me.name} discarded ${dumped.length + 1} ${card.color} card(s)`);
      break;
    }

    case KIND.DRAW2:
    case KIND.WILD_DRAW4:
    case KIND.WILD_DRAW6:
    case KIND.WILD_DRAW10:
      s.pendingDraw += drawValue(card);
      log(s, `${me.name} played ${label(card)} — stack is now +${s.pendingDraw}`);
      break;

    case KIND.WILD_REV4:
      s.dir *= -1;
      s.pendingDraw += 4;
      log(s, `${me.name} reversed and pushed the stack to +${s.pendingDraw}`);
      break;

    case KIND.ROULETTE: {
      const victim = nextIdx(s, playerIdx, 1);
      if (victim !== playerIdx) {
        let taken = 0;
        while (taken < ROULETTE_CAP) {
          const drawn = drawCards(s, victim, 1);
          if (drawn.length === 0) break;      // pile exhausted
          taken++;
          if (drawn[0].color === s.activeColor) break;
        }
        log(s, `${me.name} spun the roulette — ${s.players[victim].name} drew ${taken} to find ${s.activeColor}`);
      }
      // The victim has had their turn burned looking for the colour.
      s.turn = nextIdx(s, playerIdx, 2);
      return;
    }

    default:
      break;
  }

  s.turn = nextIdx(s, playerIdx, 1);
}

// ── actions ───────────────────────────────────────────────

function playCard(s, playerIdx, cardId, opts = {}) {
  const player = s.players[playerIdx];
  if (!player || player.eliminated) return { error: 'You are out of this game' };

  const handIdx = player.hand.findIndex((c) => c.id === cardId);
  if (handIdx < 0) return { error: 'Card not in your hand' };

  const card = player.hand[handIdx];
  const reason = illegalReason(s, playerIdx, card);
  if (reason) return { error: reason };

  if (isWild(card) && !COLORS.includes(opts.color)) {
    return { error: 'Choose a colour for that wild' };
  }

  player.hand.splice(handIdx, 1);
  if (isWild(card)) card.color = opts.color;
  s.discard.push(card);
  s.activeColor = card.color;
  s.hasDrawn = false;
  s.lastAction = { type: 'play', playerIdx, card: { ...card }, label: label(card) };
  if (card.kind !== KIND.DISCARD_ALL && card.kind !== KIND.NUMBER) {
    log(s, `${player.name} played ${card.color} ${label(card)}`);
  }

  // Emptying your hand wins immediately, before any effect resolves.
  if (player.hand.length === 0) {
    s.status = 'ended';
    s.winner = playerIdx;
    log(s, `${player.name} went out and wins!`);
    return { ok: true, won: true };
  }

  applyEffect(s, playerIdx, card, opts);

  // Discard All can clear the rest of a hand on the way out.
  if (player.hand.length === 0 && !player.eliminated) {
    s.status = 'ended';
    s.winner = playerIdx;
    log(s, `${player.name} went out and wins!`);
    return { ok: true, won: true };
  }

  // A 7-swap or a 0-rotation can push someone over the limit.
  applyMercy(s);
  if (checkGameOver(s)) return { ok: true };

  // If the effect left the turn on an eliminated seat, move it along.
  if (s.players[s.turn].eliminated) s.turn = nextIdx(s, s.turn, 1);
  if (player.hand.length !== 1) player.calledUno = false;
  return { ok: true };
}

// Draw: takes the whole stack when one is live, otherwise a single card.
function draw(s, playerIdx) {
  if (s.status !== 'playing') return { error: 'Game is over' };
  if (s.turn !== playerIdx) return { error: 'Not your turn' };
  const player = s.players[playerIdx];

  if (s.pendingDraw > 0) {
    const count = s.pendingDraw;
    s.pendingDraw = 0;
    drawCards(s, playerIdx, count);
    log(s, `${player.name} took the +${count} stack`);
    s.hasDrawn = false;
    s.lastAction = { type: 'take_stack', playerIdx, count };
    applyMercy(s);
    if (checkGameOver(s)) return { ok: true, took: count };
    s.turn = nextIdx(s, playerIdx, 1);
    if (s.players[s.turn].eliminated) s.turn = nextIdx(s, s.turn, 1);
    return { ok: true, took: count };
  }

  if (s.hasDrawn) return { error: 'You already drew — play a card or pass' };

  const drawn = drawCards(s, playerIdx, 1);
  s.hasDrawn = true;
  s.lastAction = { type: 'draw', playerIdx, count: drawn.length };
  log(s, `${player.name} drew a card`);
  applyMercy(s);
  if (checkGameOver(s)) return { ok: true, drawn: drawn.length };
  if (s.players[playerIdx].eliminated) {
    s.turn = nextIdx(s, playerIdx, 1);
    s.hasDrawn = false;
  }
  return { ok: true, drawn: drawn.length };
}

function pass(s, playerIdx) {
  if (s.status !== 'playing') return { error: 'Game is over' };
  if (s.turn !== playerIdx) return { error: 'Not your turn' };
  if (s.pendingDraw > 0) return { error: 'Take the stack or play a draw card' };
  if (!s.hasDrawn) return { error: 'You must draw before passing' };
  s.hasDrawn = false;
  s.lastAction = { type: 'pass', playerIdx };
  s.turn = nextIdx(s, playerIdx, 1);
  return { ok: true };
}

function callUno(s, playerIdx) {
  const player = s.players[playerIdx];
  if (!player || player.eliminated) return { error: 'You are out of this game' };
  if (player.hand.length > 2) return { error: 'Too early to call UNO' };
  player.calledUno = true;
  log(s, `${player.name} called UNO!`);
  return { ok: true };
}

// Catch a player sitting on one card who never called it.
function catchUno(s, accuserIdx, targetIdx) {
  const target = s.players[targetIdx];
  if (!target || target.eliminated) return { error: 'No such player' };
  if (accuserIdx === targetIdx) return { error: 'You cannot catch yourself' };
  if (target.hand.length !== 1 || target.calledUno) return { error: 'Nothing to catch' };
  drawCards(s, targetIdx, UNO_PENALTY);
  log(s, `${s.players[accuserIdx].name} caught ${target.name} — +${UNO_PENALTY}`);
  applyMercy(s);
  checkGameOver(s);
  return { ok: true };
}

// ── views ─────────────────────────────────────────────────

// What every player is allowed to see. Hands are counts only.
function publicView(s) {
  return {
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      handCount: p.hand.length,
      eliminated: p.eliminated,
      calledUno: p.calledUno,
      // How close this player is to being knocked out.
      danger: p.eliminated ? 1 : Math.min(1, p.hand.length / MERCY_LIMIT),
    })),
    topCard: topCard(s) ? { ...topCard(s), label: label(topCard(s)) } : null,
    activeColor: s.activeColor,
    dir: s.dir,
    turn: s.turn,
    pendingDraw: s.pendingDraw,
    deckCount: s.deck.length,
    status: s.status,
    winner: s.winner,
    lastAction: s.lastAction,
    mercyLimit: MERCY_LIMIT,
    log: s.log.slice(-12),
  };
}

// The private slice for one seat: their cards, and what they may do with them.
function privateView(s, playerIdx) {
  const p = s.players[playerIdx];
  if (!p) return null;
  const yourTurn = s.turn === playerIdx && s.status === 'playing' && !p.eliminated;
  return {
    playerIdx,
    hand: p.hand.map((c) => ({ ...c, label: label(c) })),
    legal: yourTurn ? legalCardIds(s, playerIdx) : [],
    yourTurn,
    canDraw: yourTurn && (s.pendingDraw > 0 || !s.hasDrawn),
    canPass: yourTurn && s.hasDrawn && s.pendingDraw === 0,
    mustTakeStack: yourTurn && s.pendingDraw > 0 && legalCardIds(s, playerIdx).length === 0,
  };
}

module.exports = {
  HAND_SIZE, MERCY_LIMIT, UNO_PENALTY,
  createGame, playCard, draw, pass, callUno, catchUno,
  legalCardIds, illegalReason, publicView, privateView,
  topCard, activeIdxs, nextIdx, applyMercy, drawCards, refill,
};
