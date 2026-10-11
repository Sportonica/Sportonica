-- ────────────────────────────────────────────────────────────────
-- Favorite venues: a player can save/unsave a venue from /create and
-- the venue detail page (src/lib/play/favorites.ts). One row per
-- (user, venue) — toggling deletes the row rather than flipping a
-- flag, so "favorited" is just "a row exists", nothing to drift out
-- of sync.
--
-- Apply once in the Supabase SQL editor. Idempotent.
-- ────────────────────────────────────────────────────────────────

create table if not exists public.venue_favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  venue_id   uuid not null references public.venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

alter table public.venue_favorites enable row level security;

drop policy if exists "venue_favorites read own" on public.venue_favorites;
create policy "venue_favorites read own"
  on public.venue_favorites for select
  using (auth.uid() = user_id);

drop policy if exists "venue_favorites insert own" on public.venue_favorites;
create policy "venue_favorites insert own"
  on public.venue_favorites for insert
  with check (auth.uid() = user_id);

drop policy if exists "venue_favorites delete own" on public.venue_favorites;
create policy "venue_favorites delete own"
  on public.venue_favorites for delete
  using (auth.uid() = user_id);
