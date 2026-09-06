// Standalone UNO No Mercy server.
//
// Only needed when running the game on its own. Inside the Semma app, skip
// this file and call registerUnoHandlers(io) on the existing io instance —
// see the README.

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const registerUnoHandlers = require('./routes/socketHandlers');

const app = express();
const server = http.createServer(app);

// Comma-separated allowlist; '*' (the default) is fine because these sockets
// carry no cookies or credentials.
const ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : '*';

const io = new Server(server, {
  cors: { origin: ORIGINS, methods: ['GET', 'POST'], credentials: false },
  pingTimeout: 30000,
  pingInterval: 10000,
});

app.use(cors({ origin: ORIGINS }));
app.use(express.json());
app.get('/health', (_, res) => res.json({ status: 'ok', game: 'uno-no-mercy', time: new Date().toISOString() }));

registerUnoHandlers(io);

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log(`🃏 UNO No Mercy server on port ${PORT}`));

module.exports = { app, server, io };
