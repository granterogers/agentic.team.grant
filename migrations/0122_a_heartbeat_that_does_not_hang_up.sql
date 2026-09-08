-- 0122 — A heartbeat that does not hang up mid-sentence
--
-- 0121's kick worked on its first firing and the response row read:
--
--   Timeout of 2000 ms reached. Total time: 2001.837 ms
--   (DNS 11.0ms, TCP/SSL handshake 34.3ms, HTTP Request/Response 1955.2ms)
--
-- The request was delivered and the worker was still working when pg_net gave
-- up on it. Two seconds was chosen on the reasoning that the heartbeat must not
-- block — which is true, and which pg_net already guarantees: `net.http_post`
-- hands the request to a background worker and returns an id immediately, so
-- the cron statement finishes in microseconds whatever the timeout says.
--
-- The timeout therefore controls only one thing: how long before pg_net closes
-- the connection on a worker that is mid-pass. Two seconds means it closes on
-- essentially every pass that finds work, and a closed connection is a plausible
-- way for the edge runtime to cancel the invocation — killing the pass a second
-- into a job that needed forty, leaving a lease to expire and Grant waiting
-- again. That is the exact failure this was built to remove.
--
-- Two minutes, matching the worker's own budget: it declines to START a new job
-- after sixty seconds, so a pass has a bounded end and the connection outlives
-- it. Nothing waits on this — the cron statement is already back.

begin;

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
    -- Silent rather than raising: this runs every minute, and an exception a
    -- minute fills the log with one line and drowns the one that matters.
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
    -- Long enough to outlive a full pass. See the header: this does not delay
    -- the cron statement, it only decides when the connection is cut.
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function app.kick_worker() from public;
grant execute on function app.kick_worker() to service_role;

commit;
