-- 0030 — remove the delete-and-reinsert from app.request_undo
--
-- 0029 declared `undo_requests` append-only, revoked UPDATE, put a reject
-- trigger on it - and then had `request_undo` DELETE the claim row and
-- re-insert it with the final outcome, because it wanted to record the outcome
-- after deciding it.
--
-- The delete works: the reject trigger covers UPDATE and TRUNCATE, and the
-- function is SECURITY DEFINER. That is exactly what makes it worth removing.
-- A table is append-only or it is not, and "append-only except for the one
-- function that owns it" is the kind of exception that is true when written
-- and quietly false two migrations later. It also means the row's history has
-- a hole in it: the claim that serialised the request is gone, replaced by a
-- different row with the same key.
--
-- The fix is to stop needing it. The outcome is derivable from the action
-- BEFORE the claim is inserted, so the claim can carry its final outcome from
-- the start:
--
--   1. read the action;
--   2. decide the outcome from what was read;
--   3. insert the claim WITH that outcome - this is the serialisation point,
--      and only one caller can pass it;
--   4. the winner applies the change to `undoable_actions`.
--
-- A loser conflicts at step 3, does not act, and is told the action's current
-- status. The window between step 1 and step 3 changes nothing: only the
-- winner acts, and its decision was made from its own read.
--
-- One row, inserted once, never modified. Which is what append-only means.

begin;

create or replace function app.request_undo(
  p_action_id uuid,
  p_requested_by text,
  p_source text default null
)
returns public.undo_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.undoable_actions;
  v_outcome public.undo_status;
begin
  select * into v_action from public.undoable_actions where action_id = p_action_id;
  if not found then
    raise exception 'no undoable action %', p_action_id
      using errcode = 'no_data_found';
  end if;

  -- Decide first, so the claim row can be written once and never touched again.
  if v_action.status = 'not_undoable' then
    v_outcome := 'not_undoable';
  elsif v_action.status = 'undone' then
    v_outcome := 'undone';
  elsif v_action.status = 'expired'
     or (v_action.undo_deadline is not null and v_action.undo_deadline <= app.now_utc()) then
    v_outcome := 'expired';
  else
    v_outcome := 'undone';
  end if;

  -- The serialisation point. Exactly one caller inserts; everyone else
  -- conflicts and does not act.
  insert into public.undo_requests (action_id, requested_by, source, outcome)
  values (p_action_id, p_requested_by, p_source, v_outcome)
  on conflict (action_id) do nothing;

  if not found then
    -- A concurrent duplicate. Report the action's current status rather than
    -- raising: a duplicate undo is normal on a retrying transport, and normal
    -- events must not surface as failures.
    return (select status from public.undoable_actions where action_id = p_action_id);
  end if;

  -- We won the claim, so we are the one that changes the world.
  if v_outcome = 'undone' and v_action.status <> 'undone' then
    update public.undoable_actions
    set status = 'undone', undone_at = app.now_utc()
    where action_id = p_action_id;
  elsif v_outcome = 'expired' and v_action.status <> 'expired' then
    update public.undoable_actions set status = 'expired' where action_id = p_action_id;
  end if;

  return v_outcome;
end;
$$;

comment on function app.request_undo is
  'Idempotent under concurrent duplicate delivery. The undo_requests primary '
  'key is the serialisation point; the claim row is written once with its final '
  'outcome and never modified, so the table is append-only without exception.';

commit;
