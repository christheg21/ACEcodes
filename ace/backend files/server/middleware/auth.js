const { verifyToken, findUserById } = require('../managers/userManager');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });

  const payload = verifyToken(header.slice(7));
  if (!payload)
    return res.status(401).json({ error: 'Token invalid or expired' });

  const user = await findUserById(payload.id);
  if (!user)
    return res.status(401).json({ error: 'User not found' });

  req.user = user;
  next();
}

module.exports = { requireAuth };
