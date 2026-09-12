-- 0282 — one policy for deleting a project
--
-- Issues #43 and #45.
--
-- ## What #43 found
--
-- `projects` has twenty-nine children and five different opinions about what
-- happens when one is deleted:
--
--   cascade   collections, contacts, dashboard_layouts, project_aliases,
--             project_attachments, project_connector_choices, relations, tasks
--   no action everything else, including `documents` — whose constraint is
--             still named `notebook_sources_project_id_fkey`, from before
--             documents were called documents
--
-- So `delete from projects` half-works and which half depends on which tables
-- that project happens to have rows in. A project with only tasks deletes
-- cleanly; one with a single document cannot be deleted at all, and says so
-- with a constraint name that names a table that no longer exists.
--
-- ## The decision, which #43 asked for and this makes
--
-- **Archive is how a project ends. Deletion is for debris.** That is option (3)
-- with (2) underneath, which the issue itself judged probably right, and it is
-- Grant's standing instruction:
--
--   > *"You should always check before making any destructive action with me."*
--
-- A cascade that silently destroys 86 real documents is exactly the action he
-- means. So:
--
--   * `documents` becomes an explicit RESTRICT rather than an accidental one,
--     and is renamed to say what it guards.
--   * `app.project_delete()` is the one sanctioned path: it removes the
--     children that are debris, refuses anything holding real content, and
--     says which in a sentence rather than a constraint name.
--   * Everything else keeps the policy it has. Making the old table match the
--     new ones (cascade everywhere) would be the reverse of safe.
--
-- ADR-0022 records this, because a future agent will otherwise "tidy" it into
-- a cascade.
--
-- ## And the harm #45 actually names
--
-- Thirty-two archived debris projects hold **561 rows on `project_aliases`**,
-- which has a GLOBAL unique index on the normalised phrase. So a retired probe
-- owns a phrase a real project should get — the same table whose missing rows
-- caused #44.
--
-- That is fixed here without deleting anything. The uniqueness that matters is
-- among projects Grant can actually be routed to, so the global index becomes
-- a trigger that checks against ACTIVE projects only. An archived project keeps
-- its aliases as history and stops blocking a live one.
--
-- A partial unique index cannot express it — the predicate would have to read
-- `projects`, and a partial index may only reference its own table — so a
-- trigger is not a preference here, it is the only shape available.

begin;

-- ---------------------------------------------------------------------------
-- 1. Documents are guarded on purpose, and the constraint says so
-- ---------------------------------------------------------------------------

alter table public.documents
  drop constraint notebook_sources_project_id_fkey;

alter table public.documents
  add constraint documents_project_id_fkey
  foreign key (project_id) references public.projects (project_id)
  on delete restrict;

comment on constraint documents_project_id_fkey on public.documents is
  'RESTRICT, deliberately (#43, ADR-0022). ADR-0013: a route may be closed and '
  'the corpus is kept. Deleting a project that holds documents is refused; '
  'archive it, or empty it first through app.project_delete.';

-- ---------------------------------------------------------------------------
-- 2. One sanctioned way to remove a project
-- ---------------------------------------------------------------------------

/**
 * Remove a project that is debris, and refuse one that is not.
 *
 * Refuses in a sentence rather than through a constraint name. `delete from
 * projects` still works for the cases it always worked for; this exists so that
 * a teardown has one call to make and a person has one answer to read.
 *
 * The order is forced by ADR-0014: archive, then attachments, then the project.
 * The trigger that requires an active project to have an enabled attachment
 * fires on the attachment delete, so an unarchived project cannot lose its
 * last source.
 *
 * `p_force` is deliberately NOT a way past documents. It covers the aliases and
 * the layout — the things a debris project accumulates — and nothing that took
 * work to make.
 */
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
  delete from public.projects where project_id = v_id;

  return jsonb_build_object('ok', true, 'deleted', p_slug);
end;
$$;

create or replace function public.project_delete(p_slug text, p_force boolean default false)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.project_delete(p_slug, p_force) $$;

-- ---------------------------------------------------------------------------
-- 3. An archived project stops holding a phrase a live one should get (#45)
-- ---------------------------------------------------------------------------

drop index if exists public.project_aliases_normalised_uniq;

/**
 * A routing phrase belongs to at most one project Grant can be routed to.
 *
 * The old global unique index counted archived projects, so 561 phrases were
 * held by thirty-two retired probes — and #44 was caused by exactly this table
 * missing the rows it should have had.
 *
 * A trigger rather than a partial unique index because the predicate has to
 * read `projects.status`, and a partial index may only reference its own table.
 * The cost is that it is not enforced under concurrent inserts of the same
 * phrase; that is acceptable here — aliases are written by one worker, and the
 * per-project uniqueness that stops a duplicate within one project is still an
 * index.
 */
create or replace function app.alias_is_free_among_active()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_holder text;
begin
  select p.slug into v_holder
    from public.project_aliases a
    join public.projects p on p.project_id = a.project_id
   where a.normalised = new.normalised
     and a.project_id <> new.project_id
     and p.status <> 'archived'
   limit 1;

  if v_holder is not null then
    raise exception 'the phrase %L already routes to %', new.normalised, v_holder
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

create trigger project_aliases_free_among_active
  before insert or update of normalised, project_id on public.project_aliases
  for each row execute function app.alias_is_free_among_active();

comment on function app.alias_is_free_among_active is
  '#45. Uniqueness among projects Grant can actually be routed to. An archived '
  'project keeps its aliases as history and no longer blocks a live one — which '
  'releases 561 phrases without deleting a single row.';

-- ---------------------------------------------------------------------------
-- 4. What is debris, so a check can see it
-- ---------------------------------------------------------------------------

/**
 * Non-fixture projects that look like they were left behind by a verify run.
 *
 * Named rather than counted, and it reports whether each one CAN be deleted —
 * a project with jobs against it never can, so a check that demanded an empty
 * result would demand something impossible and be switched off.
 */
create or replace function app.project_debris()
returns table (slug text, status text, docs int, jobs int, removable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.slug, p.status,
         (select count(*) from public.documents d where d.project_id = p.project_id)::int,
         (select count(*) from public.jobs j where j.project_id = p.project_id)::int,
         not exists (select 1 from public.documents d where d.project_id = p.project_id)
           and not exists (select 1 from public.jobs j where j.project_id = p.project_id)
    from public.projects p
   where not p.is_fixture
     and p.status = 'archived'
     /*
       The shapes a harness leaves. Deliberately a list rather than "anything
       archived": `ai-learning-two` and `ai-learning-superseded-2026-09-07` are
       real history and must never be swept.
     */
     and (p.slug like 'newsroom-%' or p.slug like 'gate4-probe-%'
          or p.slug like 'clash-%' or p.slug like 'untitled-notebook-%'
          or p.slug like 'dbg-%' or p.slug like 'probe-%')
   order by p.slug
$$;

grant execute on function app.project_delete(text, boolean) to ai_team_app;
grant execute on function app.project_debris() to ai_team_app;

commit;
