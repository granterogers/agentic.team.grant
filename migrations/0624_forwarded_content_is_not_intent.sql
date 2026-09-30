/*
  0624 - forwarded content is content, not intent (Run 5, #397).

  A message Grant FORWARDS carries somebody else's words under his name. Run 4 recorded `context.forwarded` at the
  Telegram door and 0622/0623 stopped a forwarded "yes" answering anything. This closes the other door: the work a
  forwarded message starts is NOT "asked for". `app.may_act` treats a job Grant started as prompted, so an ordinary
  level-0..2 action proceeds without asking; for a job whose ROOT turn was forwarded it falls back to the dial, which
  asks. The turn is still answered and the work still done - only the authority to ACT without asking is withheld,
  and an explicit yes, a standing authorization and every recorded No are untouched.

  `app.job_forwarded(job)` reads the root turn's command: origin_command_id is inherited by every child (0619). A job
  from before 0619 has none and reads false - the old behaviour, recorded as skew, never a refusal of old work.

  ROLLBACK: restore app.may_act from 0612's definition (the `v_asked_for` line without `job_forwarded`) and
  drop function app.job_forwarded(uuid). No data is written.
*/
create function app.job_forwarded(p_job uuid) returns boolean
language sql stable security definer set search_path = 'public', 'pg_catalog'
as $fn$
  select coalesce(
    (select coalesce(c.context ->> 'forwarded', 'false') = 'true'
       from public.jobs j join public.inbound_commands c on c.command_id = j.origin_command_id
      where j.job_id = p_job), false)
$fn$;
revoke all on function app.job_forwarded(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.may_act(p_project uuid, p_tool text, p_job uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_tool      record;
  v_autonomy  public.autonomy_level;
  v_verdict   public.policy_verdict;
  v_note      text;
  v_standing  record;
  v_asked_for boolean := false;
  v_by        text;
begin
  select tool, level, enabled, disabled_reason into v_tool
    from public.tool_permissions where tool = p_tool;
  if not found then
    return jsonb_build_object('verdict', 'refuse', 'tool', p_tool,
      'because', format('There is no such capability as %s.', p_tool));
  end if;

  -- A disabled tool is refused before the dial is consulted. The registry is
  -- the authority on what exists; autonomy is only about what may be done
  -- without asking, and it may never re-enable something switched off.
  if not v_tool.enabled then
    return jsonb_build_object('verdict', 'refuse', 'tool', p_tool,
      'action_level', v_tool.level,
      'because', coalesce(nullif(btrim(v_tool.disabled_reason), ''),
                          format('%s is switched off for everyone.', p_tool)));
  end if;

  /*
    Did a PERSON ask for this, or did the office decide to do it?

    The distinction the first draft of this function did not make, and without
    it wiring the policy into the handlers that write outward would have made
    the office noisier -- which is the opposite of #15. If Grant says "put the
    module outline in Notion", asking him whether he would like it in Notion is
    the interruption he wants removed. The asking IS the approval.

    `jobs.requested_by` is `<origin_channel>:<actor>` for anything a person
    started and `duty:<name>` for anything the office started on a schedule, so
    this is a PROPERTY rather than a list of kinds nobody will maintain -- the
    same correction #185's citation check needed.

    No job means unprompted, which is the conservative reading: a caller that
    cannot name the job it is running cannot claim somebody asked for it.
  */
  if p_job is not null then
    select requested_by into v_by from public.jobs where job_id = p_job;
    v_asked_for := v_by is not null and v_by not like 'duty:%' and not app.job_forwarded(p_job);   -- forwarded text is somebody else's words (0624)
  end if;

  v_autonomy := app.autonomy_for(p_project);

  select verdict, note into v_verdict, v_note
    from public.autonomy_policy
   where autonomy = v_autonomy and action_level = v_tool.level;
  if v_verdict is null then
    -- A gap in the matrix is a fault, and a missing configuration must not
    -- read as permission (the same argument `autonomy_for` makes).
    return jsonb_build_object('verdict', 'ask', 'tool', p_tool,
      'action_level', v_tool.level, 'autonomy', v_autonomy::text,
      'because', 'The policy has nothing to say about this, so it asks.');
  end if;

  /*
    A standing authorization upgrades ask to proceed and nothing else.

    Not refuse: `observe` means observe, and a level-3 tool cannot hold one at
    all (the trigger above). The project's own row wins over the global one,
    the same precedence `autonomy_for` uses.
  */
  /*
    Prompted work below level 3 does not stop to ask.

    Level 3 is untouched, here as everywhere: a person asking for something
    consequential is not the same as a person having seen what it will do, and
    `autonomy_policy`'s CHECK means no route through this function can return
    `proceed` for one.

    `refuse` is untouched too. A project set to `observe` and then asked to
    write is a contradiction, and the honest answer is the refusal with its
    reason, so Grant can change the dial rather than have the office quietly
    decide which of his two instructions it preferred.
  */
  if v_verdict = 'ask' and v_asked_for and v_tool.level < 3 then
    return jsonb_build_object(
      'verdict', 'proceed', 'tool', p_tool, 'action_level', v_tool.level,
      'autonomy', v_autonomy::text, 'standing', null, 'asked_for', true,
      'because', 'You asked for this, so it does not stop to ask you again.');
  end if;

  if v_verdict = 'ask' then
    select authorization_id, project_id, reason, granted_at, expires_at
      into v_standing
      from public.standing_authorizations
     where tool = p_tool
       and revoked_at is null
       and (expires_at is null or expires_at > app.now_utc())
       and (project_id is null or project_id = p_project)
     order by (project_id is not null) desc
     limit 1;
    if found then
      return jsonb_build_object(
        'verdict', 'proceed', 'tool', p_tool, 'action_level', v_tool.level,
        'autonomy', v_autonomy::text,
        'standing', jsonb_build_object(
          'id', v_standing.authorization_id,
          'scope', case when v_standing.project_id is null then 'everywhere' else 'this project' end,
          'reason', v_standing.reason,
          'since', v_standing.granted_at,
          'until', v_standing.expires_at),
        'because', format('You said not to ask again about %s: %s', p_tool, v_standing.reason));
    end if;
  end if;

  return jsonb_build_object('verdict', v_verdict::text, 'tool', p_tool,
    'action_level', v_tool.level, 'autonomy', v_autonomy::text,
    'standing', null, 'asked_for', v_asked_for, 'because', v_note);
end;
$function$;
