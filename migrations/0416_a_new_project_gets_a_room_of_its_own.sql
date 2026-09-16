-- A new dashboard project gets a Slack channel, without anybody remembering
-- (#187).
--
-- Grant, 13 September: *"all projects have a dedicated channel name in
-- Slack."* Measured this evening, four of the five active dashboard projects
-- had none.
--
-- Not for want of machinery. `ChannelProvisioner` has been good for weeks —
-- project-first underscored names so Slack's flat list groups a project's
-- rooms together, `name_taken` resolved by looking rather than by adopting a
-- stranger's channel, a human invited on creation because the first real
-- project channel had the bot as its only member. Its only callers were
-- `scripts/verify/slack.ts` and `scripts/projects/manage.ts`.
--
-- So a channel existed exactly where somebody had happened to run a script,
-- which is CLAUDE.md's standing complaint in its own words: **a capability
-- that exists only as a script an agent runs is a capability Grant does not
-- have.**
--
-- ## Enqueued, not called
--
-- Creating a channel is a Slack API call and this is SQL. 0266 already
-- established the shape for the rename direction: the function enqueues, the
-- worker carries it out, and the page reports that it is pending rather than
-- claiming something it cannot perform.
--
-- ## Never for a fixture
--
-- 0266's rule, and the reason is worth restating rather than referencing: a
-- channel is permanent and visible in Grant's workspace — Slack offers no
-- delete outside Enterprise Grid — so a fixture project that provisioned one
-- would leave a room in his sidebar for ever. The handler checks this too. Two
-- guards rather than one, because the cost is asymmetric and permanent.
--
-- Patched from the live definition, with the anchor asserted first so this
-- fails loudly if the function has moved on.

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
  if position('perform app.add_project_alias(v_id, trim(p_name), ''name'', 1.0);' in v_def) = 0 then
    raise exception 'the anchor has moved — hq_create_project must be re-read before patching';
  end if;

  v_def := replace(
    v_def,
    'perform app.add_project_alias(v_id, trim(p_name), ''name'', 1.0);',
    'perform app.add_project_alias(v_id, trim(p_name), ''name'', 1.0);' || E'\n\n' ||
    '  -- A room of its own, from the moment it exists (#187). The channel name' || E'\n' ||
    '  -- comes from v_prefix, which is derived from the NAME the same way the' || E'\n' ||
    '  -- slug is — so a project cannot end up with two identities.' || E'\n' ||
    '  if not coalesce(v_slug like ''fixture-%'' or v_slug like ''verify-%''' || E'\n' ||
    '         or v_slug like ''ledger-proof-%'', false) then' || E'\n' ||
    '    insert into public.jobs' || E'\n' ||
    '      (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)' || E'\n' ||
    '    values (gen_random_uuid(), v_id, format(''provision-%s'', v_id),' || E'\n' ||
    '            ''office.provision_channels'', ''hq'', 300,' || E'\n' ||
    '            jsonb_build_object(''prefix'', v_prefix));' || E'\n' ||
    '  end if;'
  );

  execute v_def;
end $$;

/*
  And the same for the projects that already exist (#187).

  A function rather than a one-off statement, because the four projects that
  need it today are not the point — the point is that this can be asked again
  after any period when Slack was disconnected, and answer "nothing to do".

  It enqueues; it does not create. Everything else in this migration is about
  keeping the Slack call on the worker's side of the line.
*/
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
  'Enqueue a channel for every active, non-fixture dashboard project that has '
  'none (#187). Idempotent: a project with a live provisioning job is skipped.';

grant execute on function app.provision_missing_channels() to ai_team_app, service_role;
