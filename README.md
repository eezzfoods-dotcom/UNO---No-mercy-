# UNO No Mercy

Online multiplayer UNO No Mercy — a **self-contained game module** built to drop
into the Semma gaming app alongside the other games.

> **Why this repo exists.** Semma lives on a different GitHub account, and a
> Claude Code session can only hold repos from one owner at a time. This public
> repo is the bridge: clone it from a session working on Semma and copy the two
> folders in. The same code is also on `grcc-backend` PR #6, which is where it
> was built and reviewed.
>
> ```bash
> git clone --depth 1 https://github.com/eezzfoods-dotcom/uno-no-mercy
> ```

The server owns the rules. Clients send intents (`play this card`), never state,
and each player only ever receives their own cards. Nothing in this module
imports anything from the host app, so it can be lifted out of this folder and
dropped somewhere else unchanged.

```
.
├── backend/          socket.io game server
│   ├── src/game/deck.js             the 168-card deck
│   ├── src/game/engine.js           all the rules — pure, no I/O
│   ├── src/game/roomManager.js      rooms, seats, rejoining
│   ├── src/routes/socketHandlers.js the uno:* socket API
│   ├── src/server.js                standalone server (optional)
│   └── test/                        31 tests
└── frontend/         React client
    ├── src/UnoGame.jsx              ← the one component you mount
    ├── src/context/UnoContext.jsx   socket + game state
    ├── src/components/              Card, CardBack, shared UI
    └── src/screens/                 Home · Lobby · Table · Over
```

## Running it on its own

```bash
cd backend  && npm install && npm start   # :3002
cd frontend && npm install && npm run dev # :5174
```

Open the client in two browsers, create a room in one, join with the 4-letter
code in the other.

## Wiring it into the Semma app

**Backend** — register the handlers on the socket.io server the app already has.
Every event is namespaced `uno:` and every room is namespaced `uno:<code>`, so
nothing collides with the other games:

```js
const registerUnoHandlers = require('./games/uno-no-mercy/backend/src/routes/socketHandlers');
registerUnoHandlers(io);          // alongside the existing registerSocketHandlers(io)
```

Copy `backend/src/` in and add no dependencies — it uses only `socket.io`, which
the app already has. `backend/src/server.js` is only for running the game alone;
skip it when mounting into the app.

**Frontend** — mount one component from the game picker:

```jsx
import UnoGame from './games/uno-no-mercy/frontend/src/UnoGame';
import './games/uno-no-mercy/frontend/src/uno.css';

<UnoGame socket={socket} onExit={() => setGame(null)} />
```

Pass the app's existing `socket` to share one connection. Leave it out and the
game opens its own using `VITE_UNO_BACKEND_URL` (falling back to
`VITE_BACKEND_URL`, then `http://localhost:3002`).

`onExit` renders a "Back to games" button on the home screen — wire it to
whatever returns the player to the Semma game list.

## The rules

Standard UNO, plus the No Mercy additions:

| | |
|---|---|
| **Stacking** | Draw cards stack. You may only answer with a card worth **the same or more** — a `+2` can be met with `+2/+4/+6/+10`, but a `+4` cannot be met with a `+2`. Whoever will not stack draws the whole pile. |
| **Out at 25** | Reach **25 cards** and you are eliminated on the spot. Last player standing wins if nobody goes out first. |
| **7 — swap** | Play a 7 and swap hands with a player of your choice. |
| **0 — pass along** | Play a 0 and everyone passes their hand one seat along the direction of play. |
| **Skip Everyone** | Skips all other players — you take another turn. |
| **Discard All** | Discard *every* card of that colour from your hand at once. |
| **Colour Roulette** | Name a colour; the next player draws until they turn one up, and loses their turn. |
| **Reverse +4** | Flips direction *and* pushes a `+4` onto the stack, handing it to the player who is now next. |

The 7-0 rule can be switched off per room from the lobby. Stacking and the
25-card knockout are always on — they are what makes it No Mercy.

**Deck — 168 cards**

| Cards | Count |
|---|---|
| 0–9, twice per colour | 80 |
| Skip · Reverse · +2 · Skip Everyone · Discard All, twice per colour | 40 |
| Wild · +4 · +6 · +10 · Reverse +4 · Colour Roulette, eight each | 48 |

Wild Draw cards may be played freely — No Mercy drops the "only if you have no
matching colour" restriction from standard UNO.

## Socket API

Every call takes an ack callback and answers `{ ok: true, ... }` or
`{ ok: false, error }`.

**Client → server**

| Event | Payload | |
|---|---|---|
| `uno:create` | `{ name, avatar, cfg }` | Opens a room, returns its code |
| `uno:join` | `{ code, name, avatar }` | Lobby only |
| `uno:reconnect` | `{ code, name }` | Reclaims an existing seat, any time |
| `uno:config` | `{ cfg }` | Host, lobby only |
| `uno:kick` | `{ playerIdx }` | Host, lobby only |
| `uno:start` | — | Host |
| `uno:play` | `{ cardId, color?, targetIdx? }` | `color` for wilds, `targetIdx` for a 7 |
| `uno:draw` | — | Takes the stack if one is live, else draws one |
| `uno:pass` | — | Only after drawing |
| `uno:call_uno` | — | |
| `uno:catch` | `{ targetIdx }` | +2 to a quiet player on one card |
| `uno:again` / `uno:close` / `uno:leave` | — | |
| `uno:chat` | `{ text }` | 140 chars, one per 400ms |

**Server → client**

| Event | |
|---|---|
| `uno:table` | The shared table — seats, card **counts**, top card, turn, stack size. Broadcast. |
| `uno:hand` | Your cards and your legal moves. Sent to one socket only. |
| `uno:over` | `{ winner, winnerName }` |
| `uno:chat` · `uno:kicked` · `uno:closed` | |

Seats are stable indices. A disconnect marks the seat offline and keeps the
hand; `uno:reconnect` with the same name picks it back up.

## Tests

```bash
cd backend && npm test
```

31 tests, all passing:

- **Engine (27)** — deck composition, card matching, turn order, stacking limits,
  every special card, the 7-0 rule, elimination at 25, win conditions, draw-pile
  reshuffling, UNO catches, and that the shared view never leaks a hand. The last
  is a soak test: 200 randomly played games, asserting every one terminates with
  a legal winner and that no invariant breaks after any move.
- **Multiplayer (4)** — a real socket.io server and real clients: a full
  four-player game played over the wire, reconnect-and-resume, join/name rules,
  and chat rate limiting.

The client was also driven through a two-browser game with Playwright: create,
join, deal, play a wild, pick a colour, and confirm the second device updates
live and the hand survives a reload.

## Notes

- Rooms are held in memory and swept after 3 hours. Running more than one server
  process needs a shared store or sticky sessions — the same constraint the
  Imposter India backend has.
- 2–10 players. Latecomers wait for the next hand.
- `MERCY_LIMIT`, `HAND_SIZE` and `UNO_PENALTY` are constants at the top of
  `engine.js` if you want to tune them.
