import { sql } from '../_db.js';
import { requireAdmin } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { season_id, name } = req.body;
  if (!season_id || !name?.trim()) return res.status(400).json({ error: 'season_id and name required' });

  try {
    const [player] = await sql`SELECT id FROM players WHERE LOWER(name) = LOWER(${name.trim()}) AND deleted_at IS NULL`;
    if (!player) return res.status(404).json({ error: 'Player not found' });

    await sql`UPDATE season_players SET deleted_at = NOW() WHERE season_id = ${season_id} AND player_id = ${player.id}`;

    return res.status(200).json({ message: 'Player removed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
