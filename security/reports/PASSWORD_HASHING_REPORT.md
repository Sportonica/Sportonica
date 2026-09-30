# PASSWORD_HASHING Security Report

## Status: N/A — passwords are handled by Supabase Auth

## Findings

- All passwords (email and phone accounts) are set and verified by **Supabase Auth** (GoTrue), which stores bcrypt hashes in `auth.users`. The app never sees or stores a password hash: sign-in, sign-up, password change and reset all call Supabase (`signInWithPassword`, `signUp`, `admin.createUser`, `updateUser`).
- No custom password hashing anywhere: searched `src` and all SQL for `md5`, `sha1`, `createHash`, `crypt(`, `bcrypt`, `argon`, `scrypt`, `digest(`.
- Other crypto in the codebase (not passwords, all appropriate):
  - `src/lib/security/abuse.ts` — SHA-256 to anonymise rate-limit keys (IPs / phone numbers).
  - `src/lib/phone/codes.ts` — HMAC-SHA256 of 6-digit SMS codes; 10-minute expiry and 5 attempts bound brute force.
  - `src/lib/crypto/e2e.ts` — AES-GCM for end-to-end encrypted DMs (Web Crypto).
  - `pgcrypto` extension — used for `gen_random_uuid()`.

## Recommendations

- Password policy is set in Supabase (min length 6 in the app, `PASSWORD_MIN`); consider raising it to 8 and enabling Supabase's leaked-password protection (Auth → Providers → Email).

## Verification (2026-09-30)

Code/SQL search above; nothing to change.
