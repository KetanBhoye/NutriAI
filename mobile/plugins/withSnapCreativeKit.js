const { withInfoPlist } = require('expo/config-plugins');

/**
 * The two Info.plist keys Creative Kit needs on iOS.
 *
 * `SCSDKClientId` is how Snapchat identifies the calling app. Unlike Android —
 * where the client ID rides in the intent and can be passed per call — the iOS
 * SDK reads it from Info.plist at launch, so it has to be baked in at build
 * time. That is why it comes from `extra.snapClientId` rather than being handed
 * across the bridge.
 *
 * `LSApplicationQueriesSchemes` must list `snapchat`. iOS 9+ refuses
 * `canOpenURL` for undeclared schemes, and the SDK uses exactly that to decide
 * whether Snapchat is installed — omit it and Creative Kit concludes Snapchat
 * is absent on a phone that has it, then fails with an error that says nothing
 * about a missing plist key.
 */
module.exports = function withSnapCreativeKit(config) {
  return withInfoPlist(config, (cfg) => {
    const clientId = cfg.extra?.snapClientId;

    // No client ID configured: leave the plist alone rather than writing an
    // empty string. The share path checks for this and falls back to the system
    // sheet, and a blank SCSDKClientId would make the SDK fail at runtime
    // instead — a worse failure for the same missing value.
    if (clientId) {
      cfg.modResults.SCSDKClientId = clientId;
    }

    const schemes = cfg.modResults.LSApplicationQueriesSchemes ?? [];
    if (!schemes.includes('snapchat')) schemes.push('snapchat');
    cfg.modResults.LSApplicationQueriesSchemes = schemes;

    return cfg;
  });
};
