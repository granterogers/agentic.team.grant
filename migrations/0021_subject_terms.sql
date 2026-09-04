-- 0021 — make the duplicate scan able to find anything
--
-- 0020 shipped a duplicate scan that searched `jobs.idempotency_key` with
-- ILIKE. It typechecked, it ran, and it would have returned no candidates for
-- the rest of the project's life.
--
-- §6 derives the idempotency key "from semantic inputs", which in practice
-- means a hash or a compact composite - `research:proj-4:a91f0c2`. Searching
-- it for the word `pricing` cannot match, and the failure is invisible in
-- exactly the way that matters: the scan runs, records `none_found`, satisfies
-- every constraint in 0020, and reports a clean result. The row would say the
-- router looked. The router looked at the wrong column.
--
-- This is the same defect the POC gates turned up eleven times, in a new
-- costume: a check whose result is fixed regardless of the world. A constraint
-- that a search HAPPENED cannot tell whether the search COULD have succeeded.
--
-- The fix is to compare like with like. `duplicate_search_terms` already holds
-- the subject terms of the instruction that produced the job, so a later
-- instruction's terms can be intersected against them directly - exact, no
-- substring guessing, and GIN-indexable. Renamed to `subject_terms` because
-- the column now has two jobs and only one of them is "what we searched for":
-- it is also what future searches match against.
--
-- ## The blind spot this leaves, stated rather than hidden
--
-- Only jobs that went through the router have subject terms. A job enqueued by
-- another path is invisible to the scan. That is a real limitation and the
-- honest response is to report it, not to paper over it with an unreliable
-- second signal - mixing a reliable check with an unreliable one produces a
-- check whose misses are unattributable. `app.unrouted_live_jobs()` counts the
-- blind spot so a scan result can carry its own coverage.

begin;

alter table public.routing_decisions
  rename column duplicate_search_terms to subject_terms;

comment on column public.routing_decisions.subject_terms is
  'The distinctive words of the instruction that produced this job. Both what '
  'this routing''s duplicate search used, and what LATER searches intersect '
  'against - which is the only reliable way to find semantic near-duplicates, '
  'since the idempotency key is derived and not searchable.';

-- The scan is an overlap query (`&&`) on every route, so it gets the index
-- that makes that operator fast rather than a scan over every live job.
create index routing_decisions_subject_terms
  on public.routing_decisions using gin (subject_terms);

-- ---------------------------------------------------------------------------
-- Coverage: how much of the live job set the scan cannot see
-- ---------------------------------------------------------------------------

create or replace function app.unrouted_live_jobs()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.jobs j
  where j.state not in ('complete', 'cancelled', 'failed')
    and not exists (
      select 1 from public.routing_decisions r where r.job_id = j.job_id
    );
$$;

comment on function app.unrouted_live_jobs() is
  'Live jobs with no routing decision, and therefore no subject terms - the '
  'duplicate scan''s blind spot, reported so that a `none_found` result can be '
  'read with the coverage it actually had.';

grant execute on function app.unrouted_live_jobs() to ai_team_app;

commit;
