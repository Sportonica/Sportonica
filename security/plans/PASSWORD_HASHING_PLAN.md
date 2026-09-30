# PASSWORD_HASHING Fix Plan

## Changes

None — Supabase Auth hashes passwords with bcrypt.

## Verification goals

- [x] Passwords hashed with bcrypt (Supabase Auth)
- [x] No MD5/SHA-1/plain SHA-256 used for passwords
- [x] No weak legacy hashes to migrate

## Manual verification (for the human)

- Optional: Supabase → Auth → Providers → Email → raise minimum length to 8 and turn on leaked-password protection.
