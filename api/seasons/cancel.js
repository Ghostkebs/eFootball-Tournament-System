import { sql } from '../_db.js';
import { requireAdmin } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { season_id, force = false } = req.body;
  if (!season_id) return res.status(400).json({ error: 'season_id required' });

  try {
    const [season] = await sql`SELECT * FROM seasons WHERE id = ${season_id} AND deleted_at IS NULL`;
    if (!season) return res.status(404).json({ error: 'Season not found' });
    if (season.done) return res.status(400).json({ error: 'Cannot cancel a completed season' });

    // Delete all matches if started
    if (season.started) {
      await sql`DELETE FROM matches WHERE season_id = ${season_id}`;
    }

    // Remove all season players
    await sql`UPDATE season_players SET deleted_at = NOW() WHERE season_id = ${season_id}`;

    // Soft delete the season
    await sql`UPDATE seasons SET deleted_at = NOW(), started = false WHERE id = ${season_id}`;

    return res.status(200).json({ message: 'Tournament cancelled' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
