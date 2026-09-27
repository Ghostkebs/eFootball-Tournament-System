import { sql } from '../_db.js';
import { requireAuth, requireAdmin } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  const { cycle_id } = req.query;

  if (req.method === 'GET') {
    try {
      const seasons = await sql`
        SELECT s.*, 
          array_agg(p.name ORDER BY sp.placement ASC) FILTER (WHERE p.id IS NOT NULL) AS season_players
        FROM seasons s
        LEFT JOIN season_players sp ON sp.season_id = s.id AND sp.deleted_at IS NULL
        LEFT JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
        WHERE s.cycle_id = ${cycle_id} AND s.deleted_at IS NULL
        GROUP BY s.id
        ORDER BY s.season_number ASC
      `;
      return res.status(200).json({ seasons });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'POST') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    try {
      const [last] = await sql`
        SELECT MAX(season_number) AS max FROM seasons 
        WHERE cycle_id = ${cycle_id} AND deleted_at IS NULL
      `;
      const nextNum = (last?.max || 0) + 1;
      if (nextNum > 10) return res.status(400).json({ error: 'Cycle already has 10 seasons' });

      const [season] = await sql`
        INSERT INTO seasons (cycle_id, season_number) VALUES (${cycle_id}, ${nextNum}) RETURNING *
      `;
      return res.status(201).json({ season });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
