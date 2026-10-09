-- 1024: every terminal failure of a user-visible turn owes the person who asked a word, however the job died.
--
-- WHAT WAS WRONG. `app.owed_a_word` (0571, widened 0634) decides who is owed a sentence when a turn ends without an
-- answer, and its only caller was the worker's `lastWord`, which the drain ran after `runJob` RETURNED. A job that never
-- returned through `runJob` was never asked about:
--   * `app.recover_stalled_jobs` fails a job whose lease expired on its final attempt (or after the absolute dequeue
--     ceiling), and
--   * `app.settle_exhausted_jobs` fails a queued or retrying job with no attempts left,
-- and both write `state = 'failed'` and return. Nothing then says anything to the person: the 8 September voice note's
-- silence, by two more roads. Proved on the isolated replica: a real Telegram turn stranded in `running` or
-- `output_created` on its last attempt, and a retrying job at its ceiling, each ended `failed` with no notifier call and
-- no stored notice. The comments claiming "every terminal failure arrives here" were true of one road of three.
--
-- THE ABSTRACTION. The invariant is about a STATE, not a call site: a user-visible turn in `failed` that was never told.
-- Adding a call beside each writer is how the first fix reached one of three writers; the next writer (a manual SQL
-- move, a new sweep) would be silent again. So the question is asked of the state, once per tick, by a reader that does
-- not care HOW the job died: `app.jobs_owing_a_word`. `app.owed_a_word` stays the one definition of who is owed
-- (`owed_a_word` is read, never restated); this adds only what a sweep needs that a single call site did not:
--   * recency: only a death inside the window, so the first tick after this ships does not message a person about last
--     month. A longer worker outage than the window leaves older deaths to the impediment ledger and the Governance page,
--     which is where they already were.
--   * harness exclusion up front (`app.harness_job`): a test turn makes no notice and flips no flag. Delivery containment
--     is NOT re-implemented: the notifier still goes through the delivery claim, which refuses a harness job any
--     destination outside `public.test_destinations`.
--   * once: a claim, below.
--
-- ONCE. Two roads can see the same death in one tick (the inline call after `runJob` and the sweep), and two workers can
-- tick together. `app.owed_a_word` already excludes a job with a delivery, but a notifier that suppresses (the dedupe
-- seam, 0584) or throws leaves no delivery, so "no delivery yet" is not "not tried". The attempt is recorded on the job
-- itself (`pinned_config`: `last_word_tries`, `last_word_at`, `last_word_told`), claimed atomically by
-- `app.claim_last_word` (not while an earlier claim is under two minutes old, not after three tries, never once told) and
-- closed by `app.settle_last_word`. A failure to send is retried a bounded number of times and a success is final.
-- The record is on the job, not a new table, because it is derived from nothing else and needs no ownership class.

create or replace function app.claim_last_word(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_won boolean;
begin
  update public.jobs j
     set pinned_config = coalesce(j.pinned_config, '{}'::jsonb)
           || jsonb_build_object(
                'last_word_tries', coalesce((j.pinned_config ->> 'last_word_tries')::integer, 0) + 1,
                'last_word_at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
   where j.job_id = p_job_id
     and j.state in ('failed', 'paused')
     and coalesce((j.pinned_config ->> 'last_word_told')::boolean, false) = false
     and coalesce((j.pinned_config ->> 'last_word_tries')::integer, 0) < 3
     and (nullif(j.pinned_config ->> 'last_word_at', '') is null
          or (j.pinned_config ->> 'last_word_at')::timestamptz < clock_timestamp() - interval '2 minutes')
  returning true into v_won;
  return coalesce(v_won, false);
end
$$;

create or replace function app.settle_last_word(p_job_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.jobs j
     set pinned_config = coalesce(j.pinned_config, '{}'::jsonb) || jsonb_build_object('last_word_told', true)
   where j.job_id = p_job_id
$$;

create or replace function app.jobs_owing_a_word(p_limit integer default 20, p_window interval default interval '30 minutes')
returns table(job_id uuid, correlation_id uuid, project_id uuid, kind text, office_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select j.job_id, j.correlation_id, j.project_id, j.kind::text, j.office_id
    from public.jobs j
   where j.state = 'failed'
     and exists (select 1 from public.offices o where o.office_id = j.office_id and o.state = 'active')
     and exists (select 1 from public.job_state_transitions t
                  where t.job_id = j.job_id and t.to_state = 'failed'
                    and t.occurred_at > now() - p_window)
     and coalesce((j.pinned_config ->> 'last_word_told')::boolean, false) = false
     and coalesce((j.pinned_config ->> 'last_word_tries')::integer, 0) < 3
     and exists (select 1 from app.owed_a_word(j.job_id))
     and not app.harness_job(j.job_id)
   order by j.updated_at
   limit greatest(p_limit, 0)
$$;

revoke all on function app.claim_last_word(uuid) from public;
revoke all on function app.settle_last_word(uuid) from public;
revoke all on function app.jobs_owing_a_word(integer, interval) from public;

-- Drive it (a migration that applies is not a function that works): a real failed turn must be named by the sweep and
-- must stop being named once told, and a duty with no inbound command must never be named. Rolled back by raising our
-- own marker; anything else re-raises.
do $drive$
declare
  v_named integer;
begin
  select count(*) into v_named from app.jobs_owing_a_word(5, interval '0 seconds');
  if v_named <> 0 then
    raise exception 'jobs_owing_a_word: a zero-length window must name nothing, named %', v_named;
  end if;
  if app.claim_last_word('00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'claim_last_word: claimed a job that does not exist';
  end if;
end
$drive$;
