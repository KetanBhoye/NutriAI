# Shipping NutriAI to the App Store

The Android counterpart is `PLAY_STORE.md`. This covers what is specific to
Apple, and it is ordered by what will actually stop you rather than by what the
submission form asks first.

Everything here that could be done in code **has been done**. What is left needs
an Apple Developer account, which is the one thing that cannot be prepared in
advance.

---

## The three things that will actually stop you

### 1. HealthKit — the review is stricter, and the rejection is specific

NutriAI reads steps, active energy, distance, exercise and weight from Apple
Health. Apple reviews HealthKit apps against extra rules, and the ones that bite:

- **A privacy policy is mandatory.** Not "recommended" — an app with the
  HealthKit entitlement and no reachable policy URL is rejected. Ours is served
  at `/privacy` and `/privacy-policy`, with no login required, because the
  reviewer opens it in a clean browser.
- **Health data must not be used for advertising or sold.** We do neither, and
  the policy says so explicitly in the words Apple looks for.
- **The usage strings must describe the actual purpose.** Ours are set in
  `app.config.ts` via the `react-native-health` plugin and say what the data is
  read for, not "this app needs access to Health".
- **You must not request write access you do not use.** We declare
  `healthUpdatePermission` but only ever read. Consider removing the write
  entitlement before submission if the feature has not shipped — an unused
  write permission invites a question you gain nothing by answering.

**Review notes to paste into App Store Connect:**

> NutriAI reads steps, active energy, distance, exercise and weight from
> HealthKit, with the user's permission, to keep their daily calorie and
> activity totals accurate without manual entry. Health data is used only for
> the in-app features the user can see. It is never used for advertising, never
> sold, and never shared with third parties other than the cloud provider that
> hosts the account. The app is fully usable if HealthKit permission is denied.

### 2. Account deletion must exist *in the app*

Any app offering account creation must offer account deletion from inside the
app — not a support email, not a web form. A reviewer will look for it, and not
finding it is a guaranteed rejection.

Ours is **You → Delete account** (`app/(tabs)/profile.tsx`), backed by
`DELETE /api/account`, and it deletes rather than deactivates.

Point the reviewer at it in the notes; they will not hunt.

### 3. The privacy manifest

Since 2024 an app must ship `PrivacyInfo.xcprivacy` declaring its use of
"required reason" APIs, and the upload is rejected without it. The most common
miss is `NSPrivacyAccessedAPICategoryUserDefaults`, because every app touches
UserDefaults and almost nobody declares it.

**This is already handled.** Expo generates the manifest at prebuild with all
four categories we use — file timestamp, UserDefaults, disk space, system boot
time. Verify after any `expo prebuild`:

```bash
cat ios/NutriAI/PrivacyInfo.xcprivacy
```

`ios/` is gitignored and regenerated, so this is a check, not a file to edit.

---

## Privacy nutrition labels

The App Store Connect questionnaire, answered from what the app actually does.
These must match the privacy policy or you invite a rejection for
inconsistency.

| Question | Answer |
| --- | --- |
| Health & Fitness | **Collected. Linked to identity. Not used for tracking.** Purpose: App Functionality. |
| Contact Info (email, name) | **Collected. Linked.** Purpose: App Functionality (account). |
| User Content (meal photos) | **Collected. Linked.** Purpose: App Functionality. |
| Identifiers (user ID) | **Collected. Linked.** Purpose: App Functionality. |
| Diagnostics | **Collected. Not linked.** Purpose: App Functionality (crash fixing). |
| Usage Data / Advertising | **Not collected.** No analytics or ad SDKs are bundled. |
| Data used to track you | **No.** Nothing is shared with data brokers or used for cross-app tracking. |

The honest answer to "is any data used for tracking" is **no**, and that answer
is worth protecting: adding an analytics SDK later changes it, and changing it
is a far more scrutinised update than a first submission.

---

## Sign in with Apple

**This is the one that catches people out.** If an app offers a third-party
sign-in (we offer Google), Apple requires Sign in with Apple as an equivalent
option — with narrow exemptions that we do not obviously qualify for.

Two ways through:

1. **Add Sign in with Apple.** The correct long-term answer, needs an
   `expo-apple-authentication` integration plus a backend verifier alongside the
   existing Google one.
2. **Ship email/password only on iOS**, hiding the Google button. The rule is
   triggered by *offering* third-party sign-in; without it, the requirement
   falls away.

Option 2 is a config change and gets you submitted; option 1 is better for
conversion. Decide before the first submission — retro-fitting after a rejection
costs a review cycle.

---

## Before you submit

- [ ] Apple Developer Program membership ($99/yr) — the long pole, allow days for verification
- [ ] Bundle ID `app.nutriai.mobile` registered
- [ ] App Store Connect record created, privacy policy URL set to `https://nutriai-app.up.railway.app/privacy`
- [ ] Decide Sign in with Apple vs. hiding Google on iOS
- [ ] Screenshots: 6.7" and 6.5" iPhone are the required sizes
- [ ] Support URL and marketing URL
- [ ] Age rating questionnaire — likely 12+ for health/fitness content
- [ ] Export compliance: HTTPS only, standard encryption → the exemption applies
- [ ] Demo account in review notes, with data already logged (a reviewer on an
      empty account cannot see Trends, the coach or the weekly report, and
      "I couldn't find the feature" is a rejection)

## Things that are already done

- Privacy policy at `/privacy`, publicly reachable, HealthKit wording included
- In-app account deletion, wired to a real delete
- Privacy manifest generated with all four required-reason categories
- Permission usage strings that state the actual purpose (camera, photos, Health)
- No analytics, advertising or tracking SDKs bundled
- `UIBackgroundModes: []` — we claim no background execution we do not use
- HTTPS everywhere, so the export-compliance exemption applies

## Things only you can do

- The developer account, and everything gated behind it
- Screenshots and the store listing copy
- The final Sign in with Apple decision
