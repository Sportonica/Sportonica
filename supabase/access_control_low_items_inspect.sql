-- Read-only. Shows the live definitions needed to finish the last two LOW
-- items (are_blocked, and the public stats functions on draft tournaments),
-- and the policies touched by access_control_low_items.sql. Changes nothing.
select 'function' as kind, p.proname as name, pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('are_blocked', 'are_friends', 'get_tournament_player_stats',
                    'get_tournament_cricket_stats', 'tournament_standings')
union all
select 'policy', tablename || ' / ' || policyname,
       cmd || ' to ' || roles::text
         || ' using (' || coalesce(qual, '') || ')'
         || ' with check (' || coalesce(with_check, '') || ')'
from pg_policies
where schemaname = 'public'
  and (tablename in ('squad_members', 'squad_polls', 'events', 'bookings',
                     'profiles', 'notifications', 'friend_requests')
       or qual ilike '%are_blocked%' or with_check ilike '%are_blocked%')
order by 1, 2;
