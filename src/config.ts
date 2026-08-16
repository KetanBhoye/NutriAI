export interface AppConfig {
  port: number;
  databasePath: string;
  adminApiKey: string;
  sessionTtlHours: number;
  baseUrl: string;
  nodeEnv: string;
  /**
   * Which database driver this instance uses. Normally from `DB_DRIVER`, but
   * overridable so the parity tests can run two apps side by side — one on
   * each driver — and compare their responses.
   */
  dbDriver?: 'sqlite' | 'postgres';
  /** Postgres connection string; only read when `dbDriver` is 'postgres'. */
  databaseUrl?: string;
}

export function getConfig(): AppConfig {
  const port = Number(process.env.PORT || '8787');
  const nodeEnv = process.env.NODE_ENV || 'development';

  return {
    port,
    databasePath: process.env.DATABASE_PATH || './data/calorie-tracker.db',
    adminApiKey: process.env.ADMIN_API_KEY || 'change-this-admin-key',
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || '168'),
    baseUrl: process.env.BASE_URL || `http://localhost:${port}`,
    nodeEnv,
  };
}
