-- ────────────────────────────────────────────────────────────────
-- Sports Intelligence: allow tennis contests.
--
-- si_contests.sport is checked against the list of sports that have a
-- scoring engine. Tennis now has one (src/lib/intelligence/sports/tennis.ts),
-- so it joins the list. Nothing else changes: tennis uses the same
-- tables, functions and row security as every other sport.
--
-- Requires db/sports_intelligence.sql. Apply once in the Supabase SQL
-- editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────

alter table public.si_contests drop constraint if exists si_contests_sport_check;
alter table public.si_contests add constraint si_contests_sport_check
  check (sport in ('basketball','pickleball','cricket','volleyball','badminton','swimming','tennis'));
