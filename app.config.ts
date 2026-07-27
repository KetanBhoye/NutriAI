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
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'nutriai',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
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
    permissions: HEALTH_CONNECT_PERMISSIONS,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
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
  ],
  extra: {
    apiUrl: API_URL,
    router: { origin: false },
  },
};

export default config;
