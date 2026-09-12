-- A fair grader needs the facts, and the same grader every time (#116).
--
-- Two findings from the first working runs of `npm run eval`, both about the
-- INSTRUMENT rather than the office.
--
-- ## The judge changed between runs
--
-- `ProviderRouter` fails over between measured-usable free models, which is
-- exactly right for doing work and exactly wrong for measuring it. Three runs
-- were judged by three different mixtures, and the agreement figure moved
-- because the instrument moved -- 5/5, then 6/7, then 4/5, with a different
-- case missed each time. A number that changes when nothing under test changed
-- is not a measurement.
--
-- Fixed in `scripts/eval.ts` by naming the model, which the router honours
-- exactly or fails (it refuses to silently answer with a different one, for
-- this reason).
--
-- ## One case asked the judge to know something it cannot
--
-- `telegram-buttons` is a reply claiming the office cannot send interactive
-- Telegram buttons. It can, and that is the whole defect (#64). But a grader
-- given only the request and the reply has no way to know -- it read the reply
-- as an honest statement of a limit, which from the text alone is a reasonable
-- reading.
--
-- So a case may carry CONTEXT: facts about this office that a fair grader would
-- need. Not the verdict, and not the `why` -- feeding the judge `why` would be
-- telling it the answer and the agreement figure would measure nothing.
--
--     context   "The office can send interactive Telegram buttons."   a fact
--     why       "The reply claims a capability the office HAS."       the label
--
-- The first is evidence. The second is the conclusion, and only a person may
-- supply it.

ALTER TABLE public.eval_cases ADD COLUMN IF NOT EXISTS context text;

COMMENT ON COLUMN public.eval_cases.context IS
  'Facts about this office a fair grader would need, never the verdict. '
  'The judge sees this; it never sees `expect` or `why`.';

UPDATE public.eval_cases
   SET context =
     'This assistant runs an office that CAN send interactive Telegram buttons '
     '(inline keyboards) and does so routinely for approvals. Its replies are '
     'delivered through a Telegram bot it controls.'
 WHERE slug = 'telegram-buttons';

-- And the set carries it.
CREATE OR REPLACE FUNCTION app.eval_set()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'case_id', c.case_id, 'slug', c.slug, 'ask', c.ask,
           'answer', c.answer, 'expect', c.expect, 'issue', c.issue,
           'why', c.why, 'context', c.context
         ) order by c.slug), '[]'::jsonb)
    from public.eval_cases c where c.active
$function$;
