import type { D1DatabaseCompat } from '../../db/types.js';
import { sqlTimestampNow } from '../../db/time.js';
import { GROUNDED_PER_QUERY } from '../ai/pricing.js';

/**
 * What the admin dashboard needs to answer three questions:
 *
 *   Where is the money going?      → spend by feature
 *   Who is spending it?            → top users
 *   Is the food repo working?      → hits, and what those hits saved
 *
 * All of it reads `ai_usage`, which is per-call and per-user — unlike
 * admin/usage.ts, which pulls project totals from Cloud Monitoring and can tell
 * you the bill but not who caused it.
 */

function daysAgo(days: number, now = new Date()): string {
  return sqlTimestampNow(new Date(now.getTime() - days * 86_400_000));
}

export interface FeatureSpend {
  feature: string;
  calls: number;
  cost_usd: number;
  grounded_queries: number;
}

export interface TopUser {
  user_id: string;
  email: string | null;
  name: string | null;
  plan: string;
  calls: number;
  cost_usd: number;
}

export interface RepoStats {
  foods: number;
  hits: number;
  /** What those hits would have cost as grounded searches. */
  saved_usd: number;
  by_source: Array<{ source: string; count: number }>;
}

export interface AiAdminStats {
  days: number;
  total_cost_usd: number;
  total_calls: number;
  by_feature: FeatureSpend[];
  top_users: TopUser[];
  repo: RepoStats;
  /** Rolling 24h spend, i.e. what the ceiling is compared against. */
  today_cost_usd: number;
}

export async function getAiAdminStats(
  db: D1DatabaseCompat,
  days = 30
): Promise<AiAdminStats> {
  const since = daysAgo(days);

  const byFeature = await db
    .prepare(
      `SELECT feature, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(grounded_queries), 0) AS grounded
       FROM ai_usage WHERE created_at >= ?
       GROUP BY feature ORDER BY cost DESC`
    )
    .bind(since)
    .all<{ feature: string; calls: number; cost: number; grounded: number }>();

  const topUsers = await db
    .prepare(
      `SELECT a.user_id, u.email, u.name, COALESCE(u.plan, 'free') AS plan,
              COUNT(*) AS calls, COALESCE(SUM(a.cost_usd), 0) AS cost
       FROM ai_usage a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.created_at >= ?
       GROUP BY a.user_id, u.email, u.name, u.plan
       ORDER BY cost DESC
       LIMIT 15`
    )
    .bind(since)
    .all<{
      user_id: string;
      email: string | null;
      name: string | null;
      plan: string;
      calls: number;
      cost: number;
    }>();

  const today = await db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM ai_usage WHERE created_at >= ?')
    .bind(sqlTimestampNow(new Date(Date.now() - 86_400_000)))
    .first<{ cost: number }>();

  const repoTotals = await db
    .prepare('SELECT COUNT(*) AS foods, COALESCE(SUM(hit_count), 0) AS hits FROM global_foods')
    .bind()
    .first<{ foods: number; hits: number }>();

  const bySource = await db
    .prepare('SELECT source, COUNT(*) AS count FROM global_foods GROUP BY source ORDER BY count DESC')
    .bind()
    .all<{ source: string; count: number }>();

  const features = (byFeature.results ?? []).map((r) => ({
    feature: r.feature,
    calls: Number(r.calls),
    cost_usd: Number(r.cost),
    grounded_queries: Number(r.grounded),
  }));

  const hits = Number(repoTotals?.hits ?? 0);

  return {
    days,
    total_cost_usd: features.reduce((sum, f) => sum + f.cost_usd, 0),
    total_calls: features.reduce((sum, f) => sum + f.calls, 0),
    by_feature: features,
    top_users: (topUsers.results ?? []).map((r) => ({
      user_id: r.user_id,
      email: r.email,
      name: r.name,
      plan: r.plan ?? 'free',
      calls: Number(r.calls),
      cost_usd: Number(r.cost),
    })),
    repo: {
      foods: Number(repoTotals?.foods ?? 0),
      hits,
      // Every hit is a grounded search that did not happen. This is the number
      // that justifies the repo existing.
      saved_usd: hits * GROUNDED_PER_QUERY,
      by_source: (bySource.results ?? []).map((r) => ({
        source: r.source,
        count: Number(r.count),
      })),
    },
    today_cost_usd: Number(today?.cost ?? 0),
  };
}
