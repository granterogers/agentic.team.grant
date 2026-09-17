-- A lesson is a ledger row, not a child record.
--
-- Issue #48. 0181 gave `lessons.project_id` and `lessons.staff_slug` an
-- ON DELETE CASCADE, copying the convention from `tasks` and `documents`. That
-- was wrong in a way that only showed up when the verification suite tried to
-- tidy up after itself:
--
--     ERROR: public.lessons is append-only: DELETE is never permitted (§6)
--     CONTEXT: SQL statement "DELETE FROM ONLY public.lessons WHERE ..."
--
-- A cascade IS a delete. So the two guarantees were in direct contradiction:
-- the table promised nothing would ever be removed, and its own foreign key
-- promised the opposite. In practice the trigger wins, which means the real
-- behaviour was **a project with a lesson could never be deleted, and the
-- error would name the append-only rule rather than the project** — the least
-- debuggable possible version of the constraint.
--
-- Every other append-only table here already does the right thing, and none of
-- them cascades:
--
--     events.project_id              -> projects(project_id)      no action
--     autonomy_settings.project_id   -> projects(project_id)      no action
--     job_state_transitions.job_id   -> jobs(job_id)              no action
--
-- A ledger row about a thing is not owned by that thing. So `lessons` joins
-- that family: a plain reference, no cascade, and deleting a project with
-- lessons is refused by the foreign key — with an error that names the
-- foreign key, which is the truth.
--
-- This makes `lessons` part of Issue #43 (a project with documents cannot be
-- deleted — inconsistent ON DELETE across its children), which is the right
-- place to decide the policy for the whole family at once rather than inventing
-- a fifth answer here.
--
-- To remove a lesson, withdraw it: `app.unlearn()` writes a retraction. That is
-- the honest operation and it keeps the record of what the office once believed.

begin;

alter table public.lessons
  drop constraint if exists lessons_project_id_fkey,
  drop constraint if exists lessons_staff_slug_fkey;

alter table public.lessons
  add constraint lessons_project_id_fkey
    foreign key (project_id) references public.projects(project_id),
  add constraint lessons_staff_slug_fkey
    foreign key (staff_slug) references public.staff(slug);

comment on constraint lessons_project_id_fkey on public.lessons is
  'No cascade, deliberately: a cascade is a DELETE and this table refuses '
  'DELETE. See 0183 and Issue #43.';

commit;
