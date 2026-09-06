// Standalone UNO No Mercy server.
//
// Only needed when running the game on its own. Inside the Semma app, skip
// this file and call registerUnoHandlers(io) on the existing io instance —
// see the README.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
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

// Serve the built client from this same service when it has been built, so one
// deployment gives one URL. Without a build, the API still runs on its own.
const CLIENT_DIR = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
  app.use(express.static(CLIENT_DIR));
  // Single-page app: anything that is not a file or an API route renders it.
  app.get(/^\/(?!health|socket\.io).*/, (_, res) =>
    res.sendFile(path.join(CLIENT_DIR, 'index.html')));
  console.log('Serving client from', CLIENT_DIR);
} else {
  console.log('No client build found — running API only. Build it with: npm run build');
}

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log(`🃏 UNO No Mercy server on port ${PORT}`));

module.exports = { app, server, io };
