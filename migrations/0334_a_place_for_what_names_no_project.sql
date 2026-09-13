begin;

/**
 * A place for what names no project.
 *
 * Issue #194 and #192, decided in ADR-0024.
 *
 * Grant, 13 September, asked where a message that names no project should go:
 *
 *     "You can just create an untitled or undefined project. Stuff that's not
 *      a specific project. You can just go in unnamed project as a title or
 *      category or whatever."
 *
 * In a private Telegram chat there is no project in the room. "What's the
 * status" has to land somewhere, and today it lands nowhere.
 *
 * ## Why a real project and not a nullable project_id
 *
 * Everything here hangs off project_id, and #192 is about to add conversations
 * to that list. A nullable one ripples into every reader and, worse, into
 * #192's project-isolation criterion: a check that a reader scoped to one
 * project cannot see another's has to decide what "scoped to null" means, and
 * that question gets answered inconsistently in four places.
 *
 * The measurement that settles it: 2,259 of 4,340 jobs already have a null
 * project_id. Half the office's work is unattributed, and every reader that
 * touches it currently makes its own decision about what that means.
 *
 * A real row costs this migration and changes nothing downstream.
 *
 * ## Grant's standing rule about creating projects
 *
 *     "Please don't assume I wish to create a new project - this is a large
 *      task and should always be confirmed."
 *
 * He confirmed THIS project, explicitly, in the sentence quoted above. That
 * authorisation covers this single reserved project and nothing else.
 *
 * ## It will be swept unless it is protected, and there was no way to say so
 *
 * `check:leaks` sweeps active, non-fixture projects by slug pattern, and one of
 * those patterns is `untitled-notebook-%`. Which is why, despite the word in
 * Grant's phrasing, this project is NOT named anything beginning "untitled".
 *
 * There was no protection column on `projects` at all, so this adds one.
 * `reserved_reason` rather than a boolean: null means an ordinary project, and
 * a non-null value carries the reason to whoever finds the row and wonders
 * what it is. A boolean would have needed a comment somewhere else to be
 * legible, and 0177's lesson is that a value which merely satisfies a
 * constraint tells you nothing.
 *
 * ## An active project must be attached to something
 *
 * ADR-0014's deferred constraint trigger refuses an active project with no
 * enabled attachment - "a project reads from and writes to somewhere real".
 * That is right, and it applies here too. The attachment is `upload`, which is
 * honest: what arrives in this project is messages and things Grant hands over
 * directly, not a connector's corpus.
 */

alter table public.projects
  add column if not exists reserved_reason text;

comment on column public.projects.reserved_reason is
  'Null for an ordinary project. Non-null marks a project the office depends on '
  'structurally and names why, so app.project_delete can refuse it and a person '
  'finding it in the switcher does not conclude it is debris. ADR-0024.';

-- ---------------------------------------------------------------------------
-- The project itself
-- ---------------------------------------------------------------------------

/*
  Inserted only if it is not already there, so re-running this migration is
  harmless. The slug is fixed and referenced by name in app.unnamed_project()
  below - nothing else should hardcode it.

  Deliberately NOT is_fixture. That column is GENERATED from the slug and
  matches fixture-%, verify-% and ledger-proof-%; a fixture is excluded from
  app.resolve_project_by_name and from everything Grant reads, which is the
  exact opposite of what this project is for. `unnamed` matches none of them.
*/
insert into public.projects (slug, name, status, reserved_reason)
select 'unnamed', 'Unnamed', 'active',
       'Where a message that names no project lands (ADR-0024, #194). Deleting '
       'it would orphan every unattributed conversation.'
 where not exists (select 1 from public.projects where slug = 'unnamed');

insert into public.project_attachments
  (project_id, connector, external_ref, display_name, role, enabled)
select p.project_id, 'upload', 'unnamed-project', 'Direct messages and uploads', 'source', true
  from public.projects p
 where p.slug = 'unnamed'
   and not exists (
     select 1 from public.project_attachments a where a.project_id = p.project_id);

/*
  One accessor, so no caller ever hardcodes the slug. If this project is ever
  renamed or re-keyed, this function is the single place that changes.
*/
create or replace function app.unnamed_project()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$ select project_id from public.projects where slug = 'unnamed' $$;

comment on function app.unnamed_project is
  'The reserved project that holds conversation naming no specific project '
  '(ADR-0024, #194). Use this rather than the slug, so the slug has one home.';

grant execute on function app.unnamed_project() to ai_team_app;

-- ---------------------------------------------------------------------------
-- The deletion path refuses it, by reason rather than by name
-- ---------------------------------------------------------------------------

/*
  `create or replace` is safe here: the argument list is unchanged, so this
  replaces rather than adding an overload. (0294's trap is about a CHANGED
  signature, which this is not.)

  The refusal reads `reserved_reason` rather than testing the slug, so a second
  reserved project later inherits the protection without editing this function.
  It is checked FIRST, before the document and job counts, because "you cannot
  delete this and here is why" is more useful than "this holds 4 documents".
*/
create or replace function app.project_delete(p_slug text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
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
    Aliases are NOT deleted here, and that is the original behaviour preserved
    deliberately: `project_aliases` cascades on the project's foreign key, and
    0282's trigger scopes its uniqueness to ACTIVE projects so a departing
    project releases its phrases anyway. Adding a delete here would have been
    an unverified behaviour change smuggled in by a function replacement.
  */
  delete from public.projects where project_id = v_id;

  return jsonb_build_object('ok', true, 'deleted', p_slug);
end;
$function$;

comment on function app.project_delete is
  'Delete a project, refusing when that would lose work. Order is forced by '
  'ADR-0014: archive, then attachments, then the project. Refuses a project '
  'carrying reserved_reason outright (ADR-0024) — not force-able, because '
  'p_force overrides a judgement about debris and that is not a judgement.';

commit;
