// Session cookie flags for every Supabase client (browser, server,
// proxy). @supabase/ssr defaults to SameSite=Lax (blocks cross-site form
// posts) but sets no Secure flag, so a browser could send the session
// over plain http:// on a first visit before the HTTPS redirect / HSTS
// kicks in (security audit, CSRF). HttpOnly has to stay off: the browser
// client reads the session itself — the CSP is the mitigation there.
// Secure only in production so http://localhost development still works.
export const SUPABASE_COOKIE_OPTIONS = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};
