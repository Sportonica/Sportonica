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
| Screenshots | 6.7" iPhone required (1290×2796); iPad if supporting tablets | Phone (min 2, up to 8); 7"/10" tablet if supporting tablets | ⬜ none captured yet |
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
- [ ] Capture real device screenshots for both stores
- [ ] Design the Android feature graphic (1024×500)
- [ ] Sign off on listing copy (name/subtitle/description/keywords)
- [ ] Fill in the Data Safety form (Play Console) and Privacy Nutrition Label (App Store Connect) from the data table above
- [ ] Create Play Console release keystore, update `assetlinks.json` with its SHA-256
- [ ] First internal/TestFlight build once the above are resolved
