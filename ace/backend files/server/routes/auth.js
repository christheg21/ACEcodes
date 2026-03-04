const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();
const {
  createUser, findUserByUsername, validatePassword,
  generateToken, publicProfile, getMatchHistory,
} = require('../managers/userManager');
const { requireAuth } = require('../middleware/auth');

// Strict rate limit for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required' });
    if (username.length < 3 || username.length > 20)
      return res.status(400).json({ error: 'Username must be 3–20 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Username: letters, numbers and underscores only' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await findUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const user  = await createUser({ username, password });
    const token = generateToken(user);
    res.status(201).json({ token, user: publicProfile(user) });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Registration failed — please try again' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required' });

    const user = await findUserByUsername(username);
    if (!user || !(await validatePassword(user, password)))
      return res.status(401).json({ error: 'Invalid username or password' });

    const token = generateToken(user);
    res.json({ token, user: publicProfile(user) });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Login failed — please try again' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicProfile(req.user) });
});

// GET /api/auth/history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const history = await getMatchHistory(req.user.id, { limit, offset });
    res.json({ history });
  } catch (err) {
    console.error('[history]', err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

module.exports = router;
