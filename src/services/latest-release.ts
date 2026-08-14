/**
 * What the newest published Android build is.
 *
 * The app polls this to decide whether to offer an in-app update. GitHub
 * Releases is the source of truth — the same place `/download` points and the
 * same place `mobile/scripts/release.sh` publishes to — so cutting a release
 * remains the entire update process. Nothing here needs a redeploy.
 *
 * Two deliberate choices:
 *
 *  - **We report the version string, not Android's versionCode.** The release
 *    tag (`v1.0.1`) is the only version marker GitHub carries; the versionCode
 *    lives in the APK and would mean downloading 86 MB to read it. Since
 *    `release.sh` bumps both together and refuses to reuse a tag, the tag is
 *    monotonic and comparing it is equivalent.
 *  - **The download URL we hand out is this server's own `/download`**, not the
 *    GitHub asset. That redirect is already the one indirection people's
 *    existing links go through; pointing APK_DOWNLOAD_URL somewhere else moves
 *    the installed apps too, instead of stranding them on GitHub.
 */

/** GitHub's rate limit for unauthenticated calls is 60/hour per IP. This keeps
 *  us to ~6, however many phones are checking. */
const CACHE_TTL_MS = 10 * 60 * 1000;

const FETCH_TIMEOUT_MS = 5_000;

export interface LatestRelease {
  /** Semver, no leading `v`. */
  version: string;
  /** Release notes as written on the GitHub release. */
  notes: string;
  /** Bytes, so the app can warn before a large download on mobile data. */
  size_bytes: number | null;
  published_at: string | null;
}

interface GithubAsset {
  name?: string;
  size?: number;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: GithubAsset[];
}

let cached: { at: number; value: LatestRelease | null } | null = null;

/** Test seam — the suite must not depend on GitHub being reachable. */
export function resetLatestReleaseCache(): void {
  cached = null;
}

function repo(): string {
  return process.env.GITHUB_RELEASES_REPO || 'KetanBhoye/NutriAI';
}

function apkAssetName(): string {
  return process.env.APK_ASSET_NAME || 'NutriAI.apk';
}

/** `v1.0.1` → `1.0.1`. Returns null for anything that isn't a version tag. */
export function versionFromTag(tag: string | undefined): string | null {
  if (!tag) return null;
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(tag.trim());
  return match ? match[1]! : null;
}

function parse(release: GithubRelease): LatestRelease | null {
  // A draft or prerelease is not something to push to every phone.
  if (release.draft || release.prerelease) return null;

  const version = versionFromTag(release.tag_name);
  if (!version) return null;

  // No APK attached means there is nothing to install, whatever the tag says —
  // a release carrying only source archives must not trigger an update prompt.
  const asset = release.assets?.find((a) => a.name === apkAssetName());
  if (!asset) return null;

  return {
    version,
    notes: (release.body || '').trim(),
    size_bytes: typeof asset.size === 'number' ? asset.size : null,
    published_at: release.published_at ?? null,
  };
}

/**
 * The latest release, or null if there isn't a usable one.
 *
 * Never throws: an update check failing is not worth a 500, and the app treats
 * "no answer" as "you're up to date" rather than showing an error for something
 * the user did not ask for.
 */
export async function getLatestRelease(): Promise<LatestRelease | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const res = await fetch(`https://api.github.com/repos/${repo()}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nutriai-server',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);

    const value = parse((await res.json()) as GithubRelease);
    cached = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.warn('[app-version] could not read the latest release:', (error as Error).message);
    // Serve the last known good answer if we have one. A rate-limit window or a
    // GitHub blip shouldn't make every phone think it's up to date.
    if (cached) return cached.value;
    cached = { at: Date.now(), value: null };
    return null;
  }
}
