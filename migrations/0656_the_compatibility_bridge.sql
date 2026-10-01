-- 0656 - the compatibility bridge: who owns a row written by code that does not yet say (multi-user P2).
--
-- P3 (the function surface) has not happened, so every writer in the building - 878 functions, the worker, the
-- adapters, forty suites - still inserts rows with no office. Once a table's office_id is NOT NULL those inserts would
-- fail. Rather than convert them in this phase, a BEFORE INSERT trigger on each carrier asks THIS function for the
-- office when the writer supplied none. It is a bridge, and it is deliberately narrow:
--
--   1. a row naming a PROJECT takes that project's office, then one naming a JOB takes the job's. (An office is never
--      derived from a parent to GRANT authority - the parent is the thing being checked; here it only fills in a
--      column for a legacy writer, and the composite keys then verify the edge. The verified identity that
--      decides WHO may write at all is the gateway's, unchanged.)
--   2. a duty's or trigger's job takes the office of the duty or trigger itself (an unknown one fails closed);
--   3. otherwise a row whose actor is a harness name goes to the TEST office;
--   4. otherwise it goes to the sole PERSON office - and ONLY while exactly one person office exists and no sample
--      office does. The moment a second real office or a sample is active the answer is NULL, the insert fails the
--      NOT NULL, and a legacy writer cannot write at all. That is the intended behaviour: no second real office may be
--      activated before P3 removes this function. Nothing here is a column default.
--
-- It is MEASURABLE: every use of rule 2 or 3 is counted in public.office_bridge_use, per table and rule, so the
-- removal point (P3's last wave) is observable as a counter that stops moving, and a writer still leaning on it shows.
--
-- It must not be mistaken for architecture. It is debt with a tracked end: the 47 ambient-Grant functions go in P3.

create table public.office_bridge_use (
  table_name text not null,
  rule       text not null check (rule in ('test_actor', 'sole_person')),
  n          bigint not null default 0,
  last_at    timestamptz not null default app.now_utc(),
  primary key (table_name, rule)
);
comment on table public.office_bridge_use is
  'How often a legacy writer relied on the compatibility bridge (app.bridge_office). When P3 removes the bridge this stops moving.';
alter table public.office_bridge_use enable row level security;
create policy office_bridge_use_app_all on public.office_bridge_use for all to ai_team_app using (true) with check (true);
revoke all on table public.office_bridge_use from anon, authenticated;

create function app.sole_person_office()
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  -- NULL (fail closed) unless there is exactly one active real office and it is a person.
  select case
    when (select count(*) from public.offices where kind in ('person', 'sample') and state = 'active') = 1
    then (select o.office_id from public.offices o where o.kind = 'person' and o.state = 'active')
  end
$f$;

create function app.test_office()
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select case when (select count(*) from public.offices where kind = 'test' and state = 'active') = 1
              then (select o.office_id from public.offices o where o.kind = 'test' and o.state = 'active') end
$f$;

create function app.system_office()
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select o.office_id from public.offices o where o.kind = 'system'
$f$;

-- One definition of "this actor name is a suite's", for the backfill and the bridge alike.
create function app.harness_actor(p_actor text)
returns boolean
language sql
stable
set search_path to ''
as $f$
  select coalesce(p_actor, '') <> '' and (
       app.harness_label(p_actor)
    or p_actor ~ '(^|:)[a-z-]*proof-'
    or p_actor ~ '^verification:'
    or app.principal_kind(p_actor) = 'harness')
$f$;

create function app.bridge_office(p_table text, p_project uuid, p_job uuid, p_actor text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v uuid;
  v_rule text;
begin
  if p_project is not null then
    select pr.office_id into v from public.projects pr where pr.project_id = p_project;
    if v is not null then return v; end if;
  end if;
  if p_job is not null then
    select j.office_id into v from public.jobs j where j.job_id = p_job;
    if v is not null then return v; end if;
  end if;
  -- A duty's job belongs to whoever the duty belongs to (responsibilities.office_id). An unknown duty returns NULL:
  -- the insert fails rather than the job silently becoming somebody's.
  if p_actor like 'duty:%' then
    select r.office_id into v from public.responsibilities r where r.slug = substr(p_actor, 6);
    return v;
  end if;
  if p_actor like 'trigger:%' then
    select t.office_id into v from public.event_triggers t where t.name = substr(p_actor, 9);
    return v;
  end if;
  if app.harness_actor(p_actor) then
    v := app.test_office();
    v_rule := 'test_actor';
  else
    v := app.sole_person_office();
    v_rule := 'sole_person';
  end if;
  if v is not null then
    insert into public.office_bridge_use (table_name, rule, n) values (p_table, v_rule, 1)
    on conflict (table_name, rule) do update set n = public.office_bridge_use.n + 1, last_at = app.now_utc();
  end if;
  return v;
end;
$f$;

-- The write-once rule for office_id on a carrier: set once (from null), never changed.
create function app.office_id_is_write_once()
returns trigger
language plpgsql
set search_path to ''
as $f$
begin
  if old.office_id is not null and new.office_id is distinct from old.office_id then
    raise exception 'office_id is write-once on %', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$f$;

-- The trigger that fills a legacy writer's missing office. Arguments name the columns it may read: the project, the
-- job (a parent job for a job) and the actor, each '' when the table has none.
create function app.office_bridge_trigger()
returns trigger
language plpgsql
set search_path to ''
as $f$
declare
  v_row jsonb := to_jsonb(new);
  v_project uuid;
  v_job uuid;
  v_actor text;
begin
  if new.office_id is not null then
    return new;
  end if;
  if tg_argv[0] <> '' then v_project := nullif(v_row ->> tg_argv[0], '')::uuid; end if;
  if tg_argv[1] <> '' then v_job := nullif(v_row ->> tg_argv[1], '')::uuid; end if;
  if tg_argv[2] <> '' then v_actor := v_row ->> tg_argv[2]; end if;
  new.office_id := app.bridge_office(tg_table_name, v_project, v_job, v_actor);
  return new;
end;
$f$;

-- Installs both guards on one carrier. Used by the backfill waves; idempotent.
create function app.p2_guard_table(p_table text, p_project_col text, p_job_col text, p_actor_col text)
returns void
language plpgsql
set search_path to ''
as $f$
begin
  execute format('drop trigger if exists a0_office_bridge on public.%I', p_table);
  execute format(
    'create trigger a0_office_bridge before insert on public.%I for each row execute function app.office_bridge_trigger(%L, %L, %L)',
    p_table, p_project_col, p_job_col, p_actor_col);
  execute format('drop trigger if exists a1_office_write_once on public.%I', p_table);
  execute format(
    'create trigger a1_office_write_once before update of office_id on public.%I for each row execute function app.office_id_is_write_once()',
    p_table);
end;
$f$;

revoke all on function app.office_bridge_trigger(), app.p2_guard_table(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function app.sole_person_office(), app.test_office(), app.system_office(), app.harness_actor(text),
  app.bridge_office(text, uuid, uuid, text) from public, anon, authenticated, service_role;

-- ROLLBACK (not part of the migration): drop the bridge triggers installed by the waves first, then drop table
-- public.office_bridge_use and the six functions above.
