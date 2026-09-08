import { ExpoConfig } from 'expo/config';

/**
 * NutriAI mobile — a thin native companion to the NutriAI web app. It signs in
 * to the SAME backend and reads real health data from Apple Health (iOS) and
 * Android Health Connect, pushing it to POST /api/activity.
 *
 * The API base URL is read from the API_URL env var at build time so you can
 * point a dev build at a local server. It defaults to production.
 */
const API_URL = process.env.API_URL ?? 'https://nutriai-app.up.railway.app';

/**
 * Where the backend serves the PWA build from (see src/index.ts). Kept out of
 * the `/app` namespace on purpose: the Vue PWA still lives there, and these
 * two are separate apps that happen to share a backend.
 */
const WEB_BASE_PATH = process.env.WEB_BASE_PATH ?? '/m';

// iOS OAuth client registered in the same Google Cloud project as the
// backend's web client (Google Auth Platform → Clients → iOS, bundle ID
// app.nutriai.mobile). The web client ID itself (which `POST /api/auth/google`
// actually verifies tokens against) is fetched at runtime from
// GET /api/auth/config — GoogleSignInButton.tsx passes it as `webClientId`.
const GOOGLE_IOS_CLIENT_ID = '1015788885193-55jsd3u6f4t151vj5t8ceqb8aed4ocg8.apps.googleusercontent.com';
const GOOGLE_IOS_URL_SCHEME = 'com.googleusercontent.apps.1015788885193-55jsd3u6f4t151vj5t8ceqb8aed4ocg8';

/**
 * Snap Creative Kit client ID, from https://kit.snapchat.com (project NutriAI,
 * f16ec2c0-8635-4359-a3db-5db9b7b95d55).
 *
 * Without it, an image handed to Snapchat arrives as a *chat attachment*: a
 * plain ACTION_SEND lands in Snapchat's "Send To" flow, which is a message with
 * a picture on it, not a Snap. Creative Kit is the only route to the camera
 * preview — the editor where the card becomes something you post to a Story —
 * and Snapchat identifies the calling app solely by this ID.
 *
 * Hardcoded rather than required from the environment, for the same reason
 * GOOGLE_IOS_CLIENT_ID above is: this is the *public* OAuth client ID, it ships
 * inside the APK regardless, and there is nothing to protect. Making it an env
 * var would only add a way to forget it — and a release built without it looks
 * completely normal until someone shares a card and gets a chat message.
 *
 * **Currently pointed at STAGING**, deliberately and temporarily. The
 * production version is in review, and until Snap approves it the production ID
 * works for nobody; the staging one works for the Demo Users listed in the
 * portal. Shipping staging means the handful of testers get real Snaps today
 * while everyone else keeps the behaviour they already have.
 *
 * The cost of that choice is one extra release: approval does not reach a
 * staging build, so when the review passes this must be switched back to
 * production (`7b2c22b2-ef62-4d4e-b474-58a18676743f`) and shipped again. Had we
 * shipped production instead, approval would have lit it up for everyone with
 * no new build — that is the trade being made here, on purpose.
 *
 * The value lives in the source rather than an env var so the released binary
 * is reproducible from the commit it was built at, which is the whole point of
 * the clean-tree check in scripts/release.sh.
 */
const SNAP_CLIENT_ID = process.env.SNAP_CLIENT_ID ?? '634f6a09-f811-4e8f-a028-70c013137dce';

/**
 * Whether this build is signed by a *paid* Apple Developer team.
 *
 * Two of the capabilities below — Sign in with Apple (required by guideline
 * 4.8) and Associated Domains (Universal Links) — can only be put in a
 * provisioning profile by a paid account. A personal team cannot create one,
 * and Xcode does not warn: it fails the signing step outright, so a device
 * build stops working the moment either is declared.
 *
 * Default ON, deliberately. The two failure modes are not symmetrical: with
 * these declared, a free-team build fails loudly at signing and you know
 * immediately why. Without them, everything builds fine and the App Store
 * rejects the submission days later for a missing 4.8 login. A loud local
 * failure beats a quiet remote one.
 *
 * So for a local device build on a personal team:
 *
 *   APPLE_PAID_TEAM=0 npx expo run:ios --device
 *
 * That build cannot use Sign in with Apple or Universal Links — the button
 * hides itself when `isAvailableAsync` says no — but everything else runs.
 * Never ship a store build with this unset to 0.
 */
const APPLE_PAID_TEAM = process.env.APPLE_PAID_TEAM !== '0';

// Health Connect record permissions the Android app requests (read-only).
const HEALTH_CONNECT_PERMISSIONS = [
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_DISTANCE',
  'android.permission.health.READ_WEIGHT',
  'android.permission.health.READ_EXERCISE',
];

/**
 * One collected-data-type entry.
 *
 * Every type this app collects has the same shape — linked to the user,
 * never used for tracking, and collected to run the product rather than to
 * profile anyone — so the shape is written once and the differences (there
 * are none, today) would be an argument override.
 */
function collected(type: string) {
  return {
    NSPrivacyCollectedDataType: type,
    NSPrivacyCollectedDataTypeLinked: true,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
  };
}

const config: ExpoConfig = {
  name: 'NutriAI',
  slug: 'nutriai-mobile',
  version: '1.0.31',
  orientation: 'portrait',
  scheme: 'nutriai',
  userInterfaceStyle: 'dark',
  newArchEnabled: false,
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0f1115',
  },
  ios: {
    bundleIdentifier: 'app.nutriai.mobile',
    supportsTablet: true,
    infoPlist: {
      // HealthKit background delivery is not used; foreground reads only.
      UIBackgroundModes: [],
      /**
       * The export-compliance answer, given once here instead of on every
       * upload.
       *
       * Without it App Store Connect parks the build in "Missing Compliance"
       * and never sends it to review — a state that looks exactly like a
       * successful upload until you notice review never started. `false`
       * ("uses no non-exempt encryption") is the correct answer: NutriAI's
       * only cryptography is HTTPS to its own backend, plus the OS keychain
       * via expo-secure-store, and both are exempt under the standard
       * Category 5 Part 2 note.
       */
      ITSAppUsesNonExemptEncryption: false,
    },
    /**
     * The privacy manifest (PrivacyInfo.xcprivacy), written at prebuild.
     *
     * Apple requires it, and it must agree with the Privacy Nutrition Labels
     * in App Store Connect *and* with what the app actually does at runtime.
     * A mismatch between those three is the single most common rejection
     * cause on both stores, so this list is derived from the code rather than
     * from intent:
     *
     *   Health / Fitness  Apple Health and Health Connect readings, POSTed to
     *                     /api/activity (src/health/sync.ts).
     *   Email, Name       the account itself (src/api/account.ts).
     *   User ID           the session and every row keyed to it.
     *   Other content     food entries, weigh-ins and Coach messages.
     *   Photos            meal photos, sent for analysis and not retained
     *                     (app/(tabs)/index.tsx snaps them via ImagePicker).
     *
     * Every type is linked to the account and none is used for tracking:
     * there is no analytics or advertising SDK in this app, and the health
     * data is never used for advertising, which Apple 5.1.3 forbids outright.
     *
     * `NSPrivacyAccessedAPITypes` is empty on purpose — the required-reason
     * APIs this app touches (UserDefaults via AsyncStorage, file timestamps
     * via expo-file-system) are reached through dependencies that ship their
     * own manifests, and Apple merges those. Our one custom native module,
     * share-to-app, only fires an intent.
     *
     * Keep this in step with the code. Adding a field to the payload without
     * adding it here is how an app ends up rejected for a mismatch it could
     * have avoided.
     */
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [],
      NSPrivacyCollectedDataTypes: [
        collected('NSPrivacyCollectedDataTypeHealth'),
        collected('NSPrivacyCollectedDataTypeFitness'),
        collected('NSPrivacyCollectedDataTypeEmailAddress'),
        collected('NSPrivacyCollectedDataTypeName'),
        collected('NSPrivacyCollectedDataTypeUserID'),
        collected('NSPrivacyCollectedDataTypeOtherUserContent'),
        collected('NSPrivacyCollectedDataTypePhotosorVideos'),
      ],
    },
    /**
     * Universal Links. Pairs with the apple-app-site-association served at
     * nutriai-app.up.railway.app/.well-known/ (see src/index.ts).
     *
     * Requires the Associated Domains capability, which a *paid* Apple
     * Developer account has and a personal team does not — a free-team build
     * fails to sign with this present. If a device build starts failing on
     * provisioning, this is the line to look at first.
     */
    ...(APPLE_PAID_TEAM
      ? {
          associatedDomains: ['applinks:nutriai-app.up.railway.app'],
          usesAppleSignIn: true,
        }
      : {}),
    entitlements: {
      'com.apple.developer.healthkit': true,
      'com.apple.developer.healthkit.access': [],
    },
  },
  android: {
    package: 'app.nutriai.mobile',
    /**
     * Bump this on every release you hand out. Android compares versionCode,
     * not the human version string: leave it and a phone can't tell one build
     * from another, and some installers refuse to update at all. `npm run
     * release` bumps both this and `version` for you.
     */
    versionCode: 32,
    permissions: [
      ...HEALTH_CONNECT_PERMISSIONS,
      /**
       * Lets the app install its own updates (see src/updates/). NutriAI is
       * distributed as an APK from /download rather than through Play, so
       * nothing else would ever tell a phone a new build exists.
       *
       * This is not a silent grant: Android 8+ additionally requires the user
       * to allow "install unknown apps" for NutriAI specifically, once, at the
       * first update. Without the permission declared here, that toggle isn't
       * even offered and the install intent fails with no explanation.
       */
      'android.permission.REQUEST_INSTALL_PACKAGES',
      /**
       * Meal reminders that arrive at the meal (see src/notifications/).
       *
       * Without these, expo-notifications falls back to
       * `setAndAllowWhileIdle`, which Android is free to defer to the next
       * Doze maintenance window — minutes on a stock phone, hours on the
       * aggressive vendor skins. A "lunch" nudge at 4pm is worse than none.
       *
       * `USE_EXACT_ALARM` is granted on install (Android 13+);
       * `SCHEDULE_EXACT_ALARM` covers Android 12, where it is also granted on
       * install. **Both are Play-restricted** to apps whose core function is
       * alarms, timers or calendar events — see PLAY_STORE.md before shipping
       * this manifest to the Play track.
       */
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.USE_EXACT_ALARM',
    ],
    /**
     * Foreground art sits inside the ~66% safe zone; Android masks the rest.
     *
     * The background is the app's own near-black, not the accent green: the
     * mark is a luminous ring on a dark ground, and on a bright green tile its
     * dark track and glow both invert into mud. It also stops the icon being a
     * slab of saturated colour in a dock of dark ones.
     */
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0b0e13',
    },
    /**
     * App Links. `autoVerify` is what makes Android check
     * /.well-known/assetlinks.json at install time and hand these URLs to the
     * app without the "open with" chooser.
     *
     * Verification is against the *release* signing certificate, so this only
     * takes effect for a build signed with credentials/nutriai-release.keystore
     * — a debug build still shows the chooser, which is expected and not a
     * misconfiguration. Check with:
     *   adb shell pm get-app-links app.nutriai.mobile
     */
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'nutriai-app.up.railway.app', pathPrefix: '/m' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // @expo/vector-icons (tab bar icons) depends on this at runtime.
    'expo-font',
    [
      // Snap-a-meal photo logging. The library's default usage strings are
      // generic ("access your camera"), which reads poorly at the prompt and
      // is weak for App Store review, so state the actual purpose.
      //
      // `microphonePermission` was `false` here, and that is not a no-op: it
      // makes this plugin *remove* the permission — `tools:node="remove"` on
      // RECORD_AUDIO in the Android manifest, and no NSMicrophoneUsageDescription
      // at all on iOS. Its mod runs after expo-speech-recognition's config
      // pass, so the deletion won, and v1.0.22 shipped with a mic button the
      // OS could never grant. It must stay a string for as long as anything in
      // this app wants a microphone, even though the picker itself still only
      // ever takes stills — the key is app-wide, not per-feature.
      'expo-image-picker',
      {
        photosPermission: 'NutriAI opens your photo library so you can log a meal from a picture of it.',
        cameraPermission: 'NutriAI uses your camera so you can snap a meal and have it logged automatically.',
        microphonePermission:
          'NutriAI uses your microphone so you can tell your coach what you ate instead of typing it.',
      },
    ],
    [
      /**
       * Voice chat with the Coach (see src/features/coach/voice.ts).
       *
       * The plugin adds RECORD_AUDIO on Android plus the `<queries>` entry for
       * the Google recognition service — Android 11+ hides installed packages,
       * and without it the recogniser simply reports "unavailable" on a phone
       * that has one. On iOS it writes both usage strings; speech recognition
       * needs its own, separate from the microphone's, and App Review rejects
       * the generic default.
       */
      'expo-speech-recognition',
      {
        microphonePermission:
          'NutriAI uses your microphone so you can tell your coach what you ate instead of typing it.',
        speechRecognitionPermission:
          'NutriAI transcribes what you say to your coach, so a spoken meal can be logged.',
      },
    ],
    [
      // Health Connect's connect-client requires Android 8.0+ (API 26); the Expo
      // default minSdk is 24, which fails the manifest merge. Raise it here.
      'expo-build-properties',
      {
        android: {
          // Health Connect's connect-client requires Android 8.0+ (API 26).
          minSdkVersion: 26,
          /**
           * R8 on release builds. Off by default in the Expo template — the
           * generated build.gradle reads
           * `android.enableProguardInReleaseBuilds`, which defaults to false,
           * so releases shipped unminified and unshrunk.
           *
           * Google expects R8 from February 2027, and it is worth having
           * sooner: it strips the unused half of a dependency tree that
           * includes Health Connect, HealthKit's Android twin and Google
           * Sign-In. React Native ships its own keep rules, so this needs a
           * release build actually exercised before shipping — a rule that is
           * missing shows up as a crash in a release binary and nowhere else.
           */
          enableProguardInReleaseBuilds: true,
          /**
           * Resource shrinking stays OFF, and must stay off.
           *
           * Turning it on shipped v1.0.30 with no fonts at all. React Native
           * packages every bundled font as a `res/raw` entry — Inter's five
           * weights and @expo/vector-icons' Feather among them — and loads
           * them *by name at runtime*. Nothing references them statically, so
           * the resource shrinker correctly concluded they were unused and
           * removed all twelve.
           *
           * The failure is quiet, which is what makes it dangerous. Text has
           * a fallback: `useFonts` never resolves, the 3s timeout in
           * app/_layout.tsx fires, and the app renders in the system font —
           * slightly off, entirely legible, easy to miss. An icon font has no
           * fallback, so every tab bar and button glyph renders as nothing.
           * A release smoke test on the login screen (no icons on it) passes
           * happily.
           *
           * R8 itself — `enableProguardInReleaseBuilds` above — is unaffected
           * and stays on: that is the code shrinking Google asks for by
           * February 2027. Resource shrinking is a separate, optional pass
           * that buys a few MB and costs the fonts.
           *
           * If it is ever wanted, it needs a keep rule
           * (`res/raw/keep.xml` with `tools:keep="@raw/*"`) and a release
           * build verified past the login screen — check `unzip -l` on the
           * APK for .ttf entries, which is the check that would have caught
           * this.
           */
          enableShrinkResourcesInReleaseBuilds: false,
          // react-native-health-connect pulls in Jetpack Compose, whose compiler
          // 1.5.15 needs Kotlin 1.9.25 — Expo 52 defaults to 1.9.24.
          kotlinVersion: '1.9.25',
        },
      },
    ],
    [
      // Adds the HealthKit entitlement + the two required usage-description
      // strings to Info.plist during prebuild.
      'react-native-health',
      {
        healthSharePermission:
          'NutriAI reads your steps, active energy and weight to keep your daily totals accurate.',
        healthUpdatePermission: 'NutriAI can write workouts and weight back to Apple Health.',
        isClinicalDataEnabled: false,
      },
    ],
    // Wires up the Health Connect SDK, the permissions-rationale activity and
    // the AndroidManifest <queries> entry for the Health Connect app.
    'react-native-health-connect',
    // Lets the app see Snapchat/Instagram so the direct share buttons can fire
    // an explicit intent at them. Android 11+ hides installed packages by
    // default, and an explicit intent at an undeclared one throws.
    './plugins/withShareTargetQueries',
    // The iOS half of the same feature: Creative Kit reads its client ID from
    // Info.plist at launch, and needs `snapchat` in LSApplicationQueriesSchemes
    // to detect that Snapchat is installed at all.
    './plugins/withSnapCreativeKit',
    // Registers the Health Connect permission delegate in MainActivity.onCreate
    // (the library's plugin doesn't) — without this, requesting permissions crashes.
    './plugins/withHealthConnectPermissionDelegate',
    // Adds the reversed-client-ID URL scheme to Info.plist so the OS can
    // redirect back into the app after the Google sign-in web flow.
    ['@react-native-google-signin/google-signin', { iosUrlScheme: GOOGLE_IOS_URL_SCHEME }],
    // GoogleSignIn's dependency chain (AppCheckCore → GoogleUtilities/RecaptchaInterop)
    // needs modular headers to build as static libraries under CocoaPods.
    './plugins/withModularHeaders',
    // Signs release APKs with credentials/keystore.properties when it exists,
    // instead of the template's shared debug key. See SETUP.md.
    './plugins/withReleaseSigning',
    // Removes the screen-overlay permission React Native's debug manifest
    // merges in. See the plugin — on a health app it is a malware signal for
    // a capability we never use.
    './plugins/withoutOverlayPermission',
    // Must come last: strips the aps-environment entitlement that
    // expo-notifications adds. See the plugin for why.
    './plugins/withoutPushEntitlement',
    // Puts the signing team into the generated Xcode project, so a device
    // build doesn't stop to ask for it (and doesn't lose it on the next
    // prebuild). Same reasoning as withReleaseSigning on Android.
    './plugins/withIosSigningTeam',
  ],
  /**
   * The PWA build (`npm run web:build`), served by the backend at /m.
   *
   * `output: 'single'` keeps this a client-routed SPA — the same expo-router
   * tree the native app runs, resolved in the browser — rather than the static
   * per-route HTML `output: 'static'` would emit. Static export would try to
   * render every screen at build time in Node, and these screens read a
   * session before they render anything: they'd all pre-render as the signed
   * out state and then hydrate into something different.
   *
   * `baseUrl` must match the path the backend mounts the bundle at. It is
   * baked into every asset URL at build time, so changing the mount point
   * means rebuilding, not just re-routing.
   */
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/icon.png',
  },
  experiments: {
    baseUrl: WEB_BASE_PATH,
  },
  extra: {
    apiUrl: API_URL,
    googleIosClientId: GOOGLE_IOS_CLIENT_ID,
    snapClientId: SNAP_CLIENT_ID,
    router: { origin: false },
  },
};

export default config;
