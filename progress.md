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

**Server limitation:** `PATCH /api/entries/:id` accepts only `food_name`,
`calories`, `protein_g`, `carbs_g`, `fat_g` and `meal_type` — **not**
`quantity`/`unit`. Rescaled macros persist; the stored weight does not. Fixing
that needs a backend change in `calorie-tracker-codex-refactored`
(`src/http/api.ts`, the entry-update schema).

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
