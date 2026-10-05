-- 0685 - Slack: a signed event is admitted only if its sender, its workspace and its channel agree on one office
-- (multi-user P3, wave 8).
--
-- A valid signature proves Slack sent the event. The sender's office (from the verified identity list, via
-- sender_admitted) says whose message it is; the workspace says the app is installed there; and a channel that is mapped to a
-- project belongs to that project's office. An event whose channel belongs to a DIFFERENT office than its sender is refused
-- as a stranger is - acknowledged, stored nowhere - so one office's member cannot post into, or have answered in, another
-- office's project channel.

create function public.slack_ingress_ok(p_office uuid, p_team text, p_channel text default null)
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
     and exists (select 1 from public.slack_app_credentials c
                  where c.team_id = p_team and c.enabled and c.revoked_at is null and c.office_id = p_office)
     and not exists (
       select 1
         from public.slack_channel_map m
         join public.projects pr on pr.project_id = m.project_id
        where m.channel_id = p_channel and m.active and pr.office_id <> p_office)
$f$;
revoke all on function public.slack_ingress_ok(uuid, text, text) from public, anon, authenticated;
grant execute on function public.slack_ingress_ok(uuid, text, text) to service_role;
