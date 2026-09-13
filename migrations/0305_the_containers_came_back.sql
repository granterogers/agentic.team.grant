begin;

/**
 * The containers came back, because the worker was older than the fix.
 *
 * 0283 established the rule — a Notion DATABASE is a container a project is
 * ATTACHED to, not a document in its corpus — deleted the three rows that
 * existed, and taught `syncNotion` to skip them.
 *
 * Fifteen minutes later, at 13:09, `duty:notion-sync` put all three back:
 *
 *     Projects · Tasks · Docs        legacy-coaching-course, origin 'source'
 *
 * The skip was in the repository and not in the thing that runs. The deployed
 * worker was built before 0283, so the duty was still executing the old code
 * path — which is a trap CLAUDE.md already records in almost these words:
 * *"the deployed worker was built before that handler existed."* Migration and
 * deploy are two different acts and only one of them happened.
 *
 * The worker has been redeployed (v221), so the source of them is closed. This
 * sweeps what the fifteen-minute window produced.
 *
 * ## Why a migration rather than a DELETE run by hand
 *
 * Same reason 0283 was: it is a change to Grant's corpus, and a change to his
 * corpus should be reviewable, reversible in principle, and attached to its
 * argument. A row removed by someone typing a DELETE is a row nobody can ask
 * about afterwards.
 *
 * ## And a check, so a third occurrence is loud
 *
 * The invariant is small enough to state: no document may be its own project's
 * attachment. `verify:corpus` asserts it across the whole corpus (it is what
 * found these), but a suite runs when someone runs it, and this ran unnoticed
 * for five hours. `app.containers_stored_as_documents()` makes it answerable
 * from the office itself, which is the difference between a rule and a habit.
 */

-- ---------------------------------------------------------------------------
-- What the fifteen-minute window left
-- ---------------------------------------------------------------------------

/*
  Identified by the invariant, not by title. "Docs", "Tasks" and "Projects" are
  the three that happen to be there today; keying the delete on those words
  would delete a real document Grant one day calls Tasks, and would miss the
  fourth container the next sync finds.
*/
delete from public.documents d
 using public.project_attachments a
 where a.project_id = d.project_id
   and a.connector = d.connector
   and a.external_ref = d.external_ref;

-- ---------------------------------------------------------------------------
-- So it can be asked, rather than only tested
-- ---------------------------------------------------------------------------

create or replace function app.containers_stored_as_documents()
returns table (project_slug text, connector text, title text, external_ref text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.slug, d.connector, d.title, d.external_ref, d.created_at
    from public.documents d
    join public.project_attachments a
      on a.project_id = d.project_id and a.connector = d.connector
     and a.external_ref = d.external_ref
    join public.projects p on p.project_id = d.project_id
   order by d.created_at desc
$$;

comment on function app.containers_stored_as_documents is
  'ADR-0013 and 0283: a connector container is a thing a dashboard project is '
  'ATTACHED to, never a document in its corpus. This should always return zero '
  'rows. It returned three after a duty ran on a worker deployed before 0283, '
  'which is why it exists as a query and not only as a check (0305).';

create or replace function public.containers_stored_as_documents()
returns table (project_slug text, connector text, title text, external_ref text, since timestamptz)
language sql stable security definer set search_path = public, pg_catalog
as $$ select * from app.containers_stored_as_documents() $$;

grant execute on function app.containers_stored_as_documents() to ai_team_app;
grant execute on function public.containers_stored_as_documents() to ai_team_app;

commit;
