-- Stall game scores (e.g. football juggling: most juggles in 1 minute),
-- typed in by a platform admin from /platform/games (src/lib/games).
-- A player may try again: every attempt is a row, and the leaderboard
-- counts each phone's best. RLS on with NO policies: only the server
-- (service role) reads or writes. Safe to run more than once.

create table if not exists public.stall_scores (
  id         uuid primary key default gen_random_uuid(),
  game       text not null check (game ~ '^[a-z0-9-]{2,40}$'),
  full_name  text not null check (char_length(full_name) between 2 and 80),
  phone      text not null check (phone ~ '^[0-9]{10}$'),
  score      integer not null check (score between 0 and 100000),
  note       text check (note is null or char_length(note) <= 120),
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stall_scores_game_created on public.stall_scores (game, created_at desc);
create index if not exists stall_scores_game_best on public.stall_scores (game, phone, score desc, created_at);

alter table public.stall_scores enable row level security;
revoke all on public.stall_scores from anon, authenticated;

-- Each phone's best attempt (since p_since, when given), highest first;
-- a tie goes to whoever got there first. Server only.
create or replace function public.stall_game_board(p_game text, p_since timestamptz, p_limit integer)
returns table (full_name text, score integer, created_at timestamptz)
language sql stable
set search_path = public
as $$
  select b.full_name, b.score, b.created_at
  from (
    select distinct on (s.phone) s.full_name, s.score, s.created_at
    from public.stall_scores s
    where s.game = p_game and (p_since is null or s.created_at >= p_since)
    order by s.phone, s.score desc, s.created_at asc
  ) b
  order by b.score desc, b.created_at asc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.stall_game_board(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.stall_game_board(text, timestamptz, integer) to service_role;
