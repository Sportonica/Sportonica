import { AsyncLocalStorage } from 'node:async_hooks'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { SUPABASE_COOKIE_OPTIONS } from '@/lib/supabase/cookieOptions'

// Set while building data that's cached once and shown to every
// signed-out visitor (see runAsSignedOutVisitor). Inside it createClient()
// reads as anonymous and never touches cookies, so whoever happened to
// fill the cache can't leak their own view into it — and unstable_cache
// doesn't allow cookies() anyway.
const signedOutScope = new AsyncLocalStorage<true>()

export function runAsSignedOutVisitor<T>(fn: () => Promise<T>): Promise<T> {
  return signedOutScope.run(true, fn)
}

export async function createClient() {
  // an empty cookie jar: same client, signed out
  const cookieStore = signedOutScope.getStore()
    ? { getAll: () => [], set: () => {} }
    : await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesList) => {
          // Server Components can READ cookies but not WRITE them — only
          // Server Actions and Route Handlers can. Supabase tries to refresh
          // the session cookie on every call, which throws in a page render.
          // Swallowing it is the documented pattern: proxy.ts (Next 16's
          // renamed middleware) handles the actual refresh, so nothing is
          // lost here.
          try {
            cookiesList.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            /* called from a Server Component — safe to ignore */
          }
        },
      },
    }
  )
}

// The signed-in user's id, or null for a signed-out visitor — checked
// locally from the session token (no auth server round trip), once per
// request. Only for choosing between a live read and a copy shared by
// signed-out visitors; anything that acts as the user re-checks it.
export const getViewerId = cache(async (): Promise<string | null> => {
  const sb = await createClient()
  const { data } = await sb.auth.getClaims()
  return data?.claims?.sub ?? null
})

// Server-side pages often fetch several things that each independently
// need "who's logged in" (e.g. LeaguePage's browseSquads() + myMemberships()
// both called auth.getUser() on their own client, two redundant network
// round-trips for one page render). React's cache() memoizes this per
// request — same dedup idea as the client-side authCache.ts, but scoped
// to a single server render instead of a browser session.
export const getUser = cache(async () => {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  return user
})
