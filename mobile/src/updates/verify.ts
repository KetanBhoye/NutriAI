/**
 * Is the file we just downloaded actually an APK?
 *
 * `/download` is a 302 to wherever APK_DOWNLOAD_URL points, which is the point
 * — it lets the link outlive GitHub. It also means a misconfigured value, an
 * expired signed URL or a captive-portal login page all arrive here as a
 * perfectly successful download of something that isn't an app.
 *
 * Handing that to the package installer produces "App not installed", a
 * message that names neither the cause nor anything to do about it. Checking
 * first means the app can say what actually happened.
 */

/** Base64 of the ZIP magic `PK\x03\x04`, which every APK begins with. */
const ZIP_MAGIC_BASE64_PREFIX = 'UEsD';

/** Below this it isn't a build, whatever it claims to be — the release APK is ~86 MB. */
const MIN_PLAUSIBLE_BYTES = 1_000_000;

export interface DownloadFacts {
  /** HTTP status of the final response, after redirects. */
  status: number;
  /** Size on disk in bytes. */
  size: number;
  /** First few bytes of the file, base64-encoded. */
  headBase64: string;
}

/**
 * A human-readable problem, or null if the file looks installable.
 *
 * Returns the message rather than throwing so the caller decides how loud to
 * be, and so this stays a pure function worth testing.
 */
export function describeDownloadProblem(facts: DownloadFacts): string | null {
  if (facts.status !== 200) {
    return `The download server answered ${facts.status}. Try again in a moment.`;
  }

  if (facts.size < MIN_PLAUSIBLE_BYTES) {
    // Most often an error page or a login redirect: small, and served with a
    // cheerful 200.
    return "The download didn't come through completely. Check your connection and try again.";
  }

  if (!facts.headBase64.startsWith(ZIP_MAGIC_BASE64_PREFIX)) {
    return "That download wasn't an app file. The update link may be misconfigured — please report this.";
  }

  return null;
}
