import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';
import { API_URL } from '../config';

/**
 * Tiny fetch wrapper for the NutriAI backend.
 *
 * Auth is the same `ct_sid` session cookie the web app uses, but getting hold
 * of it on React Native takes two workarounds:
 *
 * 1. Reading it. Both RN's `fetch` and `XMLHttpRequest` hide the `Set-Cookie`
 *    response header from JS (a "forbidden response-header name" that browsers
 *    hide too, and which RN's networking layer enforces even for XHR). The
 *    OS-level cookie jar sees it fine though — NSURLSession stores it
 *    automatically and `@react-native-cookies/cookies` reads it back out
 *    (HttpOnly included, since that restriction is JS-only). So after a
 *    login/signup/Google response we pull the fresh cookie from that jar and
 *    stash it in SecureStore, which is what keeps the user signed in across
 *    launches (the native jar isn't reliably persisted).
 *
 * 2. Sending it. RN configures NSURLSession with the shared cookie jar, so it
 *    silently appends that jar's cookies to whatever `Cookie` header we set.
 *    When a request 401s the server replies `Set-Cookie: ct_sid=` (empty, to
 *    clear it), that empty cookie lands in the jar, and every later request
 *    goes out as `ct_sid=<good>; ct_sid=`. The backend's cookie parser is
 *    last-one-wins, so it reads the empty value and 401s again — a failure
 *    that permanently sticks once it happens. Wiping the jar after each
 *    capture leaves our explicit header as the only source of cookies.
 */

const COOKIE_KEY = 'nutriai.session.cookie';
const SESSION_COOKIE_NAME = 'ct_sid';

let memoryCookie: string | null = null;

export async function loadStoredCookie(): Promise<string | null> {
  if (memoryCookie) return memoryCookie;
  memoryCookie = await SecureStore.getItemAsync(COOKIE_KEY);
  return memoryCookie;
}

async function setStoredCookie(cookie: string | null): Promise<void> {
  memoryCookie = cookie;
  if (cookie) await SecureStore.setItemAsync(COOKIE_KEY, cookie);
  else await SecureStore.deleteItemAsync(COOKIE_KEY);
}

/**
 * Moves the session cookie the OS just stored into SecureStore, then empties
 * the native jar so NSURLSession can't append stale copies to our own
 * `Cookie` header (see note 2 above).
 */
async function captureCookieFromNativeJar(): Promise<void> {
  const cookies = await CookieManager.get(API_URL);
  const value = cookies[SESSION_COOKIE_NAME]?.value;
  if (value) await setStoredCookie(`${SESSION_COOKIE_NAME}=${value}`);
  await CookieManager.clearAll().catch(() => {});
}

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
  /** Capture the session cookie from the native cookie jar (used by login/signup/Google). */
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
    await captureCookieFromNativeJar();
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
  await setStoredCookie(null);
  // clearAll rather than clearByName: the jar can also hold the empty
  // `ct_sid=` the server sets when rejecting a session, which would otherwise
  // be replayed onto the next sign-in attempt.
  await CookieManager.clearAll().catch(() => {});
}
