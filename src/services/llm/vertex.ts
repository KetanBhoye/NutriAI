import { getGoogleAccessToken } from './google-auth.js';
import { macComputeOnline, macGenerate, type MacOptions } from './mac-compute.js';

/**
 * POSTs to a Vertex generateContent endpoint with a timeout and automatic
 * retries. A freshly-booted container's first couple of calls to Vertex can
 * stall (cold connection state) even though the network is fine — retrying on
 * an abort transparently recovers instead of surfacing a 30s error to the user.
 * Callers own the response parsing.
 *
 * This is also the seam where Mac compute plugs in — see `mac-compute.ts`.
 */
export async function vertexFetch(
  url: string,
  token: string,
  body: unknown,
  opts?: { timeoutMs?: number; retries?: number } & MacOptions
): Promise<Response> {
  // The Mac worker goes first when it is online. Any failure there — offline
  // between the check and the claim, a timeout, a malformed answer — falls
  // through to Vertex, so turning the Mac on can only add a way to succeed.
  if (macComputeOnline()) {
    try {
      return await macGenerate(body, opts);
    } catch (error) {
      console.log('[mac-compute] falling back to Vertex:', error instanceof Error ? error.message : error);
    }
  }
  if (!token) throw new Error('No AI backend available: Mac compute failed and Vertex is not configured');

  const timeoutMs = opts?.timeoutMs ?? 24_000;
  const retries = opts?.retries ?? 2;
  const payload = JSON.stringify(body);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: payload,
        signal: ctrl.signal,
      });
    } catch (error) {
      lastErr = error;
      const aborted = (error as { name?: string }).name === 'AbortError';
      if (!aborted || attempt === retries) throw error;
      // Fresh connection on the next try.
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Vertex generateContent URL for a model. */
export function vertexUrl(project: string, location: string, model: string): string {
  return (
    `https://${location}-aiplatform.googleapis.com/v1/projects/${project}` +
    `/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`
  );
}

/**
 * Warms Vertex at startup: makes a few tiny calls so the cold-connection stall
 * is spent before real users arrive. Fire-and-forget; never throws.
 */
export async function warmUpVertex(
  credentialJson: string,
  project: string,
  location: string,
  model: string
): Promise<void> {
  try {
    const token = await getGoogleAccessToken(credentialJson);
    const url = vertexUrl(project, location, model);
    const body = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };
    for (let i = 0; i < 4; i += 1) {
      try {
        const res = await vertexFetch(url, token, body, { timeoutMs: 12_000, retries: 0 });
        if (res.ok) {
          console.log(`[vertex] warmed up on attempt ${i + 1}`);
          return;
        }
      } catch {
        // Cold — try again; the point is to spend the stalls here.
      }
    }
    console.log('[vertex] warm-up unconfirmed; per-request retries will cover it');
  } catch (error) {
    console.log('[vertex] warm-up skipped:', error instanceof Error ? error.message : 'error');
  }
}
