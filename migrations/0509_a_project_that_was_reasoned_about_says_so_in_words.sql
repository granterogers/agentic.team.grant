/*
  A project that has ever been reasoned about could never be deleted, and said
  so with a stack trace.

  `verify:waiting`'s teardown died on

      ERROR: 42501: public.decisions is append-only: UPDATE is never permitted
      CONTEXT: SQL statement "UPDATE ONLY public.decisions SET project_id = NULL
                              WHERE $1 = project_id"
               PL/pgSQL function app.project_delete(text,boolean) line 82

  `decisions.project_id` is ON DELETE SET NULL and `public.decisions` carries
  section 6's three refusals -- UPDATE, DELETE, TRUNCATE. So the cascade tries
  the one statement the ledger will never allow. It is not a foreign key
  violation, so 0360's handler, written for exactly this shape, never saw it.

  Seventeen projects hold a decision today. Every one of them has been
  permanently undeletable since #129 started recording them, and any sweep that
  reached one would have stopped there -- CLAUDE.md on the last instance of
  this: *"a sweep that stops early looks exactly like a sweep that finished."*

  Two changes, and the second is the one that matters next time:

  1. A pre-check that names `decisions`, refusing with a sentence the way the
     documents and jobs branches already do. Refusing is the right answer: a
     recorded decision is history, and ADR-0022 archives history rather than
     deleting it.
  2. The catch widened from `foreign_key_violation` to include
     `insufficient_privilege`, because that is the class an append-only ledger
     raises, and the next table to gain a section 6 trigger and a SET NULL
     reference to projects would otherwise land four frames deep again.

  Spliced from the LIVE definition rather than retyped -- CLAUDE.md records
  `app.pause_job` losing four behaviours in one go to a rewrite from memory.
*/


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

/*
  Drive it. A migration that applies cleanly is not a function that works.
*/
do $drive$
declare
  v_slug text := 'ledger-proof-0509-' || substr(md5(random()::text), 1, 8);
  v_id   uuid;
  v_out  jsonb;
begin
  insert into public.projects (slug, name, status)
  values (v_slug, 'Ledger proof 0509', 'paused')
  returning project_id into v_id;

  insert into public.decisions
    (project_id, question, chose, ruled_out, because, decided_by)
  values (v_id, 'Does project_delete refuse a project holding a decision?',
          'It must say so in a sentence',
          array['raising 42501 four frames deep'],
          'Written by migration 0509 to drive the branch it adds.', 'migration');

  v_out := app.project_delete(v_slug);
  if v_out ? 'ok' then
    raise exception '0509: project_delete DELETED a project holding a decision';
  end if;
  if position('append-only' in coalesce(v_out ->> 'error', '')) = 0 then
    raise exception '0509: refused for the wrong reason: %', v_out ->> 'error';
  end if;
  raise notice '0509 refuses correctly: %', v_out ->> 'error';

  -- Undone, because `public.jobs` and `public.decisions` are both append-only
  -- and this is a probe, not a fixture anybody should have to sweep.
  raise exception 'probe done, undoing';
exception when others then
  if sqlerrm <> 'probe done, undoing' then raise; end if;
end
$drive$;
