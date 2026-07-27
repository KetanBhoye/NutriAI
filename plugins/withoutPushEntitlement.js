const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * Removes the `aps-environment` entitlement that expo-notifications adds.
 *
 * That entitlement is only needed for *remote* push (APNs). This app only
 * schedules **local** notifications, which need no entitlement at all — and
 * keeping it breaks the build outright on a personal Apple team:
 *
 *   Provisioning Profile "iOS Team Provisioning Profile: app.nutriai.mobile"
 *   does not support the Push Notifications capability.
 *
 * Only a paid Apple Developer account can create a profile with the Push
 * capability, so on a free team this must be stripped or the app cannot be
 * built for a device at all. If remote push is ever added (paid account +
 * APNs key), delete this plugin so the entitlement comes back.
 */
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
