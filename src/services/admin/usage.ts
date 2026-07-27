import { getGoogleAccessToken } from '../llm/google-auth.js';

/**
 * Pulls the last 30 days of Vertex AI usage from Cloud Monitoring and turns it
 * into a dollar estimate. Cached for 30 minutes — the Monitoring query is a few
 * seconds and the numbers barely move — so the admin page stays snappy.
 */
export interface VertexUsage {
  input_tokens: number;
  output_tokens: number;
  invocations: number;
  cost_usd: number;
  days: number;
  input_rate_per_m: number;
  output_rate_per_m: number;
}

// Gemini 2.5 Flash pricing (per 1M tokens). Adjust if you switch models.
const IN_RATE_PER_M = 0.3;
const OUT_RATE_PER_M = 2.5;
const TTL_MS = 30 * 60 * 1000;

let cache: { at: number; data: VertexUsage } | null = null;

export async function getVertexUsage(
  credentialJson: string,
  project: string
): Promise<VertexUsage | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  try {
    const token = await getGoogleAccessToken(credentialJson);
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const base = `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`;
    const common =
      `&interval.startTime=${start}&interval.endTime=${end}` +
      `&aggregation.alignmentPeriod=2592000s&aggregation.perSeriesAligner=ALIGN_SUM` +
      `&aggregation.crossSeriesReducer=REDUCE_SUM`;

    const series = async (metric: string, groupBy?: string) => {
      let url = `${base}?filter=${encodeURIComponent(`metric.type="${metric}"`)}${common}`;
      if (groupBy) url += `&aggregation.groupByFields=${groupBy}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json()) as {
        timeSeries?: Array<{
          metric?: { labels?: Record<string, string> };
          points?: Array<{ value: { int64Value?: string; doubleValue?: number } }>;
        }>;
      };
      return json.timeSeries ?? [];
    };
    const pointSum = (s: { points?: Array<{ value: { int64Value?: string; doubleValue?: number } }> }) =>
      (s.points ?? []).reduce((a, p) => a + Number(p.value.int64Value ?? p.value.doubleValue ?? 0), 0);

    const tokenTs = await series(
      'aiplatform.googleapis.com/publisher/online_serving/token_count',
      'metric.label.type'
    );
    let input = 0;
    let output = 0;
    for (const s of tokenTs) {
      const t = s.metric?.labels?.type;
      if (t === 'input') input += pointSum(s);
      else if (t === 'output') output += pointSum(s);
    }

    const invTs = await series('aiplatform.googleapis.com/publisher/online_serving/model_invocation_count');
    const invocations = invTs.reduce((a, s) => a + pointSum(s), 0);

    const data: VertexUsage = {
      input_tokens: input,
      output_tokens: output,
      invocations,
      cost_usd: Math.round((input * (IN_RATE_PER_M / 1e6) + output * (OUT_RATE_PER_M / 1e6)) * 100) / 100,
      days: 30,
      input_rate_per_m: IN_RATE_PER_M,
      output_rate_per_m: OUT_RATE_PER_M,
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (error) {
    console.error('Vertex usage query failed:', error);
    return null;
  }
}
