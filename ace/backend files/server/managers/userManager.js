const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'ace-dev-secret-change-in-production';

// ── Create ─────────────────────────────────────────────
async function createUser({ username, password }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: {
      username,
      usernameLower: username.toLowerCase(),
      passwordHash,
      gameStats: {
        create: [
          { game: 'durak' },
          { game: 'shithead' },
          { game: 'gofish' },
        ],
      },
    },
    include: { gameStats: true },
  });
}

// ── Find ───────────────────────────────────────────────
async function findUserByUsername(username) {
  return prisma.user.findUnique({
    where: { usernameLower: username.toLowerCase() },
    include: { gameStats: true },
  });
}

async function findUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    include: { gameStats: true },
  });
}

// ── Auth ───────────────────────────────────────────────
async function validatePassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// ── Match recording ────────────────────────────────────

async function createMatch({ game, mode, roomId, roomName }) {
  const match = await prisma.match.create({ data: { game, mode, roomId, roomName } });
  return match.id;
}

/**
 * Persist results for all players when a game finishes.
 * results: [{ userId, place }]  — place 1 = best finish
 */
async function recordMatchResults({ matchId, game, mode, results }) {
  const isRanked = mode === 'ranked';

  const users = await prisma.user.findMany({
    where: { id: { in: results.map(r => r.userId) } },
    select: { id: true, elo: true },
  });
  const eloMap = Object.fromEntries(users.map(u => [u.id, u.elo]));

  // Pairwise multi-player ELO
  const changes = {};
  results.forEach(r => {
    changes[r.userId] = isRanked ? _calcElo(eloMap[r.userId] ?? 1200, r, results, eloMap) : 0;
  });

  await prisma.$transaction([
    // MatchPlayer rows
    ...results.map(r => prisma.matchPlayer.create({
      data: {
        matchId, userId: r.userId, place: r.place,
        eloChange: changes[r.userId],
        eloBefore: eloMap[r.userId] ?? 1200,
        eloAfter:  (eloMap[r.userId] ?? 1200) + changes[r.userId],
      },
    })),

    // Overall user stats
    ...results.map(r => prisma.user.update({
      where: { id: r.userId },
      data: {
        gamesPlayed: { increment: 1 },
        wins:        { increment: r.place === 1 ? 1 : 0 },
        losses:      { increment: r.place === 1 ? 0 : 1 },
        elo:         { increment: changes[r.userId] },
      },
    })),

    // Per-game stats
    ...results.map(r => prisma.gameStat.upsert({
      where: { userId_game: { userId: r.userId, game } },
      update: {
        gamesPlayed: { increment: 1 },
        wins:        { increment: r.place === 1 ? 1 : 0 },
        losses:      { increment: r.place === 1 ? 0 : 1 },
        elo:         { increment: changes[r.userId] },
      },
      create: {
        userId: r.userId, game,
        gamesPlayed: 1,
        wins:   r.place === 1 ? 1 : 0,
        losses: r.place === 1 ? 0 : 1,
        elo:    1200 + changes[r.userId],
      },
    })),

    // Close the match row
    prisma.match.update({
      where: { id: matchId },
      data: { finishedAt: new Date() },
    }),
  ]);

  return changes; // return ELO deltas so socket.js can broadcast them
}

function _calcElo(myElo, me, results, eloMap) {
  const K = 32;
  let total = 0, n = 0;
  results.forEach(opp => {
    if (opp.userId === me.userId) return;
    const oppElo = eloMap[opp.userId] ?? 1200;
    const expected = 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
    const actual = me.place < opp.place ? 1 : me.place > opp.place ? 0 : 0.5;
    total += K * (actual - expected);
    n++;
  });
  return n > 0 ? Math.round(total / n) : 0;
}

// ── Leaderboard & history ──────────────────────────────

async function getLeaderboard({ game, limit = 20, offset = 0 } = {}) {
  if (game) {
    return prisma.gameStat.findMany({
      where: { game, gamesPlayed: { gte: 3 } },
      orderBy: { elo: 'desc' },
      take: limit,
      skip: offset,
      include: { user: { select: { id: true, username: true } } },
    });
  }
  return prisma.user.findMany({
    where: { gamesPlayed: { gte: 3 } },
    orderBy: { elo: 'desc' },
    take: limit,
    skip: offset,
    select: { id: true, username: true, elo: true, gamesPlayed: true, wins: true, losses: true },
  });
}

async function getMatchHistory(userId, { limit = 20, offset = 0 } = {}) {
  return prisma.matchPlayer.findMany({
    where: { userId },
    orderBy: { match: { finishedAt: 'desc' } },
    take: limit,
    skip: offset,
    include: {
      match: {
        include: {
          players: { include: { user: { select: { username: true } } } },
        },
      },
    },
  });
}

// ── Public profile shape ───────────────────────────────
function publicProfile(user) {
  const byGame = {};
  (user.gameStats || []).forEach(gs => {
    byGame[gs.game] = { gamesPlayed: gs.gamesPlayed, wins: gs.wins, losses: gs.losses, elo: gs.elo };
  });
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    stats: {
      gamesPlayed: user.gamesPlayed,
      wins: user.wins,
      losses: user.losses,
      elo: user.elo,
      byGame,
    },
  };
}

module.exports = {
  createUser, findUserByUsername, findUserById,
  validatePassword, generateToken, verifyToken,
  publicProfile, createMatch, recordMatchResults,
  getLeaderboard, getMatchHistory,
};
