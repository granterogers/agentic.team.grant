begin;

-- A specialist's work that fails for good is handed to the Chief of Staff, once (COS-006, COS-019, REG-018, REG-019;
-- Canary incident 15 October 2026: the office asked Grant who should own the follow-ups, rather than reassigning them).
--
-- Before this, a convened specialist's hand-off that exhausted its attempts ended `failed` and nothing reassigned it.
-- The parent's synthesis then answered without it, and nothing said the work was not done.
--
-- What changed, and only this:
--   * app.reassign_failed_specialist(job): for a FAILED `office.instruction` child whose payload names a specialist
--     other than the Chief of Staff, enqueue ONE replacement under the same parent, addressed to the Chief of Staff, with
--     the same instruction. It goes through `app.enqueue_child_once`, so a repeat call finds the replacement and does not
--     add a second. Every other case returns why it did not reassign, so the worker can say so.
--   * The Chief of Staff's own failed work is not reassigned: nobody else is there to take it.
--   * Not a retry of the same specialist, and not a new owner for Grant: the owner is the Chief of Staff (task ownership
--     rule, DEC-012).

create or replace function app.reassign_failed_specialist(p_job uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  j        public.jobs;
  v_from   text;
  v_text   text;
  v_made   jsonb;
begin
  select * into j from public.jobs where job_id = p_job for share;
  if not found then
    return jsonb_build_object('reassigned', false, 'why', 'there is no such job');
  end if;
  if j.state <> 'failed' then
    return jsonb_build_object('reassigned', false, 'why', 'the job did not fail');
  end if;
  if j.kind <> 'office.instruction' or j.parent_job_id is null then
    return jsonb_build_object('reassigned', false, 'why', 'it is not a specialist hand-off');
  end if;
  v_from := j.pinned_config ->> 'addressed_to';
  if coalesce(v_from, '') in ('', 'chief-of-staff') then
    return jsonb_build_object('reassigned', false, 'why', 'the Chief of Staff owns this, and there is nobody else to hand it to');
  end if;
  v_text := coalesce(j.pinned_config ->> 'instruction', j.pinned_config ->> 'request', '');
  v_made := app.enqueue_child_once(
    j.office_id, j.parent_job_id, 'office.instruction',
    'reassigned from ' || v_from || ': ' || left(v_text, 1900),
    j.pinned_config || jsonb_build_object('addressed_to', 'chief-of-staff', 'reassigned_from', v_from),
    false, j.project_id, null, null, null);
  return jsonb_build_object(
    'reassigned', true,
    'from', v_from,
    'to', 'chief-of-staff',
    'job_id', v_made ->> 'job_id',
    'created', coalesce((v_made ->> 'created')::boolean, false));
end
$function$;

commit;
