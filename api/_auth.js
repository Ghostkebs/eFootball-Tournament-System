import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

export function verifyToken(req) {
  const header = req.headers['authorization'] || '';
  const token = header.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export function requireAuth(req, res) {
  const user = verifyToken(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

export function requireAdmin(req, res) {
  const user = verifyToken(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (user.role !== 'admin' && user.role !== 'moderator') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return user;
}
