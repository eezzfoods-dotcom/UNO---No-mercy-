import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// One socket for the whole game. In the Semma app you can hand in the app's
// existing socket instead — see `socket` on the provider props.
//
// In a deployed build the server serves this page, so same origin (undefined)
// is right. Under `vite dev` the page comes from Vite's port and the game
// server is elsewhere, so fall back to :3002 on the same host — that keeps
// `npm run dev:client` working with no config, and works from a phone on the
// same network too. VITE_UNO_BACKEND_URL overrides both.
const DEV_SERVER_PORT = 3002;

function defaultUrl() {
  const explicit = import.meta.env.VITE_UNO_BACKEND_URL || import.meta.env.VITE_BACKEND_URL;
  if (explicit) return explicit;
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${DEV_SERVER_PORT}`;
  }
  return undefined;   // same origin
}

const DEFAULT_URL = defaultUrl();

const UnoContext = createContext(null);
export const useUno = () => useContext(UnoContext);

const SESSION_KEY = 'uno:session';

const readSession = () => {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};
const writeSession = (v) => {
  try {
    if (v) sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* private mode — the game still works, just no auto-rejoin */ }
};

export function UnoProvider({ children, socket: injected, url = DEFAULT_URL }) {
  const socketRef = useRef(null);
  if (!socketRef.current) {
    socketRef.current = injected || io(url, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  const socket = socketRef.current;

  const [connected, setConnected] = useState(socket.connected);
  // Where we are dialling, so a failure can say so rather than hanging silently.
  const serverUrl = injected ? 'the app\'s own socket' : (url || 'this page\'s origin');
  const [screen, setScreen] = useState('home');   // home | lobby | table | over
  const [table, setTable] = useState(null);        // shared view
  const [hand, setHand] = useState(null);          // this player's cards
  const [seat, setSeat] = useState(null);
  const [chat, setChat] = useState([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Promise wrapper over socket.io acks so screens can `await` a move.
  const send = useCallback((event, payload = {}) => new Promise((resolve) => {
    socket.emit(event, payload, (res) => {
      if (res && res.ok === false) setError(res.error || 'Something went wrong');
      resolve(res || { ok: false, error: 'No response from server' });
    });
  }), [socket]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Reclaim our seat after a drop — the server kept the hand.
      const saved = readSession();
      if (saved?.code && saved?.name) {
        socket.emit('uno:reconnect', saved, (res) => {
          if (res?.ok) { setSeat(res.playerIdx); setTable(res.table); }
          else writeSession(null);
        });
      }
    };
    const onDisconnect = () => setConnected(false);

    const onTable = (t) => {
      setTable(t);
      setScreen(t.phase === 'lobby' ? 'lobby' : t.phase === 'playing' ? 'table' : 'over');
    };
    const onHand = (h) => setHand(h);
    const onChat = (m) => setChat((prev) => [...prev.slice(-40), m]);
    const onOver = (r) => { setResult(r); setScreen('over'); };
    const onKicked = () => { writeSession(null); setScreen('home'); setError('The host removed you from the room'); };
    const onClosed = () => { writeSession(null); setScreen('home'); setError('The host closed the room'); };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('uno:table', onTable);
    socket.on('uno:hand', onHand);
    socket.on('uno:chat', onChat);
    socket.on('uno:over', onOver);
    socket.on('uno:kicked', onKicked);
    socket.on('uno:closed', onClosed);
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('uno:table', onTable);
      socket.off('uno:hand', onHand);
      socket.off('uno:chat', onChat);
      socket.off('uno:over', onOver);
      socket.off('uno:kicked', onKicked);
      socket.off('uno:closed', onClosed);
    };
  }, [socket]);

  const enter = useCallback(async (event, { name, code, avatar } = {}) => {
    setError('');
    const res = await send(event, { name, code, avatar });
    if (res.ok) {
      setSeat(res.playerIdx);
      setTable(res.table);
      setChat([]);
      setResult(null);
      writeSession({ code: res.code, name });
      setScreen('lobby');
    }
    return res;
  }, [send]);

  const api = useMemo(() => ({
    socket, connected, serverUrl, screen, table, hand, seat, chat, error, result,
    setError, setScreen,

    createRoom: (name, avatar, cfg) => enter('uno:create', { name, avatar, cfg }),
    joinRoom: (code, name, avatar) => enter('uno:join', { code: String(code || '').toUpperCase().trim(), name, avatar }),

    setConfig: (cfg) => send('uno:config', { cfg }),
    kick: (playerIdx) => send('uno:kick', { playerIdx }),
    start: () => send('uno:start'),

    play: (cardId, opts = {}) => send('uno:play', { cardId, ...opts }),
    draw: () => send('uno:draw'),
    chooseColor: (color) => send('uno:choose_color', { color }),
    callUno: () => send('uno:call_uno'),
    catchUno: (targetIdx) => send('uno:catch', { targetIdx }),

    again: () => send('uno:again'),
    closeRoom: () => send('uno:close'),
    say: (text) => socket.emit('uno:chat', { text }),

    leave: () => {
      socket.emit('uno:leave');
      writeSession(null);
      setTable(null); setHand(null); setSeat(null);
      setChat([]); setResult(null); setScreen('home');
    },

    // Convenience flags the screens lean on.
    isHost: seat === 0,
    me: table && seat !== null ? table.seats[seat] : null,
    game: table?.game || null,
  }), [socket, connected, serverUrl, screen, table, hand, seat, chat, error, result, enter, send]);

  return <UnoContext.Provider value={api}>{children}</UnoContext.Provider>;
}
