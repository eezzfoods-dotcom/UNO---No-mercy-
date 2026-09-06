import { useEffect, useState } from 'react';
import { useUno } from '../context/UnoContext';
import { Card, CardBack, CARD_COLORS } from '../components/Card';
import { Screen, Btn, ColorPicker, SwapPicker, ACCENT } from '../components/ui';

const WILD_KINDS = new Set([
  'wild', 'wild_draw4', 'wild_draw6', 'wild_draw10', 'wild_reverse_draw4', 'wild_roulette',
]);

export default function Table() {
  const { table, hand, seat, game, play, draw, pass, callUno, catchUno } = useUno();
  // A card can need a colour, then a swap target, before it can be sent.
  const [pending, setPending] = useState(null);   // { card, color? }
  const [busy, setBusy] = useState(false);

  // Never leave a picker open for a card we no longer hold.
  useEffect(() => {
    if (pending && hand && !hand.hand.some((c) => c.id === pending.card.id)) setPending(null);
  }, [hand, pending]);

  if (!table || !game || !hand) return null;

  const meIdx = seat;
  const others = table.seats
    .map((s, i) => ({ ...s, i }))
    .filter((s) => s.i !== meIdx);

  const legal = new Set(hand.legal);

  // Walk a card through whatever it still needs before sending it to the server.
  async function attempt(card, extra = {}) {
    if (busy) return;
    if (WILD_KINDS.has(card.kind) && !extra.color) return setPending({ card });
    if (table.cfg.sevenZero && card.kind === 'number' && card.value === 7
        && extra.targetIdx === undefined && others.some((o) => !game.players[o.i].eliminated)) {
      return setPending({ card, color: extra.color, needsTarget: true });
    }
    setBusy(true);
    setPending(null);
    await play(card.id, extra);
    setBusy(false);
  }

  const top = game.topCard;
  const activeHex = CARD_COLORS[game.activeColor]?.base || '#888';
  const myTurn = hand.yourTurn;

  return (
    <Screen>
      <div style={{ width: '100%', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>

        {/* ── opponents ── */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10 }}>
          {others.map((o) => {
            const p = game.players[o.i];
            const isTurn = game.turn === o.i;
            return (
              <div key={o.i} style={{
                flex: '0 0 auto', minWidth: 92, padding: '9px 11px', borderRadius: 12,
                background: isTurn ? 'rgba(255,107,53,0.14)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isTurn ? ACCENT : 'rgba(255,255,255,0.1)'}`,
                opacity: p.eliminated ? 0.35 : 1, textAlign: 'center',
              }}>
                <div style={{ fontSize: 19 }}>{o.avatar}</div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {o.name}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>
                  {p.eliminated ? 'OUT' : `${p.handCount} cards`}
                </div>
                {/* how close they are to the 25-card wipeout */}
                {!p.eliminated && (
                  <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginTop: 5 }}>
                    <div style={{
                      width: `${Math.round(p.danger * 100)}%`, height: '100%', borderRadius: 2,
                      background: p.danger > 0.72 ? '#E5342F' : p.danger > 0.45 ? '#F9A825' : '#4CAF50',
                    }} />
                  </div>
                )}
                {!p.eliminated && p.handCount === 1 && !p.calledUno && (
                  <button
                    type="button" onClick={() => catchUno(o.i)}
                    style={{
                      marginTop: 6, width: '100%', padding: '3px 0', borderRadius: 7, cursor: 'pointer',
                      background: 'rgba(229,52,47,0.9)', border: 'none', color: '#fff',
                      fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
                    }}
                  >CATCH!</button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── the table ── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14, padding: '10px 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            <span>{game.dir === 1 ? '↻ clockwise' : '↺ anticlockwise'}</span>
            <span style={{
              width: 11, height: 11, borderRadius: '50%', background: activeHex,
              boxShadow: `0 0 10px ${activeHex}`,
            }} />
            <span style={{ textTransform: 'capitalize' }}>{game.activeColor}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <CardBack
              size="lg" count={game.deckCount}
              onClick={myTurn && hand.canDraw && !busy ? draw : undefined}
            />
            {top && <Card card={top} size="lg" />}
          </div>

          {game.pendingDraw > 0 && (
            <div style={{
              padding: '7px 16px', borderRadius: 999, background: 'rgba(229,52,47,0.92)',
              fontWeight: 800, fontSize: 14, letterSpacing: '0.04em',
            }}>
              +{game.pendingDraw} stacked — play bigger or take it
            </div>
          )}

          <p style={{ fontSize: 13, color: myTurn ? ACCENT : 'rgba(255,255,255,0.42)', fontWeight: myTurn ? 700 : 500, margin: 0 }}>
            {myTurn ? 'Your turn' : `${table.seats[game.turn]?.name}'s turn`}
          </p>

          {game.log?.length > 0 && (
            <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.32)', textAlign: 'center', margin: 0, minHeight: 15 }}>
              {game.log[game.log.length - 1].text}
            </p>
          )}
        </div>

        {/* ── my hand ── */}
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 7, fontSize: 11.5, color: 'rgba(255,255,255,0.45)',
          }}>
            <span>Your hand · {hand.hand.length}</span>
            <span style={{ color: hand.hand.length >= game.mercyLimit - 5 ? '#E5342F' : 'inherit' }}>
              out at {game.mercyLimit}
            </span>
          </div>

          <div style={{
            display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 16, paddingTop: 16,
            scrollbarWidth: 'thin',
          }}>
            {hand.hand.map((c) => (
              <Card
                key={c.id} card={c} size="md"
                playable={myTurn && legal.has(c.id)}
                dimmed={myTurn && !legal.has(c.id)}
                onClick={() => attempt(c)}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, paddingBottom: 12 }}>
            <Btn
              onClick={draw} disabled={!myTurn || !hand.canDraw || busy}
              variant={hand.mustTakeStack ? 'danger' : 'ghost'} style={{ flex: 1 }}
            >
              {game.pendingDraw > 0 ? `Take +${game.pendingDraw}` : 'Draw'}
            </Btn>
            <Btn onClick={pass} disabled={!hand.canPass || busy} variant="ghost" style={{ flex: 1 }}>
              Pass
            </Btn>
            <Btn
              onClick={callUno}
              disabled={hand.hand.length > 2 || game.players[meIdx]?.calledUno}
              style={{ flex: 1 }}
            >
              UNO!
            </Btn>
          </div>
        </div>
      </div>

      {pending && !pending.color && WILD_KINDS.has(pending.card.kind) && (
        <ColorPicker
          onPick={(color) => attempt(pending.card, { color })}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.needsTarget && (
        <SwapPicker
          seats={table.seats} game={game} meIdx={meIdx}
          onPick={(targetIdx) => attempt(pending.card, { color: pending.color, targetIdx })}
          onCancel={() => setPending(null)}
        />
      )}
    </Screen>
  );
}
