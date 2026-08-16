#!/usr/bin/env node
/**
 * Fills a dev database with two weeks of plausible activity.
 *
 * Trends, the weekly report, streaks, nudges and the consistency score all
 * need history to show anything at all — on an empty account every one of them
 * renders its empty state, so "it loads" tells you nothing. This makes them
 * render the real thing.
 *
 * The data is deliberately imperfect: missed days, days over and under target,
 * a couple of weak protein days. A seed where every day is perfect would make
 * the consistency score read 100 for everyone and hide exactly the behaviour
 * worth looking at.
 *
 * Usage:
 *   node deploy/postgres/seed-dev-data.mjs <postgres-url> [--days 14]
 *        [--end YYYY-MM-DD]  last day to seed; defaults to today (UTC)
 *        [--reset]           clear existing rows in the range first
 *
 * `--end` matters more than it looks: the app asks for *its* local date, so a
 * server seeding "up to UTC today" leaves the current week empty for anyone
 * east of UTC — which is exactly the week you want to look at.
 *
 * `--reset` makes re-running idempotent instead of stacking duplicate days on
 * top of each other. It deletes real rows in the range for the seeded users,
 * so it is dev-only by construction.
 *
 * Refuses to run against anything that looks like production.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const MEALS = [
  { meal: 'breakfast', names: ['Oats & milk', 'Poha', 'Eggs and toast', 'Idli sambar'], kcal: [320, 420] },
  { meal: 'lunch', names: ['Dal rice', 'Rajma chawal', 'Chicken salad', 'Paneer roti'], kcal: [520, 700] },
  { meal: 'dinner', names: ['Grilled chicken & rice', 'Khichdi', 'Fish curry', 'Veg pulao'], kcal: [480, 680] },
  { meal: 'snack', names: ['Whey shake', 'Banana', 'Peanut butter toast', 'Greek yoghurt'], kcal: [140, 260] },
];

/**
 * A fixed seed, so re-running produces the same database rather than a new
 * random one each time. A dev environment that changes under you is worse than
 * one with slightly boring numbers.
 */
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const isoFrom = (endMs) => (daysAgo) =>
  new Date(endMs - daysAgo * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const [url, ...rest] = process.argv.slice(2);
  if (!url) {
    console.error('Usage: seed-dev-data.mjs <postgres-url> [--days 14]');
    process.exit(1);
  }
  const daysArg = rest.indexOf('--days');
  const DAYS = daysArg >= 0 ? Number(rest[daysArg + 1]) : 14;
  const endArg = rest.indexOf('--end');
  const endDate = endArg >= 0 ? rest[endArg + 1] : new Date().toISOString().slice(0, 10);
  const RESET = rest.includes('--reset');
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(endMs)) {
    console.error(`--end must be YYYY-MM-DD, got: ${endDate}`);
    process.exit(1);
  }
  const iso = isoFrom(endMs);

  // Guard: this writes fabricated rows, and doing that to real user data would
  // be unrecoverable without a restore.
  if (/prod|nutriai-app/i.test(url)) {
    console.error('Refusing to seed: connection string looks like production.');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes('.railway.internal') || url.includes('localhost')
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: users } = await client.query(
    `SELECT u.id, u.email, p.daily_calorie_goal, p.daily_protein_goal_g
     FROM users u
     JOIN user_tracking_preferences p ON p.user_id = u.id
     WHERE p.daily_calorie_goal IS NOT NULL
     ORDER BY u.created_at
     LIMIT 30`
  );

  if (users.length === 0) {
    console.error('No users with a calorie goal — nothing to seed against.');
    process.exit(1);
  }

  let entries = 0;
  let activity = 0;
  let weighIns = 0;

  const rangeStart = iso(DAYS - 1);
  const rangeEnd = iso(0);

  await client.query('BEGIN');
  try {
    if (RESET) {
      const ids = users.map((u) => u.id);
      for (const [table, column] of [
        ['food_entries', 'entry_date'],
        ['daily_activity', 'activity_date'],
        ['profile_tracking', 'recorded_date'],
      ]) {
        await client.query(
          `DELETE FROM ${table} WHERE user_id = ANY($1) AND ${column} BETWEEN $2 AND $3`,
          [ids, rangeStart, rangeEnd]
        );
      }
    }
    for (const [index, user] of users.entries()) {
      const rng = makeRng(index * 7919 + 13);
      const kcalGoal = user.daily_calorie_goal ?? 2000;
      const proteinGoal = user.daily_protein_goal_g ?? 140;

      // Give users different adherence so the percentile has a real spread
      // rather than everyone landing on the same score.
      const adherence = 0.45 + (index % 10) * 0.06;

      let weight = 78 - index * 0.3;

      for (let d = DAYS - 1; d >= 0; d -= 1) {
        const date = iso(d);

        // Some days are simply missed. That is what makes the streak and the
        // consistency score say anything.
        if (rng() > adherence + 0.25) continue;

        // Scale the day around the goal, sometimes over and sometimes under.
        const dayFactor = 0.78 + rng() * 0.45;
        let dayKcal = 0;
        let dayProtein = 0;

        for (const slot of MEALS) {
          if (slot.meal === 'snack' && rng() > 0.55) continue;
          const base = slot.kcal[0] + rng() * (slot.kcal[1] - slot.kcal[0]);
          const kcal = Math.round((base * dayFactor * kcalGoal) / 2000);
          const protein = Math.round((kcal / 1000) * (18 + rng() * 22));
          const name = slot.names[Math.floor(rng() * slot.names.length)];

          await client.query(
            `INSERT INTO food_entries
               (id, user_id, food_name, calories, protein_g, carbs_g, fat_g, meal_type, entry_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              randomUUID(),
              user.id,
              name,
              kcal,
              protein,
              Math.round((kcal * 0.45) / 4),
              Math.round((kcal * 0.28) / 9),
              slot.meal,
              date,
            ]
          );
          entries += 1;
          dayKcal += kcal;
          dayProtein += protein;
        }

        if (dayKcal === 0) continue;

        // Steps, correlated with adherence so the movement component varies.
        const steps = Math.round(4000 + rng() * 9000 * adherence + adherence * 3000);
        await client.query(
          `INSERT INTO daily_activity (id, user_id, activity_date, steps, source)
           VALUES ($1,$2,$3,$4,'apple_health')
           ON CONFLICT (user_id, activity_date) DO UPDATE SET steps = excluded.steps`,
          [randomUUID(), user.id, date, steps]
        );
        activity += 1;

        // A weigh-in every few days, drifting down slowly with noise — real
        // scales do not descend in a straight line.
        if (d % 3 === 0) {
          weight -= 0.12 + rng() * 0.12;
          const noisy = Math.round((weight + (rng() - 0.5) * 0.6) * 10) / 10;
          await client.query(
            `INSERT INTO profile_tracking (id, user_id, weight_kg, recorded_date)
             VALUES ($1,$2,$3,$4)`,
            [randomUUID(), user.id, noisy, date]
          );
          weighIns += 1;
        }

        void proteinGoal;
        void dayProtein;
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  console.log(`range:         ${rangeStart} .. ${rangeEnd}${RESET ? ' (reset first)' : ''}`);
  console.log(`users seeded:  ${users.length}`);
  console.log(`food entries:  ${entries}`);
  console.log(`activity days: ${activity}`);
  console.log(`weigh-ins:     ${weighIns}`);
}

main().catch((error) => {
  console.error('Seeding failed and was rolled back:', error.message);
  process.exit(1);
});
