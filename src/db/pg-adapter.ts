import pg from 'pg';
import { toPositionalParams } from './sql-placeholders.js';
import type {
  D1DatabaseCompat,
  D1PreparedStatement,
  D1QueryResult,
  D1RunResult,
} from './types.js';

/**
 * Postgres behind the same `D1DatabaseCompat` interface the SQLite adapter
 * implements, so repositories do not know or care which one they are talking to.
 *
 * Two translations happen here and nowhere else:
 *
 *  1. `?` placeholders become `$1..$n` (see sql-placeholders.ts).
 *  2. Transactions get pinned to one connection. This is the subtle one:
 *     bootstrap.ts wraps each migration in `exec('BEGIN')` … `exec('COMMIT')`,
 *     and a pool hands out a *different* connection per query. Left alone, the
 *     BEGIN would open a transaction on one connection, the DDL would run
 *     auto-committed on another, and the COMMIT would close an empty
 *     transaction on a third — so a failed migration would roll back nothing
 *     while reporting success. Nothing would look wrong until a half-applied
 *     schema wedged the next boot.
 */

const { Pool } = pg;

/**
 * `numeric` (OID 1700) arrives as a string so that arbitrary precision is not
 * lost. Every numeric column in this schema is a REAL-equivalent that the app
 * already treats as a JS number, and code like `kcal + 1` on a string would
 * concatenate rather than add. Parse it back to a number to match SQLite.
 */
pg.types.setTypeParser(1700, (value: string) => Number.parseFloat(value));
/** `int8` (OID 20) likewise arrives as a string; COUNT(*) is the common case. */
pg.types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

type Queryable = Pick<pg.PoolClient, 'query'>;

class PgPreparedStatement implements D1PreparedStatement {
  private boundValues: unknown[] = [];

  constructor(
    private readonly db: PgDatabase,
    private readonly query: string
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.boundValues = values;
    return this;
  }

  async run(): Promise<D1RunResult> {
    const result = await this.db.execute(this.query, this.boundValues);
    const changes = result.rowCount ?? 0;
    return {
      meta: {
        changes,
        // Postgres has no lastInsertRowid. Nothing in this codebase needs one:
        // every primary key is an application-generated TEXT id, and the two
        // places that read `last_row_id` are test doubles. Reads as 0 rather
        // than a wrong number, so a future caller fails obviously.
        last_row_id: 0,
      },
      changes,
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.db.execute(this.query, this.boundValues);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1QueryResult<T>> {
    const result = await this.db.execute(this.query, this.boundValues);
    return { results: result.rows as T[] };
  }
}

export class PgDatabase implements D1DatabaseCompat {
  /**
   * Set while a transaction is open. Every query routes here so the whole
   * transaction runs on one connection.
   */
  private txClient: pg.PoolClient | null = null;

  constructor(private readonly pool: pg.Pool) {}

  prepare(query: string): D1PreparedStatement {
    return new PgPreparedStatement(this, query);
  }

  /** @internal — used by the prepared statement. */
  async execute(query: string, values: unknown[]): Promise<pg.QueryResult> {
    const { text, count } = toPositionalParams(query);
    if (count !== values.length) {
      throw new Error(
        `SQL expects ${count} parameter(s) but ${values.length} were bound: ${text}`
      );
    }
    return this.target().query(text, values as unknown[]);
  }

  async exec(query: string): Promise<void> {
    const command = query.trim().toUpperCase();

    if (command === 'BEGIN') {
      if (this.txClient) throw new Error('A transaction is already open');
      this.txClient = await this.pool.connect();
      await this.txClient.query('BEGIN');
      return;
    }

    if (command === 'COMMIT' || command === 'ROLLBACK') {
      const client = this.txClient;
      if (!client) throw new Error(`${command} without an open transaction`);
      try {
        await client.query(command);
      } finally {
        // Release even if the COMMIT throws, or the pool leaks a connection
        // and the next migration blocks forever waiting for one.
        this.txClient = null;
        client.release();
      }
      return;
    }

    // Multi-statement DDL. Postgres allows it in a simple query only when
    // there are no bind parameters, which is true for every migration file.
    await this.target().query(query);
  }

  private target(): Queryable {
    return this.txClient ?? this.pool;
  }

  async close(): Promise<void> {
    if (this.txClient) {
      this.txClient.release();
      this.txClient = null;
    }
    await this.pool.end();
  }
}

export function openPostgresDatabase(connectionString: string): {
  pool: pg.Pool;
  compat: PgDatabase;
} {
  const pool = new Pool({
    connectionString,
    // Railway's managed Postgres terminates TLS with a certificate that does
    // not chain to a public root. Verification is therefore off, but the
    // connection is still encrypted.
    ssl: requiresSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool error with no listener crashes the process. Idle backends get
  // recycled routinely, so this fires in normal operation.
  pool.on('error', (error) => {
    console.error('[db] idle postgres client error:', error.message);
  });

  return { pool, compat: new PgDatabase(pool) };
}

function requiresSsl(connectionString: string): boolean {
  // Railway's internal `.railway.internal` host is on a private network and
  // does not offer TLS; the public proxy host does.
  return !connectionString.includes('.railway.internal');
}
