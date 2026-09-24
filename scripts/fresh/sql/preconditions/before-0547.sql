-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0547
--
-- 0547 teaches a conversation to remember the project it resolved to, and
-- drives it by picking a subject:
--
--     select project_id into v_p from public.projects
--      where status = 'active' and not is_fixture order by updated_at desc limit 1;
--
-- On Grant's database that is one of his real projects. On a fresh install the
-- most recently touched project is `unnamed` -- the INBOX -- and 0547 itself
-- refuses to remember that one, deliberately:
--
--     and v_project is distinct from app.unnamed_project()
--
--     "Unnamed is excluded for the same reason: it is the absence of a
--      project, not a project, and a conversation that remembered it could
--      never resolve to anything else."
--
-- So the control fires about a function that is working perfectly. The
-- migration's own comment warns about this exact direction -- "the test was
-- wrong and the code was right, which is the direction that sends somebody
-- rewriting something correct".
--
-- NO DATA IS INVENTED. The scaffold project already exists on a fresh install
-- and is explicitly not a real one; touching it makes it the most recently
-- updated, so the drive picks a project that is not the inbox.
-- `projects_touch_updated_at` sets the timestamp, so the update need not say
-- what it is setting.
-- ---------------------------------------------------------------------------

update public.projects
   set status = status
 where slug = 'baseline-scaffold-do-not-use';
