const { withXcodeProject } = require('@expo/config-plugins');

/**
 * Sets the iOS development team on the generated Xcode project.
 *
 * Without it, `expo run:ios --device` reaches the signing step with no team and
 * stops to ask which one to use — fine at a keyboard, fatal in CI or any
 * scripted build. Worse, the answer it prompts for is thrown away by the next
 * `expo prebuild`, because `ios/` is generated and gitignored.
 *
 * This is the same reasoning as `withReleaseSigning.js` on the Android side:
 * anything the native project needs has to be expressed as a plugin, or it
 * lasts exactly until the next regeneration.
 *
 * Override with EXPO_APPLE_TEAM_ID to build under a different team without
 * editing this file.
 */

/** Ketan's personal team — the one the app has always been signed with. */
const DEFAULT_TEAM_ID = 'G996LG99M6';

module.exports = function withIosSigningTeam(config) {
  return withXcodeProject(config, (cfg) => {
    const teamId = process.env.EXPO_APPLE_TEAM_ID || DEFAULT_TEAM_ID;
    const project = cfg.modResults;

    const buildConfigs = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(buildConfigs)) {
      const entry = buildConfigs[key];
      // Skip the section's comment entries and any config that isn't a target
      // (the project-level ones carry no bundle identifier).
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      if (!entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER) continue;
      entry.buildSettings.DEVELOPMENT_TEAM = teamId;
    }

    // Xcode also reads the team from the target's attributes; leaving this
    // unset makes the UI show "None" even though the build settings are right.
    const firstProject = project.getFirstProject().firstProject;
    const targetAttributes = firstProject.attributes?.TargetAttributes;
    if (targetAttributes) {
      for (const targetId of Object.keys(targetAttributes)) {
        targetAttributes[targetId].DevelopmentTeam = teamId;
      }
    }

    return cfg;
  });
};
