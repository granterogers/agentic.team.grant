-- 0364 — two more cases given the evidence a fair grader needs.
--
-- 0363 moved agreement from 16/18 to 17/19 and the stricter rubric kept finding
-- the same thing, which is worth stating plainly rather than iterating past:
--
--   WRITING A 'GOOD' CASE IS HARDER THAN IT LOOKS. An answer that states facts
--   needs a context saying those facts were observed, or a grader told that a
--   claimed observation is the worst failure in the list will mark it poor -
--   correctly, on the evidence in front of it.
--
-- prose-stays-prose is a case 0362 wrote, and it had NO context at all. The
-- answer says three hundred and sixty migrations applied and the worker picked
-- up cleanly. Both are perfectly ordinary things for the office to know and
-- neither was declared, so the judge marked it poor for "specific numeric
-- claims". That is the rule working on a case I wrote carelessly, not a rule
-- that needs softening.
--
-- notebook-recovery is older. 0363 confirmed the project was created and the
-- answer claims a great deal more than that - sources pulled together, a slide
-- deck generated, an audio recording routed. The context has to cover what the
-- answer actually claims, not the headline.
--
-- The line this stays on: context is evidence a fair grader would be given
-- anyway, never the verdict. Neither statement below says whether the reply is
-- good.

update public.eval_cases
   set context = 'The office had just applied the migrations and read the worker status, so the '
              || 'numbers and the observation about timing come from work it actually did.'
 where slug = 'prose-stays-prose';

update public.eval_cases
   set context = 'The notebook project was created, the sources were added and the artifacts '
              || 'were generated - all of it is recorded. NotebookLM has no official API, so '
              || 'these run over the unofficial path, which is a reach the office has declared '
              || 'rather than a capability it invented.'
 where slug = 'notebook-recovery';
