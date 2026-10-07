-- 1033: work may be delivered only to a destination its own office holds.
--
-- WHAT WAS WRONG (Version 1 acceptance, journey N8). `app.claim_delivery` asks `app.delivery_refusal` whether a job may
-- reach a destination, and for a delivery that names a job the whole answer was `app.deliverable_to`: may work of this
-- ORIGIN act outside. Nothing asked whose destination it was. A job of Person B handed Person A's Telegram chat id (or
-- Person A's Slack channel) was claimed in B's office and SENT: driven through the real `DeliveryService`, both were
-- delivered. 0883 closed the same question for a sender with no job ("an operator sender may not address a destination
-- another office owns") and stopped there, so the one boundary that says where a message may go was enforced for the
-- operator's own senders and not for a person's work.
--
-- It was not reachable from the gateway: every sender in the product derives the destination from the JOB's own office
-- (the reply channel joins `telegram_chats` on the job's office, the pager asks `telegram_chat_for(office, ...)`, the
-- Slack adapter reads the project's own channel). That is exactly the shape of a guard held at each caller rather than
-- at the door they share, and the delivery layer's own header says why it matters: "a delivery claimed for the wrong
-- office is a message sent in the wrong person's name". A handler that ever passed a target taken from a payload, a
-- document or a model would have crossed offices with nothing to stop it.
--
-- THE RULE. Work of a person's or sample office is refused a destination that ANOTHER office holds and its own does
-- not. "Holds" is read from the rows that already say it: a Telegram chat is a `telegram_chats` row of an office, a Slack
-- channel belongs to its workspace's office (`slack_workspaces.office_id`, never the project's: a channel with no project
-- has none, which is what 0884 corrected). Refused only when somebody ELSE holds it and this office does not, so:
--   - a destination nobody holds is unchanged (an unknown chat is still refused by the origin rule, as before);
--   - a destination held by this office and another (a chat id that two offices both registered) is still allowed;
--   - a registered test destination is decided before this rule is reached, as it always was;
--   - work of the SYSTEM office is not asked: deployment-level notices reach the operator's chat by design.
-- It is the third question after "is the work real" and "may it act outside", and the refusal is recorded as
-- `suppressed` with this reason, which is the outcome every sender already understands (and `check:leaks` counts).
--
-- Spliced from the live `app.delivery_refusal`; only the final `else` branch changes.

create or replace function app.destination_held_by_another_office(
  p_job uuid,
  p_channel text,
  p_target_ref text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select o.kind in ('person', 'sample')
       and (
         (p_channel = 'telegram'
          and exists (select 1 from public.telegram_chats c
                       where c.chat_id = p_target_ref and c.office_id <> j.office_id)
          and not exists (select 1 from public.telegram_chats c
                           where c.chat_id = p_target_ref and c.office_id = j.office_id))
         or
         (p_channel = 'slack'
          and exists (select 1 from public.slack_channel_map m
                        join public.slack_workspaces w on w.team_id = m.team_id
                       where m.channel_id = p_target_ref and w.office_id <> j.office_id)
          and not exists (select 1 from public.slack_channel_map m
                            join public.slack_workspaces w on w.team_id = m.team_id
                           where m.channel_id = p_target_ref and w.office_id = j.office_id))
       )
      from public.jobs j
      join public.offices o on o.office_id = j.office_id
     where j.job_id = p_job
  ), false)
$function$;

comment on function app.destination_held_by_another_office(uuid, text, text) is
  'Does somebody else''s office hold this Telegram chat or Slack channel, with the job''s own office holding none of it? Person and sample offices only; the system office is not asked (1033).';

create or replace function app.delivery_refusal(p_job_id uuid, p_dedupe_key text, p_channel text, p_target_ref text)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref
                    and t.retired_at is null) then null
    when p_job_id is null then
      case when exists (select 1 from public.operator_senders s
                         where s.namespace = split_part(coalesce(p_dedupe_key, ''), ':', 1))
           then (case when exists (
                      select 1 from public.telegram_chats c
                       where p_channel = 'telegram' and c.chat_id = p_target_ref
                         and c.office_id is distinct from app.operator_office())
                    or exists (
                      select 1 from public.slack_channel_map m
                        join public.slack_workspaces w on w.team_id = m.team_id
                       where p_channel = 'slack' and m.channel_id = p_target_ref
                         and w.office_id is distinct from app.operator_office())
                    then 'destination belongs to another office: an operator sender may only address the operator'
                    end)
           else 'no provenance: a delivery must name its job or a registered operator sender'
      end
    when not exists (select 1 from public.jobs j where j.job_id = p_job_id) then
      'no provenance: the job this delivery names does not exist'
    else
      -- ONE definition of "may this reach a destination": deliverable_to (a registered test destination, or work whose
      -- origin may act outside). This function only adds the REASON when the answer is no (#395: the predicate had
      -- drifted into a second copy that nothing in the product called). 1033 adds the third question, whose
      -- destination it is, and answers it only for work that WAS allowed to act outside.
      case when app.deliverable_to(p_job_id, p_channel, p_target_ref) then
        case when app.destination_held_by_another_office(p_job_id, p_channel, p_target_ref)
             then 'destination belongs to another office: work may only be delivered to a destination its own office holds'
             end
      else
        case app.job_origin(p_job_id)
          when 'harness' then 'harness traffic may not reach a production destination'
          else 'unknown origin: no production door or office process made this work'
        end
      end
  end
$function$;
