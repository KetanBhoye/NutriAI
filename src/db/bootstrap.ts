import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { D1DatabaseCompat } from './types.js';
import { createPasswordHash, hashSha256 } from '../auth/security.js';
import { isoNow } from './time.js';

interface BootstrapOptions {
  migrationsDir: string;
  adminApiKey: string;
  adminEmail?: string;
  adminPassword?: string;
}

export async function bootstrapDatabase(
  db: D1DatabaseCompat,
  options: BootstrapOptions
): Promise<void> {
  await runMigrations(db, options.migrationsDir);
  await ensureDefaultAdmin(db, options);
  await ensureDefaultTrackingPreferences(db, options.migrationsDir);
  await cleanupExpiredAuthData(db);
}

async function runMigrations(
  db: D1DatabaseCompat,
  migrationsDir: string
): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of migrationFiles) {
    const existing = await db
      .prepare('SELECT name FROM schema_migrations WHERE name = ?')
      .bind(file)
      .first<{ name: string }>();

    if (existing) {
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    // Apply the migration and record it atomically. SQLite has transactional
    // DDL, so without this a crash between the two steps leaves the schema
    // changed but unrecorded — and statements like ALTER TABLE ADD COLUMN are
    // not idempotent, so the next startup fails permanently on "duplicate
    // column". These run automatically on deploy, so that would be a boot loop.
    await db.exec('BEGIN');
    try {
      await db.exec(sql);
      await db
        .prepare('INSERT INTO schema_migrations (name) VALUES (?)')
        .bind(file)
        .run();
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw new Error(
        `Migration ${file} failed and was rolled back: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

async function ensureDefaultAdmin(
  db: D1DatabaseCompat,
  options: BootstrapOptions
): Promise<void> {
  const adminEmail = options.adminEmail || 'admin@calorie-tracker.local';
  const adminPassword = options.adminPassword || 'admin123456';

  // The default key is published in the README, so hashing it would install a
  // known-value admin credential that anyone could use. Only provision an API
  // key when a real one is configured; otherwise leave it null and let the user
  // mint their own token from the app.
  const DEFAULT_ADMIN_KEY = 'change-this-admin-key';
  const configuredKeyHash =
    options.adminApiKey && options.adminApiKey !== DEFAULT_ADMIN_KEY
      ? hashSha256(options.adminApiKey)
      : null;

  const existingAdmin = await db
    .prepare('SELECT id FROM users WHERE id = ?')
    .bind('admin')
    .first<{ id: string }>();

  if (!existingAdmin) {
    await db
      .prepare(
        'INSERT INTO users (id, name, email, role, api_key_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
      )
      .bind('admin', 'Admin User', adminEmail, 'admin', configuredKeyHash)
      .run();

    await db
      .prepare(
        'INSERT INTO user_passwords (user_id, password_hash, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
      )
      .bind('admin', createPasswordHash(adminPassword))
      .run();

    return;
  }

  // Ensure the admin role, but NEVER touch api_key_hash on an existing user.
  // The previous version overwrote it on every boot, which silently revoked the
  // user's generated token on each deploy. The token is owned by the app's
  // token endpoints, not by bootstrap.
  await db
    .prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind('admin', 'admin')
    .run();
}

async function cleanupExpiredAuthData(db: D1DatabaseCompat): Promise<void> {
  await db
    .prepare('DELETE FROM oauth_authorization_codes WHERE expires_at <= ?')
    .bind(isoNow())
    .run();

  await db
    .prepare('DELETE FROM oauth_tokens WHERE expires_at <= ?')
    .bind(isoNow())
    .run();

  await db
    .prepare('DELETE FROM web_sessions WHERE expires_at <= ?')
    .bind(isoNow())
    .run();
}

function extractNumber(markdown: string, pattern: RegExp): number | undefined {
  const match = markdown.match(pattern);
  if (!match || !match[1]) {
    return undefined;
  }

  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

async function ensureDefaultTrackingPreferences(
  db: D1DatabaseCompat,
  migrationsDir: string
): Promise<void> {
  const projectRoot = join(migrationsDir, '..', '..');
  const instructionsPath = join(
    projectRoot,
    '.github',
    'instructions',
    'calorie tracking.instructions.md'
  );
  const macroCachePath = join(
    projectRoot,
    '.github',
    'instructions',
    'food-macros-cache.md'
  );

  if (!existsSync(instructionsPath) && !existsSync(macroCachePath)) {
    return;
  }

  const existing = await db
    .prepare('SELECT user_id FROM user_tracking_preferences WHERE user_id = ?')
    .bind('admin')
    .first<{ user_id: string }>();

  if (existing) {
    return;
  }

  const behaviorInstructions = existsSync(instructionsPath)
    ? readFileSync(instructionsPath, 'utf8').trim()
    : null;
  const macrosCacheNotes = existsSync(macroCachePath)
    ? readFileSync(macroCachePath, 'utf8').trim()
    : null;

  const dailyCalorieGoal = behaviorInstructions
    ? extractNumber(behaviorInstructions, /Daily Calorie Goal:\s*([0-9.]+)/i)
    : undefined;
  const dailyProteinGoal = behaviorInstructions
    ? extractNumber(behaviorInstructions, /Daily Protein Goal:\s*([0-9.]+)\s*g/i)
    : undefined;
  const dailyCarbsGoal = behaviorInstructions
    ? extractNumber(behaviorInstructions, /Daily Carbs Goal:\s*~?\s*([0-9.]+)\s*g/i)
    : undefined;
  const dailyFatGoal = behaviorInstructions
    ? extractNumber(behaviorInstructions, /Daily Fat Goal:\s*~?\s*([0-9.]+)\s*g/i)
    : undefined;

  await db
    .prepare(`
      INSERT INTO user_tracking_preferences (
        user_id, display_name, daily_calorie_goal, daily_protein_goal_g,
        daily_carbs_goal_g, daily_fat_goal_g, behavior_instructions, macros_cache_notes,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .bind(
      'admin',
      'Admin User',
      dailyCalorieGoal ? Math.round(dailyCalorieGoal) : null,
      dailyProteinGoal ?? null,
      dailyCarbsGoal ?? null,
      dailyFatGoal ?? null,
      behaviorInstructions,
      macrosCacheNotes
    )
    .run();
}
