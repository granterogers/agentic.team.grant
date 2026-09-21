-- 0541 — Synthetic work cannot cross a real external boundary
--
-- On 21 September at 21:09 `verify:history` sent a real Telegram message to
-- Grant's own chat (message 1265) and a real Slack message, and reported
-- **51/51, exit 0** while doing it. The body carried its own run token:
--
--     "I have no record of wm1ghfjv in our indexed data..."
--
-- 0523 exists to make exactly this impossible and did not stop it.
--
-- ## Why 0523 could not stop it
--
-- `app.claim_delivery` asks `app.deliverable_to`, which asks
-- `app.harness_job`, which is DERIVED from `jobs.is_fixture` (generated from
-- `requested_by`) and from whether the project is a fixture.
--
-- `verify:history` drives the real ingress on purpose — that is the point of
-- the suite — so while the job RUNS its `requested_by` is `telegram:grant`.
-- At send time `harness_job` is false, the guard permits it, and production
-- does the real thing with it. The suite then rewrites `requested_by` in
-- teardown, which makes `is_fixture` generated true RETROACTIVELY. That is
-- why `check:leaks` can see the escape afterwards and why nothing could have
-- prevented it.
--
-- The suite's own assertion — *no job of this run is still counted as
-- something Grant asked* — passes. It proves the attribution was corrected.
-- It cannot prove nothing was sent. 0523's own header names the distinction
-- and this is it one layer deeper:
--
--     "clean now" and "no synthetic side effect ever escaped" are different
--     claims, and only the first was being made.
--
-- ## The actual defect, stated once
--
-- **Every input to the guard was a value the harness controls.** A test whose
-- job is to look real will look real to anything that inspects the work. So
-- the marker must not come from the work at all.
--
-- ## What cannot be faked: which door the work came through
--
-- Measured, not assumed. Every REAL inbound command is written by an edge
-- function through PostgREST — `telegram-webhook`, `slack-events` and `voice`
-- POST to `/rest/v1/inbound_commands`, and `say_in_project`,
-- `send_to_agent` and `record_slack_history` are PostgREST RPCs called by
-- `hq-api` and `slack-events`. **Nothing in `src/` inserts that table at
-- all** — the worker only consumes it. A script has one route to this
-- database, the Management API, and it arrives as:
--
--     usename         application_name
--     postgres        mgmt-api            <- every script, every suite, me
--     authenticator   PostgREST 14.5      <- every real person's message
--     supabase_admin  pg_cron scheduler   <- the heartbeat
--
-- So the door is a fact about the connection, established before the row
-- exists, and a suite cannot change it by naming itself differently.
--
-- ## Where the strictness is, and where it deliberately is not
--
-- `inbound_commands` is stamped by the door: anything not arriving through a
-- recognised production ingress is synthetic. That is DENY BY DEFAULT, and it
-- is safe there because the production writers are enumerated above and
-- proven.
--
-- `public.jobs` is NOT stamped by the door, and that is deliberate. Eleven SQL
-- functions create jobs and the worker calls several of them — and the worker
-- falls back to the Management API whenever its direct Postgres connection is
-- unavailable. Stamping jobs by connection would mean that a worker running
-- degraded would silently stop delivering Grant's real answers, which is a
-- worse failure than the one being fixed. So a job gets its mark from its
-- LINEAGE: `enqueue_inbound` takes it from the command, `enqueue_child` takes
-- it from the parent, and everything else defaults to false.
--
-- ## Immutable, because mutation is the attack
--
-- `jobs.synthetic` cannot be changed after insert. The defect was a suite
-- rewriting attribution around a send; a mark that can be rewritten is the
-- same defect with a new column name. `inbound_commands.synthetic` is frozen
-- the same way.
--
-- ## Why the ingress list is data
--
-- If Supabase renames PostgREST's `application_name`, a deny-by-default rule
-- would stamp real traffic as synthetic and Grant would stop receiving
-- answers. That is the one direction this must not fail in, so the list of
-- production doors is a `system_config` row: one statement widens it, no
-- migration, no deploy. `verify:escapes` asserts a simulated production
-- insert is NOT stamped, so the drift is caught by a check rather than by
-- Grant noticing silence.

begin;

insert into public.system_config (key, value, description)
values (
  'delivery.production_ingress',
  '["PostgREST%"]'::jsonb,
  'LIKE patterns for the application_name of a connection permitted to create '
  'real inbound work. Every real message arrives through an edge function over '
  'PostgREST; a script reaches this database only through the Management API, '
  'which announces itself as mgmt-api. Data rather than code so that a rename '
  'at the vendor is one statement rather than a migration and a deploy (0541).'
)
on conflict (key) do nothing;

alter table public.inbound_commands
  add column if not exists synthetic boolean not null default false;

alter table public.jobs
  add column if not exists synthetic boolean not null default false;

comment on column public.inbound_commands.synthetic is
  'This did not come through a production door. Stamped from the connection '
  'at insert and never afterwards (0541).';
comment on column public.jobs.synthetic is
  'This work is synthetic. Taken from the inbound command or inherited from '
  'the parent job, never from anything the harness can rename, and immutable '
  'once set (0541).';

-- ── The door test ──────────────────────────────────────────────────────────

create or replace function app.from_production_ingress()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from jsonb_array_elements_text(
             coalesce(
               (select value from public.system_config
                 where key = 'delivery.production_ingress'),
               '["PostgREST%"]'::jsonb)) as pattern
     where coalesce(current_setting('application_name', true), '') like pattern
  )
$fn$;

comment on function app.from_production_ingress() is
  'Whether this connection is one a real person''s message can arrive through. '
  'Read from system_config so a vendor rename is one statement (0541).';

create or replace function app.stamp_synthetic_inbound()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Deny by default: anything that did not come through a production door is
  -- synthetic, whatever it calls itself.
  if not app.from_production_ingress() then
    new.synthetic := true;
  end if;
  return new;
end;
$fn$;

drop trigger if exists inbound_commands_stamp_synthetic on public.inbound_commands;
create trigger inbound_commands_stamp_synthetic
before insert on public.inbound_commands
for each row execute function app.stamp_synthetic_inbound();

-- ── Immutable, because mutation is the attack ──────────────────────────────

create or replace function app.synthetic_is_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.synthetic is distinct from old.synthetic then
    raise exception
      'synthetic is decided when the work is created and cannot be changed '
      '(% -> %). The defect this refuses is a suite rewriting its attribution '
      'around a send.', old.synthetic, new.synthetic
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists inbound_commands_synthetic_immutable on public.inbound_commands;
create trigger inbound_commands_synthetic_immutable
before update of synthetic on public.inbound_commands
for each row execute function app.synthetic_is_immutable();

drop trigger if exists jobs_synthetic_immutable on public.jobs;
create trigger jobs_synthetic_immutable
before update of synthetic on public.jobs
for each row execute function app.synthetic_is_immutable();

-- ── The send-time guard learns about it ────────────────────────────────────

create or replace function app.harness_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
  select coalesce(
    (select j.synthetic or j.is_fixture or coalesce(p.is_fixture, false)
       from public.jobs j
       left join public.projects p on p.project_id = j.project_id
      where j.job_id = p_job_id),
    false)
$function$;

comment on function app.harness_job(uuid) is
  'Is this job harness traffic? Three witnesses, any of which is enough, and '
  'each can only ever EXCLUDE: the immutable synthetic mark taken from the '
  'door the work came through (0541), the generated is_fixture, and whether '
  'the project is a fixture. app.deliverable_to asks this before anything '
  'touches a network.';

commit;
