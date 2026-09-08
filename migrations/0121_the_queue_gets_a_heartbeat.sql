-- 0121 — The queue gets a heartbeat that does not depend on GitHub
--
-- Grant: *"I just now sent a voice note to my chief of staff on Telegram, and
-- ten minutes has passed, and nothing's happened. I need the response to be
-- pretty much instant."*
--
-- Everything upstream had worked. The webhook received the note, transcribed
-- it, wrote the command and queued an `office.instruction` job — all inside a
-- second. Then it sat in `queued` for twenty-three minutes.
--
-- ## What was actually wrong
--
-- The only consumer of the queue was a GitHub Actions workflow whose cron says
-- every five minutes. Over the fourteen hours before he complained it ran six
-- times: 15:55, 16:05, 19:36, 22:15, 00:28, 05:05.
--
-- That is not a broken workflow. GitHub documents scheduled runs as
-- best-effort, delays them under load, and drops high-frequency schedules
-- first. A five-minute cron on Actions is a wish. Building the responsiveness
-- of a chat interface on top of one was the mistake, and it was mine.
--
-- ## The fix, in two halves
--
-- 1. The webhook kicks the `worker` edge function the instant it queues
--    something. That is the instant path, and it is where "pretty much
--    instant" actually comes from: reply time is now one model call.
-- 2. This migration: pg_cron calls the same function every minute regardless.
--
-- The second half is not redundant. The kick only fires for work that arrives
-- through the Telegram webhook — a recurring duty, a retry, a job enqueued by
-- MCP or the front end has nobody to kick on its behalf. And a kick that fails
-- must cost latency, never delivery (§18): the floor is what makes that true.
--
-- ## Why the URL and the secret are read from the vault at call time
--
-- Not baked into the job body. §15 keeps secrets in the vault, and a cron
-- entry is stored in a table any role that can read `cron.job` can see. The
-- scheduled statement calls a function; the function reads the vault.

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

/**
 * Ask the worker to run a pass.
 *
 * Fire-and-forget by construction: `net.http_post` queues the request and
 * returns an id immediately, so this never blocks and a worker that is slow or
 * down cannot back up the cron. The response is not read — the worker records
 * what it did in the ledger, and a heartbeat that parsed replies would be a
 * second, worse copy of that record.
 */
create or replace function app.kick_worker()
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_secret text;
  v_ref    text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'worker.kick_secret';
  if v_secret is null or v_secret = '' then
    -- Deliberately silent rather than raising. This runs every minute; an
    -- exception a minute would fill the log with the same line and drown the
    -- one that matters. The absence is visible on the Connections page.
    return null;
  end if;

  select value #>> '{}' into v_ref from public.system_config where key = 'db.project_ref';
  if v_ref is null or v_ref = '' then return null; end if;

  return net.http_post(
    url     := format('https://%s.supabase.co/functions/v1/worker', v_ref),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object('source', 'pg_cron'),
    -- Short. The worker answers when its pass is done, and waiting for that is
    -- exactly what this must not do.
    timeout_milliseconds := 2000
  );
end;
$$;

revoke all on function app.kick_worker() from public;
grant execute on function app.kick_worker() to service_role;

-- Every minute. Not faster: the webhook kick already covers the case where
-- somebody is waiting, and a sub-minute heartbeat would spend the free tier's
-- function budget on passes that find an empty queue.
select cron.unschedule('worker-heartbeat')
 where exists (select 1 from cron.job where jobname = 'worker-heartbeat');

select cron.schedule('worker-heartbeat', '* * * * *', $cron$ select app.kick_worker() $cron$);

commit;
