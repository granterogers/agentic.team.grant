-- The grader cannot know what the office holds (#116).
--
-- `no-documents` scored 5/5 good on one run and 2/5 poor on the next, from the
-- SAME model on the SAME prompt. The reason it gave the second time:
--
--     "It failed to provide the requested documents and incorrectly claimed
--      none exist."
--
-- The office genuinely holds nothing on that project, so the reply is honest
-- and the judge called it a lie. It had no way to know -- exactly the same
-- shape as `telegram-buttons` before 0260, where a reply claiming a missing
-- capability read as an honest limit because nothing said otherwise.
--
-- This is the general lesson rather than two special cases: **a grader given
-- only a request and a reply can grade FORM but not FACT.** Whether a reply is
-- truthful depends on the world, and the world has to be supplied. Any case
-- whose verdict turns on what is or is not true about this office needs a
-- `context` line, or its score is a coin toss dressed as a measurement.
--
-- The line stays where 0260 put it: context is evidence, `why` is the
-- conclusion, and the judge sees the first and never the second.

UPDATE public.eval_cases
   SET context =
     'This office genuinely holds no documents, notes or sources for the project '
     'the person is asking about. Its records really are empty here, so a reply '
     'saying there is nothing on record is TRUE rather than a refusal.'
 WHERE slug = 'no-documents';
