import { sql } from '../_db.js';
import { requireAdmin } from '../_auth.js';

const PTS = [100, 70, 50, 35, 20, 20, 20, 20];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { match_id, score_a, score_b } = req.body;
  if (score_a === undefined || score_b === undefined) return res.status(400).json({ error: 'Scores required' });
  if (Number(score_a) === Number(score_b)) return res.status(400).json({ error: 'Knockout matches need a winner' });

  try {
    const [match] = await sql`SELECT * FROM matches WHERE id = ${match_id}`;
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const winner_id = Number(score_a) > Number(score_b) ? match.player_a_id : match.player_b_id;

    // Update the match with new scores
    await sql`
      UPDATE matches 
      SET score_a = ${score_a}, score_b = ${score_b}, winner_id = ${winner_id}, locked = true
      WHERE id = ${match_id}
    `;

    // Recalculate placements if season is done
    const [season] = await sql`SELECT * FROM seasons WHERE id = ${match.season_id}`;
    if (season?.done) {
      await recalculatePlacements(match.season_id);
    }

    return res.status(200).json({ message: 'Result updated', winner_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function recalculatePlacements(season_id) {
  const matches = await sql`SELECT * FROM matches WHERE season_id = ${season_id} AND locked = true`;
  const placements = {};

  const qfs = matches.filter(m => m.round === 'qf');
  const final = matches.find(m => m.round === 'final');
  const third = matches.find(m => m.round === 'third');

  for (const m of qfs) {
    const loser = m.score_a > m.score_b ? m.player_b_id : m.player_a_id;
    placements[loser] = { placement: 5, points: PTS[4] };
  }

  if (final) {
    placements[final.winner_id] = { placement: 1, points: PTS[0] };
    const finalLoser = final.player_a_id === final.winner_id ? final.player_b_id : final.player_a_id;
    placements[finalLoser] = { placement: 2, points: PTS[1] };
  }

  if (third) {
    placements[third.winner_id] = { placement: 3, points: PTS[2] };
    const thirdLoser = third.player_a_id === third.winner_id ? third.player_b_id : third.player_a_id;
    placements[thirdLoser] = { placement: 4, points: PTS[3] };
  }

  for (const [player_id, { placement, points }] of Object.entries(placements)) {
    await sql`
      UPDATE season_players SET placement = ${placement}, points = ${points}
      WHERE season_id = ${season_id} AND player_id = ${player_id}
    `;
  }
}
