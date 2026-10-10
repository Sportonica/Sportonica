-- ── append several corrections as one ───────────────────────────
-- A fix that touches many balls (the wrong player picked, the wrong
-- bowler for an over, a wicket taken away with the batter who came in
-- for it) is stored in one transaction: every correction event and the
-- snapshot they produce, or nothing. Each event replaces one event
-- (replaces_event_id) or reverses one (voids_event_id). Same rules as
-- si_append_event: permission, lock, idempotency (on the first event's
-- client_id), ordering, and a reason on every replacement.
-- Run any time. Safe to re-run.

create or replace function public.si_append_events(
  p_contest_id uuid, p_expected_seq int, p_events jsonb,
  p_status text, p_state jsonb, p_summary jsonb, p_lines jsonb, p_mirror jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_c public.si_contests;
  v_e jsonb;
  v_seq int;
  v_first uuid;
  v_target uuid;
  v_replaces uuid;
  v_voids uuid;
begin
  select * into v_c from public.si_contests where id = p_contest_id for update;
  if not found then raise exception 'CONTEST_NOT_FOUND'; end if;
  if not public.si_can_score(v_c.tournament_id) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then raise exception 'NOTHING_TO_SAVE'; end if;

  v_first := nullif(p_events->0->>'client_id', '')::uuid;
  if v_first is null then raise exception 'CLIENT_ID_REQUIRED'; end if;
  if exists (select 1 from public.si_events where contest_id = p_contest_id and client_id = v_first) then
    return jsonb_build_object('duplicate', true, 'contest', to_jsonb(v_c));
  end if;

  if p_expected_seq is distinct from v_c.last_seq then raise exception 'SEQ_CONFLICT'; end if;

  v_seq := v_c.last_seq;
  for v_e in select * from jsonb_array_elements(p_events) loop
    v_replaces := nullif(v_e->>'replaces_event_id', '')::uuid;
    v_voids := nullif(v_e->>'voids_event_id', '')::uuid;
    if (v_replaces is null) = (v_voids is null) then raise exception 'EVENT_NOT_FOUND'; end if;
    v_target := coalesce(v_replaces, v_voids);
    if length(trim(coalesce(v_e->>'reason', ''))) = 0 then raise exception 'REASON_REQUIRED'; end if;
    if not exists (select 1 from public.si_events where id = v_target and contest_id = p_contest_id) then
      raise exception 'EVENT_NOT_FOUND';
    end if;
    if nullif(v_e->>'client_id', '') is null then raise exception 'CLIENT_ID_REQUIRED'; end if;
    v_seq := v_seq + 1;
    insert into public.si_events (contest_id, seq, type, payload, occurred_at, recorded_by, client_id, replaces_event_id, voids_event_id, reason)
    values (p_contest_id, v_seq, v_e->>'type', coalesce(v_e->'payload', '{}'::jsonb),
            coalesce((v_e->>'occurred_at')::timestamptz, now()), auth.uid(), (v_e->>'client_id')::uuid,
            v_replaces, v_voids, trim(v_e->>'reason'));
  end loop;

  v_c := public.si_write_snapshot(v_c, p_status, p_state, p_summary, p_lines, p_mirror, v_seq);
  return jsonb_build_object('duplicate', false, 'contest', to_jsonb(v_c));
end;
$$;
revoke all on function public.si_append_events(uuid, int, jsonb, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.si_append_events(uuid, int, jsonb, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
