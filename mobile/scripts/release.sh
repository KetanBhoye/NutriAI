#!/usr/bin/env bash
#
# Ship a new Android build to https://nutriai-app.up.railway.app/download
#
#   npm run release -- 1.0.1
#   npm run release -- 1.0.1 --dry-run     # build and check, publish nothing
#
# The download link follows GitHub's "latest release" permalink, so publishing
# a release is the whole update process — no backend deploy, and the link you
# already gave people keeps working.
#
# It also reaches phones that already have the app: GET /api/app-version reads
# this release, and the app's You tab offers to install it. That comparison is
# against the *tag*, so the tag has to be a plain three-part version and has to
# go up — which is what the checks below are for. See mobile/src/updates/.
#
# Two things this guards, because both are unrecoverable in their own way:
#
#   1. The APK must be signed with the same keystore as every previous build.
#      A different key means everyone who installed the old one has to
#      uninstall first, losing their local state — so the signature is checked
#      against the known fingerprint before anything is published.
#   2. The release asset must always be named NutriAI.apk. The permalink
#      resolves by filename; rename it and every shared link 404s.
#
set -euo pipefail

REPO="KetanBhoye/NutriAI"
ASSET_NAME="NutriAI.apk"

# The release keystore's fingerprint. Public information (it's in every APK),
# and the whole point is to notice when a build doesn't match it.
EXPECTED_SHA1="6A:51:74:C4:D5:7C:75:88:92:3F:1C:AB:8A:1A:F9:C6:6E:88:F4:78"

cd "$(dirname "$0")/.."

VERSION="${1:-}"
DRY_RUN="${2:-}"

if [[ -z "$VERSION" ]]; then
  echo "usage: npm run release -- <version> [--dry-run]" >&2
  echo "   e.g. npm run release -- 1.0.1" >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must look like 1.0.1, got '$VERSION'" >&2
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "error: tag v$VERSION already exists" >&2
  exit 1
fi

echo "==> Checking the tree is clean"
if [[ -n "$(git status --porcelain -- . ':!android' ':!ios')" ]]; then
  echo "error: uncommitted changes in mobile/ — commit them so the release is reproducible" >&2
  git status --short -- . ':!android' ':!ios' >&2
  exit 1
fi

echo "==> Type-checking and testing"
npm run typecheck
npm test

echo "==> Bumping version to $VERSION"
CURRENT_CODE=$(grep -oE 'versionCode: [0-9]+' app.config.ts | grep -oE '[0-9]+')
NEXT_CODE=$((CURRENT_CODE + 1))
# Android compares versionCode, not the version string.
sed -i '' "s/version: '[^']*',/version: '$VERSION',/" app.config.ts
sed -i '' "s/versionCode: $CURRENT_CODE,/versionCode: $NEXT_CODE,/" app.config.ts
echo "    version $VERSION, versionCode $NEXT_CODE"

echo "==> Building the release APK"
# android/ is generated and gitignored, so a fresh clone has to regenerate it.
[[ -d android ]] || npx expo prebuild --platform android --no-install
(cd android && ./gradlew assembleRelease -q)

APK="android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$APK" ]] || { echo "error: no APK at $APK" >&2; exit 1; }

echo "==> Verifying the signature"
APKSIGNER=$(ls ~/Library/Android/sdk/build-tools/*/apksigner 2>/dev/null | tail -1)
if [[ -z "$APKSIGNER" ]]; then
  echo "error: apksigner not found — install Android build-tools" >&2
  exit 1
fi
ACTUAL_SHA1=$("$APKSIGNER" verify --print-certs "$APK" | grep -m1 'SHA-1' | awk '{print $NF}' |
  tr 'a-f' 'A-F' | sed 's/../&:/g;s/:$//')
if [[ "$ACTUAL_SHA1" != "$EXPECTED_SHA1" ]]; then
  echo "error: this APK is signed with the WRONG KEY." >&2
  echo "  expected $EXPECTED_SHA1" >&2
  echo "  got      $ACTUAL_SHA1" >&2
  echo "Publishing it would force every existing user to uninstall first, and" >&2
  echo "Google Sign-In would stop working. Check mobile/credentials/." >&2
  exit 1
fi
echo "    signed with the release key ✓"

STAGED="$(mktemp -d)/$ASSET_NAME"
cp "$APK" "$STAGED"
echo "    $(du -h "$STAGED" | cut -f1) at $STAGED"

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "==> Dry run: stopping before publishing. Version bump left in app.config.ts."
  exit 0
fi

echo "==> Committing and tagging"
git add app.config.ts
git commit -m "Release Android v$VERSION"
git tag "v$VERSION"

echo "==> Publishing the GitHub release"
gh release create "v$VERSION" "$STAGED" \
  --repo "$REPO" \
  --title "NutriAI v$VERSION (Android)" \
  --notes "Install: https://nutriai-app.up.railway.app/download

Already have NutriAI? Open the app and go to You → App version — it will offer this update and install it for you, keeping all your data.

Android 8.0+. Installing the file directly works too; install over the top, no need to uninstall."

git push origin HEAD --tags

echo
echo "Done. https://nutriai-app.up.railway.app/download now serves v$VERSION."
