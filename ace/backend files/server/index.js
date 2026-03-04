require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors        = require('cors');
const path        = require('path');
// Security & performance — graceful fallback if not yet installed
let helmet, compression;
try { helmet      = require('helmet');      } catch { helmet      = null; }
try { compression = require('compression'); } catch { compression = null; }
const prisma   = require('./db');

const authRoutes  = require('./routes/auth');
const lobbyRoutes = require('./routes/lobby');
const rateLimit   = require('express-rate-limit');

// General API rate limit — 200 req/min per IP (generous but blocks bots)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});
const { registerSocketHandlers } = require('./socket');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 4000;

// ── CORS ────────────────────────────────────────────────
// In production the frontend is served from the same origin,
// so we only need permissive CORS for local dev.
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? false  // same-origin only
  : [
      process.env.CLIENT_URL || 'http://localhost:3000',
      'http://localhost:4000',
      'http://127.0.0.1:4000',
    ];

// Security headers
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // disabled — we load socket.io inline
    crossOriginEmbedderPolicy: false,
  }));
}
// Gzip compression
if (compression) app.use(compression());

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '50kb' }));

// ── Static frontend ─────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── REST API ─────────────────────────────────────────────
app.use('/api', apiLimiter);       // blanket rate limit on all /api/* routes
app.use('/api/auth',  authRoutes);
app.use('/api/lobby', lobbyRoutes);

// GET /api/stats — lightweight platform stats for landing page
app.get('/api/stats', async (req, res) => {
  try {
    const prisma = require('./db');
    const [totalPlayers, totalGames] = await Promise.all([
      prisma.user.count(),
      prisma.match.count({ where: { finishedAt: { not: null } } }),
    ]);
    res.json({ totalPlayers, totalGames, online: io?.sockets?.sockets?.size || 0 });
  } catch {
    res.json({ totalPlayers: 0, totalGames: 0, online: 0 });
  }
});

app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try { await prisma.$queryRaw`SELECT 1`; dbOk = true; } catch {}
  res.json({ status: 'ok', db: dbOk ? 'connected' : 'error', uptime: Math.floor(process.uptime()) });
});

// ── SPA catch-all ────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Socket.io ────────────────────────────────────────────
let io;
io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
  pingTimeout:  60000,
  pingInterval: 25000,
});

registerSocketHandlers(io);

// ── Boot ─────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🂡  ACE server → http://localhost:${PORT}\n`);
});

// ── Graceful shutdown ────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down…`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',  err => { console.error('[uncaughtException]', err); });
process.on('unhandledRejection', err => { console.error('[unhandledRejection]', err); });
