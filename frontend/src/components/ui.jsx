// Small shared pieces, styled to sit next to Imposter India's dark neon look.

export const ACCENT = '#FF6B35';

export function Screen({ children, center = false }) {
  return (
    <div style={{
      minHeight: '100dvh', width: '100%',
      background: 'radial-gradient(120% 90% at 50% 0%, #1A1030 0%, #0B0B12 55%, #050508 100%)',
      color: '#fff', fontFamily: "'DM Sans', system-ui, sans-serif",
      display: 'flex', flexDirection: 'column',
      alignItems: center ? 'center' : 'stretch',
      justifyContent: center ? 'center' : 'flex-start',
      padding: 16, boxSizing: 'border-box',
    }}>{children}</div>
  );
}

export function Btn({ children, onClick, variant = 'primary', disabled, style = {}, ...rest }) {
  const skin = {
    primary: { background: `linear-gradient(135deg, ${ACCENT}, #E5342F)`, color: '#fff', border: 'none' },
    ghost:   { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.16)' },
    danger:  { background: 'rgba(229,52,47,0.12)', color: '#FF8A80', border: '1px solid rgba(229,52,47,0.4)' },
  }[variant];

  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="uno-btn"
      style={{
        ...skin, padding: '13px 20px', borderRadius: 12,
        fontWeight: 700, fontSize: 15, letterSpacing: '0.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'transform 120ms ease, opacity 120ms ease',
        ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

export function Field({ label, ...rest }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{
        display: 'block', fontSize: 11, textTransform: 'uppercase',
        letterSpacing: '0.14em', color: 'rgba(255,255,255,0.45)', marginBottom: 6,
      }}>{label}</span>
      <input
        style={{
          width: '100%', padding: '13px 14px', borderRadius: 12, boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
          color: '#fff', fontSize: 16, outline: 'none',
        }}
        {...rest}
      />
    </label>
  );
}

// The four colours a wild can become.
export function ColorPicker({ onPick, onCancel }) {
  const swatches = [
    ['red', '#D32F2F'], ['yellow', '#F9A825'],
    ['green', '#388E3C'], ['blue', '#1976D2'],
  ];
  return (
    <Overlay title="Pick a colour" onCancel={onCancel}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {swatches.map(([name, hex]) => (
          <button
            key={name} type="button" onClick={() => onPick(name)}
            aria-label={name}
            style={{
              height: 84, borderRadius: 14, border: '1px solid rgba(255,255,255,0.2)',
              background: `linear-gradient(150deg, ${hex}, ${hex}AA)`,
              color: '#fff', fontWeight: 800, fontSize: 14, textTransform: 'capitalize',
              cursor: 'pointer', boxShadow: `0 6px 20px ${hex}55`,
            }}
          >{name}</button>
        ))}
      </div>
    </Overlay>
  );
}

// Choose whose hand to take when a 7 is played.
export function SwapPicker({ seats, game, meIdx, onPick, onCancel }) {
  const targets = seats
    .map((s, i) => ({ ...s, i }))
    .filter((s) => s.i !== meIdx && !game.players[s.i]?.eliminated);

  return (
    <Overlay title="Swap hands with…" onCancel={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {targets.map((s) => (
          <button
            key={s.i} type="button" onClick={() => onPick(s.i)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '13px 16px', borderRadius: 12, cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
              color: '#fff', fontSize: 15, fontWeight: 600,
            }}
          >
            <span>{s.avatar} {s.name}</span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
              {game.players[s.i]?.handCount} cards
            </span>
          </button>
        ))}
      </div>
    </Overlay>
  );
}

export function Overlay({ title, children, onCancel }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, background: '#14141C',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.12)', borderBottom: 'none',
          padding: 20, paddingBottom: 28,
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 800 }}>{title}</h3>
        {children}
        {onCancel && (
          <Btn variant="ghost" onClick={onCancel} style={{ width: '100%', marginTop: 14 }}>
            Cancel
          </Btn>
        )}
      </div>
    </div>
  );
}

export function Toast({ text, onDone }) {
  if (!text) return null;
  return (
    <div
      onClick={onDone}
      style={{
        position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
        zIndex: 60, maxWidth: '92vw', padding: '11px 18px', borderRadius: 12,
        background: 'rgba(229,52,47,0.94)', color: '#fff', fontSize: 14, fontWeight: 600,
        boxShadow: '0 8px 28px rgba(0,0,0,0.5)', cursor: 'pointer',
      }}
    >{text}</div>
  );
}
