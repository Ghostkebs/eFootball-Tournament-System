import { sql } from '../_db.js';
import { requireAuth, requireAdmin } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    try {
      const players = await sql`
        SELECT p.id, p.name, p.created_at,
          COALESCE(SUM(sp.points), 0) AS career_points,
          COUNT(sp.id) AS seasons_played,
          COUNT(sp.id) FILTER (WHERE sp.placement = 1) AS titles
        FROM players p
        LEFT JOIN season_players sp ON sp.player_id = p.id AND sp.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY career_points DESC, p.name ASC
      `;
      return res.status(200).json({ players });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'POST') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    try {
      const existing = await sql`SELECT id FROM players WHERE LOWER(name) = LOWER(${name.trim()}) AND deleted_at IS NULL`;
      if (existing.length > 0) return res.status(409).json({ error: 'Player already exists' });

      const [player] = await sql`
        INSERT INTO players (name) VALUES (${name.trim()}) RETURNING *
      `;
      return res.status(201).json({ player });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'DELETE') {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    try {
      const [player] = await sql`SELECT id FROM players WHERE LOWER(name) = LOWER(${name.trim()}) AND deleted_at IS NULL`;
      if (!player) return res.status(404).json({ error: 'Player not found' });

      // Block deletion if player has completed seasons (career data)
      const [hasResults] = await sql`SELECT COUNT(*) as n FROM season_players sp JOIN seasons s ON s.id = sp.season_id WHERE sp.player_id = ${player.id} AND s.done = true AND sp.deleted_at IS NULL`;
      if (parseInt(hasResults.n) > 0) return res.status(400).json({ error: 'Cannot delete a player with completed seasons. Their record is part of tournament history.' });

      await sql`UPDATE players SET deleted_at = NOW() WHERE id = ${player.id}`;
      await sql`UPDATE season_players SET deleted_at = NOW() WHERE player_id = ${player.id}`;

      return res.status(200).json({ message: 'Player deleted' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
