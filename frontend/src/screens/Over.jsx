import { useUno } from '../context/UnoContext';
import { Screen, Btn, ACCENT } from '../components/ui';

export default function Over() {
  const { table, result, isHost, again, leave, seat } = useUno();
  const score = result?.score;
  if (!table) return null;

  const winnerIdx = result?.winner ?? table.game?.winner;
  const winner = winnerIdx !== null && winnerIdx !== undefined ? table.seats[winnerIdx] : null;
  const iWon = winnerIdx === seat;

  // Standings: whoever is left, then the knocked-out players.
  const standings = table.seats
    .map((s, i) => ({ ...s, i, out: table.game?.players[i]?.eliminated }))
    .sort((a, b) => (a.i === winnerIdx ? -1 : b.i === winnerIdx ? 1 : Number(a.out) - Number(b.out)));

  return (
    <Screen center>
      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 6 }}>{iWon ? '🏆' : '🃏'}</div>
        <h2 style={{
          fontSize: 27, fontWeight: 900, margin: '0 0 6px',
          background: `linear-gradient(135deg, ${ACCENT}, #FFC93C)`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          {iWon ? 'You win!' : winner ? `${winner.name} wins` : 'Game over'}
        </h2>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.42)', margin: '0 0 6px' }}>
          {result?.winnerName ? 'No mercy shown.' : ''}
        </p>
        {score && (
          <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', margin: '0 0 24px' }}>
            +{score.total} points — {score.cards} from the other hands
            {score.bonus > 0 && `, ${score.bonus} for knockouts`}
            {result.target && ` · first to ${result.target} wins`}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, textAlign: 'left' }}>
          {standings.map((s, rank) => (
            <div key={s.i} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderRadius: 12,
              background: s.i === winnerIdx ? 'rgba(255,107,53,0.14)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${s.i === winnerIdx ? 'rgba(255,107,53,0.45)' : 'rgba(255,255,255,0.09)'}`,
            }}>
              <span style={{ width: 18, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>{rank + 1}</span>
              <span style={{ fontSize: 19 }}>{s.avatar}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 14.5 }}>{s.name}</span>
              {s.out && <span style={{ fontSize: 11, color: '#E5342F', fontWeight: 700 }}>ELIMINATED</span>}
              {s.points > 0 && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>
                  {s.points} pts
                </span>
              )}
              {s.wins > 0 && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>🏆 {s.wins}</span>}
            </div>
          ))}
        </div>

        {isHost
          ? <Btn onClick={again} style={{ width: '100%' }}>Play again</Btn>
          : <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13.5 }}>Waiting for {table.host} to deal again…</p>}
        <Btn variant="ghost" onClick={leave} style={{ width: '100%', marginTop: 8 }}>Leave room</Btn>
      </div>
    </Screen>
  );
}
