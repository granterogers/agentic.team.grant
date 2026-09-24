-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0545
--
-- 0545 stops a lesson a HARNESS job taught reaching a real prompt, and drives
-- it both ways -- the second half being the one a blank database cannot
-- satisfy:
--
--     if kept = 0 then
--       raise exception 'the filter left nothing at all, which is a filter nobody can use';
--
-- The precondition before 0539 seeded a lesson a harness TAUGHT, which 0539's
-- own filter then correctly hides -- so by the time 0545 asks what is left,
-- the answer is nothing, and a filter that leaves nothing is indistinguishable
-- from a filter that removes everything.
--
-- So this adds the other half: one lesson a PERSON taught, which no filter
-- should ever hide. F-002's shape again -- the migration is right, the
-- database is empty, and a control needs both sides of what it discriminates.
-- ---------------------------------------------------------------------------

insert into public.lessons (scope, body, learned_by)
values ('global', 'Grant prefers short answers with the decision first.', 'grant')
on conflict do nothing;
