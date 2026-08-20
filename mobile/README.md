# NutriAI Mobile

The iOS and Android app for NutriAI, built with **Expo (React Native + TypeScript)**. It is a
full client for the tracker — logging, coaching, trends and planning — not a companion to the
web app.

It talks to the same backend as the Vue PWA (`calorie-tracker-codex-refactored`, `src/http/api.ts`)
and shares its session cookie, its nutrition maths and its domain language. Where the web app
can't go, this app does: HealthKit and Health Connect, the camera for meal photos and barcodes,
the microphone for talking to the Coach, meal reminders, shareable story cards, in-app updates,
and an offline write queue.

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
speech, Google Sign-In) mean Expo Go will not work. A dev client built before a native
dependency was added won't have it: the Coach's mic and read-aloud detect that and hide
themselves rather than crashing, so if voice is missing, rebuild.

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
  (tabs)/coach.tsx         Coach — chat (voice or typed), can log food server-side
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
| `session.ts` | when a session is genuinely over (401/403 only) and the remembered profile that lets an offline launch stay signed in |
| `goalsBus.ts` | broadcasts "the targets changed" to every mounted tab |
| `entriesBus.ts` | broadcasts "this day's food log changed" — how a Coach-logged meal reaches the Today tab |
| `features/coach/` | the Coach's non-chat parts: dictation (`voice.ts`, `useDictation.ts`), text-to-speech (`speech.ts`), the "what was logged" diff + card (`loggedItems.ts`, `LoggedCard.tsx`) |
| `nutrition.ts` | BMR/TDEE/macros — a port of the web app's copy, matching the backend's formulas |
| `portion.ts` | everything is grams; unit conversion and weight estimation |
| `exercise.ts` | MET table; gross vs **net** energy for logged sessions |
| `dates.ts` | local calendar days (never `toISOString()` — see `progress.md`) |
| `theme.ts` | colours, spacing, and the `type` scale. Use it; don't set `fontFamily` by hand |
| `health/` | HealthKit + Health Connect behind one interface, plus auto-sync |
| `updates/` | in-app updates for the Android build — version compare, APK download, install intent |
| `notifications/reminders.ts` | four meal reminders a day, scheduled as dated one-shots |
| `notifications/copy.ts` | what each reminder says — slot times, motivation, missed-meal nudges |
| `notifications/updateNotice.ts` | announces a new build, once per version |
| `notifications/channels.ts` | the Android channels; without one, reminders arrive silently |
| `notifications/delivery.ts` | opens the OS settings that decide whether a reminder is allowed to arrive |
| `components/ui/` | primitives: `Screen`, `Card`, `Button`, `TextField`, `Sheet`, `PillGroup`, `OptionRow`, `StatTile`, … |
| `features/<screen>/` | components belonging to one screen, e.g. `features/goals/WeightTrendChart.tsx` |

### How data flows

**Reads** are stale-while-revalidate. `useCachedResource(key, fetcher)` (or `cached()` directly)
paints the last good payload from AsyncStorage immediately, refreshes behind it, and reports
`stale: true` when the network failed — screens then render `<StaleNotice />` rather than passing
old numbers off as current.

**Cross-tab changes** travel on the two event buses. The tab navigator keeps every tab mounted,
so a screen that fetched once keeps showing what it fetched: editing the plan on one tab left the
others on yesterday's targets (`goalsBus`), and logging a meal by talking to the Coach left Today
showing the day as it was before the conversation (`entriesBus`). Emit after a write the current
screen didn't make itself; subscribe and re-read.

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

### Reminders (`src/notifications/`)

Four a day — breakfast 11:00, lunch 14:00, snack 18:00, dinner 20:30 — **on by default**, scheduled
seven days ahead as dated one-shots and re-armed whenever the app opens or backgrounds.

- A meal that is already logged gets **no** reminder; when an earlier one was missed the nudge names
  the first missed meal, not the most recent.
- Only *today's* copy can quote live numbers, because a local notification's text is fixed when it
  is scheduled. Future days get wording that will still be true on arrival.
- 7 days × 4 meals = 28 pending. iOS silently drops anything past 64, so the horizon and the slot
  count are linked.
- **Nothing is cancelled before its replacement is scheduled.** The previous version cancelled first
  and then made network calls, which is why reminders sometimes vanished — see `progress.md`.

Whether a scheduled reminder actually *arrives* is a separate problem from scheduling it, and lives
mostly outside the app:

- **Channel.** `channels.ts` creates a MAX-importance "Meal reminders" channel before anything is
  scheduled. Without one, Android files reminders under the default channel at `IMPORTANCE_DEFAULT`
  — no banner, and on several vendor skins no sound. Channel settings are frozen once created, so
  the ids carry a version.
- **Exact alarms.** `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` are declared, or expo-notifications
  falls back to `setAndAllowWhileIdle` and Doze defers the reminder. Both are Play-restricted —
  see `PLAY_STORE.md` before shipping to Play.
- **The rest is the OEM.** Battery managers that hibernate the app drop its alarms, and Android 14
  denies exact alarms by default. Neither is visible from JS, so `delivery.ts` opens the relevant
  settings screens from You → Meal reminders → "Reminders not arriving?".

`updateNotice.ts` separately announces a newly published build, once per version, from the app's own
update check. Local like everything else here, so it fires on launch rather than the moment a
release goes out.

---

## Testing

```bash
npm test           # unit — vitest, node environment, no device
npm run test:watch
npm run e2e        # end-to-end — Maestro, needs an emulator/device + credentials
npm run e2e:smoke  # end-to-end, no account required
```

**278 unit tests** cover the logic: portion maths, nutrition formulas, local dates, the day's
totals, the cache, the write queue, the entry-edit payload rules, the plan editor's gating, the
weight-trend smoothing, exercise energy, health sync, the reminder scheduler and copy, the
notification channels, and which failures are allowed to end a session (`src/session.ts`). Native modules are stubbed
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

## Sharing to Snapchat as a Snap

The "Snap" button on the daily and weekly share cards needs a **Snap Creative
Kit client ID** to do what it says. Without one it still works, but the card
arrives in Snapchat as a *chat attachment* — a message with a picture on it,
with no Story option. That is not a bug in the button; it is what Snapchat's
ordinary share intent does with any image, from any app.

Creative Kit is the only route to the camera preview (the editor where a Snap is
actually composed), and Snapchat identifies the calling app solely by the client
ID. It is not an SDK — the integration is a single intent, in
`modules/share-to-app`.

The **production** client ID is the default in `app.config.ts`, so an ordinary
release needs nothing extra. It is the public OAuth client ID and ships in the
APK regardless, which is why it is committed rather than kept in the
environment: an env var would only add a way to forget it, and a release built
without one looks completely normal until someone shares a card and gets a chat
message.

Two environments exist in the [portal](https://kit.snapchat.com/manage) (project
`f16ec2c0-8635-4359-a3db-5db9b7b95d55`):

| | Client ID | Works for |
|---|---|---|
| Production | `7b2c22b2-…` | everyone, **once the version is approved** |
| Staging | `634f6a09-…` | only the Demo Users listed in the portal |

To test against staging, override it for one build:

```bash
SNAP_CLIENT_ID=634f6a09-f811-4e8f-a028-70c013137dce npx expo run:android
```

Two things the portal needs, both easy to miss because neither errors:

- **Creative Kit toggled on** for the version.
- A **Platform Identifier** row per stage and platform (`app.nutriai.mobile`).
  A client ID whose stage has no matching row is ignored.

To confirm a build actually works, the Snap button opens Snapchat's *camera
preview* with the card loaded and a Story option. If it opens a friend list, the
Snap path was rejected and it fell through to the plain send intent — check, in
order: the portal version is approved, Creative Kit is on, the platform
identifier exists for that stage, and (on staging) the signed-in Snapchat
account is a Demo User.

**Snapchat blocks emulator logins.** Test on a real device; repeated attempts on
an AVD get the account temporarily disabled.

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
