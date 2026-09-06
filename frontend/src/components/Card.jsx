// The card face. One component covers every card type: numbers show a big
// digit, actions show a glyph, wilds show the four-colour wheel.

const FACE = {
  red:    { base: '#D32F2F', glow: 'rgba(211,47,47,0.55)' },
  yellow: { base: '#F9A825', glow: 'rgba(249,168,37,0.55)' },
  green:  { base: '#388E3C', glow: 'rgba(56,142,60,0.55)' },
  blue:   { base: '#1976D2', glow: 'rgba(25,118,210,0.55)' },
  wild:   { base: '#1A1A1A', glow: 'rgba(255,255,255,0.35)' },
};

// What sits in the middle of the card.
const GLYPH = {
  skip: '⊘',
  reverse: '⇄',
  draw2: '+2',
  skip_all: '⏩',
  discard_all: '✖',
  wild: '◆',
  wild_draw4: '+4',
  wild_draw6: '+6',
  wild_draw10: '+10',
  wild_reverse_draw4: '⇄+4',
  wild_roulette: '❑',
};

// Corner marks — kept short so they never wrap.
const CORNER = {
  skip_all: 'ALL',
  discard_all: 'DUMP',
  wild_roulette: '?',
  wild_reverse_draw4: 'R4',
};

export const CARD_COLORS = FACE;

export function Card({
  card, size = 'md', playable = false, selected = false,
  dimmed = false, onClick, style = {},
}) {
  const theme = FACE[card?.color] || FACE.wild;
  const glyph = card.kind === 'number' ? String(card.value) : (GLYPH[card.kind] || '?');
  const corner = card.kind === 'number' ? String(card.value) : (CORNER[card.kind] || glyph);

  const dims = {
    sm: { w: 42, h: 62, font: 20, corner: 9, radius: 6 },
    md: { w: 66, h: 98, font: 30, corner: 11, radius: 9 },
    lg: { w: 92, h: 136, font: 42, corner: 14, radius: 12 },
  }[size];

  const interactive = Boolean(onClick) && playable;

  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      aria-label={`${card.color || 'wild'} ${card.label || card.kind}`}
      className={interactive ? 'uno-card uno-card--playable' : 'uno-card'}
      style={{
        width: dims.w,
        height: dims.h,
        borderRadius: dims.radius,
        background: card.color
          ? `linear-gradient(150deg, ${theme.base} 0%, ${theme.base}CC 55%, #00000055 100%)`
          : 'conic-gradient(from 45deg, #D32F2F 0deg 90deg, #F9A825 90deg 180deg, #388E3C 180deg 270deg, #1976D2 270deg 360deg)',
        border: selected ? '2px solid #FFFFFF' : '1px solid rgba(255,255,255,0.28)',
        boxShadow: selected
          ? `0 0 0 3px rgba(255,255,255,0.28), 0 10px 26px ${theme.glow}`
          : playable ? `0 4px 16px ${theme.glow}` : '0 2px 8px rgba(0,0,0,0.45)',
        opacity: dimmed ? 0.38 : 1,
        transform: selected ? 'translateY(-14px)' : 'none',
        cursor: interactive ? 'pointer' : 'default',
        position: 'relative',
        flex: '0 0 auto',
        padding: 0,
        transition: 'transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease',
        ...style,
      }}
    >
      {/* the white oval every UNO card carries */}
      <span style={{
        position: 'absolute', inset: '11%',
        borderRadius: '50% / 42%',
        background: 'rgba(255,255,255,0.94)',
        transform: 'rotate(-22deg)',
      }} />
      <span style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: card.kind === 'wild_reverse_draw4' ? dims.font * 0.5 : dims.font,
        fontWeight: 900,
        color: card.color ? theme.base : '#1A1A1A',
        textShadow: '0 1px 0 rgba(0,0,0,0.14)',
        letterSpacing: '-0.02em',
      }}>{glyph}</span>

      <span style={{ position: 'absolute', top: 3, left: 5, fontSize: dims.corner, fontWeight: 800, color: '#fff' }}>{corner}</span>
      <span style={{ position: 'absolute', bottom: 3, right: 5, fontSize: dims.corner, fontWeight: 800, color: '#fff', transform: 'rotate(180deg)' }}>{corner}</span>
    </button>
  );
}

// Face-down card, for the draw pile and other players' hands.
export function CardBack({ size = 'md', count, onClick, disabled }) {
  const dims = { sm: { w: 42, h: 62 }, md: { w: 66, h: 98 }, lg: { w: 92, h: 136 } }[size];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-label={count !== undefined ? `Draw pile, ${count} cards` : 'Face-down card'}
      className={onClick && !disabled ? 'uno-card uno-card--playable' : 'uno-card'}
      style={{
        width: dims.w, height: dims.h, borderRadius: 9,
        background: 'linear-gradient(150deg, #202024 0%, #0B0B0D 100%)',
        border: '1px solid rgba(255,255,255,0.16)',
        boxShadow: '0 3px 12px rgba(0,0,0,0.5)',
        position: 'relative', flex: '0 0 auto', padding: 0,
        cursor: onClick && !disabled ? 'pointer' : 'default',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute', inset: '14%', borderRadius: '50% / 42%',
        background: 'linear-gradient(135deg,#E53935,#FB8C00)', transform: 'rotate(-22deg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 900, fontSize: dims.w * 0.24, letterSpacing: '0.04em',
      }}>UNO</span>
      {count !== undefined && (
        <span style={{
          position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)',
          background: '#0B0B0D', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 999, padding: '1px 8px', fontSize: 10, color: 'rgba(255,255,255,0.75)',
        }}>{count}</span>
      )}
    </button>
  );
}
