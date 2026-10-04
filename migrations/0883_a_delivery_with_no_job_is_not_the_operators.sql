-- app.delivery_office answered the OPERATOR's office for any delivery that had no job and was not for a registered test
-- destination. app.claim_delivery then refused such a delivery as "no provenance" unless its dedupe namespace was a
-- registered operator sender - so the ambient fallback was hidden behind a second check, but the office it was recorded
-- under was still Grant's: an ordinary job-less delivery was ATTRIBUTED to him, and an operator sender could address a
-- destination that belongs to somebody else and have it claimed in his office.
--
-- Two changes, both fail closed:
--
-- 1. delivery_office takes the dedupe key. A job's office is the job's; a registered test destination is the test
--    office; a registered operator sender (namespace) is the operator's; ANYTHING ELSE is the system office, where the
--    refusal that follows is recorded without naming a person. Missing provenance never means Grant.
--
-- 2. delivery_refusal, for the operator-sender branch, refuses a destination that is registered to another office
--    (a Telegram chat or a Slack channel of someone else's project). An operator tool addresses the operator.
--
-- The old three-argument function is dropped by exact signature (a second overload would make every call ambiguous).
drop function if exists app.delivery_office(uuid, text, text);

create function app.delivery_office(
  p_job uuid, p_channel text, p_target_ref text, p_dedupe_key text default null)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_office uuid;
begin
  v_office := coalesce(
    (select j.office_id from public.jobs j where j.job_id = p_job),
    case when p_job is not null then app.system_office() end,
    case when exists (select 1 from public.test_destinations t
                       where t.channel = p_channel and t.target_ref = p_target_ref and t.retired_at is null)
         then app.test_office() end,
    case when exists (select 1 from public.operator_senders s
                       where s.namespace = split_part(coalesce(p_dedupe_key, ''), ':', 1))
         then app.operator_office() end,
    app.system_office());
  return app.require_office(v_office);
end
$function$;

-- Sealed like its predecessor (0841): only the owner executes it.
revoke all on function app.delivery_office(uuid, text, text, text) from public, anon, authenticated, service_role;

do $m$
declare
  v_def text;
  v_old constant text := $o$           then null
           else 'no provenance: a delivery must name its job or a registered operator sender'$o$;
  v_new constant text := $n$           then (case when exists (
                      select 1 from public.telegram_chats c
                       where p_channel = 'telegram' and c.chat_id = p_target_ref
                         and c.office_id is distinct from app.operator_office())
                    or exists (
                      select 1 from public.slack_channel_map m
                        join public.projects pr on pr.project_id = m.project_id
                       where p_channel = 'slack' and m.channel_id = p_target_ref
                         and pr.office_id is distinct from app.operator_office())
                    then 'destination belongs to another office: an operator sender may only address the operator'
                    end)
           else 'no provenance: a delivery must name its job or a registered operator sender'$n$;
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
