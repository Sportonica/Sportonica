-- ================================================================
-- PUSH NOTIFICATIONS
-- Safe to run multiple times. Live in prod (app side: PR #48); the
-- webhook below was missing and re-created 2026-10-02, verified with a
-- test insert (/api/push → 200).
--
-- One row per device the native app is installed on. The app writes
-- its own FCM token here after sign-in (PushBridge.tsx); the server
-- (/api/push) reads them with the service role when a notifications
-- row is inserted, and deletes any token FCM reports as dead.
--
-- After running this, add the Database Webhook that fires the push —
-- see the bottom of this file.
-- ================================================================

create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null check (platform in ('android', 'ios')),
  updated_at  timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

drop policy if exists "own push tokens select" on public.push_tokens;
drop policy if exists "own push tokens insert" on public.push_tokens;
drop policy if exists "own push tokens update" on public.push_tokens;
drop policy if exists "own push tokens delete" on public.push_tokens;

create policy "own push tokens select"
  on public.push_tokens for select using (user_id = auth.uid());
create policy "own push tokens insert"
  on public.push_tokens for insert with check (user_id = auth.uid());
create policy "own push tokens delete"
  on public.push_tokens for delete using (user_id = auth.uid());

-- A device changes hands when someone signs out and another account
-- signs in on the same phone: the token stays the same, the owner
-- changes. RLS can't let user B update user A's row, so re-claiming
-- goes through this function instead of a plain upsert.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_platform not in ('android', 'ios') then raise exception 'BAD_PLATFORM'; end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ================================================================
-- Webhook (Supabase Dashboard → Database → Webhooks → Create)
--   Name:    push_on_notification
--   Table:   public.notifications
--   Events:  Insert
--   Type:    HTTP Request, POST
--   URL:     https://www.sportonica.com/api/push
--   Headers: Authorization: Bearer <PUSH_WEBHOOK_SECRET>   (same value as the Vercel env var)
-- ================================================================
