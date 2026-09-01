import { API_URL } from '../config';
import { captureSessionCookie, clearStoredCookie, hasPossibleSession, loadStoredCookie } from './cookies';

/**
 * Tiny fetch wrapper for the NutriAI backend.
 *
 * Auth is the `ct_sid` session cookie. How that cookie is carried is the one
 * thing that differs between a phone and a browser, so it lives behind
 * ./cookies (native) and ./cookies.web (web) and nothing below has to know
 * which platform it is on: `loadStoredCookie()` returns the `Cookie` header to
 * send, or null when the platform sends it for us.
 */

export { hasPossibleSession, loadStoredCookie };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  /** Capture the freshly-set session cookie (used by login/signup/Google). */
  captureCookie?: boolean;
  /** Override the default request timeout (ms). LLM endpoints run long. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Registered once by AuthProvider. Lets a session that expires mid-use (not
 * just at launch) clear the stored cookie and bounce to /login instead of
 * every screen showing a raw "Request failed (401)" dead end.
 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const cookie = await loadStoredCookie();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      // Ignored by RN (which uses its own jar); on web it is what lets the
      // session cookie ride along, and keeps doing so if a dev build is ever
      // pointed at a different origin than the one serving the bundle.
      credentials: 'include',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new ApiError(0, 'Request timed out — check your connection and try again.');
    }
    throw new ApiError(0, 'Network error — check your connection and the server URL.');
  } finally {
    clearTimeout(timeout);
  }

  if (opts.captureCookie) {
    await captureSessionCookie();
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    if (res.status === 401 && !opts.captureCookie) unauthorizedHandler?.();
    let message = `Request failed (${res.status})`;
    if (data && typeof data === 'object' && 'error' in data) {
      message = String((data as { error: unknown }).error);
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await clearStoredCookie();
}
