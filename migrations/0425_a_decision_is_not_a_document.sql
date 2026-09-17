-- A decision is not a document, and it crosses projects (#129).
--
-- Grant: *"an agent cannot notice that this question was answered three weeks
-- ago on a different project, that Grant already declined this approach, that
-- the office already tried this and it did not work. Every job begins as
-- though the office has never met him."*
--
-- ## Why this is a new table and not one of the four that nearly fit
--
-- Checked before building, because most "new" ideas here turn out to be an
-- existing abstraction under another name:
--
--   * `documents` is material the office was GIVEN. A decision is something it
--     CONCLUDED, and mixing them means an agent citing its own past guess as a
--     source -- 0169's defect (a document we wrote into a connector is not new
--     material) one level up.
--   * `lessons` is a correction that stuck: a rule about HOW to behave. "Keep
--     answers to one paragraph" is a lesson; "we chose Notion over Drive
--     because the team needed to edit in place" is not.
--   * `proposals` is what an agent WANTS, with a verdict. Close, and scoped to
--     capability requests -- it cannot hold a choice between two tools neither
--     of which anybody proposed.
--   * `routing_decisions` is which agent answers. A different noun wearing the
--     same word, and the reason this table's comment says so out loud: 0311
--     was a whole migration spent undoing two words for one thing, and this is
--     the mirror risk, one word for two things.
--
-- ## The field that matters and would have been skipped
--
-- `ruled_out`. Grant's own sentence: *"'We chose Notion for project pages' is
-- worth a fraction of 'we chose Notion over Drive because the team needed to
-- edit in place' -- the second stops the question being reopened; the first
-- invites it."*
--
-- It is NOT NULL with no default. An empty array is a legitimate value and
-- means "nothing else was on the table"; a missing one would let the writer
-- skip the thing the table exists for.
--
-- ## Two rules from the Issue, both structural
--
-- **Scoped to the office, not to a project.** `project_id` records where a
-- decision came UP and is never a filter on reading. The whole point is that
-- it crosses projects, which makes this the one retrieval surface where a
-- project boundary is not a privacy boundary -- stated in ADR-0036 before it
-- was built, as the Issue asks.
--
-- **Append-only.** `app.reject_ledger_mutation` on update, delete and
-- truncate, the same three triggers `job_impediments` carries. A log that can
-- be rewritten cannot answer *when did we change our mind*, which is most of
-- its value. Superseding writes a NEW row pointing at the old one.

create table public.decisions (
  decision_id   uuid primary key default extensions.gen_random_uuid(),
  -- What was being decided, as a question. "Where do project pages live?"
  question      text not null,
  -- What was chosen. "Notion."
  chose         text not null,
  -- What was not. The field the Issue is about.
  ruled_out     text[] not null,
  -- Why, in the words of whoever decided. Never a summary somebody wrote after.
  because       text not null,
  /*
    Who decided, and it decides how the answer may be USED.

    'grant' means a record of what HE said, which `provenance.ts` counts as
    evidence. A staff slug means the office's own conclusion, which it does
    not: the office's prose is a record of what was said, never of what is
    true, and a decision it made on its own is exactly that. The reader hands
    the two to the model in different lists for that reason.
  */
  decided_by    text not null,
  decided_at    timestamptz not null default app.now_utc(),
  -- Where it came up. NOT a filter: see the table comment.
  project_id    uuid references public.projects(project_id) on delete set null,
  from_job      uuid references public.jobs(job_id),
  -- The older decision this one replaces. Both stay visible.
  supersedes    uuid references public.decisions(decision_id),
  is_fixture    boolean not null generated always as (
                  decided_by like 'verify:%' or decided_by like 'fixture-%') stored,
  /*
    One weighted vector, generated, so the reader cannot compute something that
    merely resembles it and miss the index -- 0308's defect, which cost a
    sequential scan beside an index that was right there.

    The question is weighted above the answer because a search is nearly always
    somebody asking the same question again.

    `ruled_out` is deliberately NOT in here and the reason is Postgres's, not a
    judgement: `array_to_string` is STABLE rather than immutable, so a
    generated column containing it is refused -- which this migration found on
    its first run. The reader matches the ruled-out options with a trigram
    instead, where a stable function is perfectly legal.
  */
  search        tsvector generated always as (
                  setweight(to_tsvector('english', coalesce(question, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(chose, '')), 'B') ||
                  setweight(to_tsvector('english', coalesce(because, '')), 'C')) stored,
  constraint decisions_question_said check (btrim(question) <> ''),
  constraint decisions_chose_said check (btrim(chose) <> ''),
  constraint decisions_because_said check (btrim(because) <> ''),
  -- A decision cannot supersede itself, which is the only cycle a single
  -- reference can make and the only one worth a constraint.
  constraint decisions_not_its_own_ancestor check (supersedes is distinct from decision_id)
);

comment on table public.decisions is
  'What the office CONCLUDED, and what that ruled out (#129). Distinct from '
  'documents (material it was given), from lessons (rules about how to behave) '
  'and from routing_decisions (which agent answers — a different noun wearing '
  'the same word). Scoped to the office: project_id records where a decision '
  'came up and is never a filter. Append-only; superseding writes a new row.';

create index decisions_search on public.decisions using gin (search);
create index decisions_live_recent on public.decisions (decided_at desc);
-- One live decision per superseded row: two rows both claiming to replace the
-- same older one is a history that cannot be read in order.
create unique index decisions_one_successor on public.decisions (supersedes)
  where supersedes is not null;

create trigger decisions_reject_update before update on public.decisions
  for each row execute function app.reject_ledger_mutation();
create trigger decisions_reject_delete before delete on public.decisions
  for each row execute function app.reject_ledger_mutation();
create trigger decisions_reject_truncate before truncate on public.decisions
  for each statement execute function app.reject_ledger_mutation();

/*
  Live means "not replaced by a later one".

  Derived rather than a column, because a `superseded` flag would have to be
  UPDATED and this table refuses updates -- and because 0310's rule applies:
  do not store a fact you can already read.
*/
create view public.decisions_live as
  select d.*
    from public.decisions d
   where not exists (select 1 from public.decisions n where n.supersedes = d.decision_id);

comment on view public.decisions_live is
  'Decisions nothing later has replaced. Derived, because a superseded flag '
  'would need an UPDATE and this table refuses them.';

/*
  Writing one.

  Takes the vocabulary a CALLER has -- a question, a choice, the options it
  beat, a reason -- rather than making every caller know the column types,
  which is the correction `record_consultation` needed after its INSERT raised
  on every hand-off and was swallowed.
*/
create or replace function app.record_decision_made(
  p_question text,
  p_chose text,
  p_ruled_out text[],
  p_because text,
  p_decided_by text,
  p_project uuid default null,
  p_job uuid default null,
  p_supersedes uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_id uuid;
begin
  if coalesce(btrim(p_question), '') = '' or coalesce(btrim(p_chose), '') = ''
     or coalesce(btrim(p_because), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'a decision needs the question, what was chosen, and why');
  end if;

  insert into public.decisions
    (question, chose, ruled_out, because, decided_by, project_id, from_job, supersedes)
  values (btrim(p_question), btrim(p_chose),
          coalesce(p_ruled_out, array[]::text[]), btrim(p_because),
          p_decided_by, p_project, p_job, p_supersedes)
  returning decision_id into v_id;

  return jsonb_build_object('ok', true, 'decision', v_id);
end;
$function$;

/*
  Reading them, across every project.

  Full text over the generated vector, with the trigram similarity of the
  QUESTION as a tiebreak -- a person asking the same thing again rarely uses
  the same words, and `websearch_to_tsquery` alone misses a rephrasing that
  `similarity` catches.

  Fixtures excluded, because this reaches a prompt.
*/
create or replace function app.decisions_about(p_text text, p_limit integer default 4)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(q.v order by q.rank desc, q.at desc), '[]'::jsonb)
    from (
      select d.decided_at as at,
             ts_rank(d.search, websearch_to_tsquery('english', p_text))
               + extensions.similarity(d.question, p_text) as rank,
             jsonb_build_object(
               'id', d.decision_id,
               'question', d.question,
               'chose', d.chose,
               'ruled_out', to_jsonb(d.ruled_out),
               'because', d.because,
               'by', d.decided_by,
               'at', d.decided_at,
               'project', p.name,
               'supersedes', d.supersedes) as v
        from public.decisions_live d
        left join public.projects p on p.project_id = d.project_id
       where not d.is_fixture
         and (d.search @@ websearch_to_tsquery('english', p_text)
              or extensions.similarity(d.question, p_text) > 0.25
              -- The options it beat, which the generated vector cannot hold
              -- (see the column comment). "Did we look at Drive?" has to find
              -- the decision that ruled Drive out.
              or extensions.similarity(array_to_string(d.ruled_out, ' '), p_text) > 0.25)
       order by 2 desc, 1 desc
       limit greatest(1, least(coalesce(p_limit, 4), 10))
    ) q;
$function$;

create or replace function public.decisions_about(p_text text, p_limit integer default 4)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.decisions_about(p_text, p_limit) $function$;

/*
  And the whole log, for the page.

  Superseded rows included and marked, because "both visible" is the Issue's
  own acceptance criterion -- a history that hides what it replaced cannot
  answer when the office changed its mind.
*/
create or replace function app.decisions_so_far(p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(q.v order by q.at desc), '[]'::jsonb)
    from (
      select d.decided_at as at,
             jsonb_build_object(
               'id', d.decision_id,
               'question', d.question,
               'chose', d.chose,
               'ruled_out', to_jsonb(d.ruled_out),
               'because', d.because,
               'by', d.decided_by,
               'at', d.decided_at,
               'project', p.name,
               'supersedes', d.supersedes,
               'live', not exists (select 1 from public.decisions n
                                    where n.supersedes = d.decision_id)) as v
        from public.decisions d
        left join public.projects p on p.project_id = d.project_id
       where not d.is_fixture
       order by d.decided_at desc
       limit greatest(1, least(coalesce(p_limit, 40), 200))
    ) q;
$function$;

create or replace function public.hq_decisions(p_limit integer default 40)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.decisions_so_far(p_limit) $function$;
