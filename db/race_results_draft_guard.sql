-- ================================================================
-- get_race_results: hide draft tournaments (security audit, 2026-10-28)
--
-- The function runs as its owner, so it skips RLS. It returned race
-- times and bib numbers for any tournament id, including drafts that
-- only the organiser and super admins should see. Same columns and
-- order as before; the only change is the tournament_visible_to_caller()
-- guard the other tournament stats functions got on 2026-09-30
-- (supabase/access_control_low_items.sql).
--
-- Safe to run now; safe to re-run.
-- ================================================================
create or replace function public.get_race_results(p_tournament_id uuid)
returns table (
  category_id uuid, category_name text, rank int,
  team_id uuid, runner_name text, bib_number text,
  finish_time interval, status text
)
language sql security definer set search_path = public stable as $$
  with ranked as (
    select
      coalesce(r.category_id, c.id) as cat_key,
      coalesce(c.name, 'Overall') as cat_name,
      r.team_id as t_id, t.name as r_name, r.bib_number as bib, r.finish_time as ftime, r.status as st,
      row_number() over (
        partition by coalesce(r.category_id, c.id)
        order by
          case r.status when 'finished' then 0 when 'dsq' then 1 when 'dnf' then 2 else 3 end,
          r.finish_time asc nulls last
      ) as rnk
    from public.tournament_race_results r
    join public.tournament_teams t on t.id = r.team_id
    left join public.tournament_race_categories c on c.id = r.category_id
    where r.tournament_id = p_tournament_id
      and public.tournament_visible_to_caller(p_tournament_id)
  )
  select cat_key, cat_name, rnk::int, t_id, r_name, bib, ftime, st
  from ranked
  order by cat_name, rnk;
$$;

revoke all on function public.get_race_results(uuid) from public;
grant execute on function public.get_race_results(uuid) to authenticated, anon;
