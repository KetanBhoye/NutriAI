import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';
import { API_URL } from '../config';

/**
 * The session cookie, on native.
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
 *
 * None of this applies in a browser, where the cookie is the browser's job —
 * see cookies.web.ts, which is the same module with all of it removed.
 */

const COOKIE_KEY = 'nutriai.session.cookie';
const SESSION_COOKIE_NAME = 'ct_sid';

let memoryCookie: string | null = null;

/**
 * The `Cookie` header to send, or null. On web this is always null: naming it
 * "the header we send" rather than "the cookie" is what lets the browser
 * answer "nothing, I handle that" without the caller caring.
 */
export async function loadStoredCookie(): Promise<string | null> {
  if (memoryCookie) return memoryCookie;
  memoryCookie = await SecureStore.getItemAsync(COOKIE_KEY);
  return memoryCookie;
}

/**
 * Whether there might be a session to verify at launch — a different question
 * from `loadStoredCookie`, and the reason they are separate functions.
 *
 * Here they happen to have the same answer: the stored cookie is both what we
 * send and the only evidence a session exists. On web they diverge completely
 * (see cookies.web.ts), and conflating them meant the browser build skipped
 * its entire launch check.
 */
export async function hasPossibleSession(): Promise<boolean> {
  return (await loadStoredCookie()) !== null;
}

async function setStoredCookie(cookie: string | null): Promise<void> {
  memoryCookie = cookie;
  if (cookie) await SecureStore.setItemAsync(COOKIE_KEY, cookie);
  else await SecureStore.deleteItemAsync(COOKIE_KEY);
}

/**
 * Moves the session cookie the OS just stored into SecureStore, then empties
 * the native jar so NSURLSession can't append stale copies to our own
 * `Cookie` header (see note 2 above). Called after login/signup/Google.
 */
export async function captureSessionCookie(): Promise<void> {
  const cookies = await CookieManager.get(API_URL);
  const value = cookies[SESSION_COOKIE_NAME]?.value;
  if (value) await setStoredCookie(`${SESSION_COOKIE_NAME}=${value}`);
  await CookieManager.clearAll().catch(() => {});
}

export async function clearStoredCookie(): Promise<void> {
  await setStoredCookie(null);
  // clearAll rather than clearByName: the jar can also hold the empty
  // `ct_sid=` the server sets when rejecting a session, which would otherwise
  // be replayed onto the next sign-in attempt.
  await CookieManager.clearAll().catch(() => {});
}
