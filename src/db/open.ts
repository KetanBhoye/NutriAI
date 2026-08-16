import { resolve } from 'node:path';
import { openSqliteDatabase } from './sqlite-adapter.js';
import { openPostgresDatabase } from './pg-adapter.js';
import type { D1DatabaseCompat } from './types.js';

/**
 * Chooses the database driver for this deployment.
 *
 * Production runs SQLite; the `dev` environment runs Postgres while the
 * migration is in progress. The switch is an explicit `DB_DRIVER` rather than
 * "use Postgres if DATABASE_URL happens to be set", because Railway injects
 * reference variables freely and an accidental inherit must not be able to
 * silently move production onto a different database.
 */

export type DbDriver = 'sqlite' | 'postgres';

export interface OpenedDatabase {
  compat: D1DatabaseCompat;
  driver: DbDriver;
  /** Releases the underlying handle or pool. */
  close: () => Promise<void>;
}

export function resolveDriver(env: NodeJS.ProcessEnv = process.env): DbDriver {
  const requested = (env.DB_DRIVER ?? 'sqlite').trim().toLowerCase();
  if (requested === 'postgres' || requested === 'postgresql') return 'postgres';
  if (requested === 'sqlite') return 'sqlite';
  throw new Error(`Unknown DB_DRIVER "${env.DB_DRIVER}" (expected "sqlite" or "postgres")`);
}

export function openDatabase(databasePath: string): OpenedDatabase {
  const driver = resolveDriver();

  if (driver === 'postgres') {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      // Failing loudly beats falling back to SQLite: a silent fallback would
      // boot a Postgres deployment onto an empty local file and look healthy.
      throw new Error('DB_DRIVER=postgres requires DATABASE_URL to be set');
    }
    const { compat } = openPostgresDatabase(connectionString);
    return { compat, driver, close: () => compat.close() };
  }

  const { raw, compat } = openSqliteDatabase(resolve(databasePath));
  return {
    compat,
    driver,
    close: async () => {
      raw.close();
    },
  };
}

/** Migrations live in a per-dialect directory; the SQL is not portable. */
export function migrationsDirFor(driver: DbDriver): string {
  return driver === 'postgres'
    ? resolve(process.cwd(), 'migrations/postgres')
    : resolve(process.cwd(), 'migrations/portable');
}
