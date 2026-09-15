-- 0375 — the words a legal risk is actually described in
--
-- The third examination asked for three things in one message and reached two
-- desks. The clause that reached nobody was:
--
--   "flag anything that could go legally wrong with holding staff data during
--    it"
--
-- which is unmistakably the quality and risk director's. Her expertise column
-- holds risk, compliance and audit -- the right CONCEPTS, and not one of the
-- words Grant used. who_knows_about is a trigram match, so concepts it cannot
-- see do not help.
--
-- This is configuration rather than architecture, which is the point. section
-- 232 put the subject vocabulary in staff.expertise precisely so a routing
-- miss could be fixed where Grant can fix it -- he is building a dashboard to
-- "look at each agent, what their skill sets are, and adjust and add and
-- refine". Changing the router to make one clause match would be the wrong
-- repair to the wrong layer.
--
-- Added to quality: the vocabulary of legal exposure. Deliberately not to
-- research or strategy, both of which would also plausibly claim "legal" and
-- would turn one miss into a contested reading.

update public.staff
set expertise = array(
  select distinct unnest(
    expertise || array[
      'legal',
      'legally',
      'liability',
      'regulation',
      'regulatory',
      'data protection',
      'privacy',
      'confidentiality',
      'breach',
      'exposure',
      'obligation',
      'contract risk'
    ]
  )
)
where slug = 'quality-director';

comment on column public.staff.expertise is
  'The words a subject is described in, not the concepts behind them. '
  'who_knows_about is a trigram match, so a director whose column says "risk" '
  'is not reached by "legally wrong" -- 0375. Grant edits this.';
