// UNO No Mercy — socket.io wiring.
//
// Event names and the { ok, error } ack shape follow the Imposter India
// backend so both games can share one server and one client socket.
//
// Everything is namespaced under `uno:` so nothing collides when this is
// registered alongside another game's handlers on the same io instance.
//
// The server is the only authority on the rules. Clients never send a game
// state — they send an intent, and get back a view of what the server did.

const engine = require('../game/engine');
const RM = require('../game/roomManager');

// The shared table: whose turn, what is showing, how big the stack is.
// Card counts only — never the cards themselves.
function tableState(room) {
  return {
    code: room.code,
    host: room.host,
    phase: room.phase,
    cfg: room.cfg,
    seats: room.players.map((p, i) => ({
      idx: i, name: p.name, avatar: p.avatar,
      online: p.online !== false, wins: p.wins || 0, points: p.points || 0,
    })),
    game: room.game ? engine.publicView(room.game) : null,
  };
}

module.exports = function registerUnoHandlers(io) {
  // Push the table to everyone, then each player's own cards to just them.
  function broadcast(room) {
    io.to(`uno:${room.code}`).emit('uno:table', tableState(room));
    if (!room.game) return;
    room.players.forEach((p, i) => {
      if (p.socketId) io.to(p.socketId).emit('uno:hand', engine.privateView(room.game, i));
    });
  }

  // Resolve the caller's seat, and refuse if they are not actually in it.
  function seatOf(socket) {
    const room = RM.getRoom(socket.data.unoRoom);
    if (!room) return { error: 'Room not found' };
    const idx = socket.data.unoSeat;
    if (idx === undefined || !room.players[idx]) return { error: 'You are not in this room' };
    return { room, idx };
  }

  const isHost = (room, idx) => idx === 0;

  io.on('connection', (socket) => {

    // ── lobby ────────────────────────────────────────────
    socket.on('uno:create', ({ name, cfg, avatar } = {}, cb = () => {}) => {
      const res = RM.createRoom(name, cfg, socket.id, avatar);
      if (res.error) return cb({ ok: false, error: res.error });

      const { room } = res;
      socket.join(`uno:${room.code}`);
      socket.data.unoRoom = room.code;
      socket.data.unoSeat = 0;
      cb({ ok: true, code: room.code, playerIdx: 0, table: tableState(room) });
      broadcast(room);
    });

    socket.on('uno:join', ({ code, name, avatar } = {}, cb = () => {}) => {
      const res = RM.joinRoom(code, name, socket.id, avatar);
      if (res.error) return cb({ ok: false, error: res.error });

      const { room, playerIdx } = res;
      socket.join(`uno:${room.code}`);
      socket.data.unoRoom = room.code;
      socket.data.unoSeat = playerIdx;
      cb({ ok: true, code: room.code, playerIdx, table: tableState(room) });
      broadcast(room);
    });

    // Same as join, but never creates a seat — used after a dropped connection.
    socket.on('uno:reconnect', ({ code, name } = {}, cb = () => {}) => {
      const room = RM.getRoom(code);
      if (!room) return cb({ ok: false, error: 'Room not found or expired' });

      const idx = room.players.findIndex(
        (p) => p.name.toLowerCase() === String(name || '').trim().toLowerCase());
      if (idx < 0) return cb({ ok: false, error: 'You are not in this room' });

      room.players[idx].socketId = socket.id;
      room.players[idx].online = true;
      socket.join(`uno:${room.code}`);
      socket.data.unoRoom = room.code;
      socket.data.unoSeat = idx;

      cb({ ok: true, code: room.code, playerIdx: idx, table: tableState(room) });
      broadcast(room);
    });

    socket.on('uno:config', ({ cfg } = {}, cb = () => {}) => {
      const at = seatOf(socket);
      if (at.error) return cb({ ok: false, error: at.error });
      if (!isHost(at.room, at.idx)) return cb({ ok: false, error: 'Only the host can change settings' });

      const res = RM.setConfig(at.room.code, cfg);
      if (res.error) return cb({ ok: false, error: res.error });
      cb({ ok: true });
      broadcast(at.room);
    });

    socket.on('uno:kick', ({ playerIdx } = {}, cb = () => {}) => {
      const at = seatOf(socket);
      if (at.error) return cb({ ok: false, error: at.error });
      if (!isHost(at.room, at.idx)) return cb({ ok: false, error: 'Only the host can remove players' });

      const kicked = at.room.players[playerIdx];
      const res = RM.removePlayer(at.room.code, playerIdx);
      if (res.error) return cb({ ok: false, error: res.error });

      if (kicked?.socketId) io.to(kicked.socketId).emit('uno:kicked');
      // Seats below the gap shift down, so re-anchor everyone still connected.
      at.room.players.forEach((p, i) => {
        const s = p.socketId && io.sockets.sockets.get(p.socketId);
        if (s) s.data.unoSeat = i;
      });
      cb({ ok: true });
      broadcast(at.room);
    });

    socket.on('uno:start', (_ = {}, cb = () => {}) => {
      const at = seatOf(socket);
      if (at.error) return cb({ ok: false, error: at.error });
      if (!isHost(at.room, at.idx)) return cb({ ok: false, error: 'Only the host can start' });

      const res = RM.startGame(at.room.code);
      if (res.error) return cb({ ok: false, error: res.error });
      cb({ ok: true });
      broadcast(at.room);
    });

    // ── moves ────────────────────────────────────────────
    // Every move funnels through here: run it on the engine, and if the game
    // just ended, credit the winner and flip the room to its end state.
    function move(socket, cb, run) {
      const at = seatOf(socket);
      if (at.error) return cb({ ok: false, error: at.error });
      const { room, idx } = at;
      if (!room.game || room.phase !== 'playing') return cb({ ok: false, error: 'No game in progress' });

      const res = run(room.game, idx);
      if (res.error) return cb({ ok: false, error: res.error });

      if (room.game.status === 'ended') {
        room.phase = 'ended';
        if (room.game.winner !== null && room.players[room.game.winner]) {
          room.players[room.game.winner].wins = (room.players[room.game.winner].wins || 0) + 1;
        }
        // Optional scoring game: tally the hand and carry running totals.
        const score = engine.scoreRound(room.game);
        if (score) {
          const w = room.players[score.winner];
          w.points = (w.points || 0) + score.total;
        }
        io.to(`uno:${room.code}`).emit('uno:over', {
          winner: room.game.winner,
          winnerName: room.game.winner !== null ? room.players[room.game.winner]?.name : null,
          score,
          target: engine.TARGET_SCORE,
        });
      }
      cb({ ok: true, ...res });
      broadcast(room);
    }

    socket.on('uno:play', ({ cardId, color, targetIdx } = {}, cb = () => {}) =>
      move(socket, cb, (g, i) => engine.playCard(g, i, cardId, { color, targetIdx })));

    socket.on('uno:draw', (_ = {}, cb = () => {}) =>
      move(socket, cb, (g, i) => engine.draw(g, i)));

    // The victim of a Colour Roulette names the colour they must dig for.
    socket.on('uno:choose_color', ({ color } = {}, cb = () => {}) =>
      move(socket, cb, (g, i) => engine.chooseColor(g, i, color)));

    socket.on('uno:call_uno', (_ = {}, cb = () => {}) =>
      move(socket, cb, (g, i) => engine.callUno(g, i)));

    socket.on('uno:catch', ({ targetIdx } = {}, cb = () => {}) =>
      move(socket, cb, (g, i) => engine.catchUno(g, i, targetIdx)));

    // ── after the game ───────────────────────────────────
    socket.on('uno:again', (_ = {}, cb = () => {}) => {
      const at = seatOf(socket);
      if (at.error) return cb({ ok: false, error: at.error });
      if (!isHost(at.room, at.idx)) return cb({ ok: false, error: 'Only the host can restart' });

      const res = RM.resetToLobby(at.room.code);
      if (res.error) return cb({ ok: false, error: res.error });
      cb({ ok: true });
      broadcast(at.room);
    });

    socket.on('uno:leave', () => {
      const at = seatOf(socket);
      if (at.error) return;
      socket.leave(`uno:${at.room.code}`);
      RM.markOffline(at.room.code, at.idx);
      socket.data.unoRoom = undefined;
      socket.data.unoSeat = undefined;
      broadcast(at.room);
    });

    socket.on('uno:close', (_ = {}, cb = () => {}) => {
      const at = seatOf(socket);
      if (at.error) return cb({ ok: false, error: at.error });
      if (!isHost(at.room, at.idx)) return cb({ ok: false, error: 'Only the host can close the room' });
      io.to(`uno:${at.room.code}`).emit('uno:closed');
      RM.deleteRoom(at.room.code);
      cb({ ok: true });
    });

    // ── chat ─────────────────────────────────────────────
    socket.on('uno:chat', ({ text } = {}) => {
      const at = seatOf(socket);
      if (at.error || typeof text !== 'string') return;

      const trimmed = text.trim().slice(0, 140);
      if (!trimmed) return;

      const now = Date.now();
      if (socket.data.unoLastChat && now - socket.data.unoLastChat < 400) return;
      socket.data.unoLastChat = now;

      io.to(`uno:${at.room.code}`).emit('uno:chat', {
        id: now + Math.random(),
        playerIdx: at.idx,
        name: at.room.players[at.idx].name,
        text: trimmed,
      });
    });

    // A drop leaves the seat in place — the hand is waiting on reconnect.
    socket.on('disconnect', () => {
      const code = socket.data.unoRoom;
      const idx = socket.data.unoSeat;
      if (code === undefined || idx === undefined) return;
      const room = RM.markOffline(code, idx);
      if (room) broadcast(room);
    });
  });
};
