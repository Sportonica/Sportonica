-- ────────────────────────────────────────────────────────────────
-- Public player card for a goals sport (futsal, football): one roster
-- player's figures in one tournament, match by match.
--
-- Most tournament players are walk-ins with no account, so the card is
-- keyed by the roster row (tournament_team_players.id), not a profile.
-- Readable by anyone who can see the tournament, like
-- get_tournament_player_stats. Only the name, team, jersey number and
-- match figures leave the database: never the guest's phone or email.
-- A linked account's username/avatar only when its card is public.
--
-- Apply once in the Supabase SQL editor. Read-only, idempotent.
-- ────────────────────────────────────────────────────────────────

create or replace function public.get_tournament_player_card(p_tournament_id uuid, p_team_player_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'player', jsonb_build_object(
      'id', tp.id,
      'name', coalesce(p.full_name, p.name, p.username, tp.guest_name, 'Player'),
      'jersey_number', tp.jersey_number,
      'position', tp.position,
      'is_captain', tp.role = 'captain',
      'username', case when p.is_public then p.username end,
      'avatar_url', case when p.is_public then p.avatar_url end,
      'team_id', tt.id,
      'team_name', tt.name,
      'team_logo_url', tt.logo_url,
      'group_name', tt.group_name
    ),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'match_id', m.id,
        'starts_at', m.starts_at,
        'stage', m.stage,
        'round_label', m.round_label,
        'status', m.status,
        'opponent', o.name,
        'goals_for', case when m.team_a_id = tt.id then m.score_a else m.score_b end,
        'goals_against', case when m.team_a_id = tt.id then m.score_b else m.score_a end,
        'winner_team_id', m.winner_team_id,
        'goals', s.goals,
        'assists', s.assists,
        'yellow_cards', s.yellow_cards,
        'red_card', s.red_card,
        'is_mom', s.is_mom
      ) order by m.starts_at nulls last, m.round)
      from public.tournament_match_player_stats s
      join public.tournament_matches m on m.id = s.match_id
      left join public.tournament_teams o
        on o.id = case when m.team_a_id = tt.id then m.team_b_id else m.team_a_id end
      where s.team_player_id = tp.id and m.tournament_id = p_tournament_id
    ), '[]'::jsonb)
  )
  from public.tournament_team_players tp
  join public.tournament_teams tt on tt.id = tp.team_id
  left join public.profiles p on p.id = tp.user_id
  where tp.id = p_team_player_id
    and tt.tournament_id = p_tournament_id
    and tt.status = 'confirmed'
    and public.tournament_visible_to_caller(p_tournament_id);
$$;
revoke all on function public.get_tournament_player_card(uuid, uuid) from public;
grant execute on function public.get_tournament_player_card(uuid, uuid) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- Who scored in each match of a tournament (goals sports): every player
-- with a goal, an assist, a card or player of the match, per match. Feeds
-- the scorers under a result on the public Fixtures tab, like the score
-- itself it is readable by anyone who can see the tournament.
-- ────────────────────────────────────────────────────────────────

create or replace function public.get_tournament_match_scorers(p_tournament_id uuid)
returns table(match_id uuid, team_player_id uuid, team_id uuid, player_name text, goals int, assists int, yellow_cards int, red_card boolean, is_mom boolean)
language sql stable security definer set search_path = public as $$
  select s.match_id, tp.id, tp.team_id,
    coalesce(p.full_name, p.name, p.username, tp.guest_name, 'Player')::text,
    s.goals::int, s.assists::int, s.yellow_cards::int, s.red_card, s.is_mom
  from public.tournament_match_player_stats s
  join public.tournament_matches m on m.id = s.match_id
  join public.tournament_team_players tp on tp.id = s.team_player_id
  left join public.profiles p on p.id = tp.user_id
  where m.tournament_id = p_tournament_id
    and (s.goals > 0 or s.assists > 0 or s.yellow_cards > 0 or s.red_card or s.is_mom)
    and public.tournament_visible_to_caller(p_tournament_id)
  order by s.match_id, s.goals desc, 4;
$$;
revoke all on function public.get_tournament_match_scorers(uuid) from public;
grant execute on function public.get_tournament_match_scorers(uuid) to anon, authenticated;
