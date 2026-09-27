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

  const { season_id, name } = req.body;
  if (!season_id || !name?.trim()) return res.status(400).json({ error: 'season_id and name required' });

  try {
    // Check season exists and isn't started yet
    const [season] = await sql`SELECT * FROM seasons WHERE id = ${season_id} AND deleted_at IS NULL`;
    if (!season) return res.status(404).json({ error: 'Season not found' });
    if (season.started) return res.status(400).json({ error: 'Season already started' });

    // Check not already 8 players
    const count = await sql`SELECT COUNT(*) FROM season_players WHERE season_id = ${season_id} AND deleted_at IS NULL`;
    if (parseInt(count[0].count) >= 8) return res.status(400).json({ error: 'Season already has 8 players' });

    // Get or create player — search ALL records (including soft-deleted) to avoid unique constraint crash
    let [player] = await sql`SELECT id FROM players WHERE LOWER(name) = LOWER(${name.trim()})`;
if (!player) {
  try {
    [player] = await sql`INSERT INTO players (name) VALUES (${name.trim()}) RETURNING id`;
  } catch (err) {
    if (err.code === '23505') {
      [player] = await sql`SELECT id FROM players WHERE LOWER(name) = LOWER(${name.trim()})`;
    } else {
      throw err;
    }
  }
}
    else if (player.deleted_at) {
      // Player was deleted — restore them
      await sql`UPDATE players SET deleted_at = NULL WHERE id = ${player.id}`;
    }

    // Check not already in this season
    const exists = await sql`SELECT id FROM season_players WHERE season_id = ${season_id} AND player_id = ${player.id} AND deleted_at IS NULL`;
    if (exists.length > 0) return res.status(409).json({ error: 'Player already in this season' });

    await sql`INSERT INTO season_players (season_id, player_id) VALUES (${season_id}, ${player.id})`;

    return res.status(201).json({ message: 'Player added' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
