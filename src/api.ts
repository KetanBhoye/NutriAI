import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

/**
 * Tiny fetch wrapper for the NutriAI backend.
 *
 * Auth is the same `ct_sid` session cookie the web app uses. React Native's
 * native networking persists cookies in its own jar for the app's lifetime, but
 * that jar does not reliably survive an app restart — so on login we also
 * capture the cookie from the Set-Cookie header, stash it in SecureStore, and
 * replay it as an explicit `Cookie` header on every request. That keeps the
 * user signed in across launches with zero backend changes.
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

/** Pulls `ct_sid=...` out of a (possibly multi-value) Set-Cookie header. */
function parseSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;,\\s]+)`));
  return match ? `${SESSION_COOKIE_NAME}=${match[1]}` : null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Capture a session cookie from the response (used by login). */
  captureCookie?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const cookie = await loadStoredCookie();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, 'Network error — check your connection and the server URL.');
  }

  if (opts.captureCookie) {
    const captured = parseSessionCookie(res.headers.get('set-cookie'));
    if (captured) await setStoredCookie(captured);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
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
}
