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

echo "==> Regenerating the native project so the bump reaches the build"
# ALWAYS, not only when android/ is missing.
#
# The version Gradle compiles in lives in android/app/build.gradle, which is
# GENERATED from app.config.ts by prebuild. Bumping app.config.ts without
# re-running this changes nothing: v1.0.1 shipped stamped 1.0.0/versionCode 1,
# so the app reported 1.0.0, the server offered 1.0.1, Android accepted the
# install as a same-versionCode reinstall, and the update was offered again on
# the next launch. Forever. See mobile/progress.md.
npx expo prebuild --platform android --no-install

echo "==> Building the release APK"
(cd android && ./gradlew assembleRelease -q)

APK="android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$APK" ]] || { echo "error: no APK at $APK" >&2; exit 1; }

echo "==> Verifying the APK really carries version $VERSION"
# The check that makes the above bug unshippable rather than merely fixed:
# assert what is INSIDE the APK, never what we asked for. Every step between
# app.config.ts and the binary is a place the version can fail to arrive.
AAPT=$(ls ~/Library/Android/sdk/build-tools/*/aapt2 2>/dev/null | tail -1)
if [[ -z "$AAPT" ]]; then
  echo "error: aapt2 not found — install Android build-tools" >&2
  exit 1
fi
# Capture in full, then take the first line in the shell. Piping aapt2 into
# `head -1` closes the pipe early, aapt2 dies of SIGPIPE, and `set -o pipefail`
# aborts the release with no message at all.
BADGING_ALL=$("$AAPT" dump badging "$APK")
BADGING=${BADGING_ALL%%$'\n'*}
APK_NAME=$(sed -E "s/.*versionName='([^']*)'.*/\1/" <<<"$BADGING")
APK_CODE=$(sed -E "s/.*versionCode='([^']*)'.*/\1/" <<<"$BADGING")

if [[ "$APK_NAME" != "$VERSION" || "$APK_CODE" != "$NEXT_CODE" ]]; then
  echo "error: the APK does not carry the version being released." >&2
  echo "  expected versionName $VERSION, versionCode $NEXT_CODE" >&2
  echo "  got      versionName $APK_NAME, versionCode $APK_CODE" >&2
  echo >&2
  echo "Publishing this would put every user in an update loop: the app would" >&2
  echo "report the old version, be offered this one, install it successfully," >&2
  echo "and be offered it again on the next launch." >&2
  exit 1
fi
echo "    versionName $APK_NAME, versionCode $APK_CODE ✓"

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

echo "==> Pushing the commit and tag"
# Before `gh release create`, not after. Creating a release also creates the tag
# on the remote, so pushing afterwards fails with "tag already exists" — the
# release is fine, but the script exits non-zero on its last line and never
# prints the summary, which reads exactly like a failed publish.
# This tag only — `--tags` pushes every tag in the repo, so a single stale or
# divergent one (an old release tag that differs from the remote) rejects the
# push and blocks a release that has nothing to do with it.
git push origin HEAD
git push origin "v$VERSION"

echo "==> Publishing the GitHub release"
gh release create "v$VERSION" "$STAGED" \
  --repo "$REPO" \
  --title "NutriAI v$VERSION (Android)" \
  --notes "Install: https://nutriai-app.up.railway.app/download

Already have NutriAI?

- **Running 1.0.1 or newer:** open the app, go to You → App version, and it will download and install this update for you, keeping all your data.
- **Running 1.0.0:** install the file below over the top, once. In-app updating starts from 1.0.1 — 1.0.0 shipped before it existed and has nothing to check with.

Android 8.0+. Installing over the top never needs an uninstall, so nothing is lost either way."

echo
echo "Done. https://nutriai-app.up.railway.app/download now serves v$VERSION."
