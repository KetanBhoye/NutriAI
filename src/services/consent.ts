/**
 * The version of the Terms and Privacy Policy users agree to.
 *
 * Bump this only when the documents change *materially* — a new data use, a new
 * recipient, a change to deletion. Every account whose `consent_version` is
 * older then reads as un-consented, which is what lets the app ask again
 * without re-prompting everyone for a typo fix.
 *
 * Dated rather than numbered so it matches the "Last updated" line on the
 * pages themselves; a version nobody can tie back to a document is not
 * evidence of anything.
 */
export const CONSENT_VERSION = '2026-08-17';
