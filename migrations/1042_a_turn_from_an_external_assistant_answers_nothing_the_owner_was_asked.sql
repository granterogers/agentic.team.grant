-- 1023: a typed "yes" from an external assistant (MCP) must not answer the owner's approval questions.
--
-- Found by the deep systems audit (D1) and reproduced on the isolated replica (scripts/isolated/mcp-cannot-answer.ts):
--
--   app.mcp_ask_team inserts a command with origin_channel 'teamhq', a key the production adapters do NOT produce
--   (so app.command_origin says 'unknown'), and actor = the office owner. app.open_questions_for_reply threads a
--   conversation on (channel, the part of origin_ref before the colon, subject) - 'teamhq' for the dashboard AND for
--   the assistant - so for a channel with no message identity the assistant's turn took the dashboard turn before it as
--   its "previous turn", and a question that turn left open was bindable. instruction.ts then answered it through
--   app.hq_answer_blocker as app.command_principal(...), which is the OWNER. Containment did not help: it gates job
--   kinds with external reach, and office.instruction is internal. An assistant (or text steering one) could say "yes"
--   to a plan step or a "do that from now on" offer and have it recorded as the owner's answer.
--
-- The repair is at the function the handler asks, because that is the one assembly of "what may a reply answer": a
-- turn whose origin is 'unknown' - it came through no door the office recognises - binds nothing and names nothing.
-- 'trusted' (every production adapter) and 'harness' (a suite's declared turn, which the last predicate already
-- restricts to harness work) are unchanged. Spliced from the live definition (pg_get_functiondef), one guard added.

create or replace function app.open_questions_for_reply(p_office uuid, p_command uuid)
 returns table(id text, what text, options text[], bindable boolean)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  -- 1023: a turn from no recognised door answers nothing the owner was asked, and does not reveal what is open.
  if app.command_origin(p_command) = 'unknown' then
    return;
  end if;
  return query
  with recursive me as (
    select c.origin_channel::text as ch, split_part(c.origin_ref, ':', 1) as chat,
           coalesce(c.subject, c.actor) as who, c.command_id,
           coalesce(c.context ->> 'forwarded', 'false') = 'true' as forwarded,
           nullif(coalesce(c.context ->> 'reply_to_message_id', c.context ->> 'thread_ts'), '') as points_at,
           app.command_account(p_office, c.command_id) as account,
           coalesce(c.synthetic, false) as synthetic
      from public.inbound_commands c
     where c.command_id = p_command and c.office_id = p_office
  ), ours as (
    select c.job_id from public.inbound_commands c, me
     where c.office_id = p_office
       and c.origin_channel::text = me.ch
       and split_part(c.origin_ref, ':', 1) = me.chat
       and coalesce(c.subject, c.actor) = me.who
       and c.command_id <> me.command_id
       and c.job_id is not null
       and c.received_at >= app.now_utc() - interval '12 hours'
     order by c.received_at desc
     limit 1
  ), tree as (
    select job_id from ours
    union
    select j.job_id from public.jobs j join tree t on j.parent_job_id = t.job_id and j.office_id = p_office
  ), shown as (
    -- What he was SHOWN in this conversation, by the question each message named.
    select d.blocker_id, d.sent_at, d.delivery_id
      from public.deliveries d, me
     where d.office_id = p_office
       and d.blocker_id is not null and d.state = 'sent'
       and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
       and d.sent_at >= app.now_utc() - interval '12 hours'
  ), last_sent as (
    select d.blocker_id from public.deliveries d, me
     where d.office_id = p_office
       and d.state = 'sent' and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
     order by d.sent_at desc, d.delivery_id desc limit 1
  ), replied as (
    -- The message(s) his reply points at. A Telegram message id is unique per bot, so it names one delivery. A Slack
    -- thread is flat: a reply names the thread's ROOT, so every question posted in that thread is a candidate, and
    -- the reply binds only when exactly one of them is still open.
    select distinct d.blocker_id from public.deliveries d, me
     where d.office_id = p_office
       and me.points_at is not null and d.state = 'sent' and d.blocker_id is not null
       and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
       and (d.message_ref = me.points_at or (me.ch = 'slack' and d.thread_ref = me.points_at))
  ), replied_open as (
    select count(*) as n from replied r
      join public.blockers b on b.blocker_id = r.blocker_id and b.state = 'open' and b.office_id = p_office
  ), awaiting as (
    select nullif(j.pinned_config ->> 'awaiting_answer', '')::uuid as blocker_id
      from public.jobs j where j.job_id = (select job_id from ours) and j.office_id = p_office
  ), open_shown as (
    select count(distinct s.blocker_id) as n from shown s
      join public.blockers b on b.blocker_id = s.blocker_id and b.state = 'open' and b.office_id = p_office
  )
  select b.blocker_id::text, b.requested_action, coalesce(b.approval_options, array[]::text[]),
         coalesce(case
           -- the one question the office's last reply said it was waiting on - unless this reply POINTS somewhere
           when (select points_at from me) is null and b.blocker_id = (select blocker_id from awaiting) then true   -- the turn before pinned exactly this one (#374)
           when (select points_at from me) is not null then (select n from replied_open) = 1   -- exactly the one it points at
           when (select ch from me) in ('telegram', 'slack') then
             (select n from open_shown) = 1 and b.blocker_id = (select blocker_id from last_sent)
             and b.job_id in (select job_id from tree)   -- and it came out of the turn before this one (0622)
           -- the dashboard chat and voice: a conversation is the unit, and the turn before is inside it. Exactly one
           -- open question in that turn's tree is what the office just said it was waiting on; two are named, not guessed.
           else (select count(*) from public.blockers x
                  where x.office_id = p_office and x.state = 'open' and x.job_id in (select job_id from tree)) = 1
         end, false)
    from public.blockers b
   where b.office_id = p_office
     and b.state = 'open'
     and not coalesce((select forwarded from me), false)
     and (
       -- a reply that points at a message answers the question THAT message asked, or nothing at all
       (select points_at from me) is not null and b.blocker_id in (select blocker_id from replied)
       or (
         (select points_at from me) is null
         and (
           (select ch from me) in ('telegram', 'slack') and b.blocker_id in (select blocker_id from shown)
           -- channels with no message identity: the questions of the turn before (bindable only when exactly one is open)
           or (select ch from me) not in ('telegram', 'slack') and b.job_id in (select job_id from tree)
         )
       )
       -- or the one question the office's previous reply said it was still waiting on (#374)
       or ((select points_at from me) is null and b.blocker_id = (select blocker_id from awaiting))
     )
     -- a command a harness declared may answer only harness work (the press path says the same)
     and (not (select synthetic from me) or app.harness_job(b.job_id))
   order by b.created_at desc limit 5
  ;
end;
$function$;
