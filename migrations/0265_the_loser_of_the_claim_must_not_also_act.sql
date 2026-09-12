-- 0265 — the loser of the claim must not also act
--
-- Found on the second press, not by reading.
--
-- 0029/0030's `app.request_undo` is a correct claim: `undo_requests` has the
-- action as its primary key, exactly one caller can insert, and the loser is
-- TOLD what happened rather than being given an error. All of that is right.
--
-- What it does not do is say WHICH caller you were. Winner and loser both get
-- `undone` back, because that is the action's status either way. That is the
-- right answer to the question `request_undo` was asked — *may this be undone,
-- and what became of it* — and 0263 asked it the wrong question. `hq_undo`
-- read `undone` and performed the reversal, so:
--
--     select public.hq_undo(id);   -- reverses, ok: true
--     select public.hq_undo(id);   -- REVERSES AGAIN, ok: true
--
-- The second press re-applied the inverse and reported success. For a task
-- edit that happens to be harmless — restoring the same four values twice
-- lands in the same place — which is exactly what makes it dangerous to leave:
-- it is invisible in the case you test and wrong in the case you do not.
-- `rename_project` enqueues a channel-rename job every time it runs.
--
-- 0029 named all three sources of a duplicate — a Slack retry, a double tap, a
-- job re-attempted after a crash — and built the lock for them. The lock held.
-- The caller ignored which side of it it was on.
--
-- ## The fix
--
-- One function that performs the claim and reports both halves:
--
--     outcome  what became of the action
--     won      whether THIS call was the one that got to act
--
-- `request_undo` keeps its name, its signature and its meaning, now as a thin
-- wrapper — so `verify:undo`'s concurrency property is measuring the same
-- implementation rather than a second copy of it, which is the whole reason
-- not to reimplement the claim inside `hq_undo`.

begin;

/**
 * Claim an action for undoing, and say whether this caller got it.
 *
 * `won` is false for every duplicate — a retry, a double tap, a re-attempted
 * job — and that caller must not act. It is not an error and must never be
 * reported as one: a duplicate undo is normal on a retrying transport.
 */
create or replace function app.claim_undo(
  p_action_id uuid,
  p_requested_by text,
  p_source text default null,
  out outcome public.undo_status,
  out won boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.undoable_actions;
begin
  select * into v_action from public.undoable_actions where action_id = p_action_id;
  if not found then
    raise exception 'no undoable action %', p_action_id
      using errcode = 'no_data_found';
  end if;

  -- Decide first, so the claim row can be written once and never touched again
  -- (0030: the table is append-only without exception).
  if v_action.status = 'not_undoable' then
    outcome := 'not_undoable';
  elsif v_action.status = 'undone' then
    outcome := 'undone';
  elsif v_action.status = 'expired'
     or (v_action.undo_deadline is not null and v_action.undo_deadline <= app.now_utc()) then
    outcome := 'expired';
  else
    outcome := 'undone';
  end if;

  -- The serialisation point. Exactly one caller inserts.
  insert into public.undo_requests (action_id, requested_by, source, outcome)
  values (p_action_id, p_requested_by, p_source, outcome)
  on conflict (action_id) do nothing;

  if not found then
    -- A duplicate. Report the action's current status and, crucially, that
    -- this caller is not the one that acts.
    won := false;
    outcome := (select status from public.undoable_actions where action_id = p_action_id);
    return;
  end if;

  won := true;

  -- We won the claim, so we are the one that changes the world.
  if outcome = 'undone' and v_action.status <> 'undone' then
    update public.undoable_actions
    set status = 'undone', undone_at = app.now_utc()
    where action_id = p_action_id;
  elsif outcome = 'expired' and v_action.status <> 'expired' then
    update public.undoable_actions set status = 'expired' where action_id = p_action_id;
  end if;
end;
$$;

comment on function app.claim_undo is
  'The claim, with the half `request_undo` cannot express: `won` says whether '
  'THIS caller is the one that may perform the reversal. Every duplicate gets '
  'false, and false is not an error.';

/**
 * Request an undo. Unchanged in name, signature and meaning.
 *
 * Now one line over `claim_undo`, so there is a single implementation of the
 * claim rather than two that can drift.
 */
create or replace function app.request_undo(
  p_action_id uuid,
  p_requested_by text,
  p_source text default null
)
returns public.undo_status
language sql
security definer
set search_path = ''
as $$ select outcome from app.claim_undo(p_action_id, p_requested_by, p_source) $$;

comment on function app.request_undo is
  'Idempotent under concurrent duplicate delivery. A thin wrapper over '
  'app.claim_undo; a caller that PERFORMS a reversal must use claim_undo and '
  'honour `won`, because this answers what became of the action and not who '
  'got to act on it.';

-- ---------------------------------------------------------------------------
-- And the caller that has to know
-- ---------------------------------------------------------------------------

create or replace function app.hq_undo(p_action_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id       uuid;
  v_action   public.undoable_actions;
  v_outcome  public.undo_status;
  v_won      boolean;
  v_args     jsonb;
  v_did      jsonb;
begin
  begin
    v_id := p_action_id::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not an action id');
  end;

  select * into v_action from public.undoable_actions where action_id = v_id;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to undo');
  end if;

  select outcome, won into v_outcome, v_won
    from app.claim_undo(v_id, 'grant', 'studio');

  /*
    Two separate reasons not to act, and they need different words.

    A LOSER (`won` false) is a duplicate: the same action really was undone,
    just not by this press, so the honest answer is that it is already done —
    with ok true, because from the person's point of view the thing they asked
    for is the case.

    A non-`undone` outcome is a lapsed or impossible offer, which is ok false.
  */
  if not v_won then
    return jsonb_build_object('ok', v_outcome = 'undone', 'outcome', v_outcome,
      'duplicate', true,
      'note', case v_outcome
        when 'undone'       then format('Already undone — %s', v_action.description)
        when 'expired'      then 'That offer has lapsed.'
        when 'not_undoable' then 'That one cannot be undone.'
        else 'Nothing to do.' end);
  end if;

  if v_outcome <> 'undone' then
    -- Not a failure. A lapsed offer and an impossible one are both normal, and
    -- both need words the page can show without alarm.
    return jsonb_build_object('ok', false, 'outcome', v_outcome,
      'note', case v_outcome
        when 'expired'      then 'That offer has lapsed.'
        when 'not_undoable' then 'That one cannot be undone.'
        else 'Nothing to do.' end);
  end if;

  /*
    From here on we are performing the reversal, and nothing it calls may
    record an undo of its own. Transaction-local, so it lifts by itself.
  */
  perform set_config('app.undoing', '1', true);

  v_args := v_action.reversal -> 'args';
  case v_action.reversal ->> 'action'
    when 'rename_project' then
      v_did := app.hq_rename_project(v_args ->> 'p_slug', v_args ->> 'p_name');
    when 'task_state' then
      v_did := app.hq_task_state(v_args ->> 'p_task_id', v_args ->> 'p_state',
                                 v_args ->> 'p_reason');
    when 'task_update' then
      v_did := app.hq_task_update(
        v_args ->> 'p_task_id', v_args ->> 'p_title', v_args ->> 'p_detail',
        (v_args ->> 'p_due_on')::date, (v_args ->> 'p_starts_on')::date,
        v_args ->> 'p_assignee', v_args ->> 'p_parent',
        (v_args ->> 'p_milestone')::boolean, (v_args ->> 'p_priority')::int,
        coalesce(
          (select array_agg(x #>> '{}') from jsonb_array_elements(v_args -> 'p_clear') x),
          array[]::text[]));
    when 'project_look' then
      v_did := app.hq_project_look(
        v_args ->> 'p_slug', v_args ->> 'p_icon', v_args ->> 'p_hue', null,
        coalesce(
          (select array_agg(x #>> '{}') from jsonb_array_elements(v_args -> 'p_clear') x),
          array[]::text[]));
    when 'dashboard_layout_set' then
      v_did := app.hq_dashboard_layout_set(v_args ->> 'p_slug', v_args -> 'p_panels');
    when 'dashboard_layout_reset' then
      v_did := app.hq_dashboard_layout_reset(v_args ->> 'p_slug');
    when 'reattach' then
      v_did := app.hq_reattach((v_args ->> 'p_attachment_id')::uuid, v_args ->> 'p_reason');
    else
      -- A reversal naming something this function cannot perform is a bug in
      -- whoever recorded it, and raising rolls back the claim so the offer is
      -- not silently consumed.
      raise exception 'no way to perform the reversal %', v_action.reversal ->> 'action'
        using errcode = 'feature_not_supported';
  end case;

  /*
    The inner RPCs answer a refusal as `{"error": ...}` rather than raising.
    Left alone, that would leave the action marked undone with nothing
    reversed — the worst outcome available, because the interface would say it
    worked. Raise, so the claim rolls back with it and the offer survives.
  */
  if v_did ? 'error' then
    raise exception 'could not undo: %', v_did ->> 'error'
      using errcode = 'raise_exception';
  end if;

  return jsonb_build_object('ok', true, 'outcome', 'undone',
    'kind', v_action.kind, 'note', format('Undone — %s', v_action.description));
end;
$$;

commit;
