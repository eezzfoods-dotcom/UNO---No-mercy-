// UNO No Mercy — room lifecycle.
//
// Mirrors the shape of the Imposter India room manager: an in-memory Map of
// rooms keyed by a short code, players identified by name so a dropped phone
// can rejoin the same seat, and a sweeper for abandoned rooms.

const engine = require('./engine');

const rooms = new Map();

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;   // the box says 2-6
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;   // 3 hours, same as Imposter
const SWEEP_MS = 30 * 60 * 1000;

// No I/O/0/1 — they get misread when someone reads a code out loud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return rooms.has(code) ? genCode() : code;
}

const norm = (name) => String(name || '').trim().toLowerCase();

function createRoom(hostName, cfg = {}, socketId = null, avatar = '🃏') {
  const name = String(hostName || '').trim();
  if (!name) return { error: 'Name required' };

  const code = genCode();
  const room = {
    code,
    host: name,
    players: [{ name, socketId, avatar, online: true, wins: 0 }],
    cfg: {
      sevenZero: cfg.sevenZero !== false,   // the 7-0 rule is on unless turned off
      stacking: true,                        // stacking is what No Mercy *is*
    },
    phase: 'lobby',        // lobby | playing | ended
    game: null,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return { room };
}

const getRoom = (code) => rooms.get(String(code || '').toUpperCase()) || null;

function joinRoom(code, playerName, socketId, avatar = '🃏') {
  const room = getRoom(code);
  if (!room) return { error: 'Room not found' };

  const name = String(playerName || '').trim();
  if (!name) return { error: 'Name required' };

  // Same name = same person coming back, at any phase.
  const seat = room.players.findIndex((p) => norm(p.name) === norm(name));
  if (seat >= 0) {
    room.players[seat].socketId = socketId;
    room.players[seat].online = true;
    return { room, playerIdx: seat, rejoined: true };
  }

  // A hand is dealt at start, so latecomers wait for the next one.
  if (room.phase !== 'lobby') return { error: 'Game already in progress — wait for the next round' };
  if (room.players.length >= MAX_PLAYERS) return { error: `Room is full (max ${MAX_PLAYERS})` };

  room.players.push({ name, socketId, avatar, online: true, wins: 0 });
  return { room, playerIdx: room.players.length - 1, rejoined: false };
}

// Only allowed in the lobby: pulling a seat mid-hand would shift every index.
function removePlayer(code, playerIdx) {
  const room = getRoom(code);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Cannot remove players mid-game' };
  if (playerIdx < 0 || playerIdx >= room.players.length) return { error: 'No such player' };
  if (playerIdx === 0) return { error: 'The host cannot be removed' };
  room.players.splice(playerIdx, 1);
  return { room };
}

function startGame(code) {
  const room = getRoom(code);
  if (!room) return { error: 'Room not found' };
  if (room.players.length < MIN_PLAYERS) return { error: `Need at least ${MIN_PLAYERS} players` };

  room.game = engine.createGame(
    room.players.map((p, i) => ({ id: String(i), name: p.name, avatar: p.avatar })),
    { sevenZero: room.cfg.sevenZero },
  );
  room.phase = 'playing';
  return { room };
}

// Back to the lobby with the same people and their running win tallies.
function resetToLobby(code) {
  const room = getRoom(code);
  if (!room) return { error: 'Room not found' };
  room.game = null;
  room.phase = 'lobby';
  return { room };
}

function setConfig(code, cfg = {}) {
  const room = getRoom(code);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Settings are locked once the game starts' };
  if (typeof cfg.sevenZero === 'boolean') room.cfg.sevenZero = cfg.sevenZero;
  return { room };
}

function markOffline(code, playerIdx) {
  const room = getRoom(code);
  if (!room || !room.players[playerIdx]) return null;
  room.players[playerIdx].online = false;
  return room;
}

const deleteRoom = (code) => rooms.delete(String(code || '').toUpperCase());

const sweeper = setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms.entries()) {
    if (room.createdAt < cutoff) rooms.delete(code);
  }
}, SWEEP_MS);
sweeper.unref?.();   // never hold the process open just for the sweeper

module.exports = {
  MIN_PLAYERS, MAX_PLAYERS,
  rooms, createRoom, getRoom, joinRoom, removePlayer,
  startGame, resetToLobby, setConfig, markOffline, deleteRoom,
};
