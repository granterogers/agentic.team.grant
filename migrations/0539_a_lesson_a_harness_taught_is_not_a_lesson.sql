/*
  0539 — a lesson a harness taught is not a lesson

  ## What was measured, before anything was changed

  `app.lessons_for` is what puts standing instructions into every prompt
  (`src/agents/guidance.ts`). Asked what it would hand the Chief of Staff
  for a real project, it returned 49 lessons, of which **34 were harness
  traffic**:

      HARNESS  34
      real     15

  Among them, at global scope, learned from a simulated message:

      "just do that kind of thing without asking me in the future"
      "always ask me before anything goes out"
      "can you check whether - actually never mind, just tell me what is
       on my list"

  and twenty-eight near-duplicates of *"always give your information in
  the form of clear bullet points"* from `verify-anchors`, the oldest from
  20 September - so this predates the run that found it.

  The first of those directly attacks the approval boundary. A test
  sentence had become a standing instruction telling Grant's real office to
  stop asking him.

  ## Why the flag existed and did nothing

  `public.lessons.is_fixture` is GENERATED from `learned_by` and has been
  correct the whole time. Six functions read `public.lessons`; exactly one,
  `app.hq_governance`, consults that column. The reader that feeds the
  PROMPT never did.

  That is the dial-with-no-reader defect on the path where it costs most,
  and it is 0523's defect with the direction reversed: 0523 stopped harness
  traffic reaching a production DESTINATION, and nothing stopped harness
  traffic reaching a production PROMPT.

  ## The fix, at the reader, once

  One filter, in the one function, the way 0523 put one question in
  `app.deliverable_to` rather than in each caller. The parameter is
  0297/0533/0534's, for the same reason and with the same three
  properties: it defaults to false, the PUBLIC wrapper does not take it and
  is re-created here unchanged, and both directions are asserted.

  Deliberately NOT a sweep of the rows. A lesson is append-only and
  retracting somebody else's suite's rows is not this migration's business;
  filtering at the reader fixes every existing row and every future one at
  once, and the rows stay visible to `hq_governance`, which already knows
  they are fixtures.

  The four this run's own harness taught were retracted through
  `app.retract_lesson` before this migration was written, because those
  were mine to clean.

  ## The traps this is written around

  `create or replace` does not replace a function whose argument list
  changed, so the old signature and its dependent wrapper are dropped by
  exact signature first. `pg_get_functiondef` emits no trailing semicolon.
  And the added `where` has to bracket the four scope clauses: an `or`
  chain following an `and` without parentheses would have made the filter
  apply to the first branch only, which is a filter that looks present and
  leaks three ways.
*/

drop function if exists public.lessons_for(uuid, text, text, integer);
drop function if exists app.lessons_for(uuid, text, text, integer);

CREATE OR REPLACE FUNCTION app.lessons_for(p_project_id uuid DEFAULT NULL::uuid, p_staff_slug text DEFAULT NULL::text, p_job_kind text DEFAULT NULL::text, p_limit integer DEFAULT 8, p_include_harness boolean DEFAULT false)
 RETURNS TABLE(lesson_id uuid, scope lesson_scope, body text, observations integer, confidence numeric, learned_by text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.lesson_id, l.scope, l.body, l.observations, l.confidence,
         l.learned_by, l.created_at
    from public.lessons_live l
   where (p_include_harness or not l.is_fixture)
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
  'Standing instructions for a prompt. Excludes harness-taught lessons: '
  'lessons.is_fixture is GENERATED from learned_by and, until 0539, no '
  'reader on the prompt path consulted it, so 34 of 49 lessons reaching a '
  'real prompt had been taught by test traffic. p_include_harness is for a '
  'suite driving this function, never for production.';

/*
  The wrapper, re-created unchanged and WITHOUT the parameter. PostgREST
  can only reach a wrapper, so a wrapper that cannot ask for harness
  lessons means nothing with a browser can.
*/
CREATE OR REPLACE FUNCTION public.lessons_for(p_project_id uuid DEFAULT NULL::uuid, p_staff_slug text DEFAULT NULL::text, p_job_kind text DEFAULT NULL::text, p_limit integer DEFAULT 8)
 RETURNS TABLE(lesson_id uuid, scope lesson_scope, body text, observations integer, confidence numeric, learned_by text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $wrapper$ select * from app.lessons_for(p_project_id, p_staff_slug, p_job_kind, p_limit) $wrapper$;

grant execute on function public.lessons_for(uuid, text, text, integer)
  to anon, authenticated, service_role;

/*
  Drive it, both directions, in the same migration. A migration that
  applies cleanly is not a function that works, and CLAUDE.md records four
  independent defects in one feature that reading had hidden.
*/
do $proof$
declare v_default int; v_harness int; v_real int;
begin
  select count(*) into v_default
    from app.lessons_for(null, 'chief-of-staff', 'office.instruction', 200);
  select count(*) into v_harness
    from app.lessons_for(null, 'chief-of-staff', 'office.instruction', 200, true);
  select count(*) into v_real
    from app.lessons_for(null, 'chief-of-staff', 'office.instruction', 200) l
    join public.lessons x on x.lesson_id = l.lesson_id
   where not x.is_fixture;

  if v_default <> v_real then
    raise exception
      'the default still returns harness lessons: % returned, % of them real',
      v_default, v_real;
  end if;
  if v_harness <= v_default then
    raise exception
      'p_include_harness widened nothing: % with it, % without - the filter is not doing anything',
      v_harness, v_default;
  end if;
  raise notice 'lessons_for: % to a prompt (all real), % when a suite asks for harness rows too',
    v_default, v_harness;
end
$proof$;
