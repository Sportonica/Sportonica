-- ================================================================
-- Views that bypass RLS (security audit — DATABASE_ACCESS, 2026-09-29)
--
-- These views were created in the dashboard (not in the repo) and run
-- as their owner, so RLS on the underlying tables doesn't apply. Two of
-- them showed more than the tables themselves would:
--
--   player_stats / player_sports — game counts, reliability and sports
--     for EVERY profile, including ones marked private (is_public =
--     false). Now: public profiles, yourself, and super admins only.
--
--   squad_poll_results — option labels and vote counts for every
--     squad's polls, which are members-only everywhere else. Now: only
--     for members of that squad (is_squad_member()).
--
-- Same columns, same order — only a filter is added, so nothing that
-- reads them needs to change. auth.uid() inside a view reads the
-- caller's JWT, so the filters apply per request.
--
-- Left as they are (reviewed): event_players (attendee name/avatar,
-- shown on event pages), squads_with_counts, events_full,
-- events_with_counts (public listings plus counts).
--
-- Safe to run now; safe to re-run.
-- ================================================================

create or replace view public.player_stats as
 WITH b AS (
         SELECT bk.user_id,
            bk.sport,
            bk.status,
            e.event_date,
            e.host_id
           FROM (bookings bk
             LEFT JOIN events e ON ((e.id = bk.event_id)))
        )
 SELECT p.id AS user_id,
    count(*) FILTER (WHERE ((b.status = 'confirmed'::text) AND (b.event_date < now()))) AS games_played,
    count(*) FILTER (WHERE (b.status = 'no_show'::text)) AS no_shows,
    count(*) FILTER (WHERE ((b.status = 'confirmed'::text) AND (b.event_date >= now()))) AS upcoming,
    count(*) FILTER (WHERE (b.host_id = p.id)) AS games_hosted,
    count(DISTINCT b.sport) FILTER (WHERE (b.status = 'confirmed'::text)) AS sports_count,
    max(b.event_date) FILTER (WHERE ((b.status = 'confirmed'::text) AND (b.event_date < now()))) AS last_played,
        CASE
            WHEN (count(*) FILTER (WHERE ((b.status = ANY (ARRAY['confirmed'::text, 'no_show'::text])) AND (b.event_date < now()))) = 0) THEN NULL::numeric
            ELSE round(((100.0 * (count(*) FILTER (WHERE ((b.status = 'confirmed'::text) AND (b.event_date < now()))))::numeric) / (NULLIF(count(*) FILTER (WHERE ((b.status = ANY (ARRAY['confirmed'::text, 'no_show'::text])) AND (b.event_date < now()))), 0))::numeric))
        END AS reliability
   FROM (profiles p
     LEFT JOIN b ON ((b.user_id = p.id)))
  WHERE coalesce(p.is_public, true) OR p.id = auth.uid() OR public.is_super_admin()
  GROUP BY p.id;

create or replace view public.player_sports as
 SELECT bk.user_id,
    bk.sport,
    count(*) AS games
   FROM (bookings bk
     LEFT JOIN events e ON ((e.id = bk.event_id)))
  WHERE ((bk.status = 'confirmed'::text) AND (e.event_date < now()))
    AND exists (
      select 1 from public.profiles p
       where p.id = bk.user_id
         and (coalesce(p.is_public, true) or p.id = auth.uid() or public.is_super_admin())
    )
  GROUP BY bk.user_id, bk.sport;

create or replace view public.squad_poll_results as
 SELECT o.poll_id,
    o.id AS option_id,
    o.label,
    o."position",
    count(v.user_id) AS votes
   FROM (squad_poll_options o
     LEFT JOIN squad_poll_votes v ON ((v.option_id = o.id)))
  WHERE exists (
      select 1 from public.squad_polls sp
       where sp.id = o.poll_id and public.is_squad_member(sp.squad_id)
    )
  GROUP BY o.poll_id, o.id, o.label, o."position";

-- ── Verify (run after) ──────────────────────────────────────────
-- select count(*) from public.player_stats;  -- as postgres: all profiles (no JWT → public ones + none private)
-- Anonymous REST read of player_stats for a private profile → 0 rows.
