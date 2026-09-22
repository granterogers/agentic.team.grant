-- 0543 — A failed backup reaches Grant
--
-- Driven end to end on 21 September, a terminally failed nightly backup
-- produced exactly this:
--
--     state=failed  impediments=1  outputs=0  DELIVERIES=0  chore=1
--
-- **Zero deliveries.** An impediment on the Governance page, `backup_overdue`
-- in the health reading, and a chore on My Tasks — and no Telegram, no Slack,
-- no email, no push. Grant finds out by opening the dashboard. The
-- `announce: true` on the job is inert: the notifier delivers OUTPUTS and a
-- terminally failed job writes none, so it never reaches `notifying` at all.
--
-- Every other candidate path was checked and none carries it. The chores
-- handler is `announce: false` deliberately, because an hourly message saying
-- the same thing is the narration Grant has asked twice not to receive. The
-- morning briefing contains no tasks or chores. `raise_proposals` skips kind
-- `not_capable`, which is what 0535 writes.
--
-- ## Why this pages from the DATABASE rather than from a handler
--
-- Invariant 14: monitoring must not rely solely on the component it monitors.
-- A backup alert emitted by a job handler is an alert that goes quiet exactly
-- when the worker is the thing that is broken — and the 17 September failure
-- WAS the worker being killed five times.
--
-- The database can already reach the network: `app.kick_worker` has used
-- `net.http_post` every minute since 0121, 19,381 times without a failure.
-- So the alert rides the one path that is independent of the queue, the
-- worker and the deploy, and it is scheduled on pg_cron rather than on a
-- duty for the same reason.
--
-- It deliberately does NOT go through `DeliveryService`. That is not a
-- shortcut: an operational page about the office being broken must not be
-- queued behind the office.
--
-- ## The five properties, and where each one lives
--
--   exactly once           a `backup.paged` event naming the job, checked
--                          before sending
--   no storm               plus a 20-hour cooldown, so a backup that fails
--                          every night pages once a night and not more
--   retries do not page    the candidate must be in `failed`, which is
--                          terminal. A job in `retrying` has not failed yet,
--                          and 0536 means a job making checkpoint progress is
--                          not spending attempts at all
--   no false alarm after   the candidate is only paged while NO backup has
--   recovery               completed since it failed
--   harness never pages    `app.harness_job` excludes it, which since 0541
--                          includes the immutable synthetic mark
--
-- ## What it says
--
-- Short, and it names the one command that diagnoses it. A page that says
-- "backup failed" and nothing else is a page that makes Grant open a laptop
-- to find out whether it matters.

begin;

create or replace function app.page_backup_failure()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  j          record;
  v_last_ok  timestamptz;
  v_token    text;
  v_chat     text;
  v_text     text;
  v_hours    numeric;
begin
  -- The most recent terminal failure that has not been made good since.
  select job.job_id, job.created_at, job.state_reason, job.attempt, job.max_attempts
    into j
    from public.jobs job
   where job.kind = 'office.backup'
     and job.state = 'failed'
     and not app.harness_job(job.job_id)
     and not exists (
       select 1 from public.jobs ok
        where ok.kind = 'office.backup'
          and ok.state = 'complete'
          and not app.harness_job(ok.job_id)
          and ok.created_at > job.created_at)
   order by job.created_at desc
   limit 1;

  if not found then
    return jsonb_build_object('paged', 0, 'why', 'no unrecovered terminal failure');
  end if;

  -- Exactly once for this job, ever.
  if exists (
    select 1 from public.events e
     where e.action_type = 'backup.paged'
       and e.after_state->>'job_id' = j.job_id::text
  ) then
    return jsonb_build_object('paged', 0, 'why', 'already paged', 'job', j.job_id);
  end if;

  -- And at most once a day however many jobs fail, so a broken night cannot
  -- become a broken hour.
  if exists (
    select 1 from public.events e
     where e.action_type = 'backup.paged'
       and e.occurred_at > app.now_utc() - interval '20 hours'
  ) then
    return jsonb_build_object('paged', 0, 'why', 'cooling down', 'job', j.job_id);
  end if;

  select max(o.created_at) into v_last_ok
    from storage.objects o
   where o.bucket_id = 'backups' and o.name like '%manifest.json.gz';
  v_hours := round(extract(epoch from (app.now_utc() - v_last_ok)) / 3600.0, 1);

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'telegram.chief.bot_token';
  select c.chat_id::text into v_chat
    from public.telegram_chats c
    join public.telegram_bots b on b.bot_id = c.bot_id
   where c.subject = 'grant' and c.chat_type = 'private'
     and b.staff_slug = 'chief-of-staff' and c.deliverable
   limit 1;

  if v_token is null or v_token = '' or v_chat is null then
    -- Said out loud rather than swallowed. An alert that cannot be sent is
    -- the same shape as the defect this exists for.
    return jsonb_build_object('paged', 0, 'why', 'no pager credential or chat',
                              'job', j.job_id);
  end if;

  v_text :=
    'The nightly backup failed and did not recover.' || chr(10) || chr(10) ||
    'Last good copy: ' ||
      coalesce(to_char(v_last_ok, 'DD Mon HH24:MI') || ' UTC (' || v_hours::text || 'h ago)',
               'none found') || chr(10) ||
    'It gave up after ' || j.attempt::text || ' of ' || j.max_attempts::text ||
      ' attempts: ' || left(coalesce(j.state_reason, 'no reason recorded'), 120) || chr(10) ||
    chr(10) ||
    'There is no offsite copy, so this is the only one. To look:' || chr(10) ||
    'npm run q -- "select state, attempt, state_reason from public.jobs ' ||
      'where kind = ''office.backup'' order by created_at desc limit 3"' || chr(10) ||
    'To take one now: npm run backup:now';

  perform net.http_post(
    url     := format('https://api.telegram.org/bot%s/sendMessage', v_token),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('chat_id', v_chat, 'text', v_text),
    timeout_milliseconds := 4000
  );

  perform public.append_event(
    extensions.gen_random_uuid(),
    'system', 'backup:pager', 'terminal_backup_failure',
    'backup.paged',
    false, null, null,
    jsonb_build_object('job_id', j.job_id, 'chat', v_chat,
                       'last_good_backup_hours', v_hours),
    'Paged Grant about a nightly backup that failed and did not recover.',
    '[]'::jsonb, null, null, null, j.job_id, null, null
  );

  return jsonb_build_object('paged', 1, 'job', j.job_id,
                            'last_good_backup_hours', v_hours);
end;
$fn$;

revoke all on function app.page_backup_failure() from public;
grant execute on function app.page_backup_failure() to service_role;

comment on function app.page_backup_failure() is
  'Page Grant when the nightly backup has terminally failed and not '
  'recovered. From the database over pg_net rather than from a handler, '
  'because an alert emitted by the worker goes quiet exactly when the worker '
  'is what broke (0543). Exactly once per job, at most once in twenty hours, '
  'never for harness traffic, and never while a later backup has succeeded.';

-- Its own schedule, deliberately. A duty would put the alert behind the
-- queue it is watching.
select cron.unschedule('backup-pager')
 where exists (select 1 from cron.job where jobname = 'backup-pager');

select cron.schedule('backup-pager', '17 * * * *',
  $cron$ select app.page_backup_failure() $cron$);

commit;
