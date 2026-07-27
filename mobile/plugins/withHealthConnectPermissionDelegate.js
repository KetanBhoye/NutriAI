const { withMainActivity } = require('@expo/config-plugins');

/**
 * react-native-health-connect needs its permission launcher registered in
 * MainActivity.onCreate — an ActivityResultLauncher can only be created before
 * the activity resumes, so calling requestPermission() otherwise throws
 * "lateinit property requestPermission has not been initialized" and crashes.
 *
 * The library's own Expo plugin does NOT patch MainActivity, so we do it here.
 * Runs on every prebuild, so it survives regeneration of the native project.
 */
const IMPORT = 'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const CALL = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';

module.exports = function withHealthConnectPermissionDelegate(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        `withHealthConnectPermissionDelegate: expected a Kotlin MainActivity, got ${cfg.modResults.language}`
      );
    }
    let src = cfg.modResults.contents;

    if (!src.includes(IMPORT)) {
      src = src.replace(/^(package .+\n)/m, `$1\n${IMPORT}\n`);
    }
    if (!src.includes(CALL)) {
      // Register the delegate immediately after the base onCreate call.
      src = src.replace(/super\.onCreate\(null\)/, `super.onCreate(null)\n    ${CALL}`);
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};
