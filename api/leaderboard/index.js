import { sql } from '../_db.js';
import { requireAuth } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  const { cycle_id } = req.query;
  if (!cycle_id) return res.status(400).json({ error: 'cycle_id required' });

  try {
    const rows = await sql`
      SELECT 
        p.id,
        p.name,
        COALESCE(SUM(sp.points), 0) AS points,
        MIN(sp.placement) AS best_finish,
        COUNT(sp.id) AS seasons_played,
        COALESCE(st.current_streak, 0) AS current_streak,
        COALESCE(st.best_streak, 0) AS best_streak
      FROM players p
      JOIN season_players sp ON sp.player_id = p.id AND sp.deleted_at IS NULL
      JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL
      LEFT JOIN streaks st ON st.player_id = p.id AND st.cycle_id = ${cycle_id}
      WHERE s.cycle_id = ${cycle_id} AND p.deleted_at IS NULL
      GROUP BY p.id, p.name, st.current_streak, st.best_streak
      ORDER BY points DESC, best_finish ASC, p.name ASC
    `;

    const [cycle] = await sql`
      SELECT c.*, COUNT(s.id) FILTER (WHERE s.done = true) AS seasons_done
      FROM cycles c
      LEFT JOIN seasons s ON s.cycle_id = c.id AND s.deleted_at IS NULL
      WHERE c.id = ${cycle_id}
      GROUP BY c.id
    `;

    return res.status(200).json({ cycle, leaderboard: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
