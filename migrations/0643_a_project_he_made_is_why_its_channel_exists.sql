-- 0643 - a project a person made is the durable reason its Slack channel may be made.
--
-- Grant's decision 2: when he explicitly creates a project, that project's normal Slack channel is part of the
-- authorised operation - he must not be asked "create this project's channel?" a moment later. A channel nobody
-- asked for still asks (`slack.channel`, 0640), and Slack cannot delete a channel, so the reason has to be a durable
-- fact the office can explain later, not a mood of the moment.
--
-- `public.slack_channel_authority` is that fact: one row per project, written ONLY here -
--   * by `app.hq_create_project(.., p_by)`, from the verified principal the gateway wrote, when that principal is a
--     person; or
--   * by `app.record_channel_authority(project, job)`, called by the plan executor for the project a person's own
--     turn made, where `app.person_provenance` decides from the job's origin in the database.
-- It has no client-writable surface (no public grant, row-level security on, no policy), its provenance is a person
-- or nothing, and a duty or any other office-made job cannot produce one: `person_provenance` refuses it. The handler
-- reads the row, and consumes it once the channel exists, so a retry or a second run finds nothing left to spend and
-- `ensureChannel` (already idempotent on the mapping) makes no second channel.
--
-- Slack renaming is not implemented anywhere in the office (`office.rename_channels` only ever ensures the channel
-- exists), so there is no rename authority to record; if a rename is ever built it needs its own.
--
-- `p_by` is the LAST parameter and defaults to null, so a caller that does not pass it still creates the project
-- and simply leaves no authority behind - its channel then asks. Old signature dropped by exact signature.

create table public.slack_channel_authority (
  project_id      uuid primary key references public.projects (project_id) on delete cascade,
  authorized_by   text not null check (btrim(authorized_by) <> ''),
  authorized_via  text not null check (authorized_via in ('project_creation')),
  source_job      uuid references public.jobs (job_id),
  created_at      timestamptz not null default app.now_utc(),
  consumed_at     timestamptz,
  consumed_by_job uuid references public.jobs (job_id),
  constraint slack_channel_authority_consumed_says_when check (consumed_by_job is null or consumed_at is not null)
);
comment on table public.slack_channel_authority is
  'Why a project''s normal Slack channel may be made without asking: a person made the project (0643). Written only by '
  'app.hq_create_project and app.record_channel_authority; consumed once by the provisioning job.';
alter table public.slack_channel_authority enable row level security;
alter table public.slack_channel_authority force row level security;
revoke all on table public.slack_channel_authority from anon, authenticated;

create function app.record_channel_authority(p_project uuid, p_by text, p_job uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
declare v_who text; v_fixture boolean;
begin
  select is_fixture into v_fixture from public.projects where project_id = p_project;
  if v_fixture is null then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;
  -- A fixture never gets a channel (0266), so there is nothing to authorise.
  if v_fixture then
    return jsonb_build_object('ok', false, 'error', 'a fixture project has no channel');
  end if;
  v_who := app.person_provenance(p_by, p_job);
  if v_who is null then
    return jsonb_build_object('ok', false, 'error', 'only a person making a project authorises its channel');
  end if;
  insert into public.slack_channel_authority (project_id, authorized_by, authorized_via, source_job)
  values (p_project, v_who, 'project_creation', case when btrim(coalesce(p_by, '')) = '' then p_job end)
  on conflict (project_id) do nothing;
  return jsonb_build_object('ok', true, 'project', p_project, 'authorized_by', v_who);
end;
$f$;

-- The handler's reads and its one write, as functions, so what it may do is exactly this.
create function app.channel_authority(p_project uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$
  select jsonb_build_object('authorized_by', a.authorized_by, 'via', a.authorized_via, 'since', a.created_at,
                            'source_job', a.source_job)
    from public.slack_channel_authority a
   where a.project_id = p_project and a.consumed_at is null
$f$;

create function app.consume_channel_authority(p_project uuid, p_job uuid)
returns boolean language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
declare v_n int;
begin
  update public.slack_channel_authority
     set consumed_at = app.now_utc(), consumed_by_job = p_job
   where project_id = p_project and consumed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$f$;

-- ---- hq_create_project carries the principal ---------------------------------------------------------------------
do $m$
declare v_def text; v_old text;
begin
  v_def := pg_get_functiondef('app.hq_create_project(text,text,text,text,boolean)'::regprocedure);
  v_old := E'  perform app.add_project_alias(v_id, trim(p_name), ''name'', 1.0);\n';
  if position(v_old in v_def) = 0 then raise exception '0643: hq_create_project is not shaped as expected'; end if;
  v_def := replace(v_def, 'p_force boolean DEFAULT false)', 'p_force boolean DEFAULT false, p_by text DEFAULT NULL::text)');
  v_def := replace(v_def, E'  v_near   jsonb;\nbegin',
    E'  v_near   jsonb;\n  v_refusal text;\nbegin\n  -- A test member makes only a test project; nobody unknown at all (0614''s rule on this door).\n  if btrim(coalesce(p_by, '''')) <> '''' then\n    v_refusal := app.authority_refusal(btrim(p_by), null, null);\n    if v_refusal is not null and app.principal_kind(p_by) <> ''harness'' then\n      return jsonb_build_object(''error'', v_refusal);\n    end if;\n  end if;');
  v_def := replace(v_def, v_old, v_old ||
    E'  -- He made this project, so its normal channel is part of what he asked for - recorded, durably, with who.\n  perform app.record_channel_authority(v_id, p_by, null);\n');
  drop function app.hq_create_project(text, text, text, text, boolean);
  execute v_def;
end $m$;

drop function public.hq_create_project(text, text, text, text, boolean);
create function public.hq_create_project(p_name text, p_connector text, p_ref text, p_display text default null,
                                         p_force boolean default false, p_by text default null)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog' as $f$
  select app.hq_create_project(p_name, p_connector, p_ref, p_display, p_force, p_by)
$f$;
