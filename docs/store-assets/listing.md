# Sportonica — App Store & Play Store Listing

As of Sep 24, 2026. Paste-ready copy for Play Console and App Store Connect; graphics are in this folder (see README.md).

## Overview

Sportonica 1.0 is not ready to submit yet. It still needs screenshots, a release keystore, Apple Developer enrollment and signed-off listing copy. Everything else below is ready to paste into the store consoles.

Both apps are thin Capacitor shells that load `https://www.sportonica.com` full-screen. Reviewers on both stores see the live production site, so anything broken on `main` is broken in the submitted app.

|  | App Store (iOS) | Play Store (Android) |
| --- | --- | --- |
| Bundle / package ID | com.sportonica.app | com.sportonica.app |
| Display name | Sportonica | Sportonica |
| Version / build | 1.0 / 1 | 1.0 / 1 |
| Signing | Team ID 35K8C9GK45 | No release keystore yet |
| Min OS | Set in Xcode | minSdk 24, targetSdk 36 |
| Legal entity | Sport Onica Pvt. Ltd., Kathmandu, Nepal | Same |

The app is for adult players (18+) in Kathmandu. They use it to find pickup games, book courts, and join tournaments. Venue owners and organisers use it to run bookings and events.

## Store identity

Both stores use the same name and category. Each piece of copy is under its store's character limit (counts in brackets).

| Field | App Store | Play Store |
| --- | --- | --- |
| App name (30 max) | Sportonica: Book & Play (23) | Sportonica: Book & Play (23) |
| Subtitle (30 max, iOS) | Book courts, join pickup games (30) | — |
| Short description (80 max, Play) | — | Book futsal & cricket courts, join pickup games and tournaments in Kathmandu. (77) |
| Promotional text (170 max, iOS) | Find a game tonight. Book a court in seconds. Join tournaments across Kathmandu. (80) | — |
| Primary category | Sports | Sports |
| Secondary category | Lifestyle | — (Play uses one category plus tags) |
| Age rating | 17+ (Apple's highest tier; the Terms require 18+) | IARC questionnaire; target audience 18+ only |
| Price | Free | Free, no in-app purchases |
| Support email | info@sportonica.com | info@sportonica.com |
| Support / marketing URL | https://www.sportonica.com/contact | https://www.sportonica.com |

**iOS keywords** (100 max, comma-separated with no spaces; the app name is already indexed, so it's left out): `futsal,cricket,court,booking,kathmandu,nepal,tournament,badminton,pickup,league,squad,pickleball` (96)

**Play tags:** Sports, Team sports, Booking. Play has no keyword field; it ranks on the title, short description and full description.

## Full description

Use the same copy on both stores (4,000 characters max; this is about 1,500). It only describes features that are live on sportonica.com today.

```
Sportonica is Kathmandu's home for playing sport. Find a game tonight, book a court in seconds, and join tournaments with your team, all in one app.

FIND A GAME
- Discover pickup games and events near you on a live map
- Filter by sport, time and distance
- Join Play Together games when a group needs one more player

BOOK A COURT
- Browse venues for futsal, cricket, badminton, basketball, tennis, pickleball, volleyball and more
- See open slots and book straight away
- Pay with eSewa, Khalti or the venue's QR code, and upload your payment proof in the app

TOURNAMENTS
- Browse open tournaments and register your team
- Follow fixtures, brackets, standings and live scores
- Get announcements from organisers as they happen

YOUR SQUAD
- Build squads and compete in leagues
- Add friends, send messages and plan your next match
- Get notified about bookings, invites and results

FOR VENUES AND ORGANISERS
- Manage bookings and verify payments
- Run tournaments end to end: registrations, rosters, fixtures and results

SAFE BY DESIGN
- Block or report any user
- Delete your account at any time from your profile

Sportonica is for players aged 18 and over.

Questions? Email info@sportonica.com.
Privacy Policy: https://www.sportonica.com/privacy
Terms: https://www.sportonica.com/terms
```

**What's New (1.0):** First release of Sportonica. Book courts, join pickup games and tournaments across Kathmandu.

## Screenshots & graphics

The app icons are done. There are no screenshots or Play feature graphic yet. Check the exact iPhone screenshot size in App Store Connect when you upload, because Apple changes it between releases.

| Asset | App Store | Play Store | Status |
| --- | --- | --- | --- |
| App icon | 1024×1024, in AppIcon.appiconset | 512×512, export from public/icons/icon-512.png | iOS done; Play needs export |
| Feature graphic | — | 1024×500 | Needs design |
| Phone screenshots | 1290×2796 (6.7" iPhone), 1–10 | 1080×2400, 2–8 | Not captured |
| Tablet screenshots | Only if the app supports iPad | Only if the app targets tablets | Skip for 1.0 |
| Preview video | Optional | Optional | Not planned |

**Screens to capture, in order.** These are all public pages with real content, so you don't need to log in:

1. Home (`/`): hero and featured events
2. Discover (`/discover`): the game list and map
3. Tournaments (`/tournaments`): the tournament list
4. Tournament detail: fixtures, bracket or standings for a live tournament
5. Venue or court booking (`/create`): open slots and the start of booking

**How to capture them.** The app has no native chrome, so a device-emulated browser screenshot looks exactly like the app. Open sportonica.com in Chrome and turn on DevTools device mode (Cmd+Shift+M). Choose iPhone 15 Pro Max or a custom 1080×2400 size. Then run **Capture screenshot** from the Cmd+Shift+P menu to save at full device resolution.

## Privacy & data safety

Fill in Apple's App Privacy label and Play's Data safety form from this table. It reflects what the code actually does, which is narrower than the privacy policy's legal wording. No data is used for tracking or ads, and no data is sold. All traffic is encrypted over HTTPS.

| Data type | Collected | Linked to user | Purpose | Where in the app |
| --- | --- | --- | --- | --- |
| Name, email, phone | Yes | Yes | Account, app functionality | Sign-up, profile |
| Precise location | Yes, optional | Yes | App functionality | Discover map, nearby filters, location pickers |
| Photos | Yes | Yes | App functionality | Avatar, venue photos, tournament banners, payment-proof screenshots |
| Messages and other user content | Yes | Yes | App functionality | Chats, game listings, tournament entries, bio |
| User ID | Yes | Yes | App functionality | Supabase login session |
| Payment info | No card data | — | — | eSewa or Khalti handle payments; only a proof screenshot is uploaded |
| Contacts, health, analytics, diagnostics | No | — | — | No analytics SDK is installed |

| Required URL | Link |
| --- | --- |
| Privacy policy | https://www.sportonica.com/privacy |
| Terms of service | https://www.sportonica.com/terms |
| Account deletion (both stores require this) | https://www.sportonica.com/account-deletion |

- The privacy policy mentions contacts access, but the app never asks for it. Remove that clause, or answer "not collected" on both forms anyway.
- iOS permission prompts (location, camera, photo library) and `PrivacyInfo.xcprivacy` are already in the build. Answer "no" to the encryption question, because the app only uses standard HTTPS.
- Play financial features: the app helps users pay venues. Run Play Console's policy check on this before you submit.

## Review notes

Reviewers sign in with the demo account **appreview@sportonica.com**. Before each submission, run `node scripts/seed-demo-account.mjs` to reset its password, which the script prints once. Paste that password into App Store Connect under App Review Information, and into Play Console under App content → App access.

Paste this into the notes field on both stores:

```
Sportonica lets adults in Kathmandu, Nepal book sports courts, join pickup games and enter tournaments.

Sign in with the demo account above. It is a standard player account and lands on Discover.

Where to find key features:
- Discover: find games on the map
- Book (bottom tab): choose a venue and time slot
- Tournaments: browse and view fixtures, brackets and standings
- Profile > Privacy: manage blocked users
- Profile > Delete account, or https://www.sportonica.com/account-deletion
- Block or report: open any user's profile

Payments: court and tournament fees go directly to the venue or organiser through eSewa, Khalti or their QR code. These services are for real-world sports, not digital goods, so In-App Purchase does not apply. The app has no subscriptions or digital content for sale.

Sign-in options: email/password, Google, and Sign in with Apple.
```

Sign in with Apple is already in the code. It will only work after you pay for Apple Developer enrollment and set up the Services ID and key in Supabase. Until then, Apple will reject the app under Guideline 4.8, because it offers Google sign-in.

## Submission checklist

Twelve items are still open. Four of them block submission: Apple enrollment, the release keystore, screenshots, and Play closed testing.

**Both stores**

- [ ] Sign off on the listing copy above
- [ ] Capture 5 screenshots per store
- [ ] Fill in the App Privacy and Data safety forms from the privacy table
- [ ] Set the age rating: 17+ on iOS, adults only on Play
- [ ] Reset the demo account password and paste it into both consoles
- [x] Account deletion page is live
- [x] Block and report are in place (Guideline 1.2)

**App Store**

- [ ] Pay for the Apple Developer Program ($99/yr)
- [ ] Configure Sign in with Apple: Services ID, private key, Supabase provider
- [ ] Upload a TestFlight build from Xcode, then submit for review
- [x] Info.plist permission strings, PrivacyInfo.xcprivacy, encryption flag
- [x] apple-app-site-association has the real Team ID

**Play Store**

- [ ] Generate a release keystore, turn on Play App Signing, and add its SHA-256 to `assetlinks.json`
- [ ] Design the 1024×500 feature graphic and export the 512×512 icon
- [ ] Run the financial features policy check
- [ ] Check whether the account needs a 14-day closed test before production, then upload the AAB

The full technical notes are in `docs/store-submission.md` in the repo.
