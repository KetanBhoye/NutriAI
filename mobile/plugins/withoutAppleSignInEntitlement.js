const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * Strips the Sign in with Apple entitlement on a free Apple team.
 *
 * `usesAppleSignIn` in app.config.ts is gated on APPLE_PAID_TEAM, but gating
 * it is not enough: `expo-apple-authentication` ships its own config plugin
 * that adds `com.apple.developer.applesignin` whenever the package is
 * installed, whatever the app config says. So the entitlement came back on
 * its own and a personal-team build failed to sign:
 *
 *   Provisioning profile "iOS Team Provisioning Profile: app.nutriai.mobile"
 *   does not support the Sign In with Apple capability.
 *
 * Only a paid Apple Developer account can create a profile carrying it — the
 * same situation as the push entitlement (see withoutPushEntitlement.js).
 *
 * This runs only when APPLE_PAID_TEAM=0 is set explicitly, so the default
 * build is still the compliant one carrying the entitlement. A build without
 * it simply has no Apple button: AppleSignInButton.tsx hides itself when
 * `isAvailableAsync` reports false, which is what the OS reports without the
 * entitlement. Nothing else changes.
 *
 * Never set APPLE_PAID_TEAM=0 for a store build. Guideline 4.8 requires Sign
 * in with Apple wherever a third-party social login is offered, and this app
 * offers Google — so that build would be rejected.
 */
module.exports = function withoutAppleSignInEntitlement(config) {
  if (process.env.APPLE_PAID_TEAM !== '0') return config;

  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['com.apple.developer.applesignin'];
    return cfg;
  });
};
