import { sql } from '../_db.js';
import { requireAuth, requireAdmin } from '../_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const cycles = await sql`
        SELECT c.id, c.cycle_number, c.created_at,
          COUNT(s.id) FILTER (WHERE s.done = true) AS seasons_done
        FROM cycles c
        LEFT JOIN seasons s ON s.cycle_id = c.id AND s.deleted_at IS NULL
        WHERE c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.cycle_number ASC
      `;
      return res.status(200).json({ cycles });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    try {
      const [last] = await sql`SELECT MAX(cycle_number) AS max FROM cycles WHERE deleted_at IS NULL`;
      const nextNum = (last?.max || 0) + 1;
      const [cycle] = await sql`
        INSERT INTO cycles (cycle_number) VALUES (${nextNum}) RETURNING *
      `;
      // auto-create season 1 for this cycle
      await sql`INSERT INTO seasons (cycle_id, season_number) VALUES (${cycle.id}, 1)`;
      return res.status(201).json({ cycle });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
