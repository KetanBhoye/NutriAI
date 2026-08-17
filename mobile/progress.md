# NutriAI Mobile — Migration Progress

Source of truth for what's been ported from the Vue web app
(`calorie-tracker-codex-refactored`) into this Expo app, and what's
intentionally deferred or out of scope. **Read this first before starting new
migration work — don't re-derive scope from scratch.**

The web app's REST API (`src/http/api.ts` in that repo) is the single backend
both apps talk to; nothing server-side changed as part of this pass.

## Foundation

| Item | Status | Notes |
|---|---|---|
| `src/theme.ts` (green palette replaces old placeholder blue) | done | |
| `src/components/ui/*` primitives (Screen, Card, Button, TextField, Sheet, PillGroup, StatTile, EmptyState) | done | |
| `src/dates.ts` port | done | verbatim from `web/src/dates.ts` |
| `src/nutrition.ts` port | done | verbatim from `web/src/nutrition.ts` |
| `src/types.ts` domain types | done | |
| `src/api/*` modules + barrel (`client.ts` + `entries/dashboard/goals/profile/onboarding/ai/tokens/account.ts`) | done | `client.ts` gained a request timeout + a 401 → sign-out hook |
| Session-cookie handling on RN | done | non-obvious; see "Session cookie on React Native" below before touching `client.ts` |
| Read-through response cache (`src/cache.ts`) | done | AsyncStorage; screens paint cached data instantly, fall back to it when offline, cleared on sign-out |
| Offline **write** queue | deferred | writes are still optimistic-in-memory only — see "Explicitly deferred" |
| Typography (Inter + `type` scale in `src/theme.ts`) | done | see "UI conventions" |
| Health auto-sync | done | `src/health/autoSync.ts` + `useHealthAutoSync`; runs on launch/foreground, 15-min throttle |
| 5-tab navigation (Today / Trends / Coach / Plan / You) | done | replaces the old 2-tab (Today / Health) layout |
| Onboarding gate in `app/_layout.tsx` | done | redirects `user && !user.onboarded` to `/onboarding` |
| Google Sign-In — client code | done | `src/components/GoogleSignInButton.tsx`, gated on `GET /api/auth/config` |
| Google Sign-In — iOS native OAuth client | done | registered in Google Cloud (bundle ID `app.nutriai.mobile`); ID + reversed scheme hardcoded in `app.config.ts` |
| Google Sign-In — Android native OAuth client | done | registered in Google Cloud; **no app-side config exists or is needed** — see "Google Sign-In wiring" below |

## Screens

| Screen | File | Wired to real API | Notable stand-ins this pass | Deep polish (later phase) |
|---|---|---|---|---|
| Today | `app/(tabs)/index.tsx` | yes | — (portion stepper, barcode, photo and share all ship) | `NewFoodSheet` external lookup (`GET /api/foods/lookup`) |
| Trends | `app/(tabs)/dashboard.tsx` | yes | — (14-day bar chart is plain `View`s, same as the web app's own CSS bars — not a stand-in) | — |
| Coach | `app/(tabs)/coach.tsx` | yes | text-only composer | Voice dictation (Web Speech API has no RN equivalent without a new dependency) |
| Plan | `app/(tabs)/goals.tsx` | yes | — | — |
| You | `app/(tabs)/profile.tsx` | yes | — | — |
| Onboarding | `app/onboarding.tsx` | yes | near-1:1 port of the 4-step wizard | — |
| Login / Signup | `app/login.tsx`, `app/signup.tsx` | yes | Google button renders only once configured | — |

## Explicitly deferred (tracked, not started)

| Feature | Where it was in the web app | Blocking dependency | Notes |
|---|---|---|---|
| Weekly share card | Trends "Share this week" | — | the daily card ships; the weekly variant was not ported |
| Offline durable **write** queue | app-wide | — | **done** — `src/api/queue.ts`; oldest-first, stops at the first failure, drops 4xx |
| Coach voice input | Coach composer mic button | new native STT module | |
| Bottom-sheet gesture polish | all modals | maybe `@gorhom/bottom-sheet` | `Sheet.tsx` is a plain `Modal` for now |

## Out of scope (not tracked as planned — revisit only if requirements change)

- **Remote push notifications** — **blocked, not deferred.** APNs requires an Auth
  Key that only exists inside the Apple Developer portal, and `aps-environment`
  requires a provisioning profile with the Push capability; a free/personal team
  can create neither. No backend or GCP work changes this. The server's existing
  push is Web Push (VAPID), which native iOS ignores regardless. Daily reminders
  ship as **local** notifications instead (`src/notifications/reminders.ts`),
  which need no account — the trade-off is the text is fixed when scheduled, so
  it reflects the log as of the last app open.
  **`plugins/withoutPushEntitlement.js` strips `aps-environment`**, which
  `expo-notifications` adds automatically and which otherwise fails every device
  build on a personal team. Delete that plugin if a paid account is ever added.
- **Admin dashboard** — ops-only KPI/user table for the owner account; can stay web-only.

## Portions are always grams (`src/portion.ts`)

Portions were originally recorded in whatever unit the source used — the food
library's `reference_unit`, or the household measure the photo parser returned
("1 bowl", "2 roti"), or nothing at all for manual and coach-logged rows. That
made the amount control useless: with no unit, the only thing a stepper could
do was double the meal.

Everything the app logs now records a **gram weight** (`quantity` + `unit:'g'`
on `POST /api/entries`):

- `toGrams()` converts household measures via a lookup table. Volumes are taken
  at water density; countables (roti, idli, slice, egg) use typical weights.
- `estimateGrams()` weighs rows that recorded no portion, from macro mass
  (protein+carbs+fat ÷ 0.35 dry-matter fraction), falling back to kcal ÷ 1.5.
  Surfaces that show an estimated weight say so.
- `AmountStepper` is the one control for all of it — gram-based, value typable,
  10g steps under 200g and 25g above.

Editing an entry derives per-gram macros from `total ÷ basis` and rescales all
four fields as the weight changes.

`PATCH /api/entries/:id` originally accepted only the macros and `meal_type`,
so a corrected weight was silently dropped. Fixed in
`calorie-tracker-codex-refactored` @ `66a0938` (entry-update schema, the
repository's `update()`, and `UpdateEntryParams`). Old servers strip the two
new keys rather than rejecting the request, so the app degrades safely against
an undeployed backend.

The **coach** logs entries server-side, so its rows still arrive with whatever
unit the LLM chose; they get an estimated weight in the edit sheet like any
other legacy row.

## Session cookie on React Native (read before editing `src/api/client.ts`)

Two RN-specific traps, both already worked around — don't "simplify" them away:

1. **You cannot read `Set-Cookie` from JS.** Both `fetch` and `XMLHttpRequest`
   hide it (a "forbidden response-header name"; RN enforces it for XHR too).
   The cookie is read out of the OS jar with `@react-native-cookies/cookies`
   instead, then stashed in SecureStore so it survives app restarts.
2. **RN silently appends jar cookies to your own `Cookie` header.** NSURLSession
   is configured with the shared jar. When a request 401s, the backend replies
   `Set-Cookie: ct_sid=` (empty, to clear it) — that empty cookie lands in the
   jar, so later requests go out as `ct_sid=<valid>; ct_sid=`. The backend's
   parser is last-one-wins (`src/auth/session.ts` `parseCookies`), so it reads
   the empty value and 401s again, re-setting it. **Once this happens it can
   never recover** — every retry fails identically, which makes it look like a
   credentials/OAuth bug rather than a cookie bug. Fix: `CookieManager.clearAll()`
   after each capture and on sign-out, leaving the explicit header as the only
   source of cookies.

Debugging note: if the app's request 401s but the same cookie value works via
`curl`, it's trap 2 — the wire request isn't what the headers dict says.

## Google Sign-In wiring

Three OAuth clients exist in the Google Cloud project, and only two of them are
ever named in this codebase:

| Client | ID suffix | Where it lives |
|---|---|---|
| Web | `…qiuho8htkkpplvr2k4urpf9mitich2jk` | Server env (`GOOGLE_OAUTH_CLIENT_ID`); the app fetches it at runtime from `GET /api/auth/config` and passes it as `webClientId` |
| iOS | `…55jsd3u6f4t151vj5t8ceqb8aed4ocg8` | `app.config.ts` — `GOOGLE_IOS_CLIENT_ID` + `GOOGLE_IOS_URL_SCHEME` (the reversed form, needed for the redirect) |
| Android | `…emekb8nc3f62kf8maiikftk12gl0lipo` | **Nowhere — deliberately.** |

The Android client ID is intentionally absent from the app:
`GoogleSignin.configure()`'s `ConfigureParams` type accepts only `webClientId`
and `iosClientId` — **there is no `androidClientId` option**. On Android, Google
identifies the app by package name (`app.nutriai.mobile`) + signing-cert SHA-1,
and issues an ID token audienced to the *web* client, which is exactly what
`POST /api/auth/google` verifies. So Android needs the console registration only.

Don't add a `client_secret_*.json` to the repo — nothing reads it, and it may
carry a secret.

## API response shapes that don't match `Macros`

`POST /api/onboarding/ai-plan` returns **`daily_calorie_goal` / `daily_protein_goal_g`
/ `daily_carbs_goal_g` / `daily_fat_goal_g`**, not the `calories` / `protein_g` /
`carbs_g` / `fat_g` shape used by `src/nutrition.ts`'s `Macros` and by
`GET /api/goals`'s `macros` object. Mapping it as `Macros` silently yields
`undefined` for every target, which then POSTs `NaN` on submit and surfaces as a
generic 400 → "couldn't save". Both call sites (`app/onboarding.tsx`,
`app/(tabs)/goals.tsx` `refineWithAI`) map the fields explicitly; keep it that
way. `finish()` in onboarding also rejects non-finite targets so a shape
mismatch fails loudly rather than as a connection error.

## Android crops tall glyphs when a nested span sets `lineHeight`

The stat tiles rendered `71.2` as `/1.2` and `0.0` as `U.U` on Android only.
The value is a 22px `<Text>` with a smaller `kg` span *inside* it; that span
carried `lineHeight: 18` from `type.caption`, and Android sizes the whole line
box from the nested span, cropping anything taller. iOS centres the glyph
instead and never showed it. The tiles without a unit, and the targets card
(whose unit style sets no line height), were fine all along.

So: **a span nested inside a larger `<Text>` must not set `lineHeight`.** Two
plausible-sounding fixes were tried and reverted first — raising the Android
line-height floor, and dropping `fontVariant: tabular-nums` — neither changed
anything, which is worth knowing before reaching for them again.

## Logged exercise counts; health-app active energy still doesn't

Steps say nothing about an hour of football, so a training day with few steps
read as sedentary. The Plan tab logs a session (kind + minutes), prices it with
MET values in `src/exercise.ts`, and stores it in `daily_activity`'s new
`exercise_type` / `exercise_kcal` columns (migration 0008).

The important distinction: only the **net** energy is counted — `netExerciseKcal`
subtracts one MET, because a TDEE built from an activity level already assumes
resting metabolism plus normal movement, and adding gross burn on top is how
these apps hand out phantom calories. `buildDeficitSeries` adds that net figure
to the day's expenditure. Health-app `active_energy_kcal` is still deliberately
excluded — it's passive movement TDEE already covers, whereas a logged game is
the thing the activity level couldn't anticipate.

## Tests (`npm test`, vitest)

211 unit tests over the app's logic — `nutrition`, `portion`, `dates`, `meals`,
`exercise`, `format`, `goalsBus`, `cache`, the write queue, `health/sync`, the
reminder scheduler, `shareCaption`, the weight-trend smoothing, and the two
rules extracted from screens precisely because they had broken in production
(`features/today/entryChanges.ts`, `features/goals/editorTargets.ts`).

**Put logic worth trusting in a module, not in a component**: every bug this app
has shipped lived in a plain function, and none needed a renderer to catch. That
is why the Today screen's arithmetic is in `src/meals.ts` and the chart's
smoothing in `features/goals/weightTrend.ts` rather than inline. Writing these
found a real one — a blank calorie field saved the entry as 0 kcal, because
`Number('')` is 0, not NaN.

No jest-expo / react-native-testing-library this pass, so the environment stays
`node` and the suite runs in ~250ms. Native modules (`react-native`,
`expo-secure-store`, `@react-native-cookies/cookies`, `expo-constants`) are
stubbed once in `src/test/setup.ts`, which also swaps AsyncStorage for an
in-memory map — the cache and queue are only meaningful because they persist,
so they're tested against something that really stores.

## E2E flows are Maestro, and that choice is load-bearing (`.maestro/`)

Detox would need native config in `android/` and `ios/` — both generated by
`expo prebuild` and gitignored — so it would have to be re-applied through a
config plugin on every regeneration, the same trap `withReleaseSigning` exists
to handle. Maestro needs no native changes, so the flows survive a prebuild
untouched and run on either platform. `npm run e2e:smoke` needs no account;
the rest take credentials via `-e EMAIL=... -e PASSWORD=...` and must clean up
after themselves, because they run against a real account on a real backend.

## HealthKit's exercise time is in **seconds**

`getAppleExerciseTime` looks like it returns minutes. It does not:
`RCTAppleHealthKit+Methods_Activity.m` reads
`withDefault:[HKUnit secondUnit]`, so without an explicit `unit` option a day
of 83 minutes' exercise arrives as **4,980** — which then failed the API's
1,440-minute bound and took the whole sync down with it. `healthkit.ts` now
passes `unit: 'minute'`.

Worth knowing for any metric added later: the defaults are per-method and not
consistent. Active energy defaults to kilocalories and distance to meters
(both what the existing callers assume), but check the native source rather
than the TypeScript name. Health Connect on Android was never affected — it
computes minutes from session start/end times.

## Meal suggestions: the prompt was answering its own question

"Ideas" kept returning the same two or three dishes regardless of the calories
left. Three causes, none of them the model's fault:

- **The prompt listed the dishes it wanted back** — eight examples, "e.g. moong
  dal chilla, curd rice, paneer bhurji…" — and got those dishes. Examples in a
  prompt are instructions. It now names a *style* (rotated per call from
  `ANGLES`) instead of dishes.
- **Nothing varied between calls.** `temperature: 0.6`, thinking disabled and a
  byte-identical prompt meant "↻ Suggest others" asked the same question and
  got the same answer. Temperature is 1.0, the angle rotates, and the client
  now sends `exclude` — what's already on screen — so a re-roll is a genuinely
  different request.
- **The budget was a hint, not a constraint.** "Roughly fit the calories left"
  gave nothing to hit. `mealCalorieBand()` (backend `services/coach/`) computes
  an explicit kcal range from what remains and the meal type, states it in
  numbers, and `pickSuggestions()` then *enforces* it on the way back — the
  model drifts most at the extremes, which is exactly where adapting matters.

The band is a share of what's **remaining**, not of the daily goal: someone
opening this at 9pm with 400 kcal left needs a 400-kcal-shaped answer.

Two things worth not undoing:

- `remainingCalories` is no longer floored at 150 in the endpoint. That floor
  made being 400 kcal over look identical to having 150 left, so the one case
  where adapting matters most was the one case it couldn't see. Negative
  remaining is handled explicitly as `overBudget`.
- `pickSuggestions` shows **only** fitting options when any fit, even if that
  means two instead of three. Padding the list with a 900 kcal plate on a 300
  kcal budget is the original complaint, and a short list is not a broken one.
  It falls back to the closest options only when nothing fits at all.

## In-app updates are Android-only, and that's not a gap to fill (`src/updates/`)

The app is handed out as an APK from `/download`, so nothing tells an installed
build that a newer one exists. `src/updates/` does: the You tab asks
`GET /api/app-version`, and if the published release is newer it downloads the
APK and hands it to Android's package installer.

**iOS is absent on purpose.** There is no sanctioned way for a sideloaded iOS
app to replace itself — no `REQUEST_INSTALL_PACKAGES` equivalent, no installer
intent. Anyone reaching for parity here should reach for `expo-updates` (OTA)
instead, which ships JS and assets to both platforms inside the existing binary.
That's a different mechanism, not this one extended.

Four things that are load-bearing:

- **We compare release tags, not `versionCode`.** The versionCode lives inside
  the APK and reading it would mean downloading 86 MB first. `release.sh` bumps
  both together and refuses to reuse a tag, so the tag is monotonic and
  equivalent. `isUpdateAvailable` compares numerically — `1.0.10` is newer than
  `1.0.9`, which string comparison gets backwards — and refuses downgrades,
  because a dev build ahead of the published release would otherwise show a
  button Android silently declines to act on.
- **The current version comes from `expo-application`**, not `app.config.ts` via
  `Constants`. It's read from the installed package, which is the number Android
  itself compares on install; the JS-side copy is a second source of truth and
  null in some build configurations. Getting it wrong means offering an update
  to someone who already has it, forever.
- **A successful download is not necessarily an APK.** `/download` is a 302 to
  wherever `APK_DOWNLOAD_URL` points, which is the whole point of it — and a
  misconfigured value, an expired signed URL or a captive portal all arrive as a
  200 carrying HTML. Android's only feedback would be "App not installed", which
  names nothing. `updates/verify.ts` checks the status, the size and the ZIP
  magic bytes first so the app can say what actually happened.
- **`content://`, not `file://`.** Since Android 7 a `file://` URI handed to
  another app throws `FileUriExposedException`. `FileSystem.getContentUriAsync`
  goes through expo-file-system's own FileProvider (whose `file_paths` covers
  the cache directory, where the download lands), and the intent needs
  `flags: 1` — `FLAG_GRANT_READ_URI_PERMISSION` — or the installer receives a
  URI it may not read and fails as though the file were corrupt.

The install itself is not something this code completes: firing the intent hands
control to the system installer, and if the user confirms, this process is
replaced by the new build. There is no success callback, so nothing may depend
on code after `installApk` running.

**And no failure callback either — which is the part that bites.** Android
reports a failed install to the *user* as the three words "App not installed",
and to the app as nothing whatsoever. Found by running it: an emulator with
546 MB free failed with `INSTALL_FAILED_INSUFFICIENT_STORAGE` while the card sat
on "Opening installer…" under a green success message, claiming an install that
had already failed.

The only signal available is that we still exist. A successful install replaces
the process, so regaining the foreground while still in the `installing` phase
means it didn't happen — that's what `UpdateSection`'s `AppState` effect keys
on. It cannot say *why* (Android doesn't tell us), so it names the two likely
causes and makes clear nothing changed.

`describeSpaceProblem` catches the clear-cut version of this before the download
is paid for, but it is a filter and not a guarantee: 2.5x the APK size is a
heuristic, and it does *not* catch the 546 MB case above, because Android also
needs room for dex compilation and the existing install that we can't measure
from here. Raising the multiplier until that one datum is covered would block
legitimate updates on healthy devices — so the preflight stays cheap and the
resume handler is what makes failure honest.

## Health Connect: believe the granted set, not the request's return value

Reported on an iQOO (OriginOS): tapping "Connect Health Connect" answered
"Permission was not granted" even when permission *had* been granted, and said
it in green — the success colour, because that branch set the message without
setting `failed`.

`requestPermission()` resolving with an empty array does not mean refused. Two
ways it lies:

- Some OEM builds resolve empty even after the user taps Allow.
- Android stops showing the dialog entirely after a couple of refusals, so the
  call returns instantly with nothing — indistinguishable from a fresh "no"
  unless you look at what is actually granted.

So `requestPermissions()` now checks `getGrantedPermissions()` first (skipping
the prompt when access is already held — re-asking someone who said yes is how
you get a "no"), and re-checks it after the request, including when the request
throws. The granted set is the source of truth.

Two consequences worth keeping:

- **The section re-checks grants on mount**, so permission given in Health
  Connect's own settings is noticed rather than ignored.
- **There is a route to those settings.** The old message told the user to
  enable it in settings and gave no way to get there, which is useless once
  Android has stopped showing the dialog. `openHealthConnectSettings()` is
  offered after a refusal — same reasoning as the installer's
  "install unknown apps" shortcut.

`SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED` is also no longer collapsed into
"unavailable": that told people to install an app they already had. It now says
to update it.

## A health reading can be impossible; treat it as broken, not big

Apple Health reported **4,980 exercise minutes** for a day that contains 1,440
— overlapping watch and phone samples summed twice, most likely. The endpoint
validates the payload as a unit, so that one number 400'd the whole sync and
the steps, energy, distance and weight went down with it. `syncToday` now
checks each metric against the same per-day maximum the API enforces and omits
anything impossible, reporting it back as `skipped`.

**Don't clamp to the maximum.** 1,440 would claim a full 24 hours of exercise —
a fabrication, where dropping it is merely a gap. The app says which readings it
ignored rather than silently discarding a number the user can see in their
health app.

The screen showed the failure as a wall of raw Zod JSON, in the same green the
success message uses, because `ApiError.message` carries the server's
`parsed.error.message` verbatim. Errors now get human copy and the danger
colour — **never render an API error message straight to a user.**

## `POST /api/activity` is `.strict()` — send only what you mean

The endpoint rejects unknown keys rather than ignoring them (deliberately: a
typo in the Shortcuts payload used to vanish silently). So sending
`exercise_type: null` from a build newer than the server takes the *whole*
write down with it — the weigh-in and step count included. `saveLog` therefore
omits the exercise keys entirely when there's no session, and an old backend
still accepts a plain weigh-in.

Related, and the reason this took a while to see: the Plan tab's rejection
handler set `error`, then called `load()`, which begins with `setError(null)` —
so the message was wiped in the same tick it was set, and a refused write looked
exactly like a successful one. Write failures now live in their own
`writeError` state that `load()` never touches. **Any state that reports a
failed write must not share a slot with load errors.**

## Everything the user can't retype goes through the queue

`src/api/queue.ts` covers food entries, weigh-ins/steps and plan saves. Direct
`await`s were fine for meals you could re-log, but a weigh-in cannot be
reconstructed later (you can remember what you ate; you cannot remember what
the scale said) and the adaptive plan is fitted to those readings.

Two collapse rules, both load-bearing: activity writes **merge** per day
(`POST /api/activity` upserts, so a second write would blank the first's fields
with nulls — log a weight, then steps, and the weight would vanish), and plan
writes **replace** (replaying an older plan would restore targets the user had
already moved on from). Rejection subscribers are filtered by op kind so Today
doesn't announce a refused plan save.

## Goal changes have to be broadcast (`src/goalsBus.ts`)

The tab navigator keeps every tab mounted, so Today, Trends and You each read
the targets once and then kept showing them for the whole session — editing the
plan appeared to do nothing everywhere except the Plan tab. Any successful write
to the plan or the macro targets must call `emitGoalsChanged()`; subscribers
re-read (`app/(tabs)/index.tsx`, `dashboard.tsx`, and `_layout.tsx`, which
refreshes `/api/me` for the You tab and re-schedules the reminder).

The Plan editor also must not recalculate on open. It now opens with **nothing
selected** — activity, goal and pace are all `null`, mirroring onboarding from
blank — so there is nothing to recalculate from and the saved targets stay
untouched until a real choice is made. `editMacros` is null until an activity
level, a goal and (unless the goal is "maintain") a pace have all been picked;
that null is what gates the recompute effect, the AI-refine button, and Save on
a first-ever plan. Don't reintroduce defaults here: pre-selecting the controls
is exactly what silently overwrote people's plans. Picking a goal clears the
pace rather than defaulting it, since the pace options differ per goal.

## Reminders vanished because we cancelled before we could reschedule

Reported as "sometimes they come, sometimes they don't". The cause was in our
code, not the OS.

`scheduleDailyReminder()` cancelled every pending notification and *then* made
two network calls to rebuild the copy before rescheduling — and it ran on every
backgrounding, which is exactly when the OS is about to suspend the process.
Lose that race and the user has no reminders at all until they next open the
app.

The rule that fixes it: **nothing is cancelled until its replacement exists.**
Today's totals are read first, identifiers are stable per `(dayOffset, meal)`,
and `scheduleNotificationAsync` replaces a notification with the same
identifier — so re-arming is idempotent and never opens a gap. Stale
identifiers are cancelled last, after everything wanted is in place. There's a
test asserting the first OS call is a schedule and not a cancel.

Other things worth not undoing:

- **Four slots** (`copy.ts`): breakfast 11:00, lunch 14:00, snack 18:00, dinner
  20:30. Late rather than early on purpose — a nudge that arrives before you've
  eaten is a nudge to ignore.
- **7 days × 4 meals = 28 pending.** iOS silently drops anything past 64
  pending, so the horizon and the slot count are linked; a fortnight would sit
  at 56 and leave no headroom.
- **A logged meal gets no reminder.** `reminderCopy()` returns null for it and
  the identifier is cancelled. Nagging someone about a meal they already logged
  is how notification permission gets revoked.
- **The nudge names the *first* missed meal**, not the most recent — at dinner
  with only lunch logged, breakfast is the one to chase.
- **Over budget gets its own line.** Don't cheerfully invite more food, and
  don't shame them out of logging it either.
- **Default on** (`remindersEnabled()` is true unless the stored value is
  `'0'`). An explicit opt-out is sticky; the app never re-prompts someone the OS
  has already refused, because Android stops showing that dialog anyway.

Still outside our control: aggressive OEM battery management (vivo/iQOO,
Xiaomi, OPPO) can kill scheduled alarms outright. If a user reports missing
reminders on one of those, the fix is on the device — exempt NutriAI from
battery optimisation — not in this file.

## Reminder copy can't quote a day's totals on a repeating trigger

The OS fixes notification text at scheduling time, so the old `DAILY` trigger
re-delivered one day's calories forever — that's the reminder disagreeing with
the app. `src/notifications/reminders.ts` now schedules 14 one-shot `DATE`
notifications and re-arms them on launch, foreground, backgrounding and any goal
change. Only today's carries live totals; later ones quote the target, which
stays true on any day. The cost is that reminders lapse if the app isn't opened
for two weeks.

## `PATCH /api/entries/:id` rejects nulls — and the queue drops 4xx

Editing an entry sent `protein_g: null` for any macro left blank, which zod
refused (the fields are `optional()`, not `nullable()`), so the whole patch
400'd. `flush()` drops 4xx by design, so the edit vanished without a word and
the old numbers came back on the next refresh. Three changes, all worth
keeping:

- `EntryDetailModal` omits a blank macro instead of sending null, and only
  sends null when the entry had a value the user actually cleared. `quantity`
  is omitted unless it's positive — the API requires `positive()`.
- The API accepts `null` for the three macros (clear the value); the repository
  already wrote NULL correctly.
- `subscribeRejections()` in `src/api/queue.ts` reports dropped 4xx writes.
  Today alerts and re-reads, so a refused write is visible rather than a silent
  revert. **Any new queue consumer should subscribe.**

## A reminder that arrives silently, an hour late, counts as missing

"The reminders don't come" turned out to be two separate Android behaviours,
neither of them the scheduling logic (which does not need the app running —
the alarms live in the OS, and `RECEIVE_BOOT_COMPLETED` from
expo-notifications' manifest re-arms them after a restart).

**No notification channel.** Nothing ever called
`setNotificationChannelAsync`, so every reminder landed in the app's default
channel at `IMPORTANCE_DEFAULT`: no heads-up banner, and on several vendor
skins no sound. `src/notifications/channels.ts` now creates a MAX-importance
"Meal reminders" channel and a quieter "App updates" one, and every scheduled
notification names its channel. Two things about channels that bite:

- Android **ignores** later changes to a channel that already exists — the
  user owns it from creation. Deleting and recreating the same id doesn't
  help either; the OS restores the user's settings for a resurrected id. So
  the ids carry a version (`meal-reminders-v2`) and the version moves when
  the settings must.
- `ensureChannels()` runs before the first `scheduleNotificationAsync`, not
  after. A notification posted to a channel that doesn't exist yet is filed
  under the default one permanently.

**Inexact alarms.** expo-notifications uses `setExactAndAllowWhileIdle` only
when `canScheduleExactAlarms()` is true, and falls back to
`setAndAllowWhileIdle` otherwise — which Android may defer to the next Doze
maintenance window. Minutes on a Pixel, hours on OriginOS/MIUI/ColorOS. So
`SCHEDULE_EXACT_ALARM` and `USE_EXACT_ALARM` are now declared. **Both are
Play-restricted** — read the exact-alarm section of PLAY_STORE.md before
shipping this manifest to Play.

What's left is genuinely outside the app: OEM battery managers that hibernate
the process and drop its alarms, and the per-app exact-alarm toggle on
Android 14+. `src/notifications/delivery.ts` opens each of those settings
screens, surfaced under You → Meal reminders → "Reminders not arriving?".
They can't be detected from JS, so the card offers them rather than
diagnosing.

## AI macro estimates are allowed to be low, never high

Every estimator was overstating meals, protein worst of all — a veg thali
coming back at 30 g. The asymmetry matters: an under-estimate means the user
eats a little more than the plan and progresses slightly slower; an
over-estimate means the app tells them they've spent a budget they haven't,
they eat less than planned, and they stop believing the numbers.

`src/services/coach/macro-sanity.ts` holds both halves of the fix:

- `reconcileMacros()` — deterministic. If protein×4 + carbs×4 + fat×9 exceeds
  the item's own calorie figure by more than 10%, the macros are scaled to fit
  it. **One direction only.** Macros carrying *less* energy than the calories
  are left alone, because closing that gap would mean inventing protein — the
  exact failure being fixed. Items arriving with no calories get them derived
  from the macros, since a 0 kcal / 30 g protein entry corrupts a day's totals
  invisibly.
- `CONSERVATIVE_ESTIMATION_RULES` — the prompt half: take the lower end of any
  plausible range, judge portions as home servings rather than restaurant
  ones, and anchors for ordinary Indian portions (roti, katori of dal, rice,
  curd, paneer). A test parses those anchor lines back out and checks each one
  is internally consistent, so the reference table can't quietly teach the
  thing the rules forbid.

Applied at all four estimating call sites: `photo-parse.ts`,
`grounded-macros.ts` (where per-100g and per-serving figures get mixed most
often), the coach's system prompt, and `parseFoodLog()` in
`src/services/llm/index.ts` — which is the single point every provider's
output passes through. Deliberately **not** applied to entries the user typed
themselves; their numbers are theirs.

## Only the server can end a session (`src/session.ts`)

Opening the app without a connection signed people out. The launch check in
`AuthProvider` called `/api/me` inside a `try`, and the `catch` — reached by
*any* failure, "no internet" included — ran `clearSession()`. That deletes the
`ct_sid` cookie from SecureStore, so it isn't a temporary bounce to `/login`:
the session is gone, and reconnecting doesn't bring it back. A lift, a tunnel,
or a server hiccup cost you your login permanently.

`isSessionRejected(e)` is now the only thing allowed to end a session, and it's
true for exactly 401 and 403. Everything else keeps the cookie:

- **status 0** — `client.ts` throws `ApiError(0, …)` for both a dead
  connection and a 20s timeout. Neither says anything about the cookie,
  because the request never reached the server that owns it.
- **5xx** — the server is up but broken. Its opinion on our session is
  unavailable, not negative.
- **anything that isn't an `ApiError`** — a bug in our own code must not cost
  the user their login.

Two supporting pieces:

- The confirmed profile is mirrored to AsyncStorage (`nutriai.auth.user`) on
  every successful `/api/me`, and read *before* the network call at launch. The
  cookie surviving isn't enough on its own — `AuthGate` redirects on `user`
  being null, so without a remembered profile an offline start still lands on
  the login screen. Cleared on sign-out and on a real 401, alongside the cache.
- If we couldn't verify *and* have nothing remembered (a first launch after
  update, offline), `unverified` stays set and retries on foreground and every
  15s until the server answers either way. `AuthGate` then walks them in
  without a password.

The screens behind this were already offline-tolerant: `cached()` falls back to
the last good payload, and writes go through the durable queue.

## The plan adapts to the trend, not to the last weigh-in

`planProgress()` (backend `src/services/goal-progress.ts`, returned as
`progress` by `GET /api/goals`) compares the plan's baseline for *today*
against a smoothed current weight, fits a rate over the last 28 days of
weigh-ins, projects where that lands on the target date, and derives the daily
calorie change that would close the gap. Rules that matter:

- Never judge on a single reading. The current weight is a 7-day mean and the
  rate is a least-squares fit — a plan that reacted to one salty day would say
  something different every morning.
- No rate at all from readings spanning under 7 days; no suggestion with under
  7 days of plan left; suggestions clamp to ±400 kcal and round to 0 below
  50 kcal (inside the food log's own error).
- The suggestion is **offered**, never auto-applied. `applySuggestion()` in
  `app/(tabs)/goals.tsx` only moves the calorie target (and rebalances macros
  around it); plan weights and dates stay put.

The Plan tab shows `WeightTrendChart` (daily weigh-ins, 7-day trend line, plan
baseline + tolerance band, today marker, projected finish) and `ProgressFlag`
(the verdict, the four rates, the suggestion). `GlideChart` is kept only as the
fallback for payloads cached before `weigh_ins` existed.

## Keyboard handling inside `Sheet` on Android

`adjustResize` resizes the activity's window, not the separate window a
transparent `Modal` lives in, so `KeyboardAvoidingView` had nothing to react to
and `behavior="height"` measured the whole screen — the sheet jumped and the
keyboard flickered while typing in the food search. `Sheet` now measures the
keyboard itself (`keyboardDidShow`/`Hide`, Android only) and pads the sheet by
that height, keeps `KeyboardAvoidingView` for iOS only, and dismisses the
keyboard before closing so Android never tears down a focused `TextInput` with
its window. Don't reintroduce `behavior="height"` here.

## Sharing to Snapchat needs Creative Kit, not an intent

An explicit `ACTION_SEND` at `com.snapchat.android` reaches Snapchat's *share
receiver*, and the card arrives as a **chat attachment** — a message with a
picture on it, no Story option, no editor. That looked like a working direct
share for two releases, because it does open Snapchat with the image loaded; the
gap only shows up on the receiving end. It is not fixable by adjusting the
intent's type, flags or extras: the share receiver is a different entry point
from the camera preview, and a plain send can only ever reach the first one.

Creative Kit Lite is the documented route to the preview, and it is still an
`ACTION_SEND` — the difference is three additions (`modules/share-to-app`):
the intent *data* is `snapchat://creativekit/preview` (set via `setDataAndType`,
because setting `type` alone clears the data Uri and silently demotes it back to
a chat attachment), a `CLIENT_ID` extra, and `CLIENT_APP_NAME` for attribution.
No SDK, no gradle dependency.

`CLIENT_ID` is the catch: it comes from registering the app at
kit.snapchat.com and requires Snapchat's approval. Snapchat ignores the deep
link without it and falls back to the chat flow, so **this cannot be done
anonymously** — a build with no `SNAP_CLIENT_ID` in its environment degrades to
the old send intent by design, rather than firing an intent that gets rejected.
That fallback is deliberate but it is also indistinguishable from the bug, so
when someone reports "it still sends as a chat", check the build's client ID
before reading any code.

Also worth knowing: `FLAG_GRANT_READ_URI_PERMISSION` grants against the intent's
data Uri, which here is the deep link — the image rides in `EXTRA_STREAM`, so it
needs an explicit `grantUriPermission` to Snapchat as well. Without it the
preview can open on an empty canvas, which reads as a failed card render rather
than a permissions problem.

## `captureRef` returns a path on iOS and a URI on Android

react-native-view-shot with `result: 'tmpfile'` hands back
`/private/var/mobile/.../tmp/ReactNative/xxx.png` on iOS — a bare filesystem
path, no scheme — while Android gives a `content://` URI. Swift's
`URL(string:)` requires a scheme, so it silently produced an unusable relative
URL for the iOS form, `Data(contentsOf:)` returned nil, and the Snapchat share
gave up *before Creative Kit was ever called*.

That failure was indistinguishable from Snapchat rejecting the client ID, and
it sent hours of debugging at the Snap developer portal — checking platform
identifiers, staging versus production IDs, whether the app was even installed
— for a bug that was entirely ours and two lines long. Use
`URL(fileURLWithPath:)` for anything that might be a path (`readableFileURL` in
the module does the scheme check).

Two things made it expensive, both since fixed:

- **The share button fell back to the system share sheet on failure.** It
  looked forgiving; it was camouflage. The user got a plausible-looking share
  sheet, the card went out as a file, and nothing anywhere reported an error.
  The button now shows an error instead — a broken integration should look
  broken.
- **The iOS module logged nothing.** Every failure path resolved `false` in
  silence. It now logs through `NSLog` as well as `os_log`: os_log is the right
  home, but it is *not* forwarded to a cable-attached console
  (`devicectl process launch --console`), which is the only stream available
  when debugging on a real phone. The first attempt at logging used os_log
  alone and produced nothing at all.

## UI conventions

- **Navigator headers are off app-wide** (`app/(tabs)/_layout.tsx`
  `headerShown: false`). Each screen renders its own title, mirroring the web
  app's full-bleed pages. Consequently `Screen` insets the **top** edge by
  default — don't re-enable a header without also dropping that inset, or
  you'll get double spacing.
- Use `OptionRow` (not `Button`) for stacked choices that carry a hint or a
  figure — activity levels, goals. `PillGroup` is for short labels only; four
  full-size `Button`s in a row clip their text.
- Use `Loading` rather than a bare "Loading…" `Text`, and `Skeleton`/`SkeletonCard`
  where the content has a known shape — a centred spinner collapses the layout,
  so everything jumps when data lands.
- Read screens go through `useCachedResource` (or `cached()` directly): paint the
  last payload, refresh behind it, and render `StaleNotice` when the network
  failed and the numbers on screen came from cache. Never present stale figures
  as current.
- Presenting a `Modal` while another modal (image picker, Alert) is still
  dismissing leaves it invisible but touch-capturing — the screen looks frozen.
  Defer with `InteractionManager` + a short delay.
- **Type comes from `type.*` in `src/theme.ts`.** Inter is loaded as separate
  weight files, so `fontWeight` does nothing — you must set `fontFamily`
  (`fonts.semibold` etc). `applyDefaultFont()` makes Inter the default family
  for every `Text`/`TextInput`; without it, styles that omit `fontFamily` fall
  back to the OS font and the app renders in two typefaces.
- Numerals use tabular figures via `type.figure*`, not a monospace font.
  `mono` is only for opaque strings (the API token).
- **Don't size chart bars with percentage heights.** They need a definite
  parent height, which silently breaks when the column also holds a label —
  that's what made the Trends chart render blank. Compute pixel heights in JS
  (see `dashboard.tsx` `buildBars`).

## Open risks / decisions needing a human step

- **Release-keystore SHA-1 for Android.** The Android OAuth client is registered
  against the *debug* keystore's SHA-1
  (`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`), which only
  covers local dev builds. A release/EAS build signs with a different key, so a
  second Android client must be registered with that key's SHA-1 (`eas
  credentials` if using EAS) or Google sign-in will fail in production.
- **CocoaPods modular headers.** `@react-native-google-signin/google-signin` pulls in `AppCheckCore`, which needs `use_modular_headers!` in the Podfile to build as a static library — added via `plugins/withModularHeaders.js` (runs on every `expo prebuild`, so it survives regeneration). If a future native dependency conflicts with global modular headers, scope this down to per-pod `:modular_headers => true` instead.
- **Coach tab-mount assumption.** Chat state lives in plain `useState` in `coach.tsx`, relying on expo-router's tab navigator keeping inactive screens mounted (so switching tabs doesn't clear history) rather than porting the web app's module-level `coach-state.ts` store. Empirically verify this holds before relying on it further.
