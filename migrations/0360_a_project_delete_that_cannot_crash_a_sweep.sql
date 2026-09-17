-- 0360 — project_delete clears the Slack mapping, and never escapes as a raw
-- foreign key error again.
--
-- npm run check:leaks -- --sweep aborted five projects into eleven with
--
--     23503: update or delete on table "projects" violates foreign key
--     constraint "slack_channel_map_project_id_fkey"
--
-- Two separate defects in one crash, and the second is the one that will come
-- back if only the first is fixed.
--
-- ONE: a project that ever had a Slack channel could never be deleted. ADR-0014
-- forces archive then attachments then project, and project_delete does that
-- and clears project_switches (0292) — but 32 foreign keys point at
-- public.projects and only nine of them cascade. slack_channel_map is not one
-- of the nine. A channel MAPPING is configuration, not history: the Slack
-- channel itself belongs to Slack and slack:tidy is what archives it. So the
-- row goes when the project goes.
--
-- TWO, and the general one: every other non-cascading dependent behaves the
-- same way. A raw 23503 out of a SECURITY DEFINER function is a crash rather
-- than a refusal, it names a constraint instead of a reason, and it killed the
-- sweep with six projects still listed. CLAUDE.md already records the cost of a
-- teardown that looks like it worked; this is the other half — a teardown that
-- stops and takes the rest of the run with it.
--
-- The refusals for documents and jobs stay exactly as they were. Those are
-- deliberate: a corpus is not debris (ADR-0013) and a job can never be removed
-- because job_state_transitions is append-only (§6).

create or replace function app.project_delete(p_slug text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_id       uuid;
  v_docs     int;
  v_jobs     int;
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
  exception when foreign_key_violation then
    return jsonb_build_object('error', format(
      '%s cannot be deleted: %s. It has been archived, '
      || 'which keeps it out of the project list. If that reference is history, archiving '
      || 'is the right end state; if it is configuration, project_delete should clear it.',
      p_slug, sqlerrm));
  end;

  return jsonb_build_object('ok', true, 'deleted', p_slug);
end;
$function$;
