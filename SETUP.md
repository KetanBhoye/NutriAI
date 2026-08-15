# NutriAI — full setup

Everything in one repo:

| Directory | What it is | Runs on |
|---|---|---|
| `src/` | Express + SQLite API, also an MCP server | Node 22 |
| `web/` | Vue 3 PWA, built into `public/app/` and served by the API | Browser |
| `mobile/` | Expo / React Native app (iOS + Android) | Device or simulator |

All three talk to the same API and the same session cookie (`ct_sid`). Production
is `https://nutriai-app.up.railway.app`, deployed from the `railway-deployment`
branch.

---

## 1. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node | 22+ | everything |
| pnpm | 9+ (`corepack enable`) | server + web |
| npm | bundled with Node | mobile (it has its own `package-lock.json`) |
| Xcode | 15+ | iOS builds |
| Android Studio | Ladybug+ | Android builds, emulator, SDK |
| Java | 17 or 21 | Gradle (Android Studio ships one — see §5) |
| CocoaPods | `sudo gem install cocoapods` | iOS builds |

macOS is required for iOS. Android works on any OS.

---

## 2. Server

```bash
pnpm install
cp .env.example .env          # then edit — see the table below
pnpm db:migrate               # also runs automatically on startup
pnpm dev                      # http://localhost:8787
```

`pnpm start` runs it without the file watcher. `pnpm test` runs the suite (202
tests), `pnpm type-check` the compiler.

### Environment

Only the first four matter for a local run; the rest unlock individual features
and the app degrades gracefully without them.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | listen port |
| `DATABASE_PATH` | `./data/calorie-tracker.db` | SQLite file; created on first run |
| `BASE_URL` | `http://localhost:$PORT` | used in OAuth redirects and links |
| `SESSION_TTL_HOURS` | `168` | how long a login lasts |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | — | seeds the first account at startup |
| `ADMIN_API_KEY` | — | guards the admin endpoints |
| `LLM_PROVIDER` | — | `vertex` \| `gemini` \| `anthropic` \| `openai`. **Unset ⇒ Coach, photo logging, meal suggestions and weekly insights are all disabled** (the app hides them rather than erroring) |
| `LLM_MODEL` | provider default | e.g. `gemini-2.0-flash` |
| `GCP_PROJECT`, `GCP_LOCATION`, `GOOGLE_SERVICE_ACCOUNT_JSON` | — | for `LLM_PROVIDER=vertex` |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | for the other providers |
| `GOOGLE_OAUTH_CLIENT_ID` | — | the **web** OAuth client ID. `GET /api/auth/config` returns it, and both the web and mobile apps hide their Google button when it's absent |
| `FDC_API_KEY` | — | USDA FoodData Central, for barcode/food lookup fallback |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | — | Web Push (browser only — see §7) |
| `REMINDER_ENABLED`, `REMINDER_HOUR_UTC`, `REMINDER_MINUTE_UTC` | off | daily reminder cron |

---

## 3. Web PWA

```bash
pnpm web:dev        # Vite dev server, proxies /api to localhost:8787
pnpm web:build      # builds into public/app/, served by the API at /app
```

`pnpm web:type-check` runs `vue-tsc`.

---

## 4. Mobile — running it

```bash
cd mobile
npm install
```

The app defaults to the **production** API. To point it at your own server, set
`API_URL` at build time (it's baked into the binary, so this is a rebuild, not a
restart):

```bash
API_URL=http://192.168.1.x:8787 npx expo run:ios
```

Use your machine's LAN IP, not `localhost` — `localhost` on a phone means the
phone.

### iOS

```bash
npx expo run:ios                     # simulator
npx expo run:ios --device            # pick a connected iPhone
npx expo run:ios --device <udid> --configuration Release
```

**Use `--configuration Release` for a physical device.** A Debug build expects a
Metro server and falls back to `localhost` on device, which is the phone itself —
you get a black screen. `xcrun xctrace list devices` lists UDIDs.

Health data comes from HealthKit and needs a real device; the simulator has no
health store.

### Android

```bash
npx expo run:android                 # emulator or connected device
npx expo run:android --variant release
```

Health Connect needs **Android 8.0+** and the Health Connect app installed
(built into Android 14+, a Play Store download below that).

### Regenerating the native projects

`ios/` and `android/` are generated and gitignored. If a build gets into a weird
state:

```bash
cd mobile
npx expo prebuild --clean            # both platforms
cd ios && pod install && cd ..       # iOS only
```

Everything native — icons, permissions, the Health Connect delegate, Google
Sign-In URL schemes, the Gradle signing config — is driven by `app.config.ts`
and `mobile/plugins/*.js`, so **never edit `ios/` or `android/` by hand**; the
next prebuild will discard it.

---

## 5. Building the APK

```bash
cd mobile
npx expo prebuild -p android --clean
cd android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
  ./gradlew assembleRelease
```

Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`

Install it with `adb install -r <path>`, or transfer the file to the phone and
open it (Android will ask you to allow installs from that source).

### Signing

`mobile/plugins/withReleaseSigning.js` points release builds at
`mobile/credentials/keystore.properties`. That directory is **gitignored** —
it holds the private signing key:

```
credentials/
  nutriai-release.keystore
  keystore.properties        # storeFile, storePassword, keyAlias, keyPassword
```

**Back this directory up somewhere safe.** Lose it and you cannot ship an update
that Android will accept as the same app — every install has to be uninstalled
and reinstalled first.

If the directory is missing, the plugin falls back to Expo's template debug key,
so a fresh clone still builds an installable APK — it just won't be *your*
signature, and Google Sign-In won't work (next section).

To create a new keystore:

```bash
cd mobile
mkdir -p credentials
keytool -genkeypair -v -keystore credentials/nutriai-release.keystore \
  -alias nutriai -keyalg RSA -keysize 2048 -validity 10000
# then write credentials/keystore.properties with the values you chose
```

---

## 6. Google Sign-In

Three OAuth clients in one Google Cloud project, all already registered:

| Client type | Where it's configured | Purpose |
|---|---|---|
| Web | server `GOOGLE_OAUTH_CLIENT_ID` | **the only audience the server verifies ID tokens against** |
| iOS | `mobile/app.config.ts` (`GOOGLE_IOS_CLIENT_ID` + reversed URL scheme) | lets iOS run the native flow |
| Android | Google Cloud only — nothing in the app | matched by package name + certificate SHA-1 |

The mobile button fetches the **web** client ID from `GET /api/auth/config` at
runtime and passes it as `webClientId`, so the ID token's audience matches what
the server checks. Nothing to configure in the app.

Android matches the OAuth client by package name **and the SHA-1 of the
certificate that signed the APK**, so an APK signed with a different key gets
`DEVELOPER_ERROR`. Register the fingerprint of whichever keystore you build with:

```bash
keytool -list -v -keystore mobile/credentials/nutriai-release.keystore -alias nutriai
```

Then Google Cloud Console → **Google Auth Platform → Clients → Android client →
SHA-1 certificate fingerprint**. Package name is `app.nutriai.mobile`.

The SHA-1 of the keystore currently in `mobile/credentials/`:

```
6A:51:74:C4:D5:7C:75:88:92:3F:1C:AB:8A:1A:F9:C6:6E:88:F4:78
```

Add a second SHA-1 for your Android Studio debug key
(`~/.android/debug.keystore`, alias `androiddebugkey`, password `android`) if you
want sign-in to work in debug builds too.

---

## 7. Known constraints

- **iOS push notifications are not possible without a paid Apple Developer
  account.** APNs needs an Auth Key from the Apple Developer portal, and the
  `aps-environment` entitlement needs a provisioning profile with the Push
  capability; a free/personal team can create neither. The server's push is Web
  Push (VAPID), which native iOS ignores. `mobile/plugins/withoutPushEntitlement.js`
  strips the entitlement so device builds sign at all. Meal reminders ship as
  **local** notifications instead — four a day, on by default, needing no
  account and working offline. The "new version available" notice is local for
  the same reason, so it fires on launch rather than when a release goes out.
- **Android reminders need two things the app cannot grant itself.** The build
  declares `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM` so a reminder isn't
  deferred to the next Doze maintenance window — both are Play-restricted, so
  read `mobile/PLAY_STORE.md` before submitting. An OEM battery manager that
  hibernates the app will still drop its alarms; You → Meal reminders →
  "Reminders not arriving?" links to the settings that decide it.
- **A free Apple provisioning profile expires after 7 days.** Rebuild and
  reinstall to keep a sideloaded iPhone build running.
- **Health data is read-only** on both platforms. The app never writes to Apple
  Health or Health Connect.
- `mobile/` is excluded from the server's `tsconfig.json`, `vitest.config.ts`,
  `biome.json` and `.railwayignore`, so it doesn't affect the API build or the
  Railway image.

---

## 8. Deploying

Push to `railway-deployment` and Railway rebuilds from the `Dockerfile`
(`railway.toml`). Migrations run at startup from `src/index.ts`. Health check is
`/health`.

`mobile/` is listed in `.railwayignore`, so the app source is never uploaded to
the server image.
