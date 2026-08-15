# Shipping NutriAI to Google Play

Readiness audit, written 2026-08-14 against the v1.0.2 build.

Policy details change; anything marked **verify** must be checked against the
Play Console at submission time rather than trusted from this document. The
blockers below are structural, not date-sensitive.

---

## The three things that will actually stop you

### 1. `REQUEST_INSTALL_PACKAGES` — the in-app updater cannot ship to Play

We added it so the app could install its own updates outside the Play Store.
Play restricts this permission to apps whose *core purpose* is installing other
apps — app stores, device management, enterprise deployment tools. A calorie
tracker requesting it is a rejection, and possibly a flagged account.

It is also redundant on Play: Play updates the app.

**What has to happen:** the Play build must not declare it, and must not ship
`src/updates/`'s install path. The sideloaded build keeps both — that's the
whole reason it exists, and `/download` continues to serve friends and testers.

This is a build-variant split, not a deletion. See "Deciding the two-track
build" below.

### 2. `targetSdkVersion` is 34

`android/build.gradle` targets API 34. Play enforces a floor for new
submissions and updates, and 34 is below it. `compileSdkVersion` is already 35,
so this is a small change — but **not a free one**: Android 15 enforces
edge-to-edge display, so the app must be checked for content sliding under the
status and navigation bars. Every screen, plus the `Sheet` component.

**verify** the exact required level in Console; expect 35 or 36.

### 3. Health Connect needs a declaration and approval

Reading `android.permission.health.*` requires submitting Google's Health
Connect declaration form describing exactly which data types are read and why.
It is reviewed by a human and it takes time — this is the single item most
likely to blow a "next week" deadline.

Data types to declare: `READ_STEPS`, `READ_ACTIVE_CALORIES_BURNED`,
`READ_TOTAL_CALORIES_BURNED`, `READ_DISTANCE`, `READ_EXERCISE`, `READ_WEIGHT`.
All read-only, all used to keep the day's energy balance accurate.

---

## The timeline risk nobody expects

If the Play developer account is a **personal** account created after
November 2023, Google requires a **closed test with at least 12 testers running
continuously for 14 days** before you may apply for production access.

That is a two-week wall-clock minimum before the app can go public, and it
cannot be shortened. **Check the account type first** — it changes the plan
from "submit next week" to "start the closed test next week, launch in three".

Organisation accounts are exempt.

---

## Signing: your SHA-1 will change, and Google Sign-In will break

Play App Signing means Google re-signs the app with *their* key. The
certificate users receive is not `nutriai-release.keystore`.

Consequence: the Android OAuth client registered against
`6A:51:74:C4:D5:7C:75:88:92:3F:1C:AB:8A:1A:F9:C6:6E:88:F4:78` will not match
the Play build, and **Google Sign-In will fail for every Play user**.

After the first upload, take the SHA-1 Play shows under *Release → Setup → App
signing* and register a second Android OAuth client with it in Google Cloud.
Keep the existing one — the sideloaded build still uses it.

Keep `credentials/keystore.properties` and the keystore backed up regardless:
it becomes the *upload* key, and losing it means asking Google to reset it.

---

## Permissions to clean up before the Data safety form

The merged manifest currently declares more than the app uses. None are fatal,
but each one is something to justify, and several come from libraries rather
than from us:

| Permission | Source | Action |
|---|---|---|
| `REQUEST_INSTALL_PACKAGES` | our updater | **must be removed** for Play |
| `SYSTEM_ALERT_WINDOW` | library | remove — draws over other apps, invites scrutiny |
| `READ/WRITE_EXTERNAL_STORAGE` | expo-file-system, expo-image-picker | remove; legacy, unused at this API level |
| `USE_FINGERPRINT` / `USE_BIOMETRIC` | library | remove — no biometric feature exists |
| `READ_APP_BADGE` + ~20 launcher badge permissions | expo-notifications | harmless, can stay |
| `CAMERA` | meal photos | keep, justify |
| `POST_NOTIFICATIONS` | reminders | keep, justify |
| `RECEIVE_BOOT_COMPLETED` | reminder rescheduling | keep |
| `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM` | meal reminders firing at the meal | **decide before submitting** — see below |

Strip with `android.permissions` removal in `app.config.ts` or a
`tools:node="remove"` plugin.

### The exact-alarm decision

Both exact-alarm permissions were added so reminders arrive at 11:00, not at
whenever Doze next lets the phone wake up — without them expo-notifications
falls back to `setAndAllowWhileIdle`, which vendor skins defer by hours. That
is the right trade for the sideloaded APK, where a late reminder is the whole
complaint.

Play restricts both to apps whose *core* function is an alarm clock, timer or
calendar. A meal-reminder app is arguable, not obvious, and the reviewer's
opinion is the one that counts. Three options, in the order I'd try them:

1. **Drop both from the Play build.** Reminders become inexact — typically a
   few minutes late, occasionally an hour on an aggressive OEM. Zero review
   risk, and it rides on the same build split that removes
   `REQUEST_INSTALL_PACKAGES`, so it costs nothing extra.
2. **Keep `SCHEDULE_EXACT_ALARM` only** and fill in the declaration. Users on
   Android 14+ then have to grant it themselves in Settings → Alarms &
   reminders; the app already links straight there from You → Meal reminders →
   "Reminders not arriving?".
3. **Keep both** and argue the case in the declaration form. Highest risk; a
   rejection here costs a review cycle, which at 3–7 days each is the
   expensive currency.

My recommendation is (1) for the first submission: ship, get reviewed, and
revisit if users complain about timing on the Play build specifically.

---

## Data safety form — draft answers

The app collects, and this must all be declared:

| Data | Collected | Why | Optional? |
|---|---|---|---|
| Email address | yes | account | no |
| Name | yes | display | no |
| Health: weight, body metrics | yes | the plan and its trend | no |
| Health: steps, active energy, distance, exercise | yes (Health Connect) | energy balance | yes |
| Food logs / diet | yes | core function | no |
| Photos | yes | meal recognition | yes |
| App interactions | yes | coach context | no |

All of it is transmitted to your server (Railway) and stored in SQLite.
Encrypted in transit (HTTPS). **Users can request deletion in-app** — You →
Delete account, which calls `DELETE /api/account`.

Two things this form will demand that you do not yet have:

- **A privacy policy URL.** Mandatory, and doubly so for health data. There is
  no privacy policy anywhere in the repo. It must be publicly reachable without
  logging in — `https://nutriai-app.up.railway.app/privacy` is the obvious home.
- **A web-accessible account-deletion URL.** In-app deletion exists and is
  correct, but Play also requires a page a user can reach *without installing
  the app*, explaining how to request deletion and what is removed.

---

## Store listing assets still to produce

- **App icon** 512×512 PNG — derive from `assets/icon.png`
- **Feature graphic** 1024×500 — does not exist yet, must be designed
- **Phone screenshots** ≥2 (8 recommended): Today, Plan with the trend chart,
  Coach, Trends, meal suggestions
- **Short description** ≤80 chars
- **Full description** ≤4000 chars
- **Content rating** questionnaire
- **Target audience**: 18+ is the honest answer for a calorie-tracking app;
  declaring 13+ pulls in Families policy obligations

Health/diet apps also draw scrutiny over medical claims. Avoid promising
outcomes ("lose 5kg in a month"); describe tracking, not treatment. The app
should carry a visible "not medical advice" line — the AI coach gives dietary
guidance, which makes this more than boilerplate.

---

## Deciding the two-track build

Two distribution channels, permanently:

- **Play build** — no `REQUEST_INSTALL_PACKAGES`, no self-updater, Play signs it
- **Sideload build** — what `/download` serves; keeps the updater, our keystore

Cleanest mechanism: an env flag (`PLAY_BUILD=1`) read in `app.config.ts` that
drops the permission, plus `UPDATES_SUPPORTED` in `src/updates/index.ts`
becoming false when it is set. The update card then renders its "not available
on this platform" branch, which already exists for iOS.

`scripts/release.sh` stays as-is for the sideload track. A second script (or an
EAS profile) handles the Play track — and its version check should assert the
permission is *absent*, the same way the current one asserts the version and
the signing key.

---

## What is already in good shape

- **AAB builds** — `./gradlew bundleRelease` produces one (Play requires AAB,
  not APK)
- **versionCode discipline** — enforced since v1.0.2; the release script reads
  the version back out of the built artifact and refuses to publish a mismatch
- **minSdk 26** — comfortably above Play's floor, required by Health Connect
- **Account deletion in-app** — `DELETE /api/account` wired to You → Delete account
- **64-bit** — arm64-v8a
- **No ads, no analytics SDKs, no third-party trackers** — a much simpler Data
  safety form than most apps
- **HTTPS everywhere**, no cleartext traffic in release builds

---

## Suggested order

1. Check the developer account type — it decides whether this is a one-week or
   three-week plan
2. Submit the Health Connect declaration (longest lead time, start first)
3. Write and publish the privacy policy + deletion pages
4. Split the build; strip the permissions
5. Bump targetSdk, fix edge-to-edge, retest on device
6. Produce listing assets
7. Upload to internal testing, register the Play SHA-1, verify Google Sign-In
8. Closed test if required, then production
