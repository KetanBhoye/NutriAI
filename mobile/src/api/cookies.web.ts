/**
 * The session cookie, in a browser — which is to say, not our problem.
 *
 * The native build has to carry `ct_sid` by hand (see cookies.ts for why: RN
 * hides `Set-Cookie` from JS, and its shared cookie jar replays stale copies).
 * A browser has neither problem. It stores the cookie the backend sets, sends
 * it on same-origin requests without being asked, and — because `ct_sid` is
 * HttpOnly — refuses to show it to us at all. That last part is a feature, and
 * it is why these are empty rather than a `document.cookie` implementation:
 * reading the session cookie from script is exactly what HttpOnly exists to
 * prevent, and any code here that tried would be reading nothing forever while
 * looking like it worked.
 *
 * `loadStoredCookie` returning null therefore means "send no Cookie header",
 * not "signed out". The caller must not treat it as the latter — the request
 * still goes out authenticated. (Browsers reject a script-set `Cookie` header
 * outright as a forbidden header name, so sending one is not an option even
 * if we had the value.)
 *
 * The PWA is served by the backend from /m, so requests are same-origin and
 * `fetch`'s default credentials mode already includes cookies; client.ts asks
 * for `include` explicitly anyway, which costs nothing and survives someone
 * later pointing a dev build at another origin.
 */

/** Always null on web: the browser attaches the session cookie itself. */
export async function loadStoredCookie(): Promise<string | null> {
  return null;
}

/**
 * Always true, because the honest answer is "we cannot know".
 *
 * `ct_sid` is HttpOnly, so script cannot see whether the browser is holding a
 * session — and the browser will send it regardless. The only way to find out
 * is to ask the server, so the launch check must always run and let `/api/me`
 * answer: 200 signs the user in, 401 clears them out, and a network failure
 * leaves them exactly as they were.
 *
 * Returning `loadStoredCookie() !== null` here — which is what sharing one
 * function between the two questions amounted to — made this always false, so
 * the browser build skipped the launch check entirely and showed the login
 * screen on every single page refresh, to a user whose cookie was sitting
 * right there and would have worked.
 */
export async function hasPossibleSession(): Promise<boolean> {
  return true;
}

/** No-op: the browser stored the cookie from `Set-Cookie` before we resumed. */
export async function captureSessionCookie(): Promise<void> {}

/**
 * No-op. Signing out is a server concern here — `POST /api/auth/logout`
 * replies with an expiring `Set-Cookie`, and the browser drops it. Script
 * can't clear an HttpOnly cookie, so there is nothing this could usefully do.
 */
export async function clearStoredCookie(): Promise<void> {}
