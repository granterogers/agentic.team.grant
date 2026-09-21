-- 0535 — A job that dies says so, whichever layer killed it
--
-- On 17 September the nightly backup failed. Grant was not told, no
-- impediment was written, no delivery was attempted, and the next morning
-- there was simply no backup from the 17th. The job row said:
--
--     state        = failed
--     state_reason = 'recovery: 5 attempts exhausted while in running'
--
-- in a table he does not read. Fourteen days of real traffic hold 56 failed
-- jobs, not one of which produced a delivery, and six of which — the backup
-- among them — left no trace anywhere a person looks.
--
-- ## Why this is a trigger and not a fourth patch
--
-- CLAUDE.md records this lesson being learned three times already, each time
-- at the site that had just been caught:
--
--   * the coherence gate writes an impediment when it refuses (#211);
--   * the output INSERT refusal learned it after swallowing a preference
--     Grant had taught the office;
--   * a handler that threw until its attempts ran out learned it after
--     eighteen jobs died in thirty minutes on an OpenRouter quota.
--
-- Three sites learned it and three did not. The two survivors in TypeScript
-- are `in notifying with no output to deliver` — which is invariant 7
-- word for word, completed work becoming apparent nothingness — and a review
-- rejection with attempts exhausted. The third is this whole function,
-- `app.recover_stalled_jobs`, which is SQL and could never have been fixed by
-- being careful in the worker.
--
-- Six sites, one rule, three of them wrong is not six defects. It is one
-- defective abstraction, and #249/#254 are the cautionary pair about fixing
-- the instance instead: ask whether the thing that failed is an instance or a
-- class BEFORE patching the instance. The class is "a job reached a terminal
-- failure", and the only place every path to it is visible is the transition
-- itself.
--
-- ## What it does not do
--
-- It does not double-record. The three call sites that already write a good,
-- specific impediment write it BEFORE moving the job, so by the time this
-- fires there is one and it stands aside. What it catches is the job that
-- would otherwise have nothing — which is exactly the set nobody has been
-- able to enumerate in advance, twice now.
--
-- It does not announce, page, or deliver. An impediment is a durable record
-- on a page Grant reads, and a failure a minute would make that page a log.
-- What decides whether a phone buzzes is a separate question about rate and
-- consequence, and it is not this trigger's.
--
-- It does not raise. Recording a failure must never become a second failure —
-- the same reason every observability call in `worker.ts` swallows its own
-- errors. A job that cannot be journalled still has to finish dying.
--
-- ## `needed` is the fingerprint
--
-- `needed` is generated as `lower(btrim(needed_raw))` and `raise_proposals`
-- groups by it, so the phrase is a dedupe key rather than prose. Keyed on the
-- job KIND, repeated failures of one duty collapse into one countable row —
-- which is the "repeated failure fingerprints" the operational reading has
-- never been able to answer.
--
-- The kind is `not_capable` deliberately. `app.raise_proposals` skips that
-- kind because 291 of 331 such rows are the coherence gate refusing an answer
-- and there is nothing there for a person to approve. A failed backup is the
-- same: it is a thing to be told about, not a permission to grant.

begin;

create or replace function app.journal_terminal_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Only the edge into failure. A job already failed that is touched again is
  -- not a new death, and `jobs_touch_updated_at` guarantees updates are common.
  if new.state <> 'failed' or old.state = 'failed' then
    return null;
  end if;

  -- The three careful call sites write theirs first, so this is how they win.
  if exists (
    select 1 from public.job_impediments i where i.job_id = new.job_id
  ) then
    return null;
  end if;

  begin
    insert into public.job_impediments
      (job_id, project_id, staff_slug, kind, needed_raw, detail, understood_as,
       noticed_by)
    values (
      new.job_id,
      new.project_id,
      new.recipient_agent,
      'not_capable',
      left('to finish ' || new.kind, 64),
      left(coalesce(nullif(btrim(new.state_reason), ''),
                    'it failed without saying why'), 500),
      left(new.kind || ' ended in failure and produced nothing', 280),
      'the job machinery'
    );
  exception when others then
    -- Deliberately swallowed. See the header: a failure that cannot be
    -- journalled must still be allowed to finish failing.
    null;
  end;

  return null;
end;
$fn$;

revoke all on function app.journal_terminal_failure() from public;

drop trigger if exists jobs_journal_terminal_failure on public.jobs;

create trigger jobs_journal_terminal_failure
after update of state on public.jobs
for each row
when (new.state = 'failed' and old.state is distinct from 'failed')
execute function app.journal_terminal_failure();

comment on function app.journal_terminal_failure() is
  'Every terminal job failure leaves a durable trace, whichever layer caused '
  'it. Stands aside where a call site has already written a better one. '
  'Added after the 17 September nightly backup died silently through '
  'app.recover_stalled_jobs, which is SQL and was unreachable from the three '
  'places the worker had learned this rule.';

commit;
