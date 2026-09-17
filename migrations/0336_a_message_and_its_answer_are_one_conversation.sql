begin;

/**
 * A message and the answer to it belong to the same conversation.
 *
 * Issue #192. A defect introduced by 0335 and caught before it could bite.
 *
 * 0335 gave inbound_commands a project_id, defaulting to the reserved Unnamed
 * project (0334) so a message can never be lost to an unresolvable project.
 * app.enqueue_inbound chooses the JOB's project by a completely separate route
 * - the asset's project from context, else the most recently updated active
 * project - and knew nothing about the new column.
 *
 * So the two could disagree, and the way they disagree is the worst available:
 * conversation_history reads Grant's side from the command's project and the
 * office's side through the job's, so one exchange would split across two
 * conversations. His question in one place, the answer in another, neither
 * obviously wrong on its own.
 *
 * That is CLAUDE.md's own trap twice over - "both halves correct alone, only
 * their disagreement wrong", and the rule that when you add a fact you grep for
 * the function that already decides the same thing.
 *
 * ## Which way to reconcile, and the measurement that decided it
 *
 *     commands whose context named a project:    1
 *     commands that fell back to the heuristic: 193
 *
 * The fallback is not an edge case; it is essentially the only path. So the
 * command is reconciled TO the job, leaving routing exactly as it was.
 *
 * The alternative - sending every unattributed message to Unnamed, which a
 * quick reading of ADR-0024 might suggest - would have moved substantially all
 * of Grant's Telegram traffic out of the project he is working on. He was
 * answering where a CONVERSATION groups, not asking for work to be re-routed.
 * Unnamed keeps what it was built for: the 57 commands that never became a job,
 * and conversation that genuinely belongs to no project.
 *
 * Replaced by DROP then CREATE rather than CREATE OR REPLACE. The signature is
 * unchanged so a replace would have worked, but the drop is explicit and cheap
 * and 0294's overload trap is the more expensive mistake to make twice.
 */

drop function if exists app.enqueue_inbound(uuid);

CREATE OR REPLACE FUNCTION app.enqueue_inbound(p_command_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  c record;
  v_project uuid;
  v_job uuid;
begin
  select * into c from public.inbound_commands where command_id = p_command_id;
  if not found then
    return jsonb_build_object('error', 'no such command');
  end if;
  if c.job_id is not null then
    -- Already turned into work. Idempotent because a webhook is at-least-once
    -- and the same instruction arriving twice must not be done twice.
    return jsonb_build_object('job_id', c.job_id, 'already', true);
  end if;
  -- 0075: a recording is an instruction whose words have not been read yet.
  if coalesce(trim(c.instruction), '') = '' and c.voice_file_id is null then
    return jsonb_build_object('error', 'nothing to do: the command carries no instruction');
  end if;

  /*
    The asset's project when the command names one (#27, 0313).

    The fallback below — most recently updated — is right for a message that
    arrives out of nowhere and wrong for a button pressed on a document that
    plainly belongs somewhere. Validated against `projects` rather than
    trusted: the context is written by a caller, and a project id that does not
    resolve should fall back rather than file the job nowhere.
  */
  select p.project_id into v_project
    from public.projects p
   where p.project_id = nullif(c.context->>'project_id', '')::uuid;

  if v_project is null then
    select project_id into v_project
      from public.projects where status = 'active'
     order by updated_at desc
     limit 1;
  end if;

  if v_project is null then
    return jsonb_build_object('error', 'no active project to attach this to');
  end if;

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (gen_random_uuid(), v_project,
          format('inbound-%s', p_command_id),
          'office.instruction',
          format('%s:%s', c.origin_channel, coalesce(c.subject, c.actor)),
          -- 10, not 150. See the header: lower is sooner, and at 150 every
          -- routine duty in the building was claimed ahead of a message Grant
          -- was waiting on.
          10,
          jsonb_build_object(
            'instruction', c.instruction,
            'addressed_to', c.addressed_to,
            'origin_channel', c.origin_channel,
            'origin_ref', c.origin_ref,
            'command_id', p_command_id,
            'voice_file_id', c.voice_file_id,
            'voice_seconds', c.voice_seconds,
            -- The asset and the action, as facts (#27).
            'context', c.context
          ))
  returning job_id into v_job;

  /*
    0336. The command's project is set to whatever the job resolved to.

    Added because #192 gave inbound_commands a project of its own and this
    function chooses the job's project independently - so the two could
    disagree and split one exchange across two conversations: Grant's message
    under the column's default, the office's answer under the job's project.

    Measured before changing anything: 193 of 194 enqueued commands reach the
    "most recently updated active project" fallback above, and exactly one has
    ever named a project in its context. So the heuristic is not an edge case,
    it is the path - which is why this reconciles the command TO the job rather
    than the other way round. Where work is ROUTED is a different decision from
    where a conversation GROUPS, and ADR-0024 was the latter.
  */
  update public.inbound_commands
     set job_id = v_job, processed_at = app.now_utc(), project_id = v_project
   where command_id = p_command_id;

  return jsonb_build_object('job_id', v_job, 'already', false, 'spoken', c.voice_file_id is not null);
end;
$function$
;

commit;
