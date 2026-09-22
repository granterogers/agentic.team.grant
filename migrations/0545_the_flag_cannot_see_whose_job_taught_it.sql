/*
  0545 — the flag cannot see whose JOB taught the lesson

  ## What is in every real prompt today, measured before anything changed

      select * from app.lessons_for(null, 'chief-of-staff', 'office.instruction', 100)

        shown to a real prompt   15
        taught by a harness job  12

  Twelve of fifteen. Among them, at global scope, both of these at once:

      "The middle tier is forty-two pounds a month."
      "The middle tier is sixty-three pounds fifty a month."

  Two contradictory facts about Grant's own pricing, asserted as standing
  knowledge to every agent on every job. The second is the number the office
  INVENTED from an unrelated document in the September bait corpus - CLAUDE.md
  records that fabrication by name - so a hallucination the harness was
  written to catch has been laundered into the office's permanent memory and
  read back as truth.

  And six copies of *"From now on IN THIS CONVERSATION, keep every answer to
  a single short paragraph"*, permanently global, beside "give me bullet
  points, never prose" and "keep everything to one line" - four incompatible
  formatting rules in one prompt.

  ## Why 0539 did not stop it, though it was pointed at exactly this

  0539 put the filter in the right place and rests on a premise that is not
  true. Its own header says:

      "public.lessons.is_fixture is GENERATED from learned_by and has been
       correct the whole time."

  It is correct for a lesson a SUITE taught, because `learned_by` is then
  `verify:something`. It cannot be correct for a lesson taught during a
  harness job that drives the real enqueue path, because `learned_by` is then
  `grant` or `quality-director` - the real vocabulary, correctly recorded.
  38 such lessons exist.

  This is `jobs.is_fixture` again, third table, same cause: a GENERATED column
  may only reference its own row, so it cannot see what the JOB was. 0342 and
  0351 patched the ROWS that existed; 0355 fixed the shape by DERIVING the
  answer once in `app.harness_job` and having the readers ask it. That
  treatment was never carried across to the lesson reader.

  ## The fix, and why it is `or` rather than `coalesce`

  One more clause in the one function 0539 already owns. `from_job` may be
  null - a lesson can be written outside any job - and a null cannot tell us
  anything, so it is kept. 0304's asymmetry, stated there as the rule: both
  witnesses can truthfully say "harness traffic" and neither can be trusted to
  say "real", so the question is `or`, and a witness that can only ever
  EXCLUDE cannot hide a genuine lesson.

  Deliberately NOT a sweep. 0539's argument holds: a lesson is append-only,
  the rows stay visible to `app.hq_governance`, and filtering at the reader
  fixes every existing row and every future one at once.

  ## The traps this is written around

  Spliced from the LIVE definition rather than retyped, because this file
  changes one predicate in a function somebody else wrote. `create or
  replace` does not replace a function whose argument list changed - the list
  is unchanged here, so the existing signature is replaced in place and the
  wrapper is left alone. `search_path` is '' so `app.harness_job` is
  qualified. And the function is DRIVEN at the end, because a migration that
  applies cleanly is not a function that works.
*/

CREATE OR REPLACE FUNCTION app.lessons_for(p_project_id uuid DEFAULT NULL::uuid, p_staff_slug text DEFAULT NULL::text, p_job_kind text DEFAULT NULL::text, p_limit integer DEFAULT 8, p_include_harness boolean DEFAULT false)
 RETURNS TABLE(lesson_id uuid, scope lesson_scope, body text, observations integer, confidence numeric, learned_by text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.lesson_id, l.scope, l.body, l.observations, l.confidence,
         l.learned_by, l.created_at
    from public.lessons_live l
   where (p_include_harness
          or (not l.is_fixture
              and not coalesce(app.harness_job(l.from_job), false)))
     and ((l.scope = 'global')
      or (l.scope = 'project' and l.project_id = p_project_id)
      or (l.scope = 'staff'   and l.staff_slug = p_staff_slug)
      or (l.scope = 'kind'    and l.job_kind   = p_job_kind))
   order by
     -- Specificity first. The general lesson is usually already reflected in
     -- how the office is built; the specific one is what nobody knew.
     case l.scope when 'staff' then 0 when 'kind' then 1 when 'project' then 2 else 3 end,
     l.observations desc,
     l.confidence desc,
     l.created_at desc
   limit greatest(coalesce(p_limit, 8), 0)
$function$;

comment on function app.lessons_for(uuid, text, text, integer, boolean) is
  'Standing instructions for a prompt. Excludes a lesson a suite named itself '
  'in (lessons.is_fixture, 0539) AND one taught during a harness job, which '
  'that flag cannot see because it is GENERATED and may only read its own '
  'row: 12 of the 15 lessons reaching a real prompt were the second kind, '
  'including two contradictory prices for Grant''s middle tier. A null '
  'from_job is kept, because an absent witness excludes nothing. '
  'p_include_harness is for a suite driving this function, never production.';

/*
  DRIVEN, both directions, because reading a migration proves it parses.

  The first assertion is the defect: no lesson a harness job taught may reach
  a real prompt. The second is the control that stops the filter being
  tightened into uselessness - the office must still be told the things Grant
  really said.
*/
do $drive$
declare
  leaked integer;
  kept integer;
begin
  select count(*) into leaked
    from app.lessons_for(null, 'chief-of-staff', 'office.instruction', 200) f
    join public.lessons l on l.lesson_id = f.lesson_id
   where l.from_job is not null and app.harness_job(l.from_job);
  if leaked > 0 then
    raise exception 'a harness job taught % lesson(s) that still reach a real prompt', leaked;
  end if;

  select count(*) into kept
    from app.lessons_for(null, 'chief-of-staff', 'office.instruction', 200);
  if kept = 0 then
    raise exception 'the filter left nothing at all, which is a filter nobody can use';
  end if;
  raise notice 'lessons reaching a real prompt: % (harness-taught: 0)', kept;
end
$drive$;
