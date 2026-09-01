import { describe, expect, it } from 'vitest';
import { captureSessionCookie, clearStoredCookie, hasPossibleSession, loadStoredCookie } from './cookies.web';

/**
 * The web half of the cookie seam, which is almost entirely about what these
 * functions *mean* rather than what they do — three of the four are no-ops.
 *
 * Worth testing anyway, because the one time the meanings were conflated the
 * browser build logged everyone out on every page refresh, and nothing failed:
 * no error, no warning, no test. The app simply decided a signed-in user was
 * signed out and showed them a login screen their own cookie would have
 * satisfied. These assertions are the difference between that regressing
 * loudly and regressing silently.
 */
describe('the session cookie on web', () => {
  it('sends no Cookie header of its own', async () => {
    // Not "there is no session" — the browser attaches `ct_sid` itself, and
    // it is HttpOnly so script could never read it. Anything treating this
    // null as signed-out is the bug this file exists for.
    await expect(loadStoredCookie()).resolves.toBeNull();
  });

  it('always considers a session worth verifying', async () => {
    // The whole point: script cannot see an HttpOnly cookie, so the only way
    // to know is to ask /api/me. Returning false here would skip the launch
    // check and strand a signed-in user on /login after every refresh.
    await expect(hasPossibleSession()).resolves.toBe(true);
  });

  it('does not try to capture or clear what it cannot touch', async () => {
    // Both are the browser's job — capture happens from `Set-Cookie` before
    // we resume, and clearing happens when the server expires it on logout.
    // They resolve rather than throw so client.ts needs no platform branch.
    await expect(captureSessionCookie()).resolves.toBeUndefined();
    await expect(clearStoredCookie()).resolves.toBeUndefined();
  });
});
