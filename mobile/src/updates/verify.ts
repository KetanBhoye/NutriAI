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

/**
 * How much room the install needs, as a multiple of the APK's size.
 *
 * The download itself is one copy, and Android's installer needs another plus
 * space to extract and compile the dex. 2.5x is the conventional headroom;
 * below it the installer fails with INSTALL_FAILED_INSUFFICIENT_STORAGE, whose
 * only user-visible form is "App not installed" — after the whole download has
 * already been paid for.
 */
export const INSTALL_SPACE_MULTIPLIER = 2.5;

/**
 * Is there room to download and install this? Message if not, null if fine.
 *
 * Checked *before* the download rather than after, because the failure this
 * prevents costs the user 86 MB of mobile data to discover.
 */
export function describeSpaceProblem(sizeBytes: number | null, freeBytes: number): string | null {
  // An unknown size can't be checked; the post-download verification still
  // applies, and refusing to update over a missing Content-Length would be worse.
  if (sizeBytes == null || sizeBytes <= 0) return null;

  const needed = sizeBytes * INSTALL_SPACE_MULTIPLIER;
  if (freeBytes >= needed) return null;

  const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;
  return `Not enough free space — the update needs about ${mb(needed)} and there's ${mb(freeBytes)} available. Free some space and try again.`;
}

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
