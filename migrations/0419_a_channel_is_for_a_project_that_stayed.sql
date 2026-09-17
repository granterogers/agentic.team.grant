-- A channel is for a project that STAYED (#187, correcting 0416).
--
-- 0416 enqueued channel provisioning the moment a dashboard project was
-- created, guarded against fixture slugs. That guard was not enough and the
-- cost was immediate and visible: `verify:identity` creates its subjects
-- through `app.hq_create_project` with names like `identity-proof-<run>`,
-- deliberately NOT fixture names — #45's rule, because that suite tests a
-- feature which filters fixtures and would otherwise pass for the wrong
-- reason.
--
-- So six real channels were created in Grant's workspace by two runs of a test
-- suite, and Slack offers no delete outside Enterprise Grid. They can only be
-- archived. That is the permanent, visible cost this file already warned about
-- one migration earlier, arriving through the door the warning did not cover.
--
-- The second failure is worse than the first: a project that has gathered a
-- job can never be deleted, so `verify:identity`'s teardown began failing with
-- `jobs_project_id_fkey` and the suite could not clean up after itself.
--
-- ## The fix is TIME, not a longer list of names
--
-- Enumerating the shapes a suite's project can take is the same mistake with
-- more words: the next suite will choose a name nobody listed. What separates
-- a test subject from a dashboard project is not its name, it is that one of
-- them is gone in seconds.
--
-- So: no enqueue at creation, and the periodic sweep only provisions a project
-- that is active, not a fixture, has at least one enabled attachment, and is
-- FIFTEEN MINUTES OLD. A suite's project never reaches that; a project Grant
-- makes gets its channel on the next sweep, which is right — the channel is a
-- consequence of a project existing, not a precondition of it.
--
-- The attachment clause is the second half: ADR-0014 says an active project
-- reads from and writes to somewhere real, so a project with nothing attached
-- is half-made and does not need a room yet.

-- 1. Take the enqueue back out of the creation path.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'hq_create_project'
   limit 1;

  if v_def is null then
    raise exception 'app.hq_create_project is missing';
  end if;
  if position('office.provision_channels' in v_def) = 0 then
    raise exception '0416 enqueue is already gone — check what changed before re-running this';
  end if;

  v_def := regexp_replace(
    v_def,
    '\s*-- A room of its own, from the moment it exists.*?end if;',
    '',
    'ns'
  );
  if position('office.provision_channels' in v_def) > 0 then
    raise exception 'the enqueue block did not match — refusing to apply a half-edit';
  end if;

  execute v_def;
end $$;

-- 2. The sweep, with the two conditions that separate a project from a probe.
create or replace function app.provision_missing_channels()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with want as (
    select p.project_id, p.name
      from public.projects p
     where p.status = 'active'
       and not p.is_fixture
       -- Fifteen minutes. A suite's subject is gone long before this; a
       -- project Grant made is still here.
       and p.created_at < app.now_utc() - interval '15 minutes'
       -- ADR-0014: an active project reads from and writes to somewhere real.
       -- One with nothing attached is half-made and does not need a room yet.
       and exists (
         select 1 from public.project_attachments a
          where a.project_id = p.project_id and a.enabled)
       and not exists (
         select 1 from public.slack_channel_map m
          where m.project_id = p.project_id and m.active)
  ),
  queued as (
    insert into public.jobs
      (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
    select gen_random_uuid(), w.project_id, format('provision-%s', w.project_id),
           'office.provision_channels', 'hq', 300
      from want w
    on conflict (idempotency_key) where state in ('queued','running','retrying') do nothing
    returning project_id
  )
  select jsonb_build_object(
    'wanted', (select count(*)::int from want),
    'queued', (select count(*)::int from queued),
    'projects', coalesce((select jsonb_agg(w.name order by w.name) from want w), '[]'::jsonb)
  )
$function$;

comment on function app.provision_missing_channels() is
  'Enqueue a channel for every active, attached, non-fixture dashboard project '
  'older than fifteen minutes that has none (#187, 0419). The age is what '
  'separates a project from a test subject; a name never could.';
