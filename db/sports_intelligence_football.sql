-- ────────────────────────────────────────────────────────────────
-- Sports Intelligence: allow football (futsal) and tennis contests.
--
-- si_contests.sport is checked against the sports that have a scoring
-- engine. Football (src/lib/intelligence/sports/football.ts, used for
-- tournaments whose sport is Futsal) and tennis now have one. This
-- replaces db/sports_intelligence_tennis.sql: applying either is fine,
-- this one covers both.
--
-- Football's quick score entry (update_live_score, record_match_result,
-- record_match_player_stats) is unchanged; event scoring writes its
-- final result and player stats through those same functions.
--
-- Requires db/sports_intelligence.sql. Apply once in the Supabase SQL
-- editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────

alter table public.si_contests drop constraint if exists si_contests_sport_check;
alter table public.si_contests add constraint si_contests_sport_check
  check (sport in ('basketball','pickleball','cricket','volleyball','badminton','swimming','tennis','football'));
