/*
  0629 - three original-audit findings that Runs 1-5 never touched (Final audit reconciliation).

  B11. `app.may_act` called a job "asked for" whenever its requester was not `duty:%`, so a `trigger:` or `mcp:` job
  (or any office-made root) was treated as a person asking and a level 0-2 action proceeded without a question. "Asked
  for" now requires the job's ORIGIN to be a person's: trusted (his words through a production door), or a harness
  standing in for him. Internal and unknown origins ask, exactly as a duty already did - except a registered, write-scoped MCP client, whose
  tool call is a person's (review of the candidate: MCP push_document would otherwise have become a dead end). Level 3, the outside-audience
  floor, a recorded No and a standing authorization are untouched.

  B14. `app.harness_job` and `app.job_origin` recurse through `parent_job_id`, and nothing stopped a row being
  re-parented into a cycle (an owner-level UPDATE), which overflowed the stack for real work. A job's parent is written
  once: a BEFORE UPDATE trigger refuses a change. No product code updates it.

  #343. `app.project_delete` clears the project's autonomy dial (configuration of that
  project) so a suite's project can be removed; the foreign key is NO ACTION.

  ROLLBACK: docs/final-audit/rollback-0629.sql.
*/
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
    -- Asked for by a PERSON: his own words through a production door (trusted), or a harness standing in for him.
    -- `trigger:`, `mcp:`, `hq` and every other office-made root is 'internal' and is not somebody asking (B11 of the
    -- original audit); an unknown origin gains no authority; forwarded text is somebody else's words (0624).
    v_asked_for := v_by is not null and v_by not like 'duty:%' and not app.job_forwarded(p_job)
                   and (app.job_origin(p_job) in ('trusted', 'harness')
                        -- A write-scoped MCP client the office issued a credential to IS a person's tool asking (it
                        -- pushes a document because somebody told it to): app.internal_root_ok has already checked the
                        -- client is enabled and holds write, which is what makes this root 'internal'. The other
                        -- internal roots (trigger:, hq, duty:, system) are the office deciding and still ask.
                        or (v_by like 'mcp:%' and app.job_origin(p_job) = 'internal'));
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

CREATE OR REPLACE FUNCTION app.project_delete(p_slug text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_id       uuid;
  v_docs     int;
  v_jobs     int;
  v_decs     int;
  v_reserved text;
begin
  select project_id, reserved_reason into v_id, v_reserved
    from public.projects where slug = p_slug;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L', p_slug));
  end if;

  -- ADR-0024. Not force-able: p_force exists to override a judgement about
  -- debris, and this is not a judgement.
  if v_reserved is not null then
    return jsonb_build_object('error', format(
      '%s is reserved and cannot be deleted. %s', p_slug, v_reserved));
  end if;

  select count(*) into v_docs from public.documents where project_id = v_id;
  select count(*) into v_jobs from public.jobs where project_id = v_id;
  select count(*) into v_decs from public.decisions where project_id = v_id;

  /*
    Documents are the thing that took work. ADR-0013 is explicit that closing a
    route never loses the corpus, and a project holding one is not debris.
  */
  if v_docs > 0 then
    return jsonb_build_object('error', format(
      '%s holds %s document(s). Archive it instead — a project with a corpus is not debris, '
      || 'and ADR-0013 says a route may be closed and the corpus is kept.', p_slug, v_docs));
  end if;

  /*
    And jobs cannot be removed at all: `job_state_transitions` is append-only by
    §6 and has a foreign key to `jobs`, so a job can only ever be cancelled. A
    project that was worked on is history, and history is archived rather than
    deleted.
  */
  if v_jobs > 0 then
    return jsonb_build_object('error', format(
      '%s has %s job(s) against it and a job can never be deleted — '
      || 'job_state_transitions is append-only. Archive it; the row stays out of your '
      || 'project list and its history stays readable.', p_slug, v_jobs));
  end if;

  /*
    0509. A decision is history the same way a job is, and the foreign key that
    was supposed to let go of it cannot.

    `decisions.project_id` is ON DELETE SET NULL, and `public.decisions` is
    append-only by master spec section 6 -- three triggers refusing UPDATE,
    DELETE and TRUNCATE. So the cascade's own UPDATE is refused, by the
    ledger, with 42501, four frames inside `delete from public.projects`. Not a
    foreign key violation, so 0360's handler below never saw it, and the caller
    got a raw Postgres stack rather than a sentence.

    Seventeen projects hold a decision. Every one of them has been permanently
    undeletable since the ledger triggers existed, and would have taken a sweep
    down with it the way the Slack mapping did before 0360.

    Refused rather than repaired, deliberately. The fix is not to let the
    cascade through: a recorded decision about a project is exactly the kind of
    history ADR-0022 says is archived and never deleted, which is the same
    argument the job branch above makes in the same words.
  */
  if v_decs > 0 then
    return jsonb_build_object('error', format(
      '%s has %s recorded decision(s) against it, and public.decisions is append-only '
      || '(master spec section 6) -- the foreign key would clear the reference with an UPDATE '
      || 'and the ledger refuses one. Archive it; the row stays out of your project list and '
      || 'the reasoning stays readable.', p_slug, v_decs));
  end if;

  -- Archive first. ADR-0014's trigger fires on the attachment delete and
  -- refuses an active project with no enabled attachment.
  update public.projects set status = 'archived' where project_id = v_id;
  delete from public.project_attachments where project_id = v_id;

  /*
    0292. The switch log, which is debris once its subject is gone. Not a breach
    of append-only: that trigger guards UPDATE, so the log cannot be REWRITTEN.
  */
  delete from public.project_switches where project_id = v_id;

  /*
    0360. The channel mapping, for the same reason as the switch log: it is a
    pointer to this project and means nothing without it. Deleting the row does
    not touch the Slack channel — slack:tidy archives those, and it must, because
    Slack refuses to rename or delete an archived channel.
  */
  delete from public.slack_channel_map where project_id = v_id;

  /*
    #343. The project's autonomy dial is configuration of THIS project and means nothing without it. The foreign key
    is NO ACTION, so a project whose dial had ever been set could never be deleted - verify:autonomy left a stranded
    row each run and only a witness (check:leaks) noticed.
  */
  delete from public.autonomy_settings where project_id = v_id;

  /*
    Aliases are NOT deleted here, and that is the original behaviour preserved
    deliberately: `project_aliases` cascades on the project's foreign key, and
    0282's trigger scopes its uniqueness to ACTIVE projects so a departing
    project releases its phrases anyway. Adding a delete here would have been
    an unverified behaviour change smuggled in by a function replacement.
  */

  /*
    0360. Anything still pointing at this project is history somebody kept on
    purpose, and the caller gets a sentence rather than a stack trace. Naming
    the constraint is enough to find the table without guessing, and returning
    instead of raising is what lets a sweep of eleven projects finish the other
    ten.
  */
  begin
    delete from public.projects where project_id = v_id;
  /*
    0509. `insufficient_privilege` as well, because an append-only ledger
    refuses a cascade with 42501 and not with 23503.

    The pre-check above names `decisions` specifically and gives a sentence
    worth reading. This is the net under it: the next table that gains a
    section 6 trigger and a SET NULL foreign key to projects will fail here
    the same way, and 0360's whole argument -- a sweep of eleven finishes the
    other ten, and the caller gets words rather than a stack -- applies to
    either error class.
  */
  exception when foreign_key_violation or insufficient_privilege then
    return jsonb_build_object('error', format(
      '%s cannot be deleted: %s. It has been archived, '
      || 'which keeps it out of the project list. If that reference is history, archiving '
      || 'is the right end state; if it is configuration, project_delete should clear it.',
      p_slug, sqlerrm));
  end;

  return jsonb_build_object('ok', true, 'deleted', p_slug);
end;
$function$;

create or replace function app.jobs_parent_is_written_once()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  if new.parent_job_id is distinct from old.parent_job_id then
    raise exception 'job %: a job''s parent is written once (a re-parented job can become its own ancestor)', old.job_id
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;
drop trigger if exists jobs_parent_once on public.jobs;
create trigger jobs_parent_once before update of parent_job_id on public.jobs
  for each row execute function app.jobs_parent_is_written_once();
revoke all on function app.jobs_parent_is_written_once() from public, anon, authenticated;
