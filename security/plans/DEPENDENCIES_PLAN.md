# DEPENDENCIES Fix Plan

## Changes

- `package.json` / `package-lock.json` — `next` 16.2.9 → 16.3.7, `eslint-config-next` → 16.3.7, `npm audit fix` (nanoid, baseline-browser-mapping), all versions pinned exactly.

## New files

None.

## Verification goals

- [x] Every dependency verified as legitimate
- [x] No suspicious low-download / newly published packages
- [x] Exact versions pinned
- [x] Lock file committed
- [x] `npm audit --omit=dev`: 0 critical / 0 high (0 total)
- [x] App regression-tested after the framework upgrade

## Manual verification (for the human)

- After deploy, click through booking, tournament registration and the Control Center once — the framework minor version changed.
- Consider enabling Dependabot security updates for the repo.
