-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0585
--
-- 0585 gives `app.say_once` a project dimension -- two projects saying the
-- same thing are two facts, and 0584's per-kind memory silenced the second.
-- It drives exactly that case:
--
--     select job_id into v_a from public.jobs
--      where kind = 'drive.watch' and project_id is not null …
--     select job_id into v_b … and project_id <> (…v_a's project…)
--     if v_a is null or v_chat is null then
--       raise exception 'no subject to drive with';
--
-- On Grant's database `drive.watch` ran per project, fourteen jobs across
-- fourteen projects. A blank database has never watched a drive, so there is
-- no subject and the migration correctly refuses to drive with none.
--
-- Part of F-002. Two duty jobs are scaffolded, one on each of the two
-- scaffold projects the precondition before 0167 already created, because the
-- new control is only meaningful when a SECOND project exists -- the migration
-- says so itself, and downgrades to a warning rather than claiming a pass when
-- it does not. Supplying one project would have left that control vacuous,
-- which is the shape this whole exercise keeps finding.
--
-- Nothing here decides the outcome: `say_once` reads each job's kind and
-- project and looks the kind up in `public.responsibilities`, so the
-- assertions still depend on the function rather than on anything set here.
-- ---------------------------------------------------------------------------

insert into public.jobs
  (correlation_id, idempotency_key, kind, requested_by, announce, project_id)
select gen_random_uuid(),
       'fresh-install-scaffold-0585-' || p.slug,
       'drive.watch',
       'harness:verify-fresh-install-scaffold',
       false,
       p.project_id
  from public.projects p
 where p.slug in ('baseline-scaffold-do-not-use', 'legacy-coaching-course')
on conflict do nothing;

update public.jobs
   set state = 'cancelled',
       state_reason = 'fresh-install baseline scaffolding; never ran'
 where idempotency_key like 'fresh-install-scaffold-0585-%'
   and state = 'queued';
