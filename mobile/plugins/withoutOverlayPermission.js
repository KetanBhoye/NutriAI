const { withAndroidManifest } = require('@expo/config-plugins');

const OVERLAY = 'android.permission.SYSTEM_ALERT_WINDOW';

/**
 * Removes the screen-overlay permission from the Android manifest.
 *
 * NutriAI never asks for it. It arrives on its own: React Native declares
 * `SYSTEM_ALERT_WINDOW` in its *debug* manifest, for the dev menu and the
 * redbox, and the manifest merger pulls it into the main manifest — so a
 * release build ends up requesting a permission no shipped code path uses.
 *
 * That matters more here than it would elsewhere. Overlay is the permission
 * behind tapjacking: an app that can draw over other apps can put an
 * invisible window above a banking screen. Play's review treats it as a
 * malware signal, and on a *health* app — already in a regulated category,
 * already reading Health Connect — an unexplained overlay request is exactly
 * the combination that pulls a submission into manual review.
 *
 * Removing it with `tools:node="remove"` rather than by deleting the node:
 * the debug manifest is merged in *after* this plugin runs, so a deletion
 * would simply be undone. The remove marker instructs the merger itself, and
 * survives it. Deleting the node too keeps a hand-edited android/ directory
 * (one that was prebuilt before this plugin existed) from keeping the
 * permission.
 *
 * Verify against the release AAB rather than the generated debug manifest:
 *
 *   bundletool dump manifest --bundle app-release.aab | grep SYSTEM_ALERT
 *
 * Should print nothing. If the dev menu ever stops opening in a debug build,
 * this is why — but that is the debug build's problem, not the release's.
 */
module.exports = function withoutOverlayPermission(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // The `tools` namespace has to be declared on <manifest> or the merger
    // treats tools:node as an unknown attribute and fails the build.
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const permissions = manifest['uses-permission'] || [];
    const kept = permissions.filter((p) => p?.$?.['android:name'] !== OVERLAY);

    kept.push({ $: { 'android:name': OVERLAY, 'tools:node': 'remove' } });
    manifest['uses-permission'] = kept;

    return cfg;
  });
};
