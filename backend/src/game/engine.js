// UNO Show 'em No Mercy — server-authoritative rules engine.
// Follows Mattel instruction sheet HVW18 (©2023).
//
// Pure and synchronous: every function takes state and mutates it in place,
// returning { ok } or { error }. No sockets, no timers, no I/O — so the whole
// rule set is testable without a server.
//
// The rules that make it No Mercy:
//   * draw cards stack; you may only answer with equal or greater value
//   * a player holding MERCY_LIMIT cards is out of the game on the spot
//   * a 7 MUST be swapped with a player of your choice
//   * a 0 passes every hand one seat along the direction of play
//   * Skip Everyone gives the turn straight back to you
//   * Discard All dumps every card of that colour out of your hand
//   * Colour Roulette — the VICTIM names a colour, then reveals cards until
//     they turn one up (wilds never count), keeps them all, and loses the turn
//   * Reverse +4 flips direction and hands the stack to the new next player;
//     heads-up, that is the player who played it
//
// And the one that catches people out: there is no passing. With no playable
// card you draw until you turn one up, and then you must play it.

const {
  COLORS, KIND, isWild, needsColorChoice, drawValue, isDrawCard, points, label,
  buildDeck, shuffle,
} = require('./deck');

const HAND_SIZE = 7;
const MERCY_LIMIT = 25;      // hold this many and you are out
const UNO_PENALTY = 2;
const KNOCKOUT_POINTS = 250; // per player knocked out, in the scoring game
const TARGET_SCORE = 1000;
const DRAW_CAP = 60;         // safety valve when the pile cannot satisfy a draw

// ── helpers ───────────────────────────────────────────────

const activeIdxs = (s) => s.players.map((p, i) => i).filter((i) => !s.players[i].eliminated);

function nextIdx(s, from = s.turn, steps = 1) {
  if (activeIdxs(s).length === 0) return from;
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

// Anyone at or past the limit is out. Their cards are set aside — here, back to
// the bottom of the discard, so they return with the next reshuffle.
function applyMercy(s) {
  const knockedOut = [];
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    if (p.eliminated || p.hand.length < MERCY_LIMIT) continue;
    p.eliminated = true;
    s.discard.unshift(...p.hand.splice(0, p.hand.length));
    s.knockouts += 1;
    knockedOut.push(i);
    log(s, `${p.name} hit ${MERCY_LIMIT} cards — NO MERCY, out of the game`);
  }
  return knockedOut;
}

function endGame(s, winner) {
  s.status = 'ended';
  s.winner = winner;
  s.awaiting = null;
  s.mustPlayCardId = null;
}

function checkGameOver(s) {
  const live = activeIdxs(s);
  if (live.length <= 1 && s.status === 'playing') {
    endGame(s, live.length === 1 ? live[0] : null);
    if (s.winner !== null) log(s, `${s.players[s.winner].name} is the last player standing`);
  }
  return s.status === 'ended';
}

const topCard = (s) => s.discard[s.discard.length - 1];

// ── legality ──────────────────────────────────────────────

// Why a card can or cannot be played right now. Returns null when it is legal.
function illegalReason(s, playerIdx, card) {
  if (s.status !== 'playing') return 'Game is over';
  if (s.awaiting) return 'Waiting on a colour for the Colour Roulette';
  if (s.turn !== playerIdx) return 'Not your turn';

  // Having drawn into a playable card, that is the card you play.
  if (s.mustPlayCardId && card.id !== s.mustPlayCardId) {
    return 'Play the card you just drew';
  }

  const top = topCard(s);

  // A live draw stack narrows the options to draw cards of equal or greater value.
  if (s.pendingDraw > 0) {
    if (!isDrawCard(card)) return 'You must stack a draw card or take the stack';
    if (drawValue(card) < drawValue(top)) return `Stack must be +${drawValue(top)} or higher`;
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
    mustPlayCardId: null,   // set after drawing into a playable card
    awaiting: null,         // { type: 'roulette_color', playerIdx }
    status: 'playing',
    winner: null,
    knockouts: 0,
    lastAction: null,
    log: [],
    rules: { sevenZero },
    rng,
  };

  s.players.forEach((_, i) => drawCards(s, i, HAND_SIZE));

  // "Flip over the top card... If this card is an Action Card, ignore it and
  // flip over the next card."
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
  const headsUp = activeIdxs(s).length === 2;

  switch (card.kind) {
    case KIND.NUMBER: {
      if (!s.rules.sevenZero) break;
      if (card.value === 7) {
        const swappable = activeIdxs(s).filter((i) => i !== playerIdx);
        if (swappable.length > 0) {
          const t = swappable.includes(opts.targetIdx) ? opts.targetIdx : swappable[0];
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
      log(s, `${me.name} skipped ${s.players[nextIdx(s, playerIdx, 1)].name}`);
      s.turn = nextIdx(s, playerIdx, 2);
      return;

    case KIND.REVERSE:
      s.dir *= -1;
      log(s, `${me.name} reversed the direction`);
      // Heads-up, a Reverse is a Skip — the turn comes straight back.
      if (headsUp) { s.turn = playerIdx; return; }
      break;

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
    case KIND.DRAW4:
    case KIND.WILD_DRAW6:
    case KIND.WILD_DRAW10:
      s.pendingDraw += drawValue(card);
      log(s, `${me.name} played ${label(card)} — stack is now +${s.pendingDraw}`);
      break;

    case KIND.WILD_REV4:
      s.dir *= -1;
      s.pendingDraw += 4;
      // Heads-up this skips the other player, so the stack lands back on you.
      if (headsUp) {
        log(s, `${me.name} reversed — the +${s.pendingDraw} comes back to them`);
        s.turn = playerIdx;
        return;
      }
      log(s, `${me.name} reversed and pushed the stack to +${s.pendingDraw}`);
      break;

    case KIND.ROULETTE: {
      const victim = nextIdx(s, playerIdx, 1);
      if (victim === playerIdx) break;   // nobody else left to spin on
      // The victim names the colour — so the turn pauses on them until they do.
      s.awaiting = { type: 'roulette_color', playerIdx: victim };
      s.turn = victim;
      log(s, `${me.name} spun the roulette — ${s.players[victim].name} names a colour`);
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

  if (needsColorChoice(card) && !COLORS.includes(opts.color)) {
    return { error: 'Choose a colour for that wild' };
  }
  // A 7 MUST be swapped, so the client has to say with whom.
  if (s.rules.sevenZero && card.kind === KIND.NUMBER && card.value === 7
      && activeIdxs(s).length > 1 && !activeIdxs(s).filter((i) => i !== playerIdx).includes(opts.targetIdx)) {
    return { error: 'Choose the player to swap hands with' };
  }

  player.hand.splice(handIdx, 1);
  if (needsColorChoice(card)) card.color = opts.color;
  s.discard.push(card);
  // Colour Roulette has no colour until the victim names one.
  if (card.color) s.activeColor = card.color;
  s.mustPlayCardId = null;
  s.lastAction = { type: 'play', playerIdx, card: { ...card }, label: label(card) };

  // Playing your last card wins, before any effect resolves.
  if (player.hand.length === 0) {
    endGame(s, playerIdx);
    log(s, `${player.name} played their last card and wins!`);
    return { ok: true, won: true };
  }

  applyEffect(s, playerIdx, card, opts);

  // Discard All can clear the rest of a hand on the way out.
  if (player.hand.length === 0 && !player.eliminated) {
    endGame(s, playerIdx);
    log(s, `${player.name} played their last card and wins!`);
    return { ok: true, won: true };
  }

  applyMercy(s);
  if (checkGameOver(s)) return { ok: true };
  if (s.players[s.turn].eliminated) s.turn = nextIdx(s, s.turn, 1);
  if (player.hand.length !== 1) player.calledUno = false;
  return { ok: true };
}

// The victim of a Colour Roulette names a colour, then digs for it.
function chooseColor(s, playerIdx, color) {
  if (s.status !== 'playing') return { error: 'Game is over' };
  if (!s.awaiting || s.awaiting.type !== 'roulette_color') return { error: 'Nothing to choose' };
  if (s.awaiting.playerIdx !== playerIdx) return { error: 'Not your choice to make' };
  if (!COLORS.includes(color)) return { error: 'Pick one of the four colours' };

  s.awaiting = null;
  s.activeColor = color;

  // "reveal cards one at a time until they get a card of that color
  //  (Wild Cards do NOT count)" — then keep every card revealed.
  let taken = 0;
  while (taken < DRAW_CAP) {
    const drawn = drawCards(s, playerIdx, 1);
    if (drawn.length === 0) break;              // pile exhausted
    taken++;
    if (!isWild(drawn[0]) && drawn[0].color === color) break;
  }
  log(s, `${s.players[playerIdx].name} chose ${color} and revealed ${taken} card(s)`);
  s.lastAction = { type: 'roulette', playerIdx, color, count: taken };

  applyMercy(s);
  if (checkGameOver(s)) return { ok: true, drawn: taken };

  // "and lose their turn"
  s.turn = s.players[playerIdx].eliminated ? nextIdx(s, playerIdx, 1) : nextIdx(s, playerIdx, 1);
  if (s.players[s.turn].eliminated) s.turn = nextIdx(s, s.turn, 1);
  return { ok: true, drawn: taken };
}

// Draw: takes the whole stack when one is live. Otherwise draws until a
// playable card turns up — which you must then play. There is no passing.
function draw(s, playerIdx) {
  if (s.status !== 'playing') return { error: 'Game is over' };
  if (s.awaiting) return { error: 'Waiting on a colour for the Colour Roulette' };
  if (s.turn !== playerIdx) return { error: 'Not your turn' };
  if (s.mustPlayCardId) return { error: 'Play the card you just drew' };

  const player = s.players[playerIdx];

  if (s.pendingDraw > 0) {
    const count = s.pendingDraw;
    s.pendingDraw = 0;
    drawCards(s, playerIdx, count);
    log(s, `${player.name} took the +${count} stack`);
    s.lastAction = { type: 'take_stack', playerIdx, count };
    applyMercy(s);
    if (checkGameOver(s)) return { ok: true, took: count };
    // "and lose their turn"
    s.turn = nextIdx(s, playerIdx, 1);
    if (s.players[s.turn].eliminated) s.turn = nextIdx(s, s.turn, 1);
    return { ok: true, took: count };
  }

  if (legalCardIds(s, playerIdx).length > 0) {
    return { error: 'You have a playable card — play it' };
  }

  let taken = 0;
  let playable = null;
  while (taken < DRAW_CAP) {
    const drawn = drawCards(s, playerIdx, 1);
    if (drawn.length === 0) break;              // pile exhausted
    taken++;
    if (illegalReason(s, playerIdx, drawn[0]) === null) { playable = drawn[0]; break; }
  }

  s.lastAction = { type: 'draw', playerIdx, count: taken };
  log(s, `${player.name} drew ${taken} card(s)${playable ? ' and must play the last one' : ''}`);

  applyMercy(s);
  if (checkGameOver(s)) return { ok: true, drawn: taken };

  if (s.players[playerIdx].eliminated) {
    s.turn = nextIdx(s, playerIdx, 1);
    if (s.players[s.turn].eliminated) s.turn = nextIdx(s, s.turn, 1);
    return { ok: true, drawn: taken };
  }

  if (playable) {
    s.mustPlayCardId = playable.id;
  } else {
    // Nothing left to draw and still nothing to play — the turn has to move on.
    s.turn = nextIdx(s, playerIdx, 1);
    if (s.players[s.turn].eliminated) s.turn = nextIdx(s, s.turn, 1);
  }
  return { ok: true, drawn: taken, mustPlay: playable ? playable.id : null };
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

// ── optional scoring game ─────────────────────────────────

// The winner takes the value of every card left in the other hands, plus a
// bonus for each player knocked out during the hand.
function scoreRound(s) {
  if (s.status !== 'ended' || s.winner === null) return null;
  const cards = s.players.reduce((sum, p, i) =>
    i === s.winner ? sum : sum + p.hand.reduce((n, c) => n + points(c), 0), 0);
  const bonus = s.knockouts * KNOCKOUT_POINTS;
  return { winner: s.winner, cards, bonus, total: cards + bonus };
}

// ── views ─────────────────────────────────────────────────

function publicView(s) {
  return {
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      handCount: p.hand.length,
      eliminated: p.eliminated,
      calledUno: p.calledUno,
      danger: p.eliminated ? 1 : Math.min(1, p.hand.length / MERCY_LIMIT),
    })),
    topCard: topCard(s) ? { ...topCard(s), label: label(topCard(s)) } : null,
    activeColor: s.activeColor,
    dir: s.dir,
    turn: s.turn,
    pendingDraw: s.pendingDraw,
    deckCount: s.deck.length,
    awaiting: s.awaiting,
    status: s.status,
    winner: s.winner,
    lastAction: s.lastAction,
    mercyLimit: MERCY_LIMIT,
    log: s.log.slice(-12),
  };
}

function privateView(s, playerIdx) {
  const p = s.players[playerIdx];
  if (!p) return null;
  const mine = s.turn === playerIdx && s.status === 'playing' && !p.eliminated;
  const choosing = Boolean(s.awaiting && s.awaiting.playerIdx === playerIdx);
  const legal = mine && !choosing ? legalCardIds(s, playerIdx) : [];
  return {
    playerIdx,
    hand: p.hand.map((c) => ({ ...c, label: label(c) })),
    legal,
    yourTurn: mine,
    chooseRouletteColor: choosing,
    mustPlayCardId: s.mustPlayCardId,
    // You may only draw with nothing playable, or to take a stack.
    canDraw: mine && !choosing && !s.mustPlayCardId
      && (s.pendingDraw > 0 || legal.length === 0),
    mustTakeStack: mine && s.pendingDraw > 0 && legal.length === 0,
  };
}

module.exports = {
  HAND_SIZE, MERCY_LIMIT, UNO_PENALTY, KNOCKOUT_POINTS, TARGET_SCORE,
  createGame, playCard, draw, chooseColor, callUno, catchUno, scoreRound,
  legalCardIds, illegalReason, publicView, privateView,
  topCard, activeIdxs, nextIdx, applyMercy, drawCards, refill,
};
