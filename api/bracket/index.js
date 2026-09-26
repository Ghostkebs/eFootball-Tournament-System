import { sql } from '../_db.js';
import { requireAuth, requireAdmin } from '../_auth.js';

// Returns full bracket state for a season
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  const { season_id } = req.query;
  if (!season_id) return res.status(400).json({ error: 'season_id required' });

  if (req.method === 'GET') {
    try {
      const matches = await sql`
        SELECT m.*, 
          pa.name AS player_a_name, pb.name AS player_b_name, pw.name AS winner_name
        FROM matches m
        LEFT JOIN players pa ON pa.id = m.player_a_id
        LEFT JOIN players pb ON pb.id = m.player_b_id
        LEFT JOIN players pw ON pw.id = m.winner_id
        WHERE m.season_id = ${season_id}
        ORDER BY m.round, m.match_index
      `;

      const season_players = await sql`
        SELECT p.name, sp.placement, sp.points
        FROM season_players sp
        JOIN players p ON p.id = sp.player_id
        WHERE sp.season_id = ${season_id} AND sp.deleted_at IS NULL
      `;

      const [season] = await sql`SELECT * FROM seasons WHERE id = ${season_id} AND deleted_at IS NULL`;

      return res.status(200).json({ season, matches, season_players });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // POST: set up QF matchups (start bracket)
  if (req.method === 'POST') {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { matchups } = req.body;
    // matchups: [[playerNameA, playerNameB], [playerNameA, playerNameB], ...]  x4
    if (!matchups || matchups.length !== 4) return res.status(400).json({ error: '4 QF matchups required' });

    try {
      const [season] = await sql`SELECT * FROM seasons WHERE id = ${season_id} AND deleted_at IS NULL`;
      if (!season) return res.status(404).json({ error: 'Season not found' });
      if (season.started) return res.status(400).json({ error: 'Bracket already started' });

      // Resolve player names to ids (create if not exist)
      const allNames = [...new Set(matchups.flat())];
      if (allNames.length !== 8) return res.status(400).json({ error: 'Need exactly 8 unique players' });

      const playerMap = {};
      for (const name of allNames) {
        let [p] = await sql`SELECT id FROM players WHERE LOWER(name) = LOWER(${name}) AND deleted_at IS NULL`;
        if (!p) {
          [p] = await sql`INSERT INTO players (name) VALUES (${name}) RETURNING id`;
        }
        // add to season_players
        const existing = await sql`SELECT id FROM season_players WHERE season_id = ${season_id} AND player_id = ${p.id} AND deleted_at IS NULL`;
        if (existing.length === 0) {
          await sql`INSERT INTO season_players (season_id, player_id) VALUES (${season_id}, ${p.id})`;
        }
        playerMap[name.toLowerCase()] = p.id;
      }

      // Create QF matches
      for (let i = 0; i < 4; i++) {
        const [a, b] = matchups[i];
        await sql`
          INSERT INTO matches (season_id, round, match_index, player_a_id, player_b_id)
          VALUES (${season_id}, 'qf', ${i}, ${playerMap[a.toLowerCase()]}, ${playerMap[b.toLowerCase()]})
        `;
      }

      await sql`UPDATE seasons SET started = true WHERE id = ${season_id}`;

      return res.status(201).json({ message: 'Bracket started' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
