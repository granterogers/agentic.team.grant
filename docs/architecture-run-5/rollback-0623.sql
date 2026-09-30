-- Rollback of 0623: restores the 0617 approval_for_delivery and the 0622 open_questions_for_reply (no bindable),
-- then removes bind_delivery, command_account, the write-once trigger, the column and the cutoff key.
-- Names on existing deliveries are discarded; a press afterwards falls back to the pre-0623 inference.
begin;
drop function if exists app.open_questions_for_reply(uuid);
CREATE OR REPLACE FUNCTION app.open_questions_for_reply(p_command uuid)
 RETURNS TABLE(id text, what text, options text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with recursive me as (
    select origin_channel, split_part(origin_ref, ':', 1) as chat,
           coalesce(subject, actor) as who, command_id,
           coalesce(context ->> 'forwarded', 'false') = 'true' as forwarded
      from public.inbound_commands
     where command_id = p_command
  ), ours as (
    select c.job_id from public.inbound_commands c, me
     where c.origin_channel = me.origin_channel
       and split_part(c.origin_ref, ':', 1) = me.chat
       and coalesce(c.subject, c.actor) = me.who
       and c.command_id <> me.command_id
       and c.job_id is not null
       and c.received_at >= app.now_utc() - interval '12 hours'
     -- The turn IMMEDIATELY before only. "ok" is also how people acknowledge, so a question raised three turns
     -- back, with other answers since, must not be approved by an "ok, thanks" meant for the latest reply.
     order by c.received_at desc
     limit 1
  ), tree as (
    select job_id from ours
    union
    select j.job_id from public.jobs j join tree t on j.parent_job_id = t.job_id
  )
  select b.blocker_id::text, b.requested_action, coalesce(b.approval_options, array[]::text[])
    from public.blockers b
   where b.state = 'open'
     -- (#392) A FORWARDED message is somebody else's words carried by him: it is never an answer.
     and not coalesce((select forwarded from me), false)
     and ((b.job_id in (select job_id from tree)
           -- (0622) On a channel that delivers to a conversation, a typed yes answers a question he was SHOWN.
           and (not exists (select 1 from me where me.origin_channel::text in ('telegram', 'slack'))
                or exists (
                     select 1 from public.deliveries d, me
                      where d.job_id = b.job_id
                        and d.state = 'sent'
                        -- What the office SAYS to him, not a progress note or an acknowledgement: a question
                        -- reaches him as a result or a blocker message (production: only 'result' has ever
                        -- shared a job with a blocker).
                        and d.purpose in ('result', 'blocker')
                        and d.channel = me.origin_channel::text
                        and d.target_ref = me.chat
                        and app.approval_for_delivery(d.delivery_id) = b.blocker_id
                        -- and it is the LAST thing the office sent to this chat: a typed yes answers what he
                        -- has just read, not something further up the conversation.
                        and not exists (
                              select 1 from public.deliveries d2
                               where d2.channel = d.channel and d2.target_ref = d.target_ref
                                 and d2.state = 'sent' and d2.delivery_id <> d.delivery_id
                                 and (d2.sent_at, d2.delivery_id) > (d.sent_at, d.delivery_id)))))
          -- Or the ONE question the office's previous reply said it was still waiting on (#374).
          or b.blocker_id = (select nullif(j.pinned_config ->> 'awaiting_answer', '')::uuid
                               from public.jobs j
                              where j.job_id = (select job_id from ours)))
   order by b.created_at desc limit 5
$function$
;
CREATE OR REPLACE FUNCTION app.approval_for_delivery(p_delivery uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select b.blocker_id
    from public.deliveries d
    join public.blockers b on b.job_id = d.job_id
   where d.delivery_id = p_delivery
     and b.created_at <= d.created_at
   order by b.created_at desc, b.blocker_id
   limit 1
$function$
;
drop trigger if exists deliveries_blocker_once on public.deliveries;
drop function if exists app.deliveries_blocker_is_written_once();
drop function if exists app.bind_delivery(uuid, uuid);
drop function if exists app.command_account(uuid);
drop index if exists public.deliveries_by_blocker;
alter table public.deliveries drop column if exists blocker_id;
delete from public.system_config where key = 'delivery.bindings_from';
delete from app.schema_migrations where name like '0623_%';
commit;
