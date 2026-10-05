-- 0883 decided "this Slack channel belongs to another office" through the channel's PROJECT. A Slack channel's office is
-- its WORKSPACE's (app.p2_edge_slack_channel_map reads slack_workspaces.office_id, and refuses a project of another
-- office), so the workspace is the authoritative owner and a channel with no project (a lobby, a direct message) has
-- none through the project at all. Ask the owner the database enforces.
--
-- Spliced from the live definition, anchored exactly once.
do $m$
declare
  v_def text;
  v_old constant text := $o$                      select 1 from public.slack_channel_map m
                        join public.projects pr on pr.project_id = m.project_id
                       where p_channel = 'slack' and m.channel_id = p_target_ref
                         and pr.office_id is distinct from app.operator_office()$o$;
  v_new constant text := $n$                      select 1 from public.slack_channel_map m
                        join public.slack_workspaces w on w.team_id = m.team_id
                       where p_channel = 'slack' and m.channel_id = p_target_ref
                         and w.office_id is distinct from app.operator_office()$n$;
  v_n int;
begin
  v_def := pg_get_functiondef('app.delivery_refusal(uuid,text,text,text)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then
    raise exception 'anchor occurs % times, expected exactly 1', v_n;
  end if;
  execute replace(v_def, v_old, v_new);
end
$m$;
