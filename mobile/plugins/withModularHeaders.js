const { withPodfile } = require('@expo/config-plugins');

/**
 * @react-native-google-signin/google-signin pulls in AppCheckCore, which
 * depends on GoogleUtilities/RecaptchaInterop — Swift pods that don't define
 * modules, so `pod install` refuses to resolve them as static libraries
 * otherwise ("cannot yet be integrated as static libraries").
 *
 * A blanket `use_modular_headers!` at the top of the Podfile (the naive fix)
 * forces EVERY pod to generate a module map, which collides with pods that
 * already ship their own (React-Core, ReactCommon, ExpoModulesCore) —
 * "redefinition of module" / "unable to resolve module dependency" build
 * failures. Declaring `:modular_headers => true` on just the three pods that
 * need it avoids that collision.
 */
const PODS = ['GoogleUtilities', 'RecaptchaInterop', 'AppCheckCore'];
const SNIPPET = PODS.map((name) => `  pod '${name}', :modular_headers => true\n`).join('');

module.exports = function withModularHeaders(config) {
  return withPodfile(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (!contents.includes(`pod '${PODS[0]}', :modular_headers => true`)) {
      cfg.modResults.contents = contents.replace(/(use_expo_modules!\n)/, `$1\n${SNIPPET}\n`);
    }
    return cfg;
  });
};
