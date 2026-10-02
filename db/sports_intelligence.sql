-- ────────────────────────────────────────────────────────────────
-- Sports Intelligence: event-based scoring for basketball,
-- pickleball, cricket, volleyball, badminton, swimming and tennis.
-- (An existing database adds tennis with sports_intelligence_tennis.sql.)
--
-- Three tables and four functions. The source of truth is the
-- append-only event log (si_events). si_contests.state is a cache of
-- what replaying that log produces; si_stat_lines holds raw counters
-- for finished contests so career statistics never read the log.
--
-- Rule validity is decided by the TypeScript engines
-- (src/lib/intelligence) before an event reaches si_append_event().
-- The database enforces what it can on its own: who may score,
-- ordering, idempotency and that history is never rewritten.
--
-- Football is untouched: update_live_score(), record_match_result()
-- and the player-stats tables keep working exactly as before.
--
-- Plan: docs/sports-intelligence/03-database-plan.md
-- Apply once in the Supabase SQL editor. Idempotent.
-- ────────────────────────────────────────────────────────────────

-- ── competition.rules ───────────────────────────────────────────
alter table public.tournaments
  add column if not exists scoring_rules jsonb not null default '{}'::jsonb;

-- ── contests ────────────────────────────────────────────────────
create table if not exists public.si_contests (
  id               uuid primary key default gen_random_uuid(),
  tournament_id    uuid not null references public.tournaments(id) on delete cascade,
  -- set for a match between two sides; null for a swimming race
  match_id         uuid references public.tournament_matches(id) on delete cascade,
  race_category_id uuid,
  sport            text not null check (sport in ('basketball','pickleball','cricket','volleyball','badminton','swimming','tennis')),
  label            text,
  rules            jsonb not null default '{}'::jsonb,
  context          jsonb not null default '{}'::jsonb,
  status           text not null default 'scheduled' check (status in
                     ('scheduled','live','paused','completed','abandoned','postponed','cancelled')),
  state            jsonb not null default '{}'::jsonb,
  summary          jsonb not null default '{}'::jsonb,
  last_seq         int not null default 0 check (last_seq >= 0),
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((sport = 'swimming') = (match_id is null))
);

create unique index if not exists si_contests_one_per_match on public.si_contests(match_id) where match_id is not null;
create index if not exists idx_si_contests_tournament on public.si_contests(tournament_id, status);
create index if not exists idx_si_contests_live on public.si_contests(sport, status, updated_at desc);

drop trigger if exists si_contests_touch on public.si_contests;
create trigger si_contests_touch before update on public.si_contests
  for each row execute function public.set_updated_at();

-- A swimming race may be grouped under a race category. That table
-- comes from the running feature; link to it only if it is there.
do $$
begin
  if to_regclass('public.tournament_race_categories') is not null
     and not exists (select 1 from pg_constraint where conname = 'si_contests_race_category_fk') then
    alter table public.si_contests
      add constraint si_contests_race_category_fk
      foreign key (race_category_id) references public.tournament_race_categories(id) on delete set null;
  end if;
end $$;

-- ── events: append only ─────────────────────────────────────────
create table if not exists public.si_events (
  id                uuid primary key default gen_random_uuid(),
  contest_id        uuid not null references public.si_contests(id) on delete cascade,
  -- per-contest counter assigned inside si_append_event(): the replay order
  seq               int not null check (seq > 0),
  type              text not null check (length(type) between 1 and 40),
  payload           jsonb not null default '{}'::jsonb,
  occurred_at       timestamptz not null default now(),
  recorded_at       timestamptz not null default now(),
  recorded_by       uuid references auth.users(id),
  -- idempotency key from the scorer's device
  client_id         uuid not null,
  -- a correction names the event it reverses or replaces, and why
  voids_event_id    uuid references public.si_events(id),
  replaces_event_id uuid references public.si_events(id),
  reason            text,
  unique (contest_id, seq),
  unique (contest_id, client_id),
  check (voids_event_id is null or replaces_event_id is null),
  check ((voids_event_id is null and replaces_event_id is null) or length(trim(coalesce(reason, ''))) > 0)
);

create index if not exists idx_si_events_voids on public.si_events(voids_event_id) where voids_event_id is not null;
create index if not exists idx_si_events_replaces on public.si_events(replaces_event_id) where replaces_event_id is not null;

-- History is never rewritten. A mistake is fixed by appending a
-- correction event. The only delete allowed is the cascade when the
-- whole contest (or its tournament) is removed.
create or replace function public.si_events_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'SI_EVENTS_IMMUTABLE';
end;
$$;

drop trigger if exists si_events_no_update on public.si_events;
create trigger si_events_no_update before update or delete on public.si_events
  for each row execute function public.si_events_immutable();

-- ── raw stat lines (finished contests only) ─────────────────────
create table if not exists public.si_stat_lines (
  contest_id     uuid not null references public.si_contests(id) on delete cascade,
  subject        text not null check (subject in ('player','team')),
  subject_key    text not null,
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  sport          text not null,
  team_id        uuid references public.tournament_teams(id) on delete set null,
  team_player_id uuid references public.tournament_team_players(id) on delete set null,
  user_id        uuid,
  -- swimming: distance-stroke-course, the unit times are comparable within
  event_key      text,
  -- counters only: never a percentage or an average
  raw            jsonb not null default '{}'::jsonb,
  played_at      timestamptz not null default now(),
  primary key (contest_id, subject, subject_key)
);

create index if not exists idx_si_lines_user on public.si_stat_lines(user_id, sport, played_at desc) where user_id is not null;
create index if not exists idx_si_lines_team_player on public.si_stat_lines(team_player_id) where team_player_id is not null;
create index if not exists idx_si_lines_team on public.si_stat_lines(team_id, sport) where team_id is not null;
create index if not exists idx_si_lines_tournament on public.si_stat_lines(tournament_id, sport, subject);
create index if not exists idx_si_lines_event on public.si_stat_lines(sport, event_key, played_at desc) where event_key is not null;

-- ── who may score ───────────────────────────────────────────────
-- The same three checks every other match action uses.
create or replace function public.si_can_score(p_tournament_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_t public.tournaments;
begin
  if auth.uid() is null then return false; end if;
  select * into v_t from public.tournaments where id = p_tournament_id;
  if not found then return false; end if;
  return public.is_tournament_organizer(v_t)
      or public.has_venue_access(v_t.venue_id, 'manager')
      or public.is_super_admin();
end;
$$;
revoke all on function public.si_can_score(uuid) from public;
grant execute on function public.si_can_score(uuid) to anon, authenticated;

-- ── RLS: read like tournament_matches, write only through the RPCs ──
alter table public.si_contests enable row level security;
alter table public.si_events enable row level security;
alter table public.si_stat_lines enable row level security;

drop policy if exists si_contests_read on public.si_contests;
create policy si_contests_read on public.si_contests for select using (
  exists (select 1 from public.tournaments t where t.id = tournament_id and t.status not in ('draft','pending_approval'))
  or public.si_can_score(tournament_id)
);

drop policy if exists si_events_read on public.si_events;
create policy si_events_read on public.si_events for select using (
  exists (
    select 1 from public.si_contests c join public.tournaments t on t.id = c.tournament_id
    where c.id = contest_id and (t.status not in ('draft','pending_approval') or public.si_can_score(c.tournament_id))
  )
);

drop policy if exists si_stat_lines_read on public.si_stat_lines;
create policy si_stat_lines_read on public.si_stat_lines for select using (
  exists (select 1 from public.tournaments t where t.id = tournament_id and t.status not in ('draft','pending_approval'))
  or public.si_can_score(tournament_id)
);

grant select on public.si_contests, public.si_events, public.si_stat_lines to anon, authenticated;

-- ── shared snapshot write ───────────────────────────────────────
-- Saves the cached state, and for a match between two sides keeps the
-- fixture row's live score in step so the home rail, fixtures list and
-- bracket show it with no changes of their own. The FINAL result is
-- not written here: the app calls record_match_result() /
-- record_cricket_result() so winner propagation stays in one place.
create or replace function public.si_write_snapshot(
  p_contest public.si_contests,
  p_status text, p_state jsonb, p_summary jsonb, p_lines jsonb, p_mirror jsonb, p_last_seq int
)
returns public.si_contests
language plpgsql security definer set search_path = public as $$
declare v_c public.si_contests;
begin
  update public.si_contests
    set status = p_status, state = p_state, summary = p_summary, last_seq = p_last_seq,
        started_at = case when started_at is null and p_status in ('live','paused','completed','abandoned') then now() else started_at end,
        completed_at = case when p_status in ('completed','abandoned','cancelled') then coalesce(completed_at, now()) else null end
    where id = p_contest.id returning * into v_c;

  -- Raw counters are kept for finished contests only: a match in
  -- progress must not show up in career statistics.
  delete from public.si_stat_lines where contest_id = v_c.id;
  if p_status = 'completed' and p_lines is not null then
    insert into public.si_stat_lines (contest_id, subject, subject_key, tournament_id, sport, team_id, team_player_id, user_id, event_key, raw, played_at)
    select v_c.id, l->>'subject', l->>'subjectKey', v_c.tournament_id, v_c.sport,
           nullif(l->>'teamId', '')::uuid, nullif(l->>'teamPlayerId', '')::uuid, nullif(l->>'userId', '')::uuid,
           nullif(l->>'eventKey', ''), coalesce(l->'raw', '{}'::jsonb), coalesce(v_c.started_at, now())
    from jsonb_array_elements(p_lines) l
    where l->>'subject' in ('player','team') and coalesce(l->>'subjectKey', '') <> ''
    on conflict (contest_id, subject, subject_key) do update set raw = excluded.raw;
  end if;

  if v_c.match_id is not null and p_mirror is not null and p_status in ('live','paused') then
    update public.tournament_matches
      set status = 'live',
          score_a = (p_mirror->>'scoreA')::int, score_b = (p_mirror->>'scoreB')::int,
          score_a_et = null, score_b_et = null, score_a_pens = null, score_b_pens = null,
          winner_team_id = null
      where id = v_c.match_id and status not in ('completed','walkover','cancelled');
    if p_mirror ? 'cricket' then
      update public.tournament_matches
        set wickets_a = (p_mirror->'cricket'->>'wicketsA')::int, wickets_b = (p_mirror->'cricket'->>'wicketsB')::int,
            overs_a = (p_mirror->'cricket'->>'oversA')::numeric, overs_b = (p_mirror->'cricket'->>'oversB')::numeric,
            target_runs = (p_mirror->'cricket'->>'target')::int
        where id = v_c.match_id and status = 'live';
    end if;
  end if;

  return v_c;
end;
$$;
revoke all on function public.si_write_snapshot(public.si_contests, text, jsonb, jsonb, jsonb, jsonb, int) from public, anon, authenticated;

-- ── open a contest ──────────────────────────────────────────────
create or replace function public.si_open_contest(
  p_tournament_id uuid, p_match_id uuid, p_race_category_id uuid, p_sport text, p_label text,
  p_rules jsonb, p_context jsonb, p_state jsonb, p_summary jsonb
)
returns public.si_contests
language plpgsql security definer set search_path = public as $$
declare
  v_c public.si_contests;
  v_match public.tournament_matches;
begin
  if not public.si_can_score(p_tournament_id) then raise exception 'FORBIDDEN'; end if;

  if p_match_id is not null then
    select * into v_match from public.tournament_matches where id = p_match_id for update;
    if not found or v_match.tournament_id <> p_tournament_id then raise exception 'MATCH_NOT_FOUND'; end if;
    if v_match.team_a_id is null or v_match.team_b_id is null then raise exception 'TEAMS_NOT_SET'; end if;
    -- one contest per fixture: opening twice returns the first
    select * into v_c from public.si_contests where match_id = p_match_id;
    if found then return v_c; end if;
    if v_match.status in ('completed','walkover','cancelled') then raise exception 'MATCH_ALREADY_DONE'; end if;
  end if;

  insert into public.si_contests (tournament_id, match_id, race_category_id, sport, label, rules, context, state, summary, created_by)
  values (p_tournament_id, p_match_id, p_race_category_id, p_sport, nullif(trim(coalesce(p_label, '')), ''),
          coalesce(p_rules, '{}'::jsonb), coalesce(p_context, '{}'::jsonb), coalesce(p_state, '{}'::jsonb), coalesce(p_summary, '{}'::jsonb), auth.uid())
  returning * into v_c;
  return v_c;
end;
$$;
revoke all on function public.si_open_contest(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.si_open_contest(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ── append one event ────────────────────────────────────────────
-- One transaction: permission, lock, idempotency, ordering, the event
-- itself and the snapshot that results from it.
--
--   duplicate = true  -> this client_id was already stored; nothing
--                        changed (double tap, offline retry).
--   SEQ_CONFLICT      -> another scorer got there first; reload.
create or replace function public.si_append_event(
  p_contest_id uuid, p_expected_seq int, p_type text, p_payload jsonb, p_client_id uuid, p_occurred_at timestamptz,
  p_voids_event_id uuid, p_replaces_event_id uuid, p_reason text,
  p_status text, p_state jsonb, p_summary jsonb, p_lines jsonb, p_mirror jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c public.si_contests;
  v_ev public.si_events;
  v_target uuid := coalesce(p_voids_event_id, p_replaces_event_id);
begin
  select * into v_c from public.si_contests where id = p_contest_id for update;
  if not found then raise exception 'CONTEST_NOT_FOUND'; end if;
  if not public.si_can_score(v_c.tournament_id) then raise exception 'FORBIDDEN'; end if;
  if p_client_id is null then raise exception 'CLIENT_ID_REQUIRED'; end if;

  select * into v_ev from public.si_events where contest_id = p_contest_id and client_id = p_client_id;
  if found then
    return jsonb_build_object('duplicate', true, 'event', to_jsonb(v_ev), 'contest', to_jsonb(v_c));
  end if;

  if p_expected_seq is distinct from v_c.last_seq then raise exception 'SEQ_CONFLICT'; end if;

  if v_target is not null then
    if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'REASON_REQUIRED'; end if;
    if not exists (select 1 from public.si_events where id = v_target and contest_id = p_contest_id) then
      raise exception 'EVENT_NOT_FOUND';
    end if;
  end if;

  insert into public.si_events (contest_id, seq, type, payload, occurred_at, recorded_by, client_id, voids_event_id, replaces_event_id, reason)
  values (p_contest_id, v_c.last_seq + 1, p_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_occurred_at, now()), auth.uid(),
          p_client_id, p_voids_event_id, p_replaces_event_id, nullif(trim(coalesce(p_reason, '')), ''))
  returning * into v_ev;

  v_c := public.si_write_snapshot(v_c, p_status, p_state, p_summary, p_lines, p_mirror, v_ev.seq);
  return jsonb_build_object('duplicate', false, 'event', to_jsonb(v_ev), 'contest', to_jsonb(v_c));
end;
$$;
revoke all on function public.si_append_event(uuid, int, text, jsonb, uuid, timestamptz, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.si_append_event(uuid, int, text, jsonb, uuid, timestamptz, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ── re-save the snapshot after a full recalculation ─────────────
-- Used by recalculateContest(): the log is replayed from the start
-- and the cache is overwritten with what it produced.
create or replace function public.si_save_snapshot(
  p_contest_id uuid, p_expected_seq int, p_status text, p_state jsonb, p_summary jsonb, p_lines jsonb, p_mirror jsonb
)
returns public.si_contests
language plpgsql security definer set search_path = public as $$
declare v_c public.si_contests;
begin
  select * into v_c from public.si_contests where id = p_contest_id for update;
  if not found then raise exception 'CONTEST_NOT_FOUND'; end if;
  if not public.si_can_score(v_c.tournament_id) then raise exception 'FORBIDDEN'; end if;
  if p_expected_seq is distinct from v_c.last_seq then raise exception 'SEQ_CONFLICT'; end if;
  return public.si_write_snapshot(v_c, p_status, p_state, p_summary, p_lines, p_mirror, v_c.last_seq);
end;
$$;
revoke all on function public.si_save_snapshot(uuid, int, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.si_save_snapshot(uuid, int, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ── competition.rules: save ─────────────────────────────────────
-- The tournaments UPDATE policy only admits venue managers and super
-- admins, so an organizer's direct update changes nothing and reports
-- no error. Rules are saved through this instead, with the same
-- permission check as scoring. The app validates the rules first.
create or replace function public.si_set_scoring_rules(p_tournament_id uuid, p_rules jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.si_can_score(p_tournament_id) then raise exception 'FORBIDDEN'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then raise exception 'INVALID_RULES'; end if;
  update public.tournaments set scoring_rules = p_rules where id = p_tournament_id;
  if not found then raise exception 'TOURNAMENT_NOT_FOUND'; end if;
  return p_rules;
end;
$$;
revoke all on function public.si_set_scoring_rules(uuid, jsonb) from public, anon;
grant execute on function public.si_set_scoring_rules(uuid, jsonb) to authenticated;

-- ── realtime: the match centre subscribes to one contest row ────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'si_contests'
  ) then
    execute 'alter publication supabase_realtime add table public.si_contests';
  end if;
exception when undefined_object then
  -- no supabase_realtime publication (local database): the match
  -- centre falls back to polling, nothing else depends on it
  null;
end $$;
