-- Quiz entries for /quiz (src/lib/quiz). One row per person per quiz.
-- RLS is on with NO policies: anon and signed-in users can neither read
-- nor write it. Only the server (service role) touches it: startQuiz
-- creates the row (the timer starts), submitQuiz finishes it, the
-- leaderboard and /platform/quiz (super_admin, checked in the action) read.
--
-- Safe to run more than once, and on top of the first version of this
-- file (it adds the timing columns and relaxes score to fill on finish).

create table if not exists public.quiz_entries (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        text not null,
  full_name      text not null check (char_length(full_name) between 2 and 80),
  phone          text not null check (phone ~ '^[0-9]{10}$'),
  answers        jsonb,
  score          integer check (score >= 0),
  max_score      integer not null check (max_score > 0),
  -- only for a perfect score: shown at the stall for the lucky draw
  winner_code    text,
  prize_given_at timestamptz,
  prize_note     text check (prize_note is null or char_length(prize_note) <= 120),
  created_at     timestamptz not null default now(),
  constraint quiz_entries_one_per_phone unique (quiz_id, phone),
  constraint quiz_entries_winner_code_key unique (winner_code)
);

-- the leaderboard's tie-break: when the questions were first sent, and when the answers came back
alter table public.quiz_entries add column if not exists started_at  timestamptz not null default now();
alter table public.quiz_entries add column if not exists finished_at timestamptz;
alter table public.quiz_entries add column if not exists duration_ms integer check (duration_ms is null or duration_ms >= 0);
alter table public.quiz_entries alter column answers drop not null;
alter table public.quiz_entries alter column score drop not null;

create index if not exists quiz_entries_quiz_created on public.quiz_entries (quiz_id, created_at desc);
create index if not exists quiz_entries_board on public.quiz_entries (quiz_id, score desc, duration_ms asc) where finished_at is not null;

alter table public.quiz_entries enable row level security;
revoke all on public.quiz_entries from anon, authenticated;
