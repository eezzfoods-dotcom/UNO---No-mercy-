// UNO No Mercy — deck definition.
//
// 168 cards:
//   80  numbers      0-9, twice per colour                       (4 x 20)
//   40  colour actions  skip / reverse / draw2 / skipall / discardall, twice each per colour (4 x 10)
//   48  wilds        wild, +4, +6, +10, reverse+4, roulette, eight each

const COLORS = ['red', 'yellow', 'green', 'blue'];

// Every card kind the game knows about. `draw` is how many the victim picks up;
// `wild` marks a card that has no colour until the player names one.
const KIND = {
  NUMBER:      'number',       // plays on matching colour or matching digit
  SKIP:        'skip',         // next player loses their turn
  REVERSE:     'reverse',      // flip direction of play
  DRAW2:       'draw2',
  SKIP_ALL:    'skip_all',     // everyone else is skipped — you play again
  DISCARD_ALL: 'discard_all',  // dump every card of this colour from your hand
  WILD:        'wild',
  WILD_DRAW4:  'wild_draw4',
  WILD_DRAW6:  'wild_draw6',
  WILD_DRAW10: 'wild_draw10',
  WILD_REV4:   'wild_reverse_draw4', // flip direction, the new next player takes the stack
  ROULETTE:    'wild_roulette',      // next player draws until they hit the named colour
};

// draw value carried by each kind — 0 means "not a draw card"
const DRAW_VALUE = {
  [KIND.DRAW2]: 2,
  [KIND.WILD_DRAW4]: 4,
  [KIND.WILD_REV4]: 4,
  [KIND.WILD_DRAW6]: 6,
  [KIND.WILD_DRAW10]: 10,
};

const WILD_KINDS = new Set([
  KIND.WILD, KIND.WILD_DRAW4, KIND.WILD_DRAW6,
  KIND.WILD_DRAW10, KIND.WILD_REV4, KIND.ROULETTE,
]);

const isWild = (card) => WILD_KINDS.has(card.kind);
const drawValue = (card) => DRAW_VALUE[card.kind] || 0;
const isDrawCard = (card) => drawValue(card) > 0;

// Human-readable label, used by the client and the move log.
function label(card) {
  switch (card.kind) {
    case KIND.NUMBER:      return String(card.value);
    case KIND.SKIP:        return 'Skip';
    case KIND.REVERSE:     return 'Reverse';
    case KIND.DRAW2:       return '+2';
    case KIND.SKIP_ALL:    return 'Skip Everyone';
    case KIND.DISCARD_ALL: return 'Discard All';
    case KIND.WILD:        return 'Wild';
    case KIND.WILD_DRAW4:  return 'Wild +4';
    case KIND.WILD_DRAW6:  return 'Wild +6';
    case KIND.WILD_DRAW10: return 'Wild +10';
    case KIND.WILD_REV4:   return 'Reverse +4';
    case KIND.ROULETTE:    return 'Colour Roulette';
    default:               return card.kind;
  }
}

function buildDeck() {
  const cards = [];
  let n = 0;
  const push = (card) => cards.push({ id: `c${n++}`, ...card });

  for (const color of COLORS) {
    // 0-9, two of each
    for (let copy = 0; copy < 2; copy++) {
      for (let value = 0; value <= 9; value++) {
        push({ kind: KIND.NUMBER, color, value });
      }
      for (const kind of [KIND.SKIP, KIND.REVERSE, KIND.DRAW2, KIND.SKIP_ALL, KIND.DISCARD_ALL]) {
        push({ kind, color, value: null });
      }
    }
  }

  for (const kind of [KIND.WILD, KIND.WILD_DRAW4, KIND.WILD_DRAW6,
                      KIND.WILD_DRAW10, KIND.WILD_REV4, KIND.ROULETTE]) {
    for (let copy = 0; copy < 8; copy++) {
      push({ kind, color: null, value: null });
    }
  }

  return cards;
}

// Fisher-Yates. `rng` is injectable so tests can run deterministically.
function shuffle(cards, rng = Math.random) {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

module.exports = {
  COLORS, KIND, DRAW_VALUE,
  isWild, drawValue, isDrawCard, label,
  buildDeck, shuffle,
};
