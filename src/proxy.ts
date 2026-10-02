import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SUPABASE_COOKIE_OPTIONS } from '@/lib/supabase/cookieOptions'
import { buildCsp } from '@/lib/security/csp'
import { consentExempt, hasConsent } from '@/lib/auth/consent'

// Only these prefixes gate on auth/role, with a full getUser() check
// against the auth server. Every other route is public browsing (home,
// /discover, /tournaments, /play-together, …) — the page/action checks
// auth itself where it matters.
const AUTH_PREFIXES = ['/profile', '/admin', '/welcome', '/platform', '/my-games', '/organize']

// @supabase/ssr's session cookie: sb-<project-ref>-auth-token, split into
// .0/.1 chunks when large.
const hasSessionCookie = (request: NextRequest) =>
  request.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))

// Real accounts with no "18+ and I agree" record (src/lib/auth/consent.ts)
// are sent to /consent once, whatever page they open. Only page loads:
// server actions (POST with a Next-Action header) and API calls go through,
// so a form mid-submit never gets a redirect back.
function consentRedirect(request: NextRequest, appMetadata: unknown, isAnonymous: boolean | undefined) {
  if (isAnonymous || hasConsent(appMetadata)) return null
  if (request.method !== 'GET' || request.headers.has('next-action')) return null
  const { pathname, search } = request.nextUrl
  if (consentExempt(pathname)) return null
  const url = new URL('/consent', request.url)
  url.searchParams.set('next', pathname + search)
  return NextResponse.redirect(url)
}

export async function proxy(request: NextRequest) {
  // A fresh nonce per request: Next reads it from the request's CSP header
  // while rendering and stamps it on its inline scripts, and the browser
  // runs only the scripts that carry it (src/lib/security/csp.ts).
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)
  request.headers.set('x-nonce', nonce)
  request.headers.set('Content-Security-Policy', csp)

  const response = await gate(request)
  response.headers.set('Content-Security-Policy', csp)
  return response
}

async function gate(request: NextRequest) {
  const path = request.nextUrl.pathname
  const gated = AUTH_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))

  // Signed-out visitors on public pages: nothing to check or refresh.
  if (!gated && !hasSessionCookie(request)) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesList) => {
          cookiesList.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesList.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  if (!gated) {
    // Keep the session fresh on public pages too (P-01). Otherwise an
    // expired access token gets refreshed during a Server Component
    // render, which can't write cookies — the browser keeps the old,
    // now-used refresh token, and replaying it can trip Supabase's
    // refresh-token reuse detection and sign the user out. getClaims()
    // verifies the ES256 token locally against cached JWKS, so this only
    // costs a network call when the token has actually expired — and
    // then the new cookies are written here, where that's allowed.
    const { data } = await supabase.auth.getClaims()
    const claims = data?.claims
    if (claims?.sub) {
      const toConsent = consentRedirect(request, claims.app_metadata, claims.is_anonymous)
      if (toConsent) return withCookies(toConsent, response)
    }
    return response
  }

  const { data: { user } } = await supabase.auth.getUser()
  // Anonymous sessions (silently created for tournament registration —
  // see TournamentRegisterTab) aren't real accounts: no profile row,
  // nothing to onboard. Treat them as signed-out for these two gates so
  // a stray /profile or /welcome link gets a clean, real redirect here
  // instead of reaching a page with nothing to show for that user.
  const isRealUser = !!user && !user.is_anonymous

  // /organize is here too: its tournament pages render from public data,
  // so without this gate a signed-out organizer still saw the whole
  // console and only found out on save (every action -> UNAUTHORIZED).
  // Passing through here also refreshes an expiring session cookie.
  if (!isRealUser && (path.startsWith('/profile') || path.startsWith('/welcome') || path.startsWith('/my-games') || path.startsWith('/organize'))) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', path)
    return NextResponse.redirect(loginUrl)
  }

  if (isRealUser) {
    const toConsent = consentRedirect(request, user.app_metadata, false)
    if (toConsent) return withCookies(toConsent, response)
  }

  // Admin gate — must be logged in AND have an owner/admin role. Checked
  // against the database, not user_metadata: that field is set via
  // supabase.auth.updateUser() straight from the browser, with no server
  // round-trip at all, so trusting it here was a direct privilege-escalation
  // path independent of anything on the profiles table itself.
  if (path.startsWith('/admin')) {
    if (!isRealUser) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', path)
      return NextResponse.redirect(loginUrl)
    }
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle()
    const role = profile?.role
    // super_admin oversees the whole platform, so it can open the venue
    // console too. Without this it gets bounced to the homepage.
    if (role !== 'admin' && role !== 'venue_owner' && role !== 'super_admin') {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  // Platform gate — same shape as the admin gate above. This used to be
  // enforced only by a redirect() inside platform/layout.tsx, but that
  // let the child page's own data-fetch race ahead and render its
  // "couldn't load" fallback (and Next's not-found boundary) with a 200
  // instead of ever actually redirecting — no logged-out or wrong-role
  // visitor was reliably bounced to /login. Doing it here, before any
  // page code runs, is the same mechanism that already works for /admin.
  if (path.startsWith('/platform')) {
    if (!isRealUser) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', path)
      return NextResponse.redirect(loginUrl)
    }
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'super_admin') {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', path)
      return NextResponse.redirect(loginUrl)
    }
  }

  return response
}

// A redirect built after a token refresh must still carry the refreshed
// session cookies, or the browser keeps the used refresh token (see P-01).
function withCookies(redirect: NextResponse, from: NextResponse) {
  from.cookies.getAll().forEach((c) => redirect.cookies.set(c))
  return redirect
}

export const config = {
  // Previously this only excluded _next/static|_next/image|favicon.ico —
  // every other request, including every plain static file under /public
  // (panel photos, sport photos, icons, manifest, service worker) was
  // running a full Supabase auth round-trip before being served. None of
  // that is a page navigation and none of it needs the auth/role gating
  // below, so it's excluded here too.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|icons/|panels/|sports/|\\.well-known/|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|mp4|css|js|woff2?|geojson)$).*)',
  ],
}
