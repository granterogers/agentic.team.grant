/*
  0623 - a delivery names the question it asked, and a response binds by that name (#396, Run 5)

  WHAT WAS WRONG. `deliveries` and `blockers` were never linked. A question reached him as an ordinary result
  under `job:<id>`, and every later binding was INFERRED: `approval_for_delivery` (0617) took "the latest blocker of
  the delivery's job that existed before the delivery", and the typed yes (0622) took "the last message the office
  sent to this chat". Reproduced on the replica by the Run 5 reconnaissance:

    A  reordered delivery: Q1 and Q2 open on one job, the message about Q1 recorded AFTER Q2 - a press on Q1's
       message resolved Q2;
    B  a typed yes bound to a question because ANY later message of the job existed;
    C  two bots number their own messages in the same private chat, so one press matched two deliveries (8 such
       groups in production) and which question it answered depended on join order;
    D  two questions both shown, a bare yes silently answered the later one;
    E  a Slack thread reply under an old question answered the newest, because `thread_ts` was never read;
    I  a second generation request on one job returned the FIRST question and recorded nothing.

  WHAT THIS DOES.
    * `deliveries.blocker_id` - the question a message asked. Written ONCE, by `app.bind_delivery`, before the
      message is sent, from the place the question is composed (the notifier's approval context or the paused-job
      question). A delivery may only name a blocker of ITS OWN job (a foreign or fabricated id binds nothing).
    * `app.approval_for_delivery` reads that column and nothing else. A delivery from before this migration has no
      such column value; it binds only in the one case that is provable - it was created before
      `delivery.bindings_from` AND its job had exactly one blocker at the time - and never afterwards. No backfill
      invents a binding.
    * `app.open_questions_for_reply` - what a typed reply may answer - is rebuilt on the same column:
        - a reply that POINTS at a message (Telegram `reply_to_message`, a Slack thread root, carried in
          `inbound_commands.context`) answers exactly the question that message asked, or nothing;
        - a plain reply on Telegram or Slack answers a question only when it is the ONE open question shown in this
          chat AND the last thing the office sent there; two shown and open, or the office having spoken since, is
          returned as NOT bindable so the handler says which are waiting instead of guessing;
        - the dashboard chat and voice have no message identity: their questions bind only when the turn before left exactly one open (the
          waiting list's buttons answer by id, exactly);
        - a forwarded message answers nothing (0622, unchanged).
      The result gains `bindable`; an old handler reads named columns and ignores it.
    * `app.command_account` - the bot a Telegram message or press came through, from the adapter-shaped dedupe key.

  Compatibility and skew. Deploy this migration BEFORE the worker and the webhooks. A new worker on the old schema
  cannot call `bind_delivery` (the call is caught: the message goes out unbound, and a press or reply on it answers
  nothing - fail closed). An old worker on the new schema sends messages with no blocker id; after
  `delivery.bindings_from` they bind nothing, so a question sent by an old worker is answered from the dashboard
  until the worker is redeployed. Rollback at the foot.
*/

alter table public.deliveries
  add column if not exists blocker_id uuid references public.blockers (blocker_id);
create index if not exists deliveries_by_blocker on public.deliveries (blocker_id) where blocker_id is not null;

/* written once, and only for the delivery's own job's question */
create or replace function app.deliveries_blocker_is_written_once()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if old.blocker_id is not null and new.blocker_id is distinct from old.blocker_id then
    raise exception 'the question delivery % asked is written once and cannot be changed', old.delivery_id
      using errcode = '23514';
  end if;
  if new.blocker_id is not null
     and not exists (select 1 from public.blockers b where b.blocker_id = new.blocker_id and b.job_id is not distinct from new.job_id) then
    raise exception 'delivery % cannot name a question that is not its own job''s', new.delivery_id
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;
drop trigger if exists deliveries_blocker_once on public.deliveries;
create trigger deliveries_blocker_once before insert or update of blocker_id on public.deliveries
  for each row execute function app.deliveries_blocker_is_written_once();

insert into public.system_config (key, value, description)
values ('delivery.bindings_from', to_jsonb(app.now_utc()::text),
        'Deliveries created before this moment may bind to the ONE blocker their job had at the time; after it, only a delivery that names its question binds (0623).')
on conflict (key) do nothing;

create or replace function app.bind_delivery(p_delivery uuid, p_blocker uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_delivery is null or p_blocker is null then return false; end if;
  update public.deliveries set blocker_id = p_blocker
   where delivery_id = p_delivery and (blocker_id is null or blocker_id = p_blocker)
     and state <> 'suppressed';
  return found;
exception when check_violation then
  return false;   -- a foreign or already-named delivery binds nothing; the caller sends unbound and fails closed
end;
$fn$;

create or replace function app.approval_for_delivery(p_delivery uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
  select case
    when d.blocker_id is not null then d.blocker_id
    -- Provable and bounded: a message from before this migration, whose job had exactly one question by then.
    when d.created_at < coalesce((select (value #>> '{}')::timestamptz from public.system_config where key = 'delivery.bindings_from'), '-infinity')
         and (select count(*) from public.blockers b where b.job_id = d.job_id and b.created_at <= d.created_at) = 1
      then (select b.blocker_id from public.blockers b where b.job_id = d.job_id and b.created_at <= d.created_at)
  end
    from public.deliveries d where d.delivery_id = p_delivery
$fn$;

/* the bot a Telegram message or press came through, or null where the door does not say */
create or replace function app.command_account(p_command uuid)
returns text
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
  select case when c.origin_channel::text = 'telegram'
               and c.dedupe_key ~ '^telegram:(message|callback):[0-9]+:'
              then split_part(c.dedupe_key, ':', 3) end
    from public.inbound_commands c where c.command_id = p_command
$fn$;

drop function if exists app.open_questions_for_reply(uuid);
create function app.open_questions_for_reply(p_command uuid)
returns table (id text, what text, options text[], bindable boolean)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $fn$
  with recursive me as (
    select c.origin_channel::text as ch, split_part(c.origin_ref, ':', 1) as chat,
           coalesce(c.subject, c.actor) as who, c.command_id,
           coalesce(c.context ->> 'forwarded', 'false') = 'true' as forwarded,
           nullif(coalesce(c.context ->> 'reply_to_message_id', c.context ->> 'thread_ts'), '') as points_at,
           app.command_account(c.command_id) as account
      from public.inbound_commands c
     where c.command_id = p_command
  ), ours as (
    select c.job_id from public.inbound_commands c, me
     where c.origin_channel::text = me.ch
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
    select j.job_id from public.jobs j join tree t on j.parent_job_id = t.job_id
  ), shown as (
    -- What he was SHOWN in this conversation, by the question each message named.
    select d.blocker_id, d.sent_at, d.delivery_id
      from public.deliveries d, me
     where d.blocker_id is not null and d.state = 'sent'
       and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
       and d.sent_at >= app.now_utc() - interval '12 hours'
  ), last_sent as (
    select d.blocker_id from public.deliveries d, me
     where d.state = 'sent' and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
     order by d.sent_at desc, d.delivery_id desc limit 1
  ), replied as (
    -- The message(s) his reply points at. A Telegram message id is unique per bot, so it names one delivery. A Slack
    -- thread is flat: a reply names the thread's ROOT, so every question posted in that thread is a candidate, and
    -- the reply binds only when exactly one of them is still open.
    select distinct d.blocker_id from public.deliveries d, me
     where me.points_at is not null and d.state = 'sent' and d.blocker_id is not null
       and d.channel = me.ch and d.target_ref = me.chat
       and (me.account is null or d.account_ref = me.account)
       and (d.message_ref = me.points_at or (me.ch = 'slack' and d.thread_ref = me.points_at))
  ), replied_open as (
    select count(*) as n from replied r
      join public.blockers b on b.blocker_id = r.blocker_id and b.state = 'open'
  ), awaiting as (
    select nullif(j.pinned_config ->> 'awaiting_answer', '')::uuid as blocker_id
      from public.jobs j where j.job_id = (select job_id from ours)
  ), open_shown as (
    select count(distinct s.blocker_id) as n from shown s
      join public.blockers b on b.blocker_id = s.blocker_id and b.state = 'open'
  )
  select b.blocker_id::text, b.requested_action, coalesce(b.approval_options, array[]::text[]),
         coalesce(case
           when b.blocker_id = (select blocker_id from awaiting) then true   -- the turn before pinned exactly this one (#374)
           when (select points_at from me) is not null then (select n from replied_open) = 1   -- exactly the one it points at
           when (select ch from me) in ('telegram', 'slack') then
             (select n from open_shown) = 1 and b.blocker_id = (select blocker_id from last_sent)
             and b.job_id in (select job_id from tree)   -- and it came out of the turn before this one (0622)
           -- the dashboard chat and voice: a conversation is the unit, and the turn before is inside it. Exactly one
           -- open question in that turn's tree is what the office just said it was waiting on; two are named, not guessed.
           else (select count(*) from public.blockers x
                  where x.state = 'open' and x.job_id in (select job_id from tree)) = 1
         end, false)
    from public.blockers b
   where b.state = 'open'
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
       or b.blocker_id = (select blocker_id from awaiting)
     )
   order by b.created_at desc limit 5
$fn$;

revoke all on function app.bind_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function app.command_account(uuid) from public, anon, authenticated;
revoke all on function app.open_questions_for_reply(uuid) from public, anon, authenticated;

/*
  ROLLBACK: docs/architecture-run-5/rollback-0623.sql restores the 0617 approval_for_delivery and the 0622
  open_questions_for_reply (without `bindable`), drops bind_delivery, command_account, the trigger and the column.
*/
