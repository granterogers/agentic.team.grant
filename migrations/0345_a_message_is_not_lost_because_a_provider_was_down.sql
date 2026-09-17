-- 0345 — bounded retry, and a failure a person can see and act on
--
-- Issue #202. 0014's canonical-store claim under load: losing a channel loses a
-- DELIVERY SURFACE, not data. Slack rate-limits, Telegram times out, an edge
-- function cold-starts. None of that may cost a message.
--
-- Most of the mechanism was already here and is used rather than replaced —
-- `deliveries` with its dedupe key, `claim_delivery`, `record_delivery_sent`,
-- `record_delivery_failure`, and `error_code` on the row. #202 says so in as
-- many words: use it rather than inventing a parallel failure store. Three
-- things were missing.
--
-- 1. THE RETRY WAS UNBOUNDED AND IMMEDIATE. A retryable failure set
--    `lease_expires_at = now()`, so the next worker pass reclaimed it at once
--    and `attempt` climbed for ever. Against a provider that is down that is a
--    hot loop, and on a free tier a hot loop is a cost question. #202 asks for
--    "bounded backoff, and the bound is a stated number". It is stated here and
--    in one place: five attempts, 30 seconds doubling to a ceiling of fifteen
--    minutes, about half an hour of trying in total.
--
-- 2. NOTHING COULD BE TRIED AGAIN. `failed` was terminal and `claim_delivery`
--    returns 'failed' without reclaiming, which is correct — a permanent
--    failure must not be retried by the same loop that gave up on it. But #202
--    asks for "a way to try again", and a person deciding to retry is not the
--    same event as a worker deciding to. `app.retry_delivery` is that decision,
--    and it is the only route out of `failed`.
--
-- 3. A FAILURE WAS INVISIBLE. `deliveries` knew, and nothing anybody looks at
--    read it. #202: a person must be able to tell "not answered yet" from
--    "could not be delivered" without reading a log. So the conversation
--    carries each answer's delivery outcome, and `app.undelivered` lists what
--    is stuck.
--
-- What is NOT here, deliberately: nothing about deduplication. A retry is a
-- duplicate delivery by another name, and the idempotency is already #195's —
-- `deliveries.dedupe_key` is unique and `claim_delivery` returns 'already_sent'
-- with the message reference. Reimplementing it here would be the second copy
-- that drifts.

begin;

/*
  The policy, in one place, as data.

  Written as settings rather than as constants in the function body so Grant
  can change them without a migration — the standing instruction about reducing
  dependence on a coding interface. `system_config.description` is NOT NULL.
*/
insert into public.system_config (key, value, description)
values
  ('delivery.max_attempts', '5',
   'Issue #202. How many times a failing send is retried before it is marked '
   'undelivered and shown to Grant. Five attempts with the backoff below is '
   'about half an hour of trying.'),
  ('delivery.backoff_seconds', '30',
   'Issue #202. The first retry delay. It doubles each attempt up to the '
   'ceiling below, so 30 gives 30s, 1m, 2m, 4m.'),
  ('delivery.backoff_ceiling_seconds', '900',
   'Issue #202. The longest a retry ever waits. Fifteen minutes: long enough '
   'that a provider outage is not hammered, short enough that recovery is '
   'noticed within one cycle.')
on conflict (key) do nothing;

/*
  Bounded backoff, replacing an immediate unbounded one.

  Same signature, so no caller changes — `drop function` first anyway, because
  `create or replace` does not replace a function whose argument list changed
  and the habit is what saves the time.

  The decision to give up is made HERE rather than by the caller, because the
  caller is an edge function that knows about one attempt and cannot see the
  history. A transport handler should say "this failed and it looked
  transient"; whether transient has run out of road is the record's business.
*/
drop function if exists app.record_delivery_failure(uuid, text, boolean);

create function app.record_delivery_failure(
  p_delivery_id uuid,
  p_error_code text,
  p_retryable boolean
) returns text
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_row public.deliveries;
  v_max int;
  v_base int;
  v_ceiling int;
  v_wait int;
begin
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    -- Two attempts disagree about reality. The sent record wins: it has a
    -- message reference, which is evidence; the failure has only a code.
    return 'already_sent';
  end if;

  if not p_retryable then
    update public.deliveries
       set state = 'failed', error_code = p_error_code
     where delivery_id = p_delivery_id and state = 'claimed';
    return 'failed';
  end if;

  select coalesce((select value::int from public.system_config
                    where key = 'delivery.max_attempts'), 5),
         coalesce((select value::int from public.system_config
                    where key = 'delivery.backoff_seconds'), 30),
         coalesce((select value::int from public.system_config
                    where key = 'delivery.backoff_ceiling_seconds'), 900)
    into v_max, v_base, v_ceiling;

  /*
    Out of road. The last error code is kept rather than replaced with
    something generic — "chat_not_found five times" and "timeout five times"
    are different problems and only the code says which.
  */
  if v_row.attempt >= v_max then
    update public.deliveries
       set state = 'failed', error_code = p_error_code
     where delivery_id = p_delivery_id and state = 'claimed';
    return 'gave_up';
  end if;

  /*
    Exponential, with a ceiling, computed from the attempt already made.

    `least` before the multiply would overflow on a large attempt count;
    `power` returns double precision, so the cast is explicit rather than
    implicit. Both are the kind of detail that only shows up at attempt 30.
  */
  v_wait := least(v_ceiling, (v_base * power(2, greatest(0, v_row.attempt - 1)))::int);

  update public.deliveries
     set lease_expires_at = app.now_utc() + make_interval(secs => v_wait),
         error_code = p_error_code
   where delivery_id = p_delivery_id and state = 'claimed';

  return 'retry_in_' || v_wait::text;
end;
$fn$;

comment on function app.record_delivery_failure(uuid, text, boolean) is
  'Issue #202. Bounded retry: up to delivery.max_attempts, with exponential '
  'backoff to a ceiling. Returns already_sent, failed, gave_up, or retry_in_<n>.';

/*
  Trying again, which is a person's decision and not a worker's.

  `claim_delivery` deliberately refuses to reclaim a `failed` row, and it is
  right to: the loop that gave up must not quietly change its mind. This is the
  other door, and it is the only one.

  The attempt counter is reset, so a retry gets the full budget again rather
  than one more go at a delivery that has already exhausted five. The error
  code is kept until the retry supersedes it, because "what went wrong last
  time" is worth having while the retry is in flight.
*/
create or replace function app.retry_delivery(p_delivery_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_row public.deliveries;
begin
  select * into v_row from public.deliveries
    where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'no delivery %', p_delivery_id using errcode = 'no_data_found';
  end if;

  if v_row.state = 'sent' then
    return 'already_sent';
  end if;
  if v_row.state = 'suppressed' then
    -- Suppression is a decision somebody made about whether this SHOULD be
    -- sent. Undoing it here would let a retry button override a policy.
    return 'suppressed';
  end if;

  update public.deliveries
     set state = 'claimed',
         attempt = 1,
         lease_expires_at = app.now_utc()
   where delivery_id = p_delivery_id;

  return 'queued';
end;
$fn$;

drop function if exists public.retry_delivery(uuid);
create function public.retry_delivery(p_delivery_id uuid)
returns text
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.retry_delivery(p_delivery_id) $fn$;

grant execute on function public.retry_delivery(uuid) to anon, authenticated, service_role;

/*
  What could not be delivered, and to where.

  Per project when one is named, everything when it is not. Fixtures excluded —
  harness traffic reported as an outage is the trap with its own paragraph in
  CLAUDE.md.

  `attempt` and `error_code` are both returned because together they say
  whether this is worth retrying: one attempt with a timeout is probably a
  blip, five with `chat_not_found` is a configuration problem no retry will fix.
*/
create or replace function app.undelivered(
  p_project_id uuid default null,
  p_limit integer default 50
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb)
    from (
      select d.updated_at as at,
             jsonb_build_object(
               'delivery_id', d.delivery_id,
               'channel',     d.channel,
               'purpose',     d.purpose,
               'target',      d.target_ref,
               'attempt',     d.attempt,
               'error_code',  d.error_code,
               'job',         d.job_id,
               'project',     j.project_id,
               'at',          d.updated_at,
               -- A code nobody can act on is a code nobody reads. This is the
               -- same argument #186 made about the provenance line.
               'says', case
                 when d.error_code like 'chat_not_found%'
                   then 'That chat no longer exists, or the bot was removed from it.'
                 when d.error_code like 'indeterminate%'
                   then 'The provider did not say whether it arrived.'
                 when d.error_code like '%rate%'
                   then 'The provider is rate-limiting us.'
                 when d.error_code like '%timeout%' or d.error_code like '%ECONN%'
                   then 'The provider could not be reached.'
                 else 'The provider refused it.'
               end
             ) as v
        from public.deliveries d
        left join public.jobs j on j.job_id = d.job_id
       where d.state = 'failed'
         and coalesce(j.is_fixture, false) = false
         and (p_project_id is null or j.project_id = p_project_id)
       order by d.updated_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
$fn$;

drop function if exists public.undelivered(uuid, integer);
create function public.undelivered(p_project_id uuid default null, p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.undelivered(p_project_id, p_limit) $fn$;

grant execute on function public.undelivered(uuid, integer) to anon, authenticated, service_role;

comment on function app.undelivered(uuid, integer) is
  'Issue #202. What could not be delivered, with the attempt count, the error '
  'code and a sentence a person can act on.';

commit;
