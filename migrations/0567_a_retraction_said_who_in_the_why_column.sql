-- Every retraction the office wrote before today has its two text columns the
-- wrong way round, and the rows cannot be corrected.
--
-- app.retract_lesson(p_lesson_id, p_why, p_by) writes body = p_why and
-- learned_by = p_by. src/agents/remember.ts passed the AUTHOR second, so the
-- author landed in the reason column and the reason in the author column, on
-- every withdrawal the office has ever performed:
--
--     body        learned_by
--     grant       Withdrawn: do not use bullets anymore
--
-- Two consequences, and the second is the expensive one. The ledger's record
-- of WHY a rule was dropped is a username. And lessons.is_fixture is GENERATED
-- from learned_by, so a retraction written by a suite carried the reason text
-- there instead of the suite's name and was attributed as Grant's own -- which
-- is how 41 global and 34 project retractions came to read as real traffic.
--
-- public.lessons refuses UPDATE by trigger, correctly: it is a ledger. So the
-- historical rows stay as they are and this migration records the fact where
-- somebody writing a query against them will see it, rather than pretending it
-- can be fixed. The code fix is named arguments at both call sites, which is
-- CLAUDE.md's rule for a signature this easy to get round the wrong way.

comment on column public.lessons.body is
  'The rule, or -- on a retraction row -- why it was dropped. RETRACTIONS '
  'WRITTEN BEFORE 2026-09-23 HOLD THE AUTHOR HERE INSTEAD: remember.ts passed '
  'app.retract_lesson its arguments the wrong way round, and this table '
  'refuses UPDATE, so those rows cannot be corrected. Read them with that in '
  'mind and do not count them as Grant''s.';

comment on column public.lessons.learned_by is
  'Who stated or withdrew it. RETRACTIONS WRITTEN BEFORE 2026-09-23 HOLD THE '
  'REASON HERE INSTEAD -- see the comment on body. is_fixture is GENERATED '
  'from this column, so those rows are marked real whoever wrote them, and a '
  'harness retraction among them cannot be told from one of Grant''s.';

comment on column public.lessons.is_fixture is
  'Generated from learned_by. Trustworthy on lesson rows; on retraction rows '
  'written before 2026-09-23 it is generated from the reason text and means '
  'nothing.';
