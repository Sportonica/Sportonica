# XSS Fix Plan

## Changes

None needed.

## New files

None.

## Verification goals

- [x] No dangerouslySetInnerHTML / innerHTML with user content (only constant JSON-LD)
- [x] Hand-built HTML escapes every user value (team sheet `esc()`)
- [x] Stored payloads render as text on profile, tournament, teams, team sheet, Control Center
- [x] javascript: URLs in user-set links are blocked (React 19)

## Manual verification (for the human)

- None required.
