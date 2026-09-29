-- ================================================================
-- SEC-04: rate-limit counters for auth server actions
--
-- Server actions that talk to Supabase Auth on the visitor's behalf
-- (phone signup via the admin API, phone login, the current-password
-- check on Login & Security) reach Supabase from Vercel's IPs, so
-- Supabase's own per-IP limits can't tell visitors apart — and the
-- admin API skips them entirely. src/lib/security/abuse.ts keeps its
-- own fixed-window counters here instead.
--
-- Keys arrive already hashed ("bucket:<sha256 prefix>"), so no raw IP
-- or phone number is stored. Only the service role can touch any of
-- it. The app fails open if this hasn't been run yet (logs an error,
-- allows the request), so run order vs. deploy doesn't matter.
--
-- Safe to re-run.
-- ================================================================

create table if not exists public.rate_limit_hits (
  key          text primary key,
  window_start timestamptz not null,
  hits         integer not null
);

alter table public.rate_limit_hits enable row level security;
-- No policies: anon/authenticated get nothing. Belt and braces:
revoke all on public.rate_limit_hits from anon, authenticated;

-- Counts one hit for p_key and returns whether it's still within p_max
-- hits in the current p_window_seconds window.
create or replace function public.hit_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into rate_limit_hits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case
      when r.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else r.window_start end,
    hits = case
      when r.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else r.hits + 1 end
  returning hits into v_hits;

  -- Occasional sweep so expired windows don't pile up (no cron needed).
  if random() < 0.01 then
    delete from rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end;
$$;

revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ── Verify (run after) ──────────────────────────────────────────
-- select has_function_privilege('anon', 'public.hit_rate_limit(text,integer,integer)', 'execute');          -- false
-- select has_function_privilege('authenticated', 'public.hit_rate_limit(text,integer,integer)', 'execute'); -- false
-- select has_table_privilege('anon', 'public.rate_limit_hits', 'select');                                   -- false
