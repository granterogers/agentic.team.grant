/*
  0622 - a typed "yes" answers a question he was shown, not one that merely exists (#394, Run 4)

  WHAT WAS WRONG. `instruction.ts` binds a short typed yes or no to "the one open question in the previous turn's
  job tree" - a deliberately conversational binding, and Run 3 fixed its BUTTON sibling (0617: a press answers the
  question its own message showed). The typed door had no such check: a question raised by the previous turn but
  never delivered to him - the message failed, was suppressed, or is still waiting to send - was still "the one
  open question", so "yes" approved something he had not seen.

  WHAT THIS DOES. The query moves into one function, `app.open_questions_for_reply`, so the handler and the test
  ask the same thing, and gains one condition for the two channels that deliver to a conversation (Telegram and
  Slack): the question must have been DELIVERED to this chat - a delivery of the job that raised it, that is
  `sent`, to this conversation, whose own binding (`app.approval_for_delivery`, 0617) is this question. A channel
  with no delivery record (the dashboard's own chat, voice) is answered as it always was. The second door in the
  old query - the question the office's previous reply said it was still waiting on (`awaiting_answer`, #374) -
  is unchanged: that pointer is written only by a turn that already bound to a question.

  Everything else is the old query verbatim: the turn IMMEDIATELY before only, twelve hours, several open
  questions are named and asked about, none does nothing.

  #392, in the same function: a message he FORWARDED is somebody else's text under his name, so a forwarded
  "yes" answers nothing. The Telegram adapter now records `context.forwarded` at the door (nothing later can tell),
  and the query refuses to bind an answer from such a command. What this does not do (recorded on #392): treat
  forwarded text as material rather than instruction everywhere else the model reads it.

  Compatibility: the function is new and the handler calls it; an old handler runs the old inline query, which is
  simply the weaker rule. Deploy the migration before the worker. Rollback: drop the function.
*/

create or replace function app.open_questions_for_reply(p_command uuid)
returns table (id text, what text, options text[])
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
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
                        and d.channel = me.origin_channel::text
                        and d.target_ref = me.chat
                        and app.approval_for_delivery(d.delivery_id) = b.blocker_id)))
          -- Or the ONE question the office's previous reply said it was still waiting on (#374).
          or b.blocker_id = (select nullif(j.pinned_config ->> 'awaiting_answer', '')::uuid
                               from public.jobs j
                              where j.job_id = (select job_id from ours)))
   order by b.created_at desc limit 5
$fn$;

revoke all on function app.open_questions_for_reply(uuid) from public, anon, authenticated;
