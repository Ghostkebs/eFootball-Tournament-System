import { sql } from '../_db.js';
import { requireAuth } from '../_auth.js';

const PTS = [100, 70, 50, 35, 20, 20, 20, 20];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireAuth(req, res);
  if (!user) return;

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Player name required' });

  try {
    const [player] = await sql`SELECT * FROM players WHERE LOWER(name) = LOWER(${name}) AND deleted_at IS NULL`;
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const seasons = await sql`
      SELECT sp.placement, sp.points, s.season_number, c.cycle_number, c.id AS cycle_id
      FROM season_players sp
      JOIN seasons s ON s.id = sp.season_id
      JOIN cycles c ON c.id = s.cycle_id
      WHERE sp.player_id = ${player.id} AND sp.deleted_at IS NULL AND s.done = true
      ORDER BY c.cycle_number ASC, s.season_number ASC
    `;

    // group by cycle
    const byC = {};
    for (const row of seasons) {
      if (!byC[row.cycle_number]) byC[row.cycle_number] = { cycle_number: row.cycle_number, cycle_id: row.cycle_id, seasons: [], points: 0, titles: 0, podiums: 0 };
      byC[row.cycle_number].seasons.push(row);
      byC[row.cycle_number].points += row.points;
      if (row.placement === 1) byC[row.cycle_number].titles++;
      if (row.placement <= 3) byC[row.cycle_number].podiums++;
    }

    const careerPts = seasons.reduce((a, s) => a + s.points, 0);
    const titles = seasons.filter(s => s.placement === 1).length;
    const podiums = seasons.filter(s => s.placement <= 3).length;
    const bestFinish = seasons.length ? Math.min(...seasons.map(s => s.placement)) : null;

    return res.status(200).json({
      player: { id: player.id, name: player.name },
      career: { points: careerPts, titles, podiums, seasons_played: seasons.length, best_finish: bestFinish },
      cycles: Object.values(byC)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
