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

// iOS OAuth client registered in the same Google Cloud project as the
// backend's web client (Google Auth Platform → Clients → iOS, bundle ID
// app.nutriai.mobile). The web client ID itself (which `POST /api/auth/google`
// actually verifies tokens against) is fetched at runtime from
// GET /api/auth/config — GoogleSignInButton.tsx passes it as `webClientId`.
const GOOGLE_IOS_CLIENT_ID = '1015788885193-55jsd3u6f4t151vj5t8ceqb8aed4ocg8.apps.googleusercontent.com';
const GOOGLE_IOS_URL_SCHEME = 'com.googleusercontent.apps.1015788885193-55jsd3u6f4t151vj5t8ceqb8aed4ocg8';

// Health Connect record permissions the Android app requests (read-only).
const HEALTH_CONNECT_PERMISSIONS = [
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_DISTANCE',
  'android.permission.health.READ_WEIGHT',
  'android.permission.health.READ_EXERCISE',
];

const config: ExpoConfig = {
  name: 'NutriAI',
  slug: 'nutriai-mobile',
  version: '1.0.7',
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
    },
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
    versionCode: 8,
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
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // @expo/vector-icons (tab bar icons) depends on this at runtime.
    'expo-font',
    [
      // Snap-a-meal photo logging. The library's default usage strings are
      // generic ("access your camera"), which reads poorly at the prompt and
      // is weak for App Store review, so state the actual purpose. Microphone
      // is disabled — we only ever take stills.
      'expo-image-picker',
      {
        photosPermission: 'NutriAI opens your photo library so you can log a meal from a picture of it.',
        cameraPermission: 'NutriAI uses your camera so you can snap a meal and have it logged automatically.',
        microphonePermission: false,
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
    // Must come last: strips the aps-environment entitlement that
    // expo-notifications adds. See the plugin for why.
    './plugins/withoutPushEntitlement',
    // Puts the signing team into the generated Xcode project, so a device
    // build doesn't stop to ask for it (and doesn't lose it on the next
    // prebuild). Same reasoning as withReleaseSigning on Android.
    './plugins/withIosSigningTeam',
  ],
  extra: {
    apiUrl: API_URL,
    googleIosClientId: GOOGLE_IOS_CLIENT_ID,
    router: { origin: false },
  },
};

export default config;
