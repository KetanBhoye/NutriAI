# NutriAI Mobile

The iOS and Android app for NutriAI, built with **Expo (React Native + TypeScript)**. It is a
full client for the tracker — logging, coaching, trends and planning — not a companion to the
web app.

It talks to the same backend as the Vue PWA (`calorie-tracker-codex-refactored`, `src/http/api.ts`)
and shares its session cookie, its nutrition maths and its domain language. Where the web app
can't go, this app does: HealthKit and Health Connect, the camera for meal photos and barcodes,
local reminders, and an offline write queue.

---

## Read this first

Read [`progress.md`](./progress.md). It is the engineering log: what is done, what is
deliberately deferred, and — most usefully — the decisions that look wrong until you know why
(the cookie handling, grams-only portions, the write queue's collapse rules, the Android text
traps). Most bugs this app has shipped were re-introductions of something explained there.

---

## Quick start

```bash
# prerequisites: Node 18+, Xcode (iOS), Android Studio + an AVD (Android), JDK 17+
npm install

npm run typecheck        # tsc --noEmit
npm test                 # unit tests (vitest), ~250ms, no device needed
```

To run the app you need a **development build** — several native modules (health, camera,
Google Sign-In) mean Expo Go will not work.

```bash
# iOS, on a connected iPhone
npx expo run:ios --device

# Android, on an emulator or connected device
npx expo run:android
```

Both commands generate the native project, build it, install it and start Metro. First build is
slow (5–15 min); afterwards `npm start` is enough, since JS changes reload without rebuilding.

By default the app talks to the deployed backend (`https://nutriai-app.up.railway.app`). To point
it at a local one, set `API_URL` **at build time** — it is baked into the bundle via
`app.config.ts`, not read at runtime:

```bash
API_URL="http://192.168.1.20:8787" npx expo run:ios --device   # your LAN IP, not localhost
```

On an Android emulator the host machine is `http://10.0.2.2:8787`. A release build blocks
cleartext HTTP, so a local backend needs a debug build or an HTTPS tunnel.

### iOS signing

The Xcode project already carries a development team. On a personal (free) Apple team, iOS
refuses to launch the app until you trust the certificate on the device:
**Settings → General → VPN & Device Management → Developer App → Trust**.

Push notifications are impossible on a personal team, which is why reminders are local — see
`plugins/withoutPushEntitlement.js` and the note in `progress.md`.

---

## Architecture

### Screens (`app/`, Expo Router — file-based)

```
app/
  _layout.tsx              fonts, AuthProvider, auth + onboarding gate
  login.tsx  signup.tsx    email/password + Google Sign-In
  onboarding.tsx           4-step wizard; sets the first plan and targets
  (tabs)/_layout.tsx       5 tabs; also schedules reminders and refreshes /api/me
  (tabs)/index.tsx         Today — the food log
  (tabs)/dashboard.tsx     Trends — 14-day chart, weekly AI report
  (tabs)/coach.tsx         Coach — chat, can log food server-side
  (tabs)/goals.tsx         Plan — weight plan, progress, weigh-ins, exercise
  (tabs)/profile.tsx       You — account, reminders, health sync, API token
```

Screens own their data fetching and state. There is no global store: what is shared travels
either through `AuthProvider` or through the small event buses described below.

### Supporting modules (`src/`)

| Module | Responsibility |
|---|---|
| `api/client.ts` | fetch wrapper, session cookie, timeouts, 401 → sign-out. **Read the cookie notes in `progress.md` before editing.** |
| `api/*.ts` | one module per resource (`entries`, `goals`, `dashboard`, `profile`, `onboarding`, `ai`, `tokens`, `account`) |
| `api/queue.ts` | durable write queue — food entries, weigh-ins, plan saves |
| `cache.ts` / `useCachedResource.ts` | read-through cache; screens paint last-known data, then refresh |
| `auth.tsx` | `AuthProvider` / `useAuth`, session bootstrap |
| `goalsBus.ts` | broadcasts "the targets changed" to every mounted tab |
| `nutrition.ts` | BMR/TDEE/macros — a port of the web app's copy, matching the backend's formulas |
| `portion.ts` | everything is grams; unit conversion and weight estimation |
| `exercise.ts` | MET table; gross vs **net** energy for logged sessions |
| `dates.ts` | local calendar days (never `toISOString()` — see `progress.md`) |
| `theme.ts` | colours, spacing, and the `type` scale. Use it; don't set `fontFamily` by hand |
| `health/` | HealthKit + Health Connect behind one interface, plus auto-sync |
| `updates/` | in-app updates for the Android build — version compare, APK download, install intent |
| `notifications/reminders.ts` | local daily reminders, scheduled as dated one-shots |
| `components/ui/` | primitives: `Screen`, `Card`, `Button`, `TextField`, `Sheet`, `PillGroup`, `OptionRow`, `StatTile`, … |
| `features/<screen>/` | components belonging to one screen, e.g. `features/goals/WeightTrendChart.tsx` |

### How data flows

**Reads** are stale-while-revalidate. `useCachedResource(key, fetcher)` (or `cached()` directly)
paints the last good payload from AsyncStorage immediately, refreshes behind it, and reports
`stale: true` when the network failed — screens then render `<StaleNotice />` rather than passing
old numbers off as current.

**Writes** that a user would hate to lose go through `src/api/queue.ts`: food entries, weigh-ins
and plan saves. They are persisted, drained oldest-first, and stop at the first network failure so
ordering holds. A `4xx` is dropped (retrying can't fix it) but **reported** via
`subscribeRejections`, because silently dropping one made an edit look saved and then revert.

**Cross-screen updates.** The tab navigator keeps every tab mounted, so a screen that read the
targets once would show them forever. `emitGoalsChanged()` after any successful write to the plan
tells Today, Trends, You and the reminder scheduler to re-read.

### The plan, and how it adapts

`GET /api/goals` returns the plan, the macro targets, every weigh-in in the plan window, and a
server-computed `progress` object. That object — `planProgress()` in the backend's
`src/services/goal-progress.ts` — compares a **smoothed** current weight against the plan's line
for today, fits a rate over the last 28 days, projects where it lands, and derives the daily
calorie change that would close the gap.

It is deliberately conservative: no rate from under a week of readings, no suggestion with under a
week of plan left, clamped to ±400 kcal, and the suggestion is offered rather than applied. The app
renders it as `ProgressFlag` plus `WeightTrendChart`.

---

## Testing

```bash
npm test           # unit — vitest, node environment, no device
npm run test:watch
npm run e2e        # end-to-end — Maestro, needs an emulator/device + credentials
npm run e2e:smoke  # end-to-end, no account required
```

**211 unit tests** cover the logic: portion maths, nutrition formulas, local dates, the day's
totals, the cache, the write queue, the entry-edit payload rules, the plan editor's gating, the
weight-trend smoothing, exercise energy, health sync and the reminder scheduler. Native modules are stubbed
once in `src/test/setup.ts`, and AsyncStorage is swapped for an in-memory map so the cache and
queue are tested against something that really stores.

The rule this codebase follows: **logic worth trusting lives in a module, not in a component.**
Every bug this app has shipped lived in a plain function, and none of them needed a renderer to
catch.

**Ten end-to-end flows** live in `.maestro/` — see [`.maestro/README.md`](./.maestro/README.md),
which also lists the four traps that will bite you when writing a new flow (whole-string regexes,
seeing through modals, `hideKeyboard` being a Back press, no implicit scrolling).

```bash
emulator -avd <your-avd> &
adb install -r android/app/build/outputs/apk/release/app-release.apk
npm run e2e -- -e EMAIL=you@example.com -e PASSWORD=secret
```

---

## Shipping a new version

```bash
npm run release -- 1.0.1
```

That's the whole process. It type-checks, runs the tests, bumps `version` and
`versionCode`, builds the release APK, **verifies it carries the release key**,
publishes it as a GitHub release, and pushes the tag. The backend's `/download`
route follows GitHub's *latest release* permalink, so
`https://nutriai-app.up.railway.app/download` starts serving the new build
immediately — no backend deploy, and the link people already have keeps working.

Add `--dry-run` to build and check without publishing anything.

Two invariants the script enforces, because both are discovered far too late
otherwise:

- **Same keystore, always.** It compares the built APK's SHA-1 against the
  release key and refuses to publish a mismatch. A different key means everyone
  who installed a previous build must uninstall first — losing their local
  state — and Google Sign-In stops working, since Google matches the signing
  certificate.
- **The asset is always `NutriAI.apk`.** The permalink resolves by filename;
  rename it and every shared link 404s. The version lives in the release title
  and tag.

Signing comes from `credentials/keystore.properties` via
`plugins/withReleaseSigning.js`. Both the keystore and its passwords are
gitignored.

> **Back the keystore up somewhere off your machine.** Lose it and you cannot
> ship an update to anyone who installed a previous APK.

EAS works too (`eas build --profile preview --platform android`), and `eas.json`
carries `development`, `preview` and `production` profiles.

### How installed apps find out (`src/updates/`)

Publishing a release is also what notifies phones already running the app. There
is no Play Store to do it, so the app asks:

1. `GET /api/app-version` on the backend reports the newest published release —
   version, notes and size, read from GitHub and cached ten minutes
   (`src/services/latest-release.ts` in the backend). The `url` it hands back is
   the backend's own `/download`, so `APK_DOWNLOAD_URL` still moves every
   installed app, not just new installs.
2. The You tab checks quietly on open and says nothing unless there's something
   newer. "Check for updates" forces it.
3. Tapping update downloads the APK to the cache directory, **verifies it really
   is one** (a redirect to an error page arrives as a cheerful 200 — see
   `updates/verify.ts`), and hands it to Android's package installer through a
   `content://` URI.

Because the signature matches, it installs over the top: no uninstall, no data
loss. Android asks the user to allow "install unknown apps" for NutriAI once.

Versions are compared as release tags, not `versionCode` — the tag is the only
version marker GitHub carries, and `release.sh` keeps the two in lockstep. The
running version is read from `expo-application`, i.e. from the installed package
itself.

**iOS has no equivalent and cannot.** A sideloaded iOS app can't replace itself;
those builds update through TestFlight or the App Store. Cross-platform JS-only
updates would need `expo-updates` (OTA), which is not wired up.

### `android/` and `ios/` are generated

Both are produced by `expo prebuild` and are **gitignored**. Never hand-edit them: the next
prebuild throws the change away. Native configuration belongs in `app.config.ts` or a config
plugin in `plugins/` — which is exactly what `withReleaseSigning`, `withModularHeaders`,
`withoutPushEntitlement` and `withHealthConnectPermissionDelegate` are for.

If a build fails with *"No matching variant … no variants exist"* for every native module, the
generated project is stale against `package.json`. Regenerate it:

```bash
npx expo prebuild --platform android --clean --no-install
```

---

## How this fits in the repository

The app lives in the same repository as the backend it talks to
(`calorie-tracker-codex-refactored`), alongside `src/` (Express API + MCP
server) and `web/` (the Vue PWA). One clone, one history, one place to change
an endpoint and the client that calls it in the same commit.

It is still its own project inside that repo:

- **`npm`, not `pnpm`** — it has its own `package.json` and lockfile. The
  backend uses pnpm; don't cross the streams.
- **Its own tests.** `npm test` here; `pnpm test` at the root runs the server's.
  The root `tsconfig.json` and `vitest.config.ts` only include `src/**` and
  `web/src/**`, and `biome.json`/`.railwayignore` exclude `mobile/`, so nothing
  here can affect the server build or the Railway image.
- **Its own release cycle.** The APK is published as a GitHub release; the
  backend's `/download` route redirects to the latest one.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Signed in, then every request 401s and never recovers | The RN cookie jar appended an empty `ct_sid`. See the session-cookie section in `progress.md`. |
| App installs on iPhone but won't launch | Developer certificate not trusted on the device (Settings → General → VPN & Device Management). |
| Gradle: "no variants exist" for every native module | Stale generated `android/` — run `expo prebuild --clean`. |
| Digits render with their tops cut off on Android | A span nested in a larger `<Text>` set its own `lineHeight`. See `progress.md`. |
| A sheet jumps or closes while typing on Android | `KeyboardAvoidingView` inside a `Modal`, or a stray Back press. `Sheet.tsx` handles both — don't undo it. |
| An edit saves, then reverts on refresh | The server rejected the write and the queue dropped it. The alert now says so; check the payload against the endpoint's schema. |
| `adb install` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed build was signed with a different key — `adb uninstall app.nutriai.mobile` first. |
