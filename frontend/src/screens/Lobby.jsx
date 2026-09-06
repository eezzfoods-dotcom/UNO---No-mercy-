import { useUno } from '../context/UnoContext';
import { Screen, Btn, ACCENT } from '../components/ui';

export default function Lobby() {
  const { table, seat, isHost, start, kick, setConfig, leave } = useUno();
  if (!table) return null;

  const enough = table.seats.length >= 2;

  return (
    <Screen>
      <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', padding: '10px 0 22px' }}>
          <p style={{
            fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.4)', margin: 0,
          }}>Room code</p>
          <div style={{
            fontSize: 46, fontWeight: 900, letterSpacing: '0.16em', marginTop: 4,
            background: `linear-gradient(135deg, ${ACCENT}, #FFC93C)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>{table.code}</div>
          <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            Share it — everyone joins from their own phone
          </p>
        </header>

        <p style={{
          fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.4)', marginBottom: 8,
        }}>Players · {table.seats.length}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {table.seats.map((s) => (
            <div key={s.idx} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderRadius: 12, background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${s.idx === seat ? 'rgba(255,107,53,0.5)' : 'rgba(255,255,255,0.1)'}`,
            }}>
              <span style={{ fontSize: 22 }}>{s.avatar}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>
                {s.name}
                {s.idx === 0 && <span style={{ color: ACCENT, fontSize: 11, marginLeft: 8 }}>HOST</span>}
                {s.idx === seat && <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginLeft: 8 }}>YOU</span>}
              </span>
              {s.wins > 0 && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>🏆 {s.wins}</span>
              )}
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: s.online ? '#4CAF50' : 'rgba(255,255,255,0.22)',
              }} />
              {isHost && s.idx !== 0 && (
                <button
                  type="button" onClick={() => kick(s.idx)} aria-label={`Remove ${s.name}`}
                  style={{
                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                    fontSize: 17, cursor: 'pointer', padding: '0 2px',
                  }}
                >×</button>
              )}
            </div>
          ))}
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px',
          borderRadius: 12, background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)', marginBottom: 18,
          cursor: isHost ? 'pointer' : 'default', opacity: isHost ? 1 : 0.6,
        }}>
          <input
            type="checkbox" checked={table.cfg.sevenZero} disabled={!isHost}
            onChange={(e) => setConfig({ sevenZero: e.target.checked })}
            style={{ width: 17, height: 17, accentColor: ACCENT }}
          />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>7-0 rule</span>
            <span style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
              A 7 swaps hands with someone · a 0 passes every hand along
            </span>
          </span>
        </label>

        {isHost ? (
          <Btn onClick={start} disabled={!enough} style={{ width: '100%' }}>
            {enough ? 'Deal the cards' : 'Waiting for one more player'}
          </Btn>
        ) : (
          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13.5, padding: '13px 0' }}>
            Waiting for {table.host} to start…
          </p>
        )}
        <Btn variant="ghost" onClick={leave} style={{ width: '100%', marginTop: 8 }}>Leave room</Btn>
      </div>
    </Screen>
  );
}
