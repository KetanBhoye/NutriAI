import { randomUUID } from 'node:crypto';
import type { D1DatabaseCompat } from '../../db/types.js';
import { sqlTimestampNow } from '../../db/time.js';
import { costOf } from './pricing.js';

/**
 * Records what every model call cost, per user.
 *
 * Built before any quota exists, deliberately. Limits chosen without knowing
 * the real distribution are guesses: too tight and they cost users, too loose
 * and they cost money. Two weeks of these rows will pick better numbers than
 * anyone can reason out in advance.
 *
 * Recording never blocks the response. A metering failure must not turn a
 * working coach reply into an error — the worst case is one under-counted call.
 */

export type AiFeature =
  | 'coach'
  | 'parse'
  | 'photo'
  | 'suggest'
  | 'weekly'
  | 'onboarding'
  | 'grounded';

export interface UsageRecord {
  userId: string;
  feature: AiFeature;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  groundedQueries?: number;
}

export async function recordAiUsage(
  db: D1DatabaseCompat,
  usage: UsageRecord
): Promise<void> {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const groundedQueries = usage.groundedQueries ?? 0;

  try {
    await db
      .prepare(
        `INSERT INTO ai_usage
           (id, user_id, feature, model, input_tokens, output_tokens, grounded_queries, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        randomUUID(),
        usage.userId,
        usage.feature,
        usage.model ?? null,
        inputTokens,
        outputTokens,
        groundedQueries,
        costOf({ inputTokens, outputTokens, groundedQueries }),
        sqlTimestampNow()
      )
      .run();
  } catch (error) {
    // Deliberately swallowed. See the note above: an under-counted call is a
    // far smaller problem than a 500 on a reply the user already paid for.
    console.error(
      '[ai] failed to record usage:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Pulls token counts out of a Vertex response.
 *
 * `usageMetadata` is what Vertex actually returns; when it is missing (an
 * error shape, a streamed chunk) the caller still gets a row with zero tokens,
 * because knowing a call *happened* matters more for quota than knowing its
 * exact size.
 */
export function tokensFromVertex(payload: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  const meta = (payload as {
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  })?.usageMetadata;

  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
  };
}

export interface UsageWindow {
  calls: number;
  costUsd: number;
  groundedQueries: number;
}

/** Usage for one user since `since` (a `YYYY-MM-DD HH:MM:SS` UTC timestamp). */
export async function usageSince(
  db: D1DatabaseCompat,
  userId: string,
  since: string,
  feature?: AiFeature
): Promise<UsageWindow> {
  const row = feature
    ? await db
        .prepare(
          `SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
                  COALESCE(SUM(grounded_queries), 0) AS grounded
           FROM ai_usage WHERE user_id = ? AND created_at >= ? AND feature = ?`
        )
        .bind(userId, since, feature)
        .first<{ calls: number; cost: number; grounded: number }>()
    : await db
        .prepare(
          `SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
                  COALESCE(SUM(grounded_queries), 0) AS grounded
           FROM ai_usage WHERE user_id = ? AND created_at >= ?`
        )
        .bind(userId, since)
        .first<{ calls: number; cost: number; grounded: number }>();

  return {
    calls: Number(row?.calls ?? 0),
    costUsd: Number(row?.cost ?? 0),
    groundedQueries: Number(row?.grounded ?? 0),
  };
}

/** Project-wide usage since `since`, for the global ceiling. */
export async function projectUsageSince(
  db: D1DatabaseCompat,
  since: string
): Promise<UsageWindow> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(grounded_queries), 0) AS grounded
       FROM ai_usage WHERE created_at >= ?`
    )
    .bind(since)
    .first<{ calls: number; cost: number; grounded: number }>();

  return {
    calls: Number(row?.calls ?? 0),
    costUsd: Number(row?.cost ?? 0),
    groundedQueries: Number(row?.grounded ?? 0),
  };
}
