-- A project answers to its own name.
--
-- Issue #44, found during the end-to-end sweep (#41). `npm run verify:identity`
-- was 17/28, and eleven failures were one area: resolving a project from the
-- name a person actually uses for it.
--
-- ## What was wrong
--
-- `Legacy Coaching Course` — Grant's main project, the one with 33 documents —
-- **had no rows in `project_aliases` at all.**
--
-- `app.resolve_project_by_name` has four branches. Three of them join
-- `project_aliases`: the exact-alias match at 0.99, and the name-inside-a-
-- sentence match at 0.95 (0156). With no alias rows, all three are unreachable,
-- and only the fuzzy `similarity` branch can fire. So:
--
--     'Legacy Coaching Course'                            -> 1.000 via slug
--     'add this to the Legacy Coaching Course please'      -> 0.601 (fuzzy)
--
-- and `app.resolve_project` requires >= 0.90 before it will act on a name. The
-- full name appearing verbatim in a sentence scored 0.601 and was discarded, so
-- the office asked "which project?" about a sentence that named it exactly.
--
-- ## Why it happened, and why a backfill alone is not the fix
--
-- Nothing seeds aliases. There is no trigger on `projects` — only
-- `projects_need_an_attachment` and `projects_touch_updated_at`. Aliases are
-- written by whichever application path happens to create a project, so a
-- project created any other way, or created before that code existed, has none.
-- Thirty-eight projects are in that state.
--
-- Backfilling the existing ones fixes today and leaves the same hole open. A
-- trigger closes it: every project gets an alias for its name and its slug at
-- the moment it exists, whatever created it.
--
-- ## What is deliberately NOT changed
--
-- The 0.90 threshold in `app.resolve_project` stays. Lowering it so fuzzy
-- matches get through would make the office act on guesses, and the whole
-- design of that function is that it returns NULL and asks rather than picking
-- the most recently touched project. The fix is to make the exact match
-- reachable, not to accept worse evidence.

begin;

create or replace function app.seed_project_aliases() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Its name, as written. `source = 'name'` and high confidence, because a
  -- project's own name is not an inference.
  -- `normalised` is a GENERATED column — the database derives it from `alias`,
  -- so writing it is refused. That is the right design: it means two callers
  -- cannot disagree about how a name normalises.
  /*
    `normalised` is a GENERATED column and there are TWO unique constraints on
    this table: one per project, and one GLOBAL — an alias points at exactly one
    project, which is how "a name that already exists asks first" is supposed to
    work. So a name already claimed by another project is left alone rather than
    stolen, and the ambiguity surfaces where it should: as a question.
  */
  insert into public.project_aliases (project_id, alias, source, confidence)
  select new.project_id, new.name, 'name', 1.0
   where app.normalise_name(new.name) is not null
     and not exists (
       select 1 from public.project_aliases a
        where a.normalised = app.normalise_name(new.name)
     );

  -- Its slug, which is how it is written in a URL or a command.
  insert into public.project_aliases (project_id, alias, source, confidence)
  select new.project_id, new.slug, 'slug', 1.0
   where app.normalise_name(new.slug) is not null
     and not exists (
       select 1 from public.project_aliases a
        where a.normalised = app.normalise_name(new.slug)
     );

  /*
    A rename leaves the old name behind on purpose.

    Grant will keep calling it what he called it last week, and the point of
    this table is to answer to the names people actually use. Old aliases are
    only removed when he says so.
  */
  return new;
end $$;

drop trigger if exists projects_seed_aliases on public.projects;
create trigger projects_seed_aliases
  after insert or update of name, slug on public.projects
  for each row execute function app.seed_project_aliases();

-- --- backfill ---------------------------------------------------------------
-- Every project that has none, fixtures included: a fixture project that cannot
-- be resolved by name makes the identity suite fail for the wrong reason.

/*
  Live projects first, and one at a time.

  Two archived fixtures can share a normalised name, and the global unique
  constraint means whoever is inserted first keeps it. Ordering by
  `status = 'active'` and then by age makes that deterministic and puts the
  real projects at the front of the queue — Grant's Legacy Coaching Course
  should own its own name, not lose it to a probe fixture from August.
*/
insert into public.project_aliases (project_id, alias, source, confidence)
select distinct on (app.normalise_name(p.name))
       p.project_id, p.name, 'name', 1.0
  from public.projects p
 where app.normalise_name(p.name) is not null
   and not exists (
     select 1 from public.project_aliases a
      where a.normalised = app.normalise_name(p.name)
   )
 order by app.normalise_name(p.name),
          (p.status = 'active') desc, p.is_fixture, p.created_at;

insert into public.project_aliases (project_id, alias, source, confidence)
select distinct on (app.normalise_name(p.slug))
       p.project_id, p.slug, 'slug', 1.0
  from public.projects p
 where app.normalise_name(p.slug) is not null
   and not exists (
     select 1 from public.project_aliases a
      where a.normalised = app.normalise_name(p.slug)
   )
 order by app.normalise_name(p.slug),
          (p.status = 'active') desc, p.is_fixture, p.created_at;

commit;
