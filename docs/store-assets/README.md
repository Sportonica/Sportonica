# Store assets

Everything needed for the Play Console and App Store Connect listings, except
the app bundle and the signing key (see below).

| File | Size | Upload to |
|---|---|---|
| `play-icon-512.png` | 512×512 PNG, no alpha | Play → Store listing → App icon |
| `play-feature-graphic-1024x500.jpg` | 1024×500 JPEG | Play → Store listing → Feature graphic |
| `play-phone-screenshots/1–4` | 1080×1920 PNG | Play → Store listing → Phone screenshots |
| `ios-iphone-6.9-screenshots/1–4` | 1290×2796 PNG | App Store Connect → iPhone 6.9" screenshots |
| `listing.md` | — | Name, subtitle, descriptions, keywords, privacy answers, review notes |

Screenshots are device-emulated captures of production (`www.sportonica.com`),
which is exactly what the Capacitor shell renders, framed with a caption.
Recapture them whenever the relevant screens change. Keep test data such as the
"Demo" venues out of frame.

## Not in this repo, on purpose

- **Play upload key** (`sportonica-upload.jks` + password). This repo is public,
  and anyone with the key could sign updates as Sportonica. It is kept offline
  by the owners (password manager + offline backup). `.gitignore` blocks
  `*.jks`, `*.keystore`, `*.p12` and `keystore.properties`.
- **Release bundle** (`*.aab`). It's a build output: rebuild with
  `cd android && ./gradlew bundleRelease` (Gradle 8.14 needs JDK ≤ 24), then
  sign it with the upload key via `jarsigner`. Bump `versionCode` in
  `android/app/build.gradle` for every upload after the first.

Submission status and technical gaps: [`docs/store-submission.md`](../store-submission.md).
