# App Store & Play Store Submission

Both native apps are thin [Capacitor](https://capacitorjs.com) shells — see
[`capacitor.config.ts`](../capacitor.config.ts). They ship no bundled UI;
`MainActivity`/`SceneDelegate` just load `https://www.sportonica.com` and
render it full-screen. Reviewers on both stores will therefore be reviewing
the **live production site**, not a build artifact — anything broken on
`main` is broken in the submitted binary too.

Native shell source: `ios/` and `android/` on this branch are git subtrees;
source of truth is the standalone [`ios`](https://github.com/Sportonica/Sportonica/tree/ios)
and [`android`](https://github.com/Sportonica/Sportonica/tree/android) branches
(see [`README.md`](../README.md#branches)).

---

## App identity

| | iOS | Android |
|---|---|---|
| Bundle / package ID | `com.sportonica.app` | `com.sportonica.app` |
| Display name | Sportonica | Sportonica |
| Version | `1.0` (`MARKETING_VERSION`) | `1.0` (`versionName`) |
| Build number | `1` (`CURRENT_PROJECT_VERSION`) | `1` (`versionCode`) |
| Signing team / config | Team ID `35K8C9GK45` ([`project.pbxproj`](../ios/App/App.xcodeproj/project.pbxproj)) | `minSdk 24` / `targetSdk 36` ([`variables.gradle`](../android/variables.gradle)) |

---

## Required URLs (already live)

| Purpose | URL |
|---|---|
| Privacy Policy | https://www.sportonica.com/privacy |
| Terms of Service | https://www.sportonica.com/terms |
| Account deletion | https://www.sportonica.com/account-deletion (implementation: [`docs/account-deletion.md`](account-deletion.md)) |
| Support / contact | https://www.sportonica.com/contact — `info@sportonica.com` |
| Marketing / support site (Play Console) | https://www.sportonica.com |

Legal entity for both consoles: **Sport Onica Pvt. Ltd.**, Kathmandu
Metropolitan City, Ward no. 9, Kathmandu District, Nepal.

---

## Data collected (for Apple's Privacy Nutrition Label & Play's Data Safety form)

Derived from [`privacy/page.tsx`](../src/app/(legal)/privacy/page.tsx) and
what the code actually reads/uploads — fill in the console forms from this
table, not from the privacy policy's broader legal language, since the
console forms ask about actual practice.

| Data type | Collected? | Linked to user? | Where in the app |
|---|---|---|---|
| Name, email, phone | Yes | Yes | Account signup/profile |
| Precise location | Yes | Yes | `navigator.geolocation` in Discover map, "nearby" filters, venue/game location pickers ([`DiscoverFilters.tsx`](../src/app/discover/DiscoverFilters.tsx), [`NearbyPopup.tsx`](../src/components/NearbyPopup.tsx), [`LocationPicker.tsx`](../src/components/shared/LocationPicker.tsx), [`AppHeader.tsx`](../src/components/AppHeader.tsx)) |
| Photos / user content | Yes | Yes | Avatar upload ([`ProfileEditor.tsx`](../src/app/profile/ProfileEditor.tsx)), venue photos, tournament banners, **payment-proof screenshots** and host QR images (see below) |
| Payment info | Partial — see note | Yes | Card/bank details go directly to Khalti/eSewa gateways, never touch Sportonica servers. But `uploadPaymentProof` stores a **screenshot of the completed payment** the user submits as proof — this image may incidentally show a bank/wallet app UI |
| User-generated content | Yes | Yes | Game listings, tournament entries, messages, profile bio |
| Identifiers (device/user ID) | Yes | Yes | Supabase auth session |
| Diagnostics/analytics | Not currently instrumented | — | No analytics SDK in `package.json` today — revisit this row if one is added before submission |

**Not collected:** contacts (the privacy policy mentions a contacts-access
feature but nothing in the codebase requests it today — either remove that
clause from the policy or don't claim "no contacts access" on the store
forms until it's built), health/biometric data, precise financial account
numbers.

---

## Listing copy (draft — needs sign-off before submission)

- **Name:** Sportonica
- **Subtitle / short description:** Kathmandu's sports booking platform — find games, book courts.
- **Category:** Sports (primary), Lifestyle (secondary, if the store requires one)
- **Description:** draft from [`README.md`](../README.md) — expand with real screenshots' feature callouts (Discover map, flash matches, tournaments, venue booking) before submitting.
- **Keywords (iOS):** kathmandu sports, court booking, futsal, cricket booking, tournament, play together, nepal sports
- **Support email:** info@sportonica.com

---

## Asset checklist

| Asset | iOS | Android | Status |
|---|---|---|---|
| App icon | 1024×1024, [`AppIcon.appiconset`](../ios/App/App/Assets.xcassets/AppIcon.appiconset) | Adaptive icon, `mipmap-*/ic_launcher*` | ✅ present on both |
| Play Store hi-res icon (512×512) | — | Not yet exported to Play Console; source available at [`public/icons/icon-512.png`](../public/icons/icon-512.png) | ⬜ needs export |
| Feature graphic (1024×500, Android) | — | Not created | ⬜ missing — needs design |
| Screenshots | Largest current iPhone size Xcode/App Store Connect requires at submission time (check then — this has changed release over release); iPad if supporting tablets | Phone (min 2, up to 8); 7"/10" tablet if supporting tablets | ⬜ none captured yet |
| App preview video | Optional | Optional | ⬜ not planned for v1 |

---

## Pre-submission technical gaps

Found while auditing the native shells against what the web app actually
does — these will cause rejections or runtime crashes if not fixed before
either submission:

1. ✅ **Fixed.** `Info.plist` was missing usage-description keys. The app
   calls `navigator.geolocation.getCurrentPosition` (Discover, "nearby",
   location pickers) and uses `<input type="file" accept="image/*">` for
   avatars, payment-proof screenshots, and tournament banners — which on iOS
   opens a picker that offers **"Take Photo"** as well as the library.
   Added `NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryUsageInfo`,
   and `NSCameraUsageInfo` to
   [`ios/App/App/Info.plist`](../ios/App/App/Info.plist). Without these,
   missing location keys meant the permission prompt silently never
   appeared (`getCurrentPosition` just failed); missing camera/photo-library
   keys can hard-crash the app the first time a user taps "Take Photo," and
   Apple review rejects binaries that request access without a usage string
   outright.
2. ✅ **Fixed.** `apple-app-site-association` had a placeholder team ID.
   [`public/.well-known/apple-app-site-association`](../public/.well-known/apple-app-site-association)
   now reads `appID: "35K8C9GK45.com.sportonica.app"` (Team ID confirmed in
   `project.pbxproj`). Universal Links (and the Google Sign-In
   browser-redirect flow in `GoogleButton.tsx`) can now reopen the app.
3. ⬜ **Still open — needs a real release keystore.**
   [`public/.well-known/assetlinks.json`](../public/.well-known/assetlinks.json)
   still has `REPLACE_WITH_YOUR_PRODUCTION_SIGNING_CERT_SHA256_FINGERPRINT`.
   This can't be filled in yet — no release keystore exists in the repo or
   in Play Console (`android/app/build.gradle` has no `signingConfigs`
   block). Generate/upload one, then get its SHA-256 from Play Console →
   App signing, and add it alongside the existing debug fingerprint — or
   Android App Links auto-verification fails.
4. ⬜ No feature graphic or screenshots exist yet (see asset checklist above).

---

## Store-policy compliance gaps

These aren't config typos — they're store **policy** requirements the app
doesn't satisfy yet. Each one is a plausible rejection reason on its own,
independent of the technical gaps above.

1. 🟡 **Code shipped, blocked on paid Apple Developer enrollment (Apple
   Guideline 4.8).** The app offers Google OAuth as a login option
   ([`GoogleButton.tsx`](../src/components/GoogleButton.tsx), used in
   [`login`](../src/app/(auth)/login/page.tsx) and
   [`signup`](../src/app/(auth)/signup/page.tsx)) alongside email/password.
   Any app offering a third-party/social login for account creation must
   also offer Sign in with Apple as an equivalent, privacy-preserving
   option — this is one of the most common iOS rejection reasons for apps
   that already have Google/Facebook login.

   Added [`AppleButton.tsx`](../src/components/AppleButton.tsx), wired into
   both auth pages identically to `GoogleButton.tsx` — same
   `signInWithOAuth` → system-browser → `/auth/callback` round trip
   (`CapacitorBridge.tsx`'s `appUrlOpen` listener was already
   provider-agnostic, no change needed there). This is the **web OAuth**
   flow, not the native `ASAuthorizationAppleIDProvider` SDK, which means
   **no Xcode/entitlements changes and no native Capacitor plugin are
   needed** — it's the same pattern already shipping for Google, just
   pointed at `provider: "apple"`.

   What's still blocked on paying for the $99/yr Apple Developer Program
   (can't be done without it):
   - Create a **Services ID** in the Apple Developer portal with "Sign in
     with Apple" enabled, domain `sportonica.com`, return URL
     `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
   - Generate a **Sign in with Apple private key** (Keys → +) — note the
     Key ID and Team ID (`35K8C9GK45`, already known)
   - In Supabase Dashboard → Authentication → Providers → Apple: enable
     it, paste in the Services ID as Client ID, the Team ID, Key ID, and
     the private key content as the Secret Key
   - No App ID capability change needed (that's only required for the
     native SDK flow, which this isn't using)
2. ✅ **Fixed.** Added [`ios/App/App/PrivacyInfo.xcprivacy`](../ios/App/App/PrivacyInfo.xcprivacy)
   and wired it into the Xcode target (`project.pbxproj` — file reference,
   build file, group membership, and Resources build phase). Checked the
   actual source of every installed Capacitor package
   (`@capacitor/core`, `ios`, `app`, `browser`, `splash-screen`,
   `status-bar`) in `node_modules` for the required-reason API patterns
   Apple's manifest cares about (`UserDefaults`, file/volume timestamps,
   disk space, system boot time) — none were found, so the manifest
   declares `NSPrivacyAccessedAPITypes` empty, `NSPrivacyTracking = false`,
   and no tracking domains. `NSPrivacyCollectedDataTypes` is also left
   empty since the native binary itself doesn't collect data — all
   collection happens in the remote web content loaded into the WKWebView,
   which is covered by the App Store Connect Privacy Nutrition Label
   instead. **Re-check this file if any native Capacitor plugin is added
   later** (e.g. a native Geolocation or Camera plugin instead of the
   current plain web APIs) — those would need real entries here.
3. ⬜ **No reviewer/demo account documented.** Almost the entire app sits
   behind login (booking, messages, tournaments, profile). Both consoles
   ask for this explicitly: App Store Connect → App Review Information →
   sign-in credentials + notes for the reviewer; Play Console → App content
   → **App access** → instructions or credentials. Without a working test
   account handed to reviewers, both stores will bounce the submission
   asking for one. Needs a seeded test account (or a documented way to
   create one) that isn't tied to a real person.
4. ✅ **Fixed.** User-blocking (Apple Guideline 1.2 — UGC apps) is shipped
   and verified in production (PR #16). Blocking someone ends the
   friendship, cancels pending friend requests, stops new friend requests
   and new DM sends (in either direction, even in an existing
   conversation — closed a real pre-existing gap where DM send RLS only
   checked participancy, not live friendship), and never reveals to the
   blocked party that they've been blocked. `RUN_ME_user_blocking.sql` ran
   clean against production (table, functions, and policies all
   confirmed present). Reporting (`fileReport` in
   [`squads/actions.ts`](../src/lib/squads/actions.ts)) still feeds the
   admin moderation queue at `/platform/reports` alongside it. Profile →
   Privacy now lists and manages blocked users for real instead of the
   old "coming soon" stub.
5. ⬜ **Age rating / target audience.** [`terms/page.tsx`](../src/app/(legal)/terms/page.tsx)
   requires users to be **18+** to register. Set both consoles' age-rating
   questionnaires accordingly (Apple: 17+, the highest standard tier — note
   Apple has no dedicated 18+ tier, so 17+ plus the ToS age-gate is the
   correct combination; Play: complete the IARC questionnaire honestly and
   set target audience to adults, not "designed for families").
6. ⬜ **Play Console "Financial features" declaration — needs a policy check.**
   The app facilitates real-money court/tournament bookings (QR-code /
   eSewa / Khalti payment-proof upload flow in
   [`PaymentStep.tsx`](../src/components/payments/PaymentStep.tsx)). Even
   though Sportonica doesn't hold funds itself, Play's Financial Services
   policy can still apply to apps that facilitate payments between users —
   confirm with Play Console's policy checker before submitting so the
   listing isn't rejected or held for extra verification.
7. ✅ **Fixed.** Added `ITSAppUsesNonExemptEncryption = false` to
   [`ios/App/App/Info.plist`](../ios/App/App/Info.plist). The app only uses
   standard HTTPS/TLS, which qualifies for Apple's export-compliance
   exemption, so this skips the manual encryption question on every App
   Store Connect build upload.
8. ⬜ **Play Console closed-testing requirement.** Newer (and personal)
   Google Play developer accounts must run a closed test with a minimum
   number of testers for at least 14 continuous days before Play grants
   production access. Confirm the Sportonica Play Console account's
   creation date/type and whether this gate applies before assuming a
   direct-to-production release is possible.

---

## Account deletion requirement

Both stores require self-serve, in-app account deletion for any account
created in-app. Already implemented — see
[`docs/account-deletion.md`](account-deletion.md). For submission, just
link `https://www.sportonica.com/account-deletion` in:
- App Store Connect → App Privacy → "data deletion" question
- Play Console → App content → Data safety → account deletion URL

---

## Next steps

- [x] Fix `Info.plist` usage-description keys
- [x] Fix `apple-app-site-association` team-ID placeholder
- [ ] Generate a release keystore and fill in `assetlinks.json`'s production SHA-256
- [x] Add Sign in with Apple alongside Google OAuth (client code) — [ ] still needs the Services ID + private key + Supabase provider config once the Apple Developer account is paid for
- [x] Add an iOS Privacy Manifest (`PrivacyInfo.xcprivacy`)
- [x] Add `ITSAppUsesNonExemptEncryption = false` to `Info.plist`
- [ ] Seed a reviewer/demo account and document it for App Review Information / Play App access
- [x] Ship (or feature-gate) user-blocking before submitting with messaging enabled
- [ ] Set age rating / target audience to 18+ adults in both consoles
- [ ] Run the Play Console policy checker on the payment-facilitation flow (Financial features)
- [ ] Confirm whether the Play Console account needs 14-day closed testing before production
- [ ] Capture real device screenshots for both stores
- [ ] Design the Android feature graphic (1024×500)
- [ ] Sign off on listing copy (name/subtitle/description/keywords)
- [ ] Fill in the Data Safety form (Play Console) and Privacy Nutrition Label (App Store Connect) from the data table above
- [ ] First internal/TestFlight build once the above are resolved
