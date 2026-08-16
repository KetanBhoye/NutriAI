#!/usr/bin/env node
/**
 * Copies a SQLite backup into a Postgres database that already has the schema.
 *
 * Usage:
 *   node scripts/sqlite-to-postgres.mjs <backup.db> <postgres-url>
 *
 * Deliberately dumb: it reads each table and inserts the rows as-is. No type
 * coercion, because the Postgres schema was generated to mirror the SQLite one
 * (see migrations/postgres/README.md) — if a value needs converting, that is a
 * schema mismatch worth failing on rather than papering over.
 *
 * Tables are copied parents-first so foreign keys hold at every step. The whole
 * copy runs in one transaction: a partial migration is worse than none, because
 * it looks like it worked.
 */
import Database from 'better-sqlite3';
import pg from 'pg';

/** Parents before children. Order matters; foreign keys are enforced. */
const TABLE_ORDER = [
  'users',
  'user_passwords',
  'web_sessions',
  'user_profiles',
  'profile_tracking',
  'oauth_clients',
  'oauth_authorization_codes',
  'oauth_tokens',
  'body_measurements',
  'progress_photos',
  'user_tracking_preferences',
  'foods',
  'food_entries',
  'food_aliases',
  'daily_activity',
  'goal_plans',
  'push_subscriptions',
  'weekly_reports',
];

async function main() {
  const [backupPath, connectionString] = process.argv.slice(2);
  if (!backupPath || !connectionString) {
    console.error('Usage: sqlite-to-postgres.mjs <backup.db> <postgres-url>');
    process.exit(1);
  }

  const sqlite = new Database(backupPath, { readonly: true });
  const client = new pg.Client({ connectionString });
  await client.connect();

  const counts = [];
  try {
    await client.query('BEGIN');

    for (const table of TABLE_ORDER) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (rows.length === 0) {
        counts.push([table, 0, 0]);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const quoted = columns.map((c) => `"${c}"`).join(', ');

      for (const row of rows) {
        const params = columns.map((c) => row[c]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`,
          params
        );
      }

      const { rows: after } = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      counts.push([table, rows.length, after[0].n]);
    }

    // Verify before committing, so a mismatch rolls the whole thing back.
    const mismatched = counts.filter(([, src, dst]) => src !== dst);
    if (mismatched.length > 0) {
      throw new Error(
        `Row counts differ: ${mismatched.map(([t, s, d]) => `${t} ${s}->${d}`).join(', ')}`
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    sqlite.close();
    await client.end();
  }

  let total = 0;
  for (const [table, src] of counts) {
    if (src > 0) console.log(`  ${table.padEnd(28)} ${String(src).padStart(6)}`);
    total += src;
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(total).padStart(6)}`);
}

main().catch((error) => {
  console.error('Migration failed and was rolled back:', error.message);
  process.exit(1);
});
