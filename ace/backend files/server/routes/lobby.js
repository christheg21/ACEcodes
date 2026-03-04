const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createRoom, listRooms, getRoom, publicRoom, GAME_CONFIGS } = require('../managers/roomManager');
const { getLeaderboard } = require('../managers/userManager');

// GET /api/lobby/rooms
router.get('/rooms', (req, res) => {
  const { game, status } = req.query;
  let rooms = listRooms();
  if (game)   rooms = rooms.filter(r => r.game   === game);
  if (status) rooms = rooms.filter(r => r.status === status);
  res.json({ rooms });
});

// GET /api/lobby/rooms/:id
router.get('/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ room: publicRoom(room) });
});

// POST /api/lobby/rooms  (auth required)
router.post('/rooms', requireAuth, (req, res) => {
  const { name, game, maxPlayers, mode, password } = req.body;
  if (!name || name.trim().length < 2 || !game)
    return res.status(400).json({ error: 'Room name must be at least 2 characters' });
  if (!GAME_CONFIGS[game])
    return res.status(400).json({ error: `Invalid game. Choose: ${Object.keys(GAME_CONFIGS).join(', ')}` });

  const config = GAME_CONFIGS[game];
  const max = Math.min(parseInt(maxPlayers) || config.maxPlayers, config.maxPlayers);

  const room = createRoom({
    name: name.slice(0, 40),
    game,
    maxPlayers: max,
    mode: mode === 'ranked' ? 'ranked' : 'casual',
    password: password || null,
    hostId: req.user.id,
    hostUsername: req.user.username,
  });
  res.status(201).json({ room: publicRoom(room) });
});

// GET /api/lobby/games
router.get('/games', (_req, res) => {
  res.json({ games: GAME_CONFIGS });
});

// GET /api/lobby/leaderboard?game=durak&limit=20&offset=0
router.get('/leaderboard', async (req, res) => {
  try {
    const { game, limit, offset } = req.query;
    const board = await getLeaderboard({
      game: game || undefined,
      limit: Math.min(parseInt(limit) || 20, 50),
      offset: parseInt(offset) || 0,
    });
    res.json({ leaderboard: board });
  } catch (err) {
    console.error('[leaderboard]', err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

module.exports = router;
