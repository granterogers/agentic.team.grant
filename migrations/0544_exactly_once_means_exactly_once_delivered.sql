-- 0544 — Exactly once must mean exactly once DELIVERED
--
-- 0543's pager was proved end to end and then the first real page **timed
-- out and was lost**:
--
--     id 19136  status (none)  timed_out true
--     "Timeout of 5000 ms reached. Total time: 5000.263000 ms (DNS ...)"
--
-- A `getMe` to the same host with a generous timeout answered immediately
-- afterwards — `200 {"ok":true,"result":{"id":8967954396,"is_bot":true...}` —
-- so the database CAN reach `api.telegram.org`. What it cannot do is resolve
-- a host it has not spoken to recently inside four seconds. Every other
-- `net.http_post` in this system talks to `*.supabase.co`, which is warm
-- every minute because of the heartbeat; Telegram is cold precisely because
-- the pager is rare.
--
-- So the alert built to survive the worker dying would itself have been lost
-- on its first use, silently, and the event ledger would have recorded it as
-- paged. That is the exact failure class this whole run is about.
--
-- ## Two changes, and the second is the real one
--
-- The timeout goes to twenty seconds. That is the cheap half: nothing waits
-- on this call, and a pager that gives up before DNS answers is not a pager.
--
-- The important half is that **"already paged" must mean "a page actually
-- landed"**. 0543 recorded the attempt and treated the attempt as the
-- delivery, which is the same mistake as counting a claimed delivery as a
-- sent one. The request id goes into the event now, and a prior attempt only
-- silences the pager if it did NOT demonstrably fail.
--
-- ## Why "unknown" counts as delivered
--
-- `net._http_response` is pruned after a few hours, so an old event's request
-- id resolves to nothing. That is indistinguishable from success and from
-- failure, and the two errors are not equal: re-paging costs Grant a
-- duplicate message, and the 20-hour cooldown already bounds that to one a
-- day. Re-paging FOREVER, every hour, for a page whose evidence has been
-- pruned, is an alert storm — which is the thing he asked not to have. So a
-- page is re-attempted only on POSITIVE evidence that it failed, and the
-- cooldown counts only pages not known to have failed.

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
  v_request  bigint;
begin
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

  /*
    Exactly once DELIVERED (0544).

    A previous attempt silences the pager only if it is not KNOWN to have
    failed. `net._http_response` is pruned, so an attempt whose evidence has
    gone counts as delivered -- see the header: re-paging for ever about a
    pruned request is the alert storm, and the cooldown below already bounds
    a duplicate to one a day.
  */
  if exists (
    select 1
      from public.events e
      left join net._http_response r
        on r.id = (e.after_state->>'request_id')::bigint
     where e.action_type = 'backup.paged'
       and e.after_state->>'job_id' = j.job_id::text
       and not (coalesce(r.timed_out, false)
                or (r.status_code is not null and r.status_code >= 300))
  ) then
    return jsonb_build_object('paged', 0, 'why', 'already paged', 'job', j.job_id);
  end if;

  if exists (
    select 1
      from public.events e
      left join net._http_response r
        on r.id = (e.after_state->>'request_id')::bigint
     where e.action_type = 'backup.paged'
       and e.occurred_at > app.now_utc() - interval '20 hours'
       and not (coalesce(r.timed_out, false)
                or (r.status_code is not null and r.status_code >= 300))
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

  -- Twenty seconds, not four. The first page of a quiet week pays for a cold
  -- DNS lookup that every other caller here never sees, and nothing waits on
  -- this: net.http_post returns an id immediately.
  v_request := net.http_post(
    url     := format('https://api.telegram.org/bot%s/sendMessage', v_token),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('chat_id', v_chat, 'text', v_text),
    timeout_milliseconds := 20000
  );

  perform public.append_event(
    extensions.gen_random_uuid(),
    'system', 'backup:pager', 'terminal_backup_failure',
    'backup.paged',
    false, null, null,
    jsonb_build_object('job_id', j.job_id, 'chat', v_chat,
                       'request_id', v_request,
                       'last_good_backup_hours', v_hours),
    'Paged Grant about a nightly backup that failed and did not recover.',
    '[]'::jsonb, null, null, null, j.job_id, null, null
  );

  return jsonb_build_object('paged', 1, 'job', j.job_id, 'request_id', v_request,
                            'last_good_backup_hours', v_hours);
end;
$fn$;

comment on function app.page_backup_failure() is
  'Page Grant when the nightly backup has terminally failed and not '
  'recovered. From the database over pg_net rather than from a handler, '
  'because an alert emitted by the worker goes quiet exactly when the worker '
  'is what broke (0543). Exactly once DELIVERED -- a prior attempt known to '
  'have timed out or errored does not silence it (0544) -- at most once in '
  'twenty hours, never for harness traffic, never while a later backup has '
  'succeeded.';

commit;
