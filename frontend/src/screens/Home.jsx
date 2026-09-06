import { useState } from 'react';
import { useUno } from '../context/UnoContext';
import { Screen, Btn, Field, ACCENT } from '../components/ui';

const AVATARS = ['🃏', '🔥', '👑', '🐯', '🚀', '🦁', '⚡', '🎯', '🍿', '💀'];

export default function Home({ onExit }) {
  const { createRoom, joinRoom, connected } = useUno();
  const [mode, setMode] = useState(null);     // null | 'create' | 'join'
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    if (mode === 'create') await createRoom(name.trim(), avatar);
    else await joinRoom(code, name.trim(), avatar);
    setBusy(false);
  };

  return (
    <Screen center>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            fontSize: 52, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1,
            background: `linear-gradient(135deg, ${ACCENT}, #FFC93C)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>UNO</div>
          <div style={{
            marginTop: 6, fontSize: 12, fontWeight: 800, letterSpacing: '0.42em',
            color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase',
          }}>No Mercy</div>
          <p style={{ marginTop: 14, fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
            Stacked draws. Hand swaps. Hit 25 cards and you are out.
          </p>
        </div>

        {!mode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Btn onClick={() => setMode('create')} disabled={!connected}>Create a room</Btn>
            <Btn variant="ghost" onClick={() => setMode('join')} disabled={!connected}>Join with a code</Btn>
            {onExit && <Btn variant="ghost" onClick={onExit}>Back to games</Btn>}
            {!connected && (
              <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
                Connecting to the server…
              </p>
            )}
          </div>
        )}

        {mode && (
          <div>
            <Field
              label="Your name" value={name} maxLength={14} autoFocus
              placeholder="e.g. Arun"
              onChange={(e) => setName(e.target.value)}
            />
            {mode === 'join' && (
              <Field
                label="Room code" value={code} maxLength={4}
                placeholder="ABCD"
                style={{ letterSpacing: '0.4em', textTransform: 'uppercase' }}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            )}

            <span style={{
              display: 'block', fontSize: 11, textTransform: 'uppercase',
              letterSpacing: '0.14em', color: 'rgba(255,255,255,0.45)', margin: '4px 0 8px',
            }}>Pick an avatar</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {AVATARS.map((a) => (
                <button
                  key={a} type="button" onClick={() => setAvatar(a)}
                  aria-label={`avatar ${a}`}
                  style={{
                    width: 44, height: 44, borderRadius: 12, fontSize: 21, cursor: 'pointer',
                    background: avatar === a ? 'rgba(255,107,53,0.2)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${avatar === a ? ACCENT : 'rgba(255,255,255,0.12)'}`,
                  }}
                >{a}</button>
              ))}
            </div>

            <Btn
              onClick={go} style={{ width: '100%' }}
              disabled={busy || !name.trim() || (mode === 'join' && code.length !== 4)}
            >
              {busy ? 'Please wait…' : mode === 'create' ? 'Create room' : 'Join room'}
            </Btn>
            <Btn variant="ghost" onClick={() => setMode(null)} style={{ width: '100%', marginTop: 8 }}>
              Back
            </Btn>
          </div>
        )}
      </div>
    </Screen>
  );
}
