import { sql } from '../_db.js';
import { requireAdmin } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireAdmin(req, res);
  if (!user) return;

  const { season_id, player_name } = req.body;
  if (!season_id || !player_name) return res.status(400).json({ error: 'season_id and player_name required' });

  try {
    let [p] = await sql`SELECT id FROM players WHERE LOWER(name) = LOWER(${player_name.trim()}) AND deleted_at IS NULL`;
    if (!p) {
      [p] = await sql`INSERT INTO players (name) VALUES (${player_name.trim()}) RETURNING id`;
    }

    const existing = await sql`SELECT id FROM season_players WHERE season_id = ${season_id} AND player_id = ${p.id} AND deleted_at IS NULL`;
    if (existing.length > 0) return res.status(409).json({ error: 'Player already added' });

    await sql`INSERT INTO season_players (season_id, player_id) VALUES (${season_id}, ${p.id})`;

    const players = await sql`
      SELECT p.id, p.name FROM season_players sp
      JOIN players p ON p.id = sp.player_id
      WHERE sp.season_id = ${season_id} AND sp.deleted_at IS NULL
    `;

    return res.status(201).json({ players: players.map(p => ({ id: p.id, name: p.name })) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
