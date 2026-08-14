/**
 * Deciding whether the build on the server is newer than the one running.
 *
 * This is the whole update prompt in one function, and both ways of getting it
 * wrong are user-visible: too eager and the app nags forever about a version
 * it already is; too shy and nobody ever updates. Hence: pure, and tested.
 *
 * Versions are the release tags `mobile/scripts/release.sh` publishes —
 * three-part semver, no suffixes. Anything else is treated as "can't tell",
 * which resolves to no prompt.
 */

/** -1 if a < b, 0 if equal, 1 if a > b. Null for anything unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;

  for (let i = 0; i < 3; i++) {
    // Numeric, not lexicographic: '10' > '9' even though '10' < '9' as strings.
    if (left[i]! !== right[i]!) return left[i]! < right[i]! ? -1 : 1;
  }
  return 0;
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Should we offer `latest` to someone running `current`?
 *
 * Note the strictness: only a *greater* version counts. A local build ahead of
 * the published one (which is normal while developing) must not be offered a
 * downgrade — Android would reject the install anyway, but silently, leaving
 * the user tapping a button that does nothing.
 */
export function isUpdateAvailable(current: string, latest: string | null | undefined): boolean {
  if (!latest) return false;
  return compareVersions(latest, current) === 1;
}

/** "90000000" → "86 MB". Shown before a download that costs real mobile data. */
export function formatSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
