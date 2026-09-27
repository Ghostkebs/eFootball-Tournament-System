import bcrypt from 'bcryptjs';
import { sql } from '../_db.js';
import { signToken } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password, role_code } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  // Role is decided server-side only. Never trust a client-supplied 'role' field —
  // that let anyone call this endpoint directly and register as admin.
  const ADMIN_CODE = process.env.ADMIN_REGISTRATION_CODE;
  const role = (ADMIN_CODE && role_code === ADMIN_CODE) ? 'admin' : 'viewer';

  try {
    const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
    if (existing.length > 0) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const [user] = await sql`
      INSERT INTO users (username, password_hash, role)
      VALUES (${username}, ${hash}, ${role})
      RETURNING id, username, role
    `;

    const token = signToken({ id: user.id, username: user.username, role: user.role });
    return res.status(201).json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
