import "server-only";
import { createHash } from "crypto";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/admin";

// SERVER ONLY — uses the service-role key. Abuse guards for server
// actions that talk to Supabase Auth on the visitor's behalf (SEC-04).
// Supabase rate-limits auth per IP, but every call from here arrives from
// a Vercel IP and admin calls skip its limits entirely, so these actions
// need their own per-visitor limit — and the actions that create accounts
// need their own CAPTCHA check.

// The visitor's IP as Vercel reports it. Prefer the headers only Vercel's
// edge sets (a client can't supply them); x-forwarded-for is also
// overwritten by Vercel, but is kept last as a fallback for other hosts.
// Rate limits key on this, so it must not be spoofable (security audit,
// RATE_LIMITING).
export async function clientIp(): Promise<string> {
  const h = await headers();
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  return first(h.get("x-vercel-forwarded-for")) || first(h.get("x-real-ip")) || first(h.get("x-forwarded-for")) || "unknown";
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

// Counts one hit against `bucket` for `key` (hashed, so raw IPs and phone
// numbers never land in the table). Returns false once more than `max`
// hits fall in the current `windowSeconds` window.
//
// Fails open: if the counter can't be reached (e.g. the SQL hasn't been
// run yet) the action goes ahead and the error is logged. A broken
// limiter shouldn't lock everybody out of signing up.
export async function underRateLimit(
  bucket: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc("hit_rate_limit", {
      p_key: `${bucket}:${hash(key)}`,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data !== false;
  } catch (e) {
    console.error("[rate-limit] check failed, allowing:", (e as { message?: string })?.message ?? e);
    return true;
  }
}

// Checks a Turnstile token with Cloudflare. Only for actions Supabase
// doesn't check itself (admin-API signup); Supabase verifies the token on
// its own auth endpoints. With no secret configured it passes, matching
// the client, which sends no token without a site key.
export async function captchaPassed(token: string | undefined): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: await clientIp() });
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch (e) {
    console.error("[captcha] siteverify failed:", (e as Error)?.message);
    return false;
  }
}
