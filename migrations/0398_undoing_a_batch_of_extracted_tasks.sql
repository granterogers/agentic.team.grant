begin;

-- ---------------------------------------------------------------------------
-- 0398 - undoing a batch of extracted tasks (#130)
--
-- `office.extract_tasks` reads a document and creates the tasks it finds.
-- Twelve rows appearing at once needs one way to take them back, and #118's
-- undo strip is the answer the office already has.
--
-- `app.hq_undo` performs a reversal by a CLOSED case, and raises
-- feature_not_supported on a verb it does not know - deliberately, with a
-- comment saying that raising rolls back the claim so the offer is not
-- silently consumed. So offering an undo whose action does not exist there
-- would be a control that claims something nothing performs: 0298's defect,
-- and the shape CLAUDE.md records three times over.
--
-- ## Scoped to the job, not to a list of titles
--
-- The first draft of the handler passed the titles it had created. Titles are
-- the wrong key: `app.task_add` normalises them, two documents can legitimately
-- produce the same action, and a title Grant has since edited would be missed
-- while an identical one he wrote himself would be caught.
--
-- `public.tasks.job_id` already records which job added a row. That is exact,
-- needs nothing passed, and cannot over-reach.
--
-- ## And only what he has not touched
--
-- An undo two minutes later should take back what the office did. It must NOT
-- take back what Grant did in between - if he has started one, finished one or
-- edited one, that is his work and deleting it is the destructive action he
-- has said to always check about first.
--
-- So: still `todo`, never edited (`updated_at` unchanged from `created_at`),
-- and nothing depending on it. Anything else is left alone and COUNTED, so the
-- answer says what it could not take back rather than implying it took back
-- everything.
-- ---------------------------------------------------------------------------

create or replace function app.undo_tasks_from_job(p_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_removed int;
  v_kept    int;
begin
  if p_job is null then
    return jsonb_build_object('error', 'there is no job to undo');
  end if;

  select count(*) into v_kept
    from public.tasks t
   where t.job_id = p_job
     and (t.state <> 'todo' or t.updated_at > t.created_at + interval '1 second');

  with gone as (
    delete from public.tasks t
     where t.job_id = p_job
       and t.state = 'todo'
       -- `tasks_touch` sets updated_at on every UPDATE, so this is how a row
       -- Grant has edited says so. A second of slack because the insert and
       -- the trigger are not the same instant.
       and t.updated_at <= t.created_at + interval '1 second'
    returning 1
  )
  select count(*) into v_removed from gone;

  return jsonb_build_object('removed', v_removed, 'kept', v_kept,
    'note', case when v_kept = 0 then 'all of them'
                 else format('%s left alone - you had already changed %s of them', v_kept, v_kept)
            end);
end;
$$;

comment on function app.undo_tasks_from_job(uuid) is
  'Take back the tasks one job created (#130, 0398). Keyed on tasks.job_id '
  'rather than on titles, which normalise and collide. Only rows still todo '
  'and never edited: anything Grant has touched since is his work and stays, '
  'and the answer counts what it left alone rather than implying otherwise.';

/*
  And teach `hq_undo` the verb, patched from the live definition.

  The function is long and 0285 already added two verbs to it; transcribing it
  to add a third is how a predicate gets changed by accident.
*/
do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.hq_undo(text)'::regprocedure;
  if position('when ''contact_fields_set'' then' in v_def) = 0 then
    raise exception 'hq_undo is not shaped as expected - read it before patching';
  end if;
  if position('tasks_from_job' in v_def) > 0 then
    raise exception 'it already knows how to undo a batch of tasks';
  end if;
  v_def := replace(v_def,
    '    else' || E'\n' ||
    '      -- A reversal naming something this function cannot perform is a bug in',
    '    -- #130, migration 0398.' || E'\n' ||
    '    when ''tasks_from_job'' then' || E'\n' ||
    '      v_did := app.undo_tasks_from_job((v_args ->> ''p_job'')::uuid);' || E'\n' ||
    '    else' || E'\n' ||
    '      -- A reversal naming something this function cannot perform is a bug in');
  execute v_def;
end
$$;

commit;
