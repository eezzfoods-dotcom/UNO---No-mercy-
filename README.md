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
│   └── test/                        35 tests
└── frontend/         React client
    ├── src/UnoGame.jsx              ← the one component you mount
    ├── src/context/UnoContext.jsx   socket + game state
    ├── src/components/              Card, CardBack, shared UI
    └── src/screens/                 Home · Lobby · Table · Over
```

## Play it online

The server also serves the web client, so one deployment gives one URL that
players open on their own phones.

**Deploy on Render** — free plan, and WebSockets work on it:

1. https://dashboard.render.com/select-repo?type=web
2. Pick this repo. `render.yaml` fills in the build and start commands.
3. Create Web Service, wait for the build, open the URL it gives you.

Any host that runs a normal Node process works the same way — Railway, Fly,
Heroku, a VPS. **Vercel and Netlify will not**, because their serverless
functions cannot hold a WebSocket open.

| | |
|---|---|
| Build | `npm install && npm run build` |
| Start | `npm start` |
| Health | `GET /health` |
| Port | from `$PORT`, default 3002 |

## Running it locally

```bash
npm install && npm run build && npm start     # one service on :3002
```

Or with hot reload, in two terminals:

```bash
npm run dev:server                            # :3002
npm run dev:client                            # :5174
```

For the split setup, point the client at the server by putting
`VITE_UNO_BACKEND_URL=http://localhost:3002` in `frontend/.env`.

Open the URL in two browsers, create a room in one, join with the 4-letter
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
game opens its own to the origin it was served from, which
`VITE_UNO_BACKEND_URL` overrides when the client and server sit on different
hosts.

`onExit` renders a "Back to games" button on the home screen — wire it to
whatever returns the player to the Semma game list.

## The rules

Implemented from Mattel instruction sheet **HVW18** (©2023) — the official
UNO Show 'em No Mercy rules. Standard UNO matching (colour, number or symbol),
plus these:

| | |
|---|---|
| **Stacking** | Draw cards stack. You may only answer with a card worth **the same or more** — a `+2` can be met with `+2/+4/+6/+10`, but a `+4` cannot be met with a `+2`. Whoever will not stack draws the whole pile. |
| **Out at 25** | Reach **25 cards** and you are eliminated on the spot. Last player standing wins if nobody goes out first. |
| **7 — swap** | Playing a 7 *must* be followed by swapping hands with a player of your choice. |
| **0 — pass along** | Play a 0 and everyone passes their hand one seat along the direction of play. |
| **Skip Everyone** | Skips all other players — you take another turn. |
| **Discard All** | Discard *every* card of that colour from your hand at once. |
| **No passing** | With no playable card you draw until you turn one up — and then you must play it. There is no drawing one and passing. |
| **Colour Roulette** | The **next player** names a colour, then reveals cards until they turn that colour up (wilds never count), keeps every card revealed, and loses their turn. |
| **Reverse +4** | Flips direction *and* pushes a `+4` onto the stack, handing it to whoever is now next. Heads-up it skips the other player, so the stack comes back to **you** — unless you stack over it. |

7-0 is official, but can be switched off per room from the lobby as a house
rule. Stacking and the 25-card knockout are always on — they are what makes it
No Mercy. 2–6 players, as on the box.

**Deck — 168 cards**

| Cards | Count |
|---|---|
| 0–9, twice per colour | 80 |
| Skip · Reverse · +2 · **+4** · Skip Everyone · Discard All, twice per colour | 48 |
| Wild · Wild +6 · Wild +10 · Reverse +4 · Colour Roulette, eight each | 40 |

Note that **+4 is a colour card, not a wild** — the sheet lists it under "Any
Color Action Card" with Skip, Reverse, +2, Discard All and Skip Everyone. The
wild draw cards are +6 and +10.

**Optional scoring game.** The winner of a hand takes the value of every card
left in the other hands — numbers at face value, colour actions 20, wilds 50 —
plus **250 per player knocked out** that hand. First to **1000** wins. Running
totals show on the results screen; the game does not end the room at 1000, so
you can keep playing hands as long as you like.

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
| `uno:draw` | — | Takes the stack if one is live, else draws until something is playable |
| `uno:choose_color` | `{ color }` | The Colour Roulette victim names their colour |
| `uno:call_uno` | — | |
| `uno:catch` | `{ targetIdx }` | +2 to a quiet player on one card |
| `uno:again` / `uno:close` / `uno:leave` | — | |
| `uno:chat` | `{ text }` | 140 chars, one per 400ms |

**Server → client**

| Event | |
|---|---|
| `uno:table` | The shared table — seats, card **counts**, top card, turn, stack size. Broadcast. |
| `uno:hand` | Your cards and your legal moves. Sent to one socket only. |
| `uno:over` | `{ winner, winnerName, score, target }` |
| `uno:chat` · `uno:kicked` · `uno:closed` | |

Seats are stable indices. A disconnect marks the seat offline and keeps the
hand; `uno:reconnect` with the same name picks it back up.

## Tests

```bash
cd backend && npm test
```

35 tests, all passing:

- **Engine (31)** — deck composition against the sheet's card list, card
  matching, turn order, stacking limits, every special card, the 7-0 rule,
  draw-until-playable, elimination at 25, win conditions, draw-pile reshuffling,
  UNO catches, the optional scoring values, and that the shared view never leaks
  a hand. The last is a soak test: 300 randomly played games, asserting every one
  terminates with a legal winner and that no invariant breaks after any move.
- **Multiplayer (4)** — a real socket.io server and real clients: a full
  four-player game played over the wire, reconnect-and-resume, join/name rules,
  and chat rate limiting.

The client was also driven through a two-browser game with Playwright against
the built single service: create, join, deal, play a wild, pick a colour, and
confirm the second device updates live and the hand survives a reload.

## Notes

- Rooms are held in memory and swept after 3 hours. Running more than one server
  process needs a shared store or sticky sessions — the same constraint the
  Imposter India backend has.
- 2–6 players, as the box states. Latecomers wait for the next hand.
- `MERCY_LIMIT`, `HAND_SIZE` and `UNO_PENALTY` are constants at the top of
  `engine.js` if you want to tune them.
