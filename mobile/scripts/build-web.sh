#!/usr/bin/env bash
#
# Build the PWA and publish it into the backend's static directory.
#
#   npm run web:build
#
# The PWA is this same app — the expo-router tree in app/ and everything in
# src/ — compiled through react-native-web instead of to a native binary. It is
# served by the backend at /m (see src/index.ts in the repo root), which is why
# the build must know its base path: Expo bakes it into every asset URL at
# build time, so /m is a build-time fact, not a routing one. Change where it is
# mounted and you must rebuild, not just re-route.
#
# Output goes to public/m/ in the repo root, alongside the admin console's
# public/app/. It is committed like public/app/ is — the deploy image is built
# from the repo, and nothing on the server runs Metro.

set -euo pipefail

cd "$(dirname "$0")/.."
MOBILE_DIR="$(pwd)"
REPO_ROOT="$(cd .. && pwd)"
OUT_DIR="$REPO_ROOT/public/m"

echo "==> Exporting web bundle"
rm -rf dist
npx expo export -p web

if [ ! -f dist/index.html ]; then
  echo "error: export produced no index.html" >&2
  exit 1
fi

# The service worker's cache name has to change when the app changes, or a
# returning user is served the previous build out of a cache that still looks
# valid. The exported bundle's filename already carries a content hash of
# exactly the code that changed, so use it rather than a timestamp: two builds
# of identical source then produce identical output, and a rebuild that changed
# nothing doesn't evict everyone's cache for no reason.
BUILD_ID="$(
  find dist/_expo -name 'entry-*.js' -maxdepth 4 \
    | head -n 1 \
    | sed -E 's/.*entry-([a-f0-9]+)\.js/\1/'
)"
if [ -z "$BUILD_ID" ]; then
  echo "error: could not find the exported bundle to derive a build id" >&2
  exit 1
fi
echo "==> Build id: $BUILD_ID"

# -i.bak for BSD/GNU sed portability; the backup is removed straight after.
sed -i.bak "s/__BUILD_ID__/$BUILD_ID/" dist/sw.js && rm -f dist/sw.js.bak
if grep -q '__BUILD_ID__' dist/sw.js; then
  echo "error: service worker was not stamped with a build id" >&2
  exit 1
fi

# The service worker is plain JS that nothing else compiles or lints, and it
# is loaded by the browser in a context with no visible console — a syntax
# error there doesn't fail the build or show up in the page, it just silently
# means no offline launch and no installable app. (That is exactly how a `*/`
# inside a comment shipped once.) One parse is enough to make it loud.
echo "==> Checking the service worker parses"
node --check dist/sw.js

echo "==> Publishing to $OUT_DIR"
# Replaced wholesale rather than merged: the old build's hashed assets would
# otherwise accumulate forever, and a file deleted from the source would live
# on in the deploy.
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -R dist/. "$OUT_DIR/"

echo
echo "Done. Serving locally:"
echo "  cd $REPO_ROOT && pnpm dev   ->   http://localhost:8787/m/"
echo "(cd $MOBILE_DIR && npm run web  for the dev server with fast refresh)"
