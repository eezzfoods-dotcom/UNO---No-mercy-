// UNO Show 'em No Mercy — deck definition.
// Card set and rules follow Mattel instruction sheet HVW18 (©2023).
//
// 168 cards:
//   80  numbers          0-9, twice per colour                                (4 x 20)
//   48  colour actions   Skip / Reverse / +2 / +4 / Skip Everyone /
//                        Discard All, twice each per colour                   (4 x 12)
//   40  wilds            Wild, Wild +6, Wild +10, Wild Reverse +4,
//                        Wild Colour Roulette, eight each                     (5 x 8)
//
// Note that +4 is a COLOUR card here, not a wild — the sheet lists it under
// "Any Color Action Card" alongside Skip, Reverse, +2, Discard All and Skip
// Everyone. The wild draw cards are +6 and +10.

const COLORS = ['red', 'yellow', 'green', 'blue'];

const KIND = {
  NUMBER:      'number',       // plays on matching colour or matching digit
  SKIP:        'skip',         // next player loses their turn
  REVERSE:     'reverse',      // flip direction of play
  DRAW2:       'draw2',
  DRAW4:       'draw4',        // coloured, not wild
  SKIP_ALL:    'skip_all',     // everyone else is skipped — you play again
  DISCARD_ALL: 'discard_all',  // dump every card of this colour from your hand
  WILD:        'wild',
  WILD_DRAW6:  'wild_draw6',
  WILD_DRAW10: 'wild_draw10',
  WILD_REV4:   'wild_reverse_draw4', // flip direction, the new next player takes the stack
  ROULETTE:    'wild_roulette',      // victim names a colour, then digs for it
};

// draw value carried by each kind — 0 means "not a draw card"
const DRAW_VALUE = {
  [KIND.DRAW2]: 2,
  [KIND.DRAW4]: 4,
  [KIND.WILD_REV4]: 4,
  [KIND.WILD_DRAW6]: 6,
  [KIND.WILD_DRAW10]: 10,
};

const WILD_KINDS = new Set([
  KIND.WILD, KIND.WILD_DRAW6, KIND.WILD_DRAW10, KIND.WILD_REV4, KIND.ROULETTE,
]);

// Colour Roulette is a wild, but its colour is named by the victim, not by the
// player who plays it — so it is the one wild that takes no colour up front.
const CHOOSES_COLOR = new Set([
  KIND.WILD, KIND.WILD_DRAW6, KIND.WILD_DRAW10, KIND.WILD_REV4,
]);

const isWild = (card) => WILD_KINDS.has(card.kind);
const needsColorChoice = (card) => CHOOSES_COLOR.has(card.kind);
const drawValue = (card) => DRAW_VALUE[card.kind] || 0;
const isDrawCard = (card) => drawValue(card) > 0;

// Points for a card left in a losing hand, under the optional scoring game.
function points(card) {
  if (card.kind === KIND.NUMBER) return card.value;
  return isWild(card) ? 50 : 20;
}

function label(card) {
  switch (card.kind) {
    case KIND.NUMBER:      return String(card.value);
    case KIND.SKIP:        return 'Skip';
    case KIND.REVERSE:     return 'Reverse';
    case KIND.DRAW2:       return '+2';
    case KIND.DRAW4:       return '+4';
    case KIND.SKIP_ALL:    return 'Skip Everyone';
    case KIND.DISCARD_ALL: return 'Discard All';
    case KIND.WILD:        return 'Wild';
    case KIND.WILD_DRAW6:  return 'Wild +6';
    case KIND.WILD_DRAW10: return 'Wild +10';
    case KIND.WILD_REV4:   return 'Reverse +4';
    case KIND.ROULETTE:    return 'Colour Roulette';
    default:               return card.kind;
  }
}

const COLOR_ACTIONS = [KIND.SKIP, KIND.REVERSE, KIND.DRAW2, KIND.DRAW4,
                       KIND.SKIP_ALL, KIND.DISCARD_ALL];
const WILD_CARDS = [KIND.WILD, KIND.WILD_DRAW6, KIND.WILD_DRAW10,
                    KIND.WILD_REV4, KIND.ROULETTE];

function buildDeck() {
  const cards = [];
  let n = 0;
  const push = (card) => cards.push({ id: `c${n++}`, ...card });

  for (const color of COLORS) {
    for (let copy = 0; copy < 2; copy++) {
      for (let value = 0; value <= 9; value++) push({ kind: KIND.NUMBER, color, value });
      for (const kind of COLOR_ACTIONS) push({ kind, color, value: null });
    }
  }
  for (const kind of WILD_CARDS) {
    for (let copy = 0; copy < 8; copy++) push({ kind, color: null, value: null });
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
  COLORS, KIND, DRAW_VALUE, COLOR_ACTIONS, WILD_CARDS,
  isWild, needsColorChoice, drawValue, isDrawCard, points, label,
  buildDeck, shuffle,
};
