// End-to-end: real socket.io server, real clients, a full game played over the wire.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');

const registerUnoHandlers = require('../src/routes/socketHandlers');
const RM = require('../src/game/roomManager');

// Promise wrapper around socket.io's ack callback.
const emit = (sock, ev, payload = {}) =>
  new Promise((res) => sock.emit(ev, payload, res));

const once = (sock, ev) => new Promise((res) => sock.once(ev, res));

async function bootServer() {
  const server = http.createServer();
  const ioServer = new Server(server, { cors: { origin: '*' } });
  registerUnoHandlers(ioServer);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    close: async () => {
      ioServer.disconnectSockets(true);
      await new Promise((r) => ioServer.close(r));
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    },
  };
}

function connect(url) {
  const sock = Client(url, { transports: ['websocket'], forceNew: true });
  return new Promise((res, rej) => {
    const bail = setTimeout(() => rej(new Error('socket never connected')), 5000);
    sock.on('connect', () => { clearTimeout(bail); res(sock); });
    sock.on('connect_error', (e) => { clearTimeout(bail); rej(e); });
  });
}

// The ack for a move can beat the broadcast that follows it, so wait for this
// player's own view to catch up rather than spinning on a stale one.
function awaitTurn(views, me, ms = 3000) {
  const deadline = Date.now() + ms;
  return new Promise((res, rej) => {
    const poll = () => {
      if (views[me] && (views[me].yourTurn || views[me].chooseRouletteColor)) return res(views[me]);
      if (Date.now() > deadline) return rej(new Error(`player ${me} never got their turn view`));
      setTimeout(poll, 5);
    };
    poll();
  });
}

test('four players run a full game over sockets', async (t) => {
  const srv = await bootServer();
  const socks = [];
  t.after(async () => { socks.forEach((s) => s.close()); await srv.close(); });

  const names = ['Arun', 'Bala', 'Chitra', 'Deepa'];
  for (const _ of names) socks.push(await connect(srv.url));

  // ── host creates, everyone else joins ──
  const created = await emit(socks[0], 'uno:create', { name: names[0], cfg: { sevenZero: true } });
  assert.ok(created.ok, created.error);
  const code = created.code;
  assert.match(code, /^[A-Z2-9]{4}$/, 'a readable 4-character room code');
  assert.strictEqual(created.playerIdx, 0);

  for (let i = 1; i < names.length; i++) {
    const res = await emit(socks[i], 'uno:join', { code, name: names[i] });
    assert.ok(res.ok, res.error);
    assert.strictEqual(res.playerIdx, i);
  }

  // ── only the host may start ──
  const notHost = await emit(socks[2], 'uno:start');
  assert.ok(!notHost.ok);
  assert.match(notHost.error, /host/i);

  // Each player's own cards arrive privately; the table arrives to everyone.
  const hands = names.map((_, i) => once(socks[i], 'uno:hand'));
  const table = once(socks[1], 'uno:table');

  assert.ok((await emit(socks[0], 'uno:start')).ok);

  const dealt = await Promise.all(hands);
  dealt.forEach((h, i) => {
    assert.strictEqual(h.hand.length, 7, `${names[i]} was dealt 7`);
    assert.strictEqual(h.playerIdx, i);
  });

  const t0 = await table;
  assert.strictEqual(t0.phase, 'playing');
  assert.strictEqual(t0.game.players.length, 4);
  t0.game.players.forEach((p) => assert.strictEqual(p.handCount, 7));
  assert.ok(!JSON.stringify(t0).includes('"hand":'), 'the table never carries anyone\'s cards');

  // ── a player cannot move out of turn ──
  const room = RM.getRoom(code);
  const offTurn = (room.game.turn + 1) % 4;
  const bad = await emit(socks[offTurn], 'uno:draw');
  assert.ok(!bad.ok);
  assert.match(bad.error, /Not your turn/);

  // ── play it out, always via the server's own advertised legal moves ──
  const views = dealt.slice();
  socks.forEach((s, i) => s.on('uno:hand', (v) => { views[i] = v; }));

  const over = once(socks[0], 'uno:over');
  let moves = 0;

  while (RM.getRoom(code).phase === 'playing' && moves < 3000) {
    const g = RM.getRoom(code).game;
    const me = g.turn;
    const view = await awaitTurn(views, me);

    let res;
    if (view.chooseRouletteColor) {
      res = await emit(socks[me], 'uno:choose_color', { color: 'red' });
    } else if (view.legal.length > 0) {
      const others = g.players.map((_, i) => i).filter((i) => i !== me && !g.players[i].eliminated);
      res = await emit(socks[me], 'uno:play', {
        cardId: view.legal[0],
        color: 'red',
        targetIdx: others[0],
      });
    } else if (view.canDraw) {
      res = await emit(socks[me], 'uno:draw');
    } else {
      assert.fail(`player ${me} had no legal action`);
    }
    assert.ok(res.ok, `move ${moves} rejected: ${res.error}`);
    moves++;
  }

  const result = await over;
  assert.ok(result.winner !== null && result.winner !== undefined, 'a winner was announced');
  assert.ok(names.includes(result.winnerName), `winner name is one of the players (${result.winnerName})`);
  assert.ok(result.score && result.score.total >= 0, 'the hand was scored');
  assert.strictEqual(result.target, 1000, 'the scoring game runs to 1000');

  const final = RM.getRoom(code);
  assert.strictEqual(final.phase, 'ended');
  assert.strictEqual(final.players[result.winner].wins, 1, 'the win was tallied');

  // ── rematch returns everyone to the lobby with tallies intact ──
  assert.ok((await emit(socks[0], 'uno:again')).ok);
  assert.strictEqual(RM.getRoom(code).phase, 'lobby');
  assert.strictEqual(RM.getRoom(code).players[result.winner].wins, 1, 'tally survives the rematch');
});

test('a dropped player reclaims their seat and their cards', async (t) => {
  const srv = await bootServer();
  const socks = [];
  t.after(async () => { socks.forEach((s) => s.close()); await srv.close(); });

  for (let i = 0; i < 2; i++) socks.push(await connect(srv.url));
  const { code } = await emit(socks[0], 'uno:create', { name: 'Arun' });
  await emit(socks[1], 'uno:join', { code, name: 'Bala' });

  const balaHand = once(socks[1], 'uno:hand');
  await emit(socks[0], 'uno:start');
  const before = (await balaHand).hand.map((c) => c.id);

  // Bala's phone dies.
  socks[1].close();
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(RM.getRoom(code).players[1].online, false, 'marked offline, seat kept');

  // …and comes back.
  const revived = await connect(srv.url);
  socks.push(revived);
  // Subscribe before asking: the server broadcasts the moment it acks.
  const redealt = once(revived, 'uno:hand');
  const back = await emit(revived, 'uno:reconnect', { code, name: 'Bala' });
  assert.ok(back.ok, back.error);
  assert.strictEqual(back.playerIdx, 1, 'same seat');
  assert.strictEqual(RM.getRoom(code).players[1].online, true);

  const after = (await redealt).hand.map((c) => c.id);
  assert.deepStrictEqual(after, before, 'the same cards were waiting');

  // A name nobody is using cannot claim a seat.
  const stranger = await connect(srv.url);
  socks.push(stranger);
  const denied = await emit(stranger, 'uno:reconnect', { code, name: 'Nobody' });
  assert.ok(!denied.ok);
  assert.match(denied.error, /not in this room/i);
});

test('joining is closed once a hand is dealt, and names are unique per room', async (t) => {
  const srv = await bootServer();
  const socks = [];
  t.after(async () => { socks.forEach((s) => s.close()); await srv.close(); });

  for (let i = 0; i < 3; i++) socks.push(await connect(srv.url));
  const { code } = await emit(socks[0], 'uno:create', { name: 'Arun' });

  // Same name = the same person rejoining, not a second seat.
  const dup = await emit(socks[1], 'uno:join', { code, name: 'arun' });
  assert.ok(dup.ok);
  assert.strictEqual(dup.playerIdx, 0, 'reclaims the existing seat');
  assert.strictEqual(RM.getRoom(code).players.length, 1);

  const arun = await connect(srv.url);   // Arun's original socket lost the seat
  socks.push(arun);
  await emit(arun, 'uno:reconnect', { code, name: 'Arun' });
  await emit(socks[2], 'uno:join', { code, name: 'Chitra' });
  await emit(arun, 'uno:start');

  const late = await connect(srv.url);
  socks.push(late);
  const res = await emit(late, 'uno:join', { code, name: 'Late' });
  assert.ok(!res.ok);
  assert.match(res.error, /already in progress/i);

  const nowhere = await emit(late, 'uno:join', { code: 'ZZZZ', name: 'Late' });
  assert.ok(!nowhere.ok);
  assert.match(nowhere.error, /not found/i);
});

test('chat is relayed, trimmed and rate limited', async (t) => {
  const srv = await bootServer();
  const socks = [];
  t.after(async () => { socks.forEach((s) => s.close()); await srv.close(); });

  for (let i = 0; i < 2; i++) socks.push(await connect(srv.url));
  const { code } = await emit(socks[0], 'uno:create', { name: 'Arun' });
  await emit(socks[1], 'uno:join', { code, name: 'Bala' });

  const heard = once(socks[1], 'uno:chat');
  socks[0].emit('uno:chat', { text: '  vanakkam da  ' });
  const msg = await heard;
  assert.strictEqual(msg.text, 'vanakkam da', 'trimmed');
  assert.strictEqual(msg.name, 'Arun');

  // A burst from the same socket is dropped by the 400ms limiter.
  // Clear the window opened by the message above first.
  await new Promise((r) => setTimeout(r, 450));
  let count = 0;
  socks[1].on('uno:chat', () => { count++; });
  socks[0].emit('uno:chat', { text: 'one' });
  socks[0].emit('uno:chat', { text: 'two' });
  socks[0].emit('uno:chat', { text: 'three' });
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(count, 1, 'only the first of the burst got through');
});
