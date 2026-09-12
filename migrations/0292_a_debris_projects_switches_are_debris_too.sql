-- 0292 — a debris project's switches are debris too
--
-- Found by `verify:agents` while fixing #177.
--
--   ERROR: update or delete on table "projects" violates foreign key constraint
--          "project_switches_project_id_fkey" on table "project_switches"
--   CONTEXT: SQL statement "delete from public.projects where project_id = v_id"
--            PL/pgSQL function app.project_delete(text,boolean)
--
-- 0282 made `app.project_delete` the one sanctioned way to remove a project,
-- and said what that means:
--
--   > *it removes the children that are debris, refuses anything holding real
--   > content, and says which in a sentence rather than a constraint name.*
--
-- It misses `project_switches`, so a project that was ever the subject of a
-- conversation cannot be deleted, and fails with exactly the constraint name
-- 0282 exists to avoid. Every suite that switches to its own subject hits this,
-- which is every suite that will be written against #171's harness.
--
-- ## A switch row is not content
--
-- `project_switches` is an append-only LOG, and its own comment says why it is
-- one: *"the history is what makes 'which project was this job filed under, and
-- why' answerable after the fact."* That value is entirely about the project —
-- so when the project goes, the answer it made answerable goes with it, and the
-- rows are orphaned history about nothing.
--
-- Which is the same test 0282 already applies to attachments and the layout:
-- debris a project accumulates, not something that took work to make. Documents
-- and jobs still refuse, and still refuse in a sentence.
--
-- Append-only is preserved. The trigger that guards it covers UPDATE — the log
-- cannot be REWRITTEN, which is the property §6 wants — and `verify:agents`
-- asserts exactly that. Removing the log of a project that no longer exists is
-- not a rewrite of history; it is the same delete the `on delete cascade` on
-- `project_attachments` already performs one table over.

begin;

create or replace function app.project_delete(p_slug text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id   uuid;
  v_docs int;
  v_jobs int;
begin
  select project_id into v_id from public.projects where slug = p_slug;
  if v_id is null then
    return jsonb_build_object('error', format('no project %L', p_slug));
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
    deleted. Said here rather than left to a foreign-key error naming a table
    the reader did not ask about.
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
    0292. The switch log, which is debris once its subject is gone.

    Not a breach of append-only: that trigger guards UPDATE, so the log cannot
    be REWRITTEN, which is the property §6 asks for and which `verify:agents`
    asserts directly. These rows are history about a project that will not
    exist in three statements' time.

    Without this, a project that was ever the subject of a conversation could
    not be deleted, and failed with the constraint name 0282 exists to avoid.
  */
  delete from public.project_switches where project_id = v_id;

  delete from public.projects where project_id = v_id;

  return jsonb_build_object('ok', true, 'deleted', p_slug);
end;
$$;

commit;
