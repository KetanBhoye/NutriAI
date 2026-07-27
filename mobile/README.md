# NutriAI Mobile

A lightweight **cross-platform native companion** to the NutriAI web app, built with
**Expo (React Native + TypeScript)**. It signs in to the same NutriAI backend and pulls **real
health data** from:

- **Apple Health** (HealthKit) on iOS — via [`react-native-health`](https://github.com/agencyenterprise/react-native-health)
- **Android Health Connect** on Android — via [`react-native-health-connect`](https://github.com/matinzd/react-native-health-connect)

It reads **steps, active energy, distance, exercise minutes and weight**, then pushes them to
`POST /api/activity` so your charts and coach stay accurate — no manual entry.

> Meal logging still happens in the web app / coach. This app is focused on the one thing a PWA
> can't do: talk to the phone's health store.

---

## Architecture

```
app/                       screens (Expo Router, file-based)
  _layout.tsx              root + auth gate (redirects login <-> tabs)
  login.tsx                email/password sign-in
  (tabs)/index.tsx         Today — calories + macros from /api/dashboard
  (tabs)/health.tsx        connect + sync health data
src/
  api.ts                   fetch client, ct_sid cookie auth (SecureStore)
  auth.tsx                 AuthProvider / useAuth
  config.ts                API_URL + health source constant
  health/
    index.ts               picks provider by Platform.OS
    healthkit.ts           iOS  (Apple Health)
    healthConnect.ts       Android (Health Connect)
    sync.ts                read today -> POST /api/activity
    types.ts               normalised DailyHealth shape
```

Auth reuses the web app's `ct_sid` session cookie: on login we capture it from `Set-Cookie`,
store it in `expo-secure-store`, and replay it as a `Cookie` header. **No backend changes required.**

---

## Prerequisites

- Node 18+ and the [Expo](https://docs.expo.dev/) toolchain (`npx expo`)
- **iOS:** macOS + Xcode, and an **Apple Developer team** (HealthKit needs a signed build; it does
  **not** run in Expo Go)
- **Android:** Android Studio, plus the **Health Connect** app (bundled on Android 14+, otherwise
  install it from the Play Store)

Because both health libraries include native code, you must use a **development build** — not Expo Go.

---

## Setup

```bash
cd nutriai-mobile
npm install

# Optional: point at a local backend (defaults to production)
export API_URL="http://192.168.1.20:8080"   # your machine's LAN IP, not localhost
```

### Run on iOS (real device recommended — the simulator has no Health data)

```bash
npx expo prebuild -p ios      # generates the ios/ project + HealthKit entitlement
npx expo run:ios --device     # build & install onto a connected iPhone
```

Open `ios/` in Xcode once to set your **Signing Team** if `run:ios` prompts for it. On first
launch, open the **Health** tab → **Connect Apple Health** and allow the requested read types.

### Run on Android (device or emulator with Health Connect)

```bash
npx expo prebuild -p android
npx expo run:android
```

Make sure **Health Connect** is installed and has some data (Google Fit, Samsung Health, etc. can
write into it). In the app: **Health** tab → **Connect Health Connect** → grant the read
permissions.

---

## Building distributables (EAS)

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform ios      # or android
```

`eas.json` includes `development`, `preview`, and `production` profiles.

---

## Notes / follow-ups

- **`source` field:** `POST /api/activity` currently accepts `source: 'apple_health' | 'manual'`,
  so Android data is also tagged `apple_health` (see `src/config.ts`). If you add a
  `'health_connect'` value to the backend enum, update the Android branch there.
- **Background sync:** this build syncs on demand (the **Sync now** button). Automated
  background sync (HealthKit background delivery / a periodic task) is a natural next step.
- **Meal logging:** kept in the web app for now; the API client here can be extended to add
  logging screens if you want the mobile app to do everything.
