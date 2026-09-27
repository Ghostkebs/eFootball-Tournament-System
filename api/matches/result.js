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
  if (score_a === score_b) return res.status(400).json({ error: 'Knockout matches need a winner' });

  try {
    const [match] = await sql`SELECT * FROM matches WHERE id = ${match_id}`;
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.locked) return res.status(400).json({ error: 'Match already locked' });

    const winner_id = score_a > score_b ? match.player_a_id : match.player_b_id;
    const loser_id = score_a > score_b ? match.player_b_id : match.player_a_id;

    await sql`
      UPDATE matches SET score_a = ${score_a}, score_b = ${score_b}, winner_id = ${winner_id}, locked = true
      WHERE id = ${match_id}
    `;

    const season_id = match.season_id;

    // Auto-advance: create next round match if both feeders done
    await autoAdvance(season_id, match.round, match.match_index, winner_id, loser_id);

    // Check if season is complete
    await checkSeasonDone(season_id);

    return res.status(200).json({ message: 'Result locked', winner_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function autoAdvance(season_id, round, idx, winner_id, loser_id) {
  if (round === 'qf') {
    // QFs 0,1 → SF 0 | QFs 2,3 → SF 1
    const sfIdx = idx < 2 ? 0 : 1;
    const [existing] = await sql`SELECT * FROM matches WHERE season_id = ${season_id} AND round = 'sf' AND match_index = ${sfIdx}`;
    if (existing) {
      // fill in the missing player slot
      if (!existing.player_a_id) {
        await sql`UPDATE matches SET player_a_id = ${winner_id} WHERE id = ${existing.id}`;
      } else if (!existing.player_b_id) {
        await sql`UPDATE matches SET player_b_id = ${winner_id} WHERE id = ${existing.id}`;
      }
    } else {
      // which slot am I? (first or second feeder for this SF)
      const isFirst = idx === 0 || idx === 2;
      if (isFirst) {
        await sql`INSERT INTO matches (season_id, round, match_index, player_a_id) VALUES (${season_id}, 'sf', ${sfIdx}, ${winner_id})`
          .catch(() => {});
      } else {
        await sql`INSERT INTO matches (season_id, round, match_index, player_b_id) VALUES (${season_id}, 'sf', ${sfIdx}, ${winner_id})`
          .catch(() => {});
      }
    }
  }

  if (round === 'sf') {
    // SF winners → Final; SF losers → 3rd place
    await ensureSlot(season_id, 'final', 0, winner_id);
    await ensureSlot(season_id, 'third', 0, loser_id);
  }
}

async function ensureSlot(season_id, round, match_index, player_id) {
  const [existing] = await sql`SELECT * FROM matches WHERE season_id = ${season_id} AND round = ${round} AND match_index = ${match_index}`;
  if (!existing) {
    await sql`INSERT INTO matches (season_id, round, match_index, player_a_id) VALUES (${season_id}, ${round}, ${match_index}, ${player_id})`;
  } else if (!existing.player_a_id) {
    await sql`UPDATE matches SET player_a_id = ${player_id} WHERE id = ${existing.id}`;
  } else if (!existing.player_b_id) {
    await sql`UPDATE matches SET player_b_id = ${player_id} WHERE id = ${existing.id}`;
  }
}

async function checkSeasonDone(season_id) {
  const [final] = await sql`SELECT * FROM matches WHERE season_id = ${season_id} AND round = 'final' AND locked = true`;
  const [third] = await sql`SELECT * FROM matches WHERE season_id = ${season_id} AND round = 'third' AND locked = true`;
  if (!final || !third) return;

  // Determine placements
  const qfs = await sql`SELECT * FROM matches WHERE season_id = ${season_id} AND round = 'qf'`;
  const placements = {};

  // QF losers → 5th
  for (const m of qfs) {
    const loser = m.score_a > m.score_b ? m.player_b_id : m.player_a_id;
    placements[loser] = { placement: 5, points: PTS[4] };
  }

  // Final & 3rd place
  placements[final.winner_id] = { placement: 1, points: PTS[0] };
  const finalLoser = final.player_a_id === final.winner_id ? final.player_b_id : final.player_a_id;
  placements[finalLoser] = { placement: 2, points: PTS[1] };
  placements[third.winner_id] = { placement: 3, points: PTS[2] };
  const thirdLoser = third.player_a_id === third.winner_id ? third.player_b_id : third.player_a_id;
  placements[thirdLoser] = { placement: 4, points: PTS[3] };

  for (const [player_id, { placement, points }] of Object.entries(placements)) {
    await sql`
      UPDATE season_players SET placement = ${placement}, points = ${points}
      WHERE season_id = ${season_id} AND player_id = ${player_id}
    `;
  }

  await sql`UPDATE seasons SET done = true WHERE id = ${season_id}`;

  // Update streaks
  const season = await sql`SELECT * FROM seasons WHERE id = ${season_id}`;
  const cycle_id = season[0].cycle_id;
  for (const [player_id, { placement }] of Object.entries(placements)) {
    const [streak] = await sql`SELECT * FROM streaks WHERE player_id = ${player_id} AND cycle_id = ${cycle_id}`;
    if (!streak) {
      const cur = placement <= 3 ? 1 : 0;
      await sql`INSERT INTO streaks (player_id, cycle_id, current_streak, best_streak, last_season_n) VALUES (${player_id}, ${cycle_id}, ${cur}, ${cur}, ${season[0].season_number})`;
    } else {
      const newStreak = placement <= 3 ? streak.current_streak + 1 : 0;
      const newBest = Math.max(streak.best_streak, newStreak);
      await sql`UPDATE streaks SET current_streak = ${newStreak}, best_streak = ${newBest}, last_season_n = ${season[0].season_number} WHERE id = ${streak.id}`;
    }
  }
}
