-- 0657 - ownership wave 1: projects, duties and jobs (multi-user P2).
--
-- The roots of the ownership graph. Everything else hangs off a project or a job, so these three go first and the
-- later waves read the office from them. One transaction: characterise -> backfill -> assert -> immutability, bridge
-- and composite keys -> NOT NULL. A row that no rule proves aborts the whole wave and names itself; there is no
-- default and no fallback to Grant.
--
-- THE RULES (each is evidence, not a guess; the counts they produce are printed by a dry run):
--
--   projects
--     fixture            is_fixture (generated from the slug)                        -> TEST
--     run-token slug     not active, and the slug carries a suite's run token or a   -> TEST
--                        "proof"/"probe" segment (a suite builds real-named subjects on purpose, #45)
--     trusted or active  active, or a job entered by a production door (origin        -> PERSON
--                        'trusted') - positive evidence somebody real used it
--     harness only       has harness jobs and no other job                            -> TEST
--     anything else      ABORT
--
--   duties (responsibilities)  an explicit table, below. A duty that is not in it ABORTS. The five that belong to the
--     deployment (retention, backup, capacity report, vault export) are SYSTEM; the rest read or act on a person's
--     data and are the person's. A duty with a project takes its project's office.
--
--   jobs: a TREE has one office, because a child's parent edge is a same-office edge.
--     - if any member, or any row a member produced or was asked in (its command, its tasks, decisions, lessons...),
--       names a project, the tree takes that project's office (all projects in a tree must agree, or the wave aborts). A harness job on a REAL project is therefore the project's: structurally forced, counted
--       below, and flagged as before - the composite key cannot express "this row is a test inside that office";
--     - otherwise by the root: a duty's job takes the duty's office; a harness job -> TEST; a connector registration
--       or a requester that is an owner key of a person office -> that person's; a suite-shaped requester or a
--       rename that matches no real project's channel prefix (a discarded arc) -> TEST; anything else ABORTS.
--
-- Dry run: `select set_config('p2.dry_run','0657',true);` before the file makes it raise a full report at the end and
-- roll everything back, which is how the production characterisation and the lock timing were taken.

do $m$
declare
  v_person uuid := app.sole_person_office();
  v_test   uuid := app.test_office();
  v_system uuid := app.system_office();
  v_n      int;
  v_bad    text;
  v_report text := '';
  x        record;
begin
  if v_person is null or v_test is null or v_system is null then
    raise exception '0657: expected exactly one person, one test and one system office (got % / % / %)', v_person, v_test, v_system;
  end if;
  select count(*) into v_n from (
    select 1 from public.projects where office_id is not null
    union all select 1 from public.jobs where office_id is not null
    union all select 1 from public.responsibilities where office_id is not null) s;
  if v_n <> 0 then raise exception '0657: found % rows already stamped; this wave expects a clean slate', v_n; end if;

  alter table public.projects disable trigger user;
  alter table public.responsibilities disable trigger user;
  alter table public.jobs disable trigger user;

  -- ---- projects ----------------------------------------------------------------------------------------------
  create temp table p2_project on commit drop as
  select p.project_id, p.slug,
    case
      when p.is_fixture then 'test:fixture'
      when p.status <> 'active' and (p.slug ~ '(^|-)(m[t-v][a-z0-9]{6}|(?=[a-z0-9]*[0-9])[a-z0-9]{8})(-|$)'
                                     or p.slug ~ '(^|-)(proof|probe)(-|$)') then 'test:run-token'
      when p.status = 'active'
           or exists (select 1 from public.jobs j where j.project_id = p.project_id and app.job_origin(j.job_id) = 'trusted')
        then 'person:trusted-or-active'
      when exists (select 1 from public.jobs j where j.project_id = p.project_id and app.harness_job(j.job_id))
           and not exists (select 1 from public.jobs j where j.project_id = p.project_id and not app.harness_job(j.job_id))
        then 'test:harness-jobs-only'
      else 'UNRESOLVED' end as rule
  from public.projects p;

  select string_agg(slug, ', ') into v_bad from (select slug from p2_project where rule = 'UNRESOLVED' order by slug limit 20) s;
  if v_bad is not null then raise exception '0657: projects no rule proves an owner for: %', v_bad; end if;

  update public.projects p set office_id = case split_part(r.rule, ':', 1) when 'person' then v_person else v_test end
    from p2_project r where r.project_id = p.project_id;
  for x in select rule, count(*) c from p2_project group by 1 order by 1 loop
    v_report := v_report || 'project ' || x.rule || ' = ' || x.c || E'\n';
    insert into public.office_backfill_report (wave, table_name, rule, n) values ('0657', 'projects', x.rule, x.c);
  end loop;

  -- ---- duties ------------------------------------------------------------------------------------------------
  create temp table p2_duty on commit drop as
  select r.responsibility_id, r.slug, r.project_id,
    case
      when r.project_id is not null then 'project'
      when r.slug in ('build-shot-retention', 'job-trace-retention', 'nightly-backup', 'daily-capacity-report', 'vault-export')
        then 'system'
      when r.slug in ('calendar-refresh', 'calendar-task-sync', 'credential-chores', 'discovery-sync', 'drive-watch',
                      'mail-refresh', 'morning-briefing', 'notion-sync', 'proposal-round', 'slack-rotation',
                      'task-reminders', 'vikunja-sync') then 'person'
      else 'UNRESOLVED' end as rule
  from public.responsibilities r;
  select string_agg(slug, ', ') into v_bad from p2_duty where rule = 'UNRESOLVED';
  if v_bad is not null then raise exception '0657: duties not classified (system or person) - classify them: %', v_bad; end if;
  update public.responsibilities r set office_id = case d.rule
      when 'system' then v_system
      when 'person' then v_person
      else (select pr.office_id from public.projects pr where pr.project_id = d.project_id) end
    from p2_duty d where d.responsibility_id = r.responsibility_id;
  for x in select rule, count(*) c from p2_duty group by 1 order by 1 loop
    v_report := v_report || 'duty ' || x.rule || ' = ' || x.c || E'\n';
    insert into public.office_backfill_report (wave, table_name, rule, n) values ('0657', 'responsibilities', x.rule, x.c);
  end loop;

  -- ---- jobs --------------------------------------------------------------------------------------------------
  create temp table p2_tree on commit drop as
  with recursive t(job_id, root_id) as (
    select job_id, job_id from public.jobs where parent_job_id is null
    union all
    select j.job_id, t.root_id from public.jobs j join t on j.parent_job_id = t.job_id)
  select * from t;
  select count(*) into v_n from public.jobs;
  if (select count(*) from p2_tree) <> v_n then
    raise exception '0657: % job(s) are not reachable from a root; the tree walk is incomplete', v_n - (select count(*) from p2_tree);
  end if;

  -- Every place a job is tied to a project: its own column, and the rows it produced or was asked in. A row that names
  -- both a job and a project says the job's work lives in that project; the composite keys later insist the two agree.
  create temp table p2_job_project on commit drop as
  select job_id as job_id, project_id, 'jobs' as src from public.jobs where project_id is not null
  union select job_id as job_id, project_id, 'inbound_commands' as src from public.inbound_commands where job_id is not null and project_id is not null
  union select from_job as job_id, project_id, 'decisions' as src from public.decisions where from_job is not null and project_id is not null
  union select from_job as job_id, project_id, 'lessons' as src from public.lessons where from_job is not null and project_id is not null
  union select from_job as job_id, project_id, 'skills' as src from public.skills where from_job is not null and project_id is not null
  union select job_id as job_id, project_id, 'tasks' as src from public.tasks where job_id is not null and project_id is not null
  union select job_id as job_id, project_id, 'blockers' as src from public.blockers where job_id is not null and project_id is not null
  union select job_id as job_id, project_id, 'notebook_spend' as src from public.notebook_spend where job_id is not null and project_id is not null
  union select job_id as job_id, project_id, 'notebook_sync_queue' as src from public.notebook_sync_queue where job_id is not null and project_id is not null
  union select caused_by_job as job_id, project_id, 'signals' as src from public.signals where caused_by_job is not null and project_id is not null
  union select related_job_id as job_id, project_id, 'events' as src from public.events where related_job_id is not null and project_id is not null
  union select job_id as job_id, project_id, 'browser_actions' as src from public.browser_actions where job_id is not null and project_id is not null
  union select produced_by_job as job_id, project_id, 'documents' as src from public.documents where produced_by_job is not null and project_id is not null;

  create index on p2_tree (job_id);
  create index on p2_tree (root_id);
  create index on p2_job_project (job_id);
  analyze p2_tree;
  analyze p2_job_project;

  -- The job's own project column outranks what the rows around it say: a command's project is the scope the chat
  -- happened to be pointed at, the job's is the project it was made for.
  create temp table p2_harness_root on commit drop as
  select r.root_id, app.harness_job(r.root_id) as harness from (select distinct root_id from p2_tree) r;
  create index on p2_harness_root (root_id);
  -- A suite's trees are decided by the job's own project only: a harness command is scoped to whichever project the chat
  -- happened to be pointed at (usually the catch-all one), which is no evidence that the suite was working in it.
  create temp table p2_tree_project on commit drop as
  select t.root_id, jp.src, pr.slug, pr.office_id
    from p2_tree t join p2_job_project jp on jp.job_id = t.job_id join public.projects pr on pr.project_id = jp.project_id
    join p2_harness_root h on h.root_id = t.root_id
   where jp.src = 'jobs' or not h.harness;
  create index on p2_tree_project (root_id);
  create temp table p2_root on commit drop as
  select tp.root_id, array_agg(distinct tp.office_id) as project_offices
    from p2_tree_project tp
   where tp.src = 'jobs' or tp.root_id not in (select tq.root_id from p2_tree_project tq where tq.src = 'jobs')
   group by tp.root_id
  union all
  select t.root_id, null::uuid[] from (select distinct root_id from p2_tree) t
   where t.root_id not in (select root_id from p2_tree_project);

  select string_agg(d.line, E'\n') into v_bad from (
    select left(tp.root_id::text, 8) || ' ' || tp.src || ' -> ' || tp.slug as line
      from p2_tree_project tp join p2_root r on r.root_id = tp.root_id
     where cardinality(r.project_offices) > 1
       and (tp.src = 'jobs' or tp.root_id not in (select tq.root_id from p2_tree_project tq where tq.src = 'jobs'))
     group by 1 order by 1 limit 40) d;
  if v_bad is not null then raise exception E'0657: job trees spanning projects of different offices:\n%', v_bad; end if;

  create temp table p2_job_rule on commit drop as
  select r.root_id, j.requested_by,
    case
      when r.project_offices is not null then 'project'
      when app.harness_job(r.root_id) then 'test:harness'
      when j.requested_by like 'duty:%' then
        case when exists (select 1 from public.responsibilities d where d.slug = substr(j.requested_by, 6)) then 'duty' else 'UNRESOLVED:unknown duty' end
      when j.requested_by = 'connector:register' then 'person:connector-register'
      when app.harness_actor(j.requested_by) then 'test:suite-requester'
      when j.requested_by = 'hq' and j.kind = 'office.rename_channels' and j.state::text = 'cancelled'
           and not exists (select 1 from public.projects q where q.office_id = v_person and q.channel_prefix = j.pinned_config ->> 'prefix')
        then 'test:discarded-rename'
      when exists (select 1 from public.office_members m join auth.users u on lower(u.email) = m.email
                    join public.offices o on o.auth_user_id = u.id
                   where m.kind = 'person' and o.kind = 'person'
                     and (m.owner_key = split_part(j.requested_by, ':', 2) or m.owner_key = j.requested_by))
        then 'person:requester'
      else 'UNRESOLVED' end as rule
  from p2_root r join public.jobs j on j.job_id = r.root_id;
  select string_agg(distinct requested_by, ', ') into v_bad from (select requested_by from p2_job_rule where rule like 'UNRESOLVED%' limit 20) s;
  if v_bad is not null then raise exception '0657: root jobs no rule proves an owner for (requested_by): %', v_bad; end if;

  create temp table p2_job_office on commit drop as
  select r.root_id,
    case
      when jr.rule = 'project' then r.project_offices[1]
      when jr.rule = 'duty' then (select d.office_id from public.responsibilities d where d.slug = substr(jr.requested_by, 6))
      when jr.rule like 'person:%' then v_person
      else v_test end as office_id,
    jr.rule
  from p2_root r join p2_job_rule jr using (root_id);

  update public.jobs j set office_id = o.office_id
    from p2_tree t join p2_job_office o on o.root_id = t.root_id
   where j.job_id = t.job_id;

  for x in select jo.rule, count(*) c from p2_tree t join p2_job_office jo using (root_id) group by 1 order by 1 loop
    v_report := v_report || 'job (by tree) ' || x.rule || ' = ' || x.c || E'\n';
    insert into public.office_backfill_report (wave, table_name, rule, n) values ('0657', 'jobs', 'tree: ' || x.rule, x.c);
  end loop;
  for x in select o.kind, count(*) c from public.jobs j join public.offices o on o.office_id = j.office_id group by 1 order by 1 loop
    v_report := v_report || 'jobs owned by ' || x.kind || ' office = ' || x.c || E'\n';
  end loop;
  select count(*) into v_n from public.jobs j join public.offices o on o.office_id = j.office_id
   where o.kind = 'person' and app.harness_job(j.job_id);
  v_report := v_report || 'harness jobs forced into the person office by a real project (flagged, counted) = ' || v_n || E'\n';
  insert into public.office_backfill_report (wave, table_name, rule, n)
  values ('0657', 'jobs', 'FLAG: a harness job on a real project took the project''s office (composite key cannot say test-inside-person)', v_n);

  -- ---- nothing left unowned, nothing inconsistent --------------------------------------------------------------
  select (select count(*) from public.projects where office_id is null)
       + (select count(*) from public.responsibilities where office_id is null)
       + (select count(*) from public.jobs where office_id is null) into v_n;
  if v_n <> 0 then raise exception '0657: % row(s) still unowned after the rules', v_n; end if;
  select count(*) into v_n from public.jobs j join public.jobs p on p.job_id = j.parent_job_id where p.office_id <> j.office_id;
  if v_n <> 0 then raise exception '0657: % child job(s) in a different office from their parent', v_n; end if;
  select count(*) into v_n from public.jobs j join public.projects p on p.project_id = j.project_id where p.office_id <> j.office_id;
  if v_n <> 0 then raise exception '0657: % job(s) in a different office from their project', v_n; end if;

  alter table public.jobs enable trigger user;
  alter table public.responsibilities enable trigger user;
  alter table public.projects enable trigger user;
  if exists (select 1 from pg_trigger t where t.tgrelid in ('public.jobs'::regclass, 'public.projects'::regclass, 'public.responsibilities'::regclass)
              and not t.tgisinternal and t.tgenabled <> 'O') then
    raise exception '0657: a trigger was left disabled';
  end if;

  v_report := v_report || 'elapsed since the transaction began = ' || (clock_timestamp() - transaction_timestamp()) || E'\n';
  if current_setting('p2.dry_run', true) = '0657' then
    raise exception E'P2REPORT\n%', v_report;
  end if;
  raise notice E'0657 backfill:\n%', v_report;
end
$m$;

-- ---- constrain: composite keys, same-office edges, write-once, the bridge, NOT NULL ----------------------------------
alter table public.projects add constraint projects_id_office_key unique (project_id, office_id);
alter table public.jobs add constraint jobs_id_office_key unique (job_id, office_id);

alter table public.jobs add constraint jobs_project_same_office
  foreign key (project_id, office_id) references public.projects (project_id, office_id) not valid;
alter table public.jobs add constraint jobs_parent_same_office
  foreign key (parent_job_id, office_id) references public.jobs (job_id, office_id) not valid;
alter table public.jobs add constraint jobs_root_same_office
  foreign key (root_job_id, office_id) references public.jobs (job_id, office_id) not valid;
alter table public.responsibilities add constraint responsibilities_project_same_office
  foreign key (project_id, office_id) references public.projects (project_id, office_id) not valid;
alter table public.jobs validate constraint jobs_project_same_office;
alter table public.jobs validate constraint jobs_parent_same_office;
alter table public.jobs validate constraint jobs_root_same_office;
alter table public.responsibilities validate constraint responsibilities_project_same_office;

alter table public.projects alter column office_id set not null;
alter table public.responsibilities alter column office_id set not null;
alter table public.jobs alter column office_id set not null;

select app.p2_guard_table('projects', '', '', '');
select app.p2_guard_table('responsibilities', 'project_id', '', 'created_by');
select app.p2_guard_table('jobs', 'project_id', 'parent_job_id', 'requested_by');

-- ROLLBACK (not part of the migration): drop the five composite constraints, the two unique keys and the guard
-- triggers (a0_office_bridge, a1_office_write_once) on these three tables; alter column office_id drop not null;
-- update ... set office_id = null needs the write-once trigger dropped first.
