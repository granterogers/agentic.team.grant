-- ADR-0065: building the end-to-end proof of the Slack install found that events from a person's own connected workspace would
-- have been IGNORED. `app.slack_team_ok` and `public.slack_ingress_ok` recognise a workspace only through an enabled row of
-- `public.slack_app_credentials` (the deployment's own install), and a person's install is a row of `public.slack_installs`
-- (0891). So the status page would have said "connected, can receive" and the door would have answered "unrecognised workspace"
-- to every message. Both halves right alone, only their disagreement wrong.
--
-- An ACTIVE install counts as the workspace's installation, for the office that made it and for no other: the same
-- one-workspace-one-office rule the credentials row enforced. The deployment's own path is unchanged, byte for byte in effect.

create or replace function app.slack_team_ok(p_team text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select coalesce(p_team ~ '^T[A-Z0-9]{8,}$', false)
     and (exists (select 1 from public.slack_app_credentials c
                   where c.team_id = p_team and c.enabled and c.revoked_at is null)
          or exists (select 1 from public.slack_installs i
                      where i.team_id = p_team and i.state = 'active'))
$f$;

create or replace function public.slack_ingress_ok(p_office uuid, p_team text, p_channel text default null)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select p_office is not null
     and exists (select 1 from public.offices o where o.office_id = p_office and o.state = 'active')
     and app.slack_team_ok(p_team)
     -- The installation the event came through is the SENDER'S office's. A workspace belongs to exactly one office, so an
     -- event from another office's workspace is refused even when its sender is a perfectly good member of their own.
     -- That installation is the deployment's credentials row, or the sender's own active install (0891).
     and (exists (select 1 from public.slack_app_credentials c
                   where c.team_id = p_team and c.enabled and c.revoked_at is null and c.office_id = p_office)
          or exists (select 1 from public.slack_installs i
                      where i.team_id = p_team and i.state = 'active' and i.office_id = p_office))
     and not exists (
       select 1
         from public.slack_channel_map m
         join public.projects pr on pr.project_id = m.project_id
        where m.channel_id = p_channel and m.active and pr.office_id <> p_office)
$f$;

-- "Can receive" is what the DOOR will say, asked of the door's own predicate, so the page and the door cannot disagree again:
-- the installer is admitted AND the workspace is accepted for this office.
create or replace function app.slack_install_status(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_install public.slack_installs;
  v_waiting timestamptz;
  v_configured boolean;
begin
  perform app.require_office(p_office);
  select * into v_install from public.slack_installs i where i.office_id = p_office and i.state = 'active';
  select max(c.expires_at) into v_waiting from public.channel_link_challenges c
   where c.office_id = p_office and c.channel = 'slack'
     and c.used_at is null and c.revoked_at is null and c.expires_at > app.now_utc();
  v_configured := coalesce((select nullif(btrim(c.value #>> '{}'), '') is not null from public.system_config c where c.key = 'slack.client_id'), false);
  return jsonb_build_object('slack', jsonb_build_object(
    'state', case when v_install.install_id is not null then 'connected' when v_waiting is not null then 'waiting' else 'none' end,
    'workspace', case when v_install.install_id is not null
                      then (select w.team_name from public.slack_workspaces w where w.team_id = v_install.team_id) end,
    'connected_at', v_install.installed_at,
    'waiting_until', case when v_install.install_id is null then v_waiting end,
    'can_connect', p_office <> app.operator_office() and v_install.install_id is null and v_configured,
    'available', v_configured,
    'managed_by_operator', p_office = app.operator_office(),
    'can_receive', v_install.install_id is not null
                   and exists (select 1 from public.subject_identities i
                                where i.office_id = p_office and i.origin_channel = 'slack' and i.actor = v_install.installer_user)
                   and public.slack_ingress_ok(p_office, v_install.team_id, null),
    'can_reply', v_install.install_id is not null
                 and coalesce((select (c.value #>> '{}') = 'true' from public.system_config c where c.key = 'slack.per_office_delivery'), false)));
end
$f$;
