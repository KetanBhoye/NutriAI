const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Declares the apps we hand a share card to directly.
 *
 * Android 11 (API 30) made installed packages invisible by default. An
 * *explicit* intent naming a package you have not declared throws
 * ActivityNotFoundException, so the Snapchat button would fail on every modern
 * phone without this — and it would fail identically whether or not Snapchat
 * was installed, which makes it look like the feature is simply broken.
 *
 * Instagram is listed for the same reason. Its ADD_TO_STORY path happens to
 * work today because that intent is fired implicitly, but relying on that
 * distinction is a trap: the first person to add `packageName` to it would get
 * a bug that only reproduces on Android 11+.
 *
 * Declaring a package is not a permission — it grants no access, it only lets
 * the app see that the package exists.
 */
const SHARE_TARGETS = ['com.snapchat.android', 'com.instagram.android'];

module.exports = function withShareTargetQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    manifest.queries = manifest.queries ?? [];
    // Expo's schema models <queries> as an array of blocks; reuse the first
    // rather than appending a second, which is valid XML but confusing to read.
    const block = manifest.queries[0] ?? {};
    manifest.queries[0] = block;

    block.package = block.package ?? [];
    for (const name of SHARE_TARGETS) {
      const already = block.package.some((p) => p.$?.['android:name'] === name);
      if (!already) block.package.push({ $: { 'android:name': name } });
    }

    return cfg;
  });
};
