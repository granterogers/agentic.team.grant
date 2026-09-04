-- 0020 — routing decisions, and the two limits that keep delegation bounded
--
-- Phase 5's acceptance contains a sentence that reads like bookkeeping and is
-- not:
--
--   "duplicate-work avoidance is enforced by the router as a REQUIRED QUERY"
--
-- Not "the router should check". A required query. The distinction matters
-- because the failure it prevents is silent: two channels ask for the same
-- work in different words, both are reasonable, both get done, and nothing
-- anywhere reports a fault. §5 is explicit - *"when uncertain, link to or
-- reuse the existing job rather than silently creating duplicate substantive
-- work."*
--
-- The `jobs` idempotency index (0005) already collides IDENTICAL work. It
-- cannot catch this: "summarise the pricing research" and "what did we find on
-- pricing" derive different keys because they are different strings. Semantic
-- near-duplication is the router's problem, and the only way to know the
-- router looked is to make the record of looking a NOT NULL column on the
-- decision itself.
--
-- So: a routing decision without a recorded search does not exist. Not
-- "is flagged" - cannot be inserted. And proceeding anyway when the search DID
-- find something has to be justified in prose, because that is the exact
-- moment the duplicate gets created.
--
-- The second half of the file is delegation depth. §9's runaway-delegation
-- failure injection needs something to run away FROM, and a cap enforced in a
-- worker is a cap that the next worker forgets.

begin;

-- ---------------------------------------------------------------------------
-- What the duplicate search concluded
-- ---------------------------------------------------------------------------

create type public.duplicate_resolution as enum (
  -- The search ran and found nothing similar in flight.
  'none_found',
  -- Similar live work exists and this request was attached to it rather than
  -- duplicated. §5's preferred outcome.
  'linked_to_existing',
  -- Similar live work exists and this is genuinely different anyway. Allowed,
  -- but this is the branch that creates duplicates when it is wrong, so the
  -- constraint below makes it the only branch that must argue for itself.
  'proceeded_distinct'
);

comment on type public.duplicate_resolution is
  'What the router''s mandatory duplicate search concluded. `proceeded_distinct` '
  'is the branch that must be justified: it is where a duplicate gets made.';

-- ---------------------------------------------------------------------------
-- Routing decisions
-- ---------------------------------------------------------------------------

create table public.routing_decisions (
  decision_id       uuid        primary key default gen_random_uuid(),
  job_id            uuid        not null references public.jobs (job_id),

  -- §6's classification, and whether it was contested. `confident` is not
  -- decoration: the roster rules below read it, because an unconfident reading
  -- is the one case where convening a team is most expensive and least
  -- justified.
  intent_class      text        not null,
  confident         boolean     not null,
  intent_reason     text        not null,

  -- ---- the required query, recorded ----------------------------------------
  -- Non-empty by constraint. A search with no terms is not a search, and a
  -- nullable column here would make "the router checked" a claim rather than a
  -- fact.
  duplicate_search_terms  text[]  not null,
  -- What it returned, verbatim, including when that was nothing. Stored as
  -- jsonb rather than a join table because it is evidence of a moment, not
  -- live state: the candidate jobs move on, and this must not.
  duplicate_candidates    jsonb   not null default '[]'::jsonb,
  duplicate_resolution    public.duplicate_resolution not null,
  linked_job_id           uuid    references public.jobs (job_id),
  -- Only required on `proceeded_distinct`, where it is the whole safeguard.
  distinct_justification  text,

  -- ---- who was convened, and why so few ------------------------------------
  -- Staff slugs rather than ids: this row is read by humans reviewing a
  -- routing decision after the fact, and a uuid tells them nothing. The FK is
  -- given up deliberately; §9's roles are seeded by migration and their slugs
  -- are stable identity, not a label.
  roster            text[]      not null default '{}'::text[],
  roster_reason     text        not null,

  -- §9: "Trivial work spawns no subagents." A decision to convene NOBODY is a
  -- real decision and is recorded as one, rather than as an absent row.
  delegation_depth  smallint    not null default 0,

  decided_at        timestamptz not null default app.now_utc(),

  constraint routing_decisions_intent_known
    check (intent_class in (
      'thought', 'question', 'discussion', 'suggestion',
      'light_investigation', 'assignment', 'direct_command'
    )),

  -- The required query, as a constraint rather than as a convention.
  constraint routing_decisions_search_was_performed
    check (cardinality(duplicate_search_terms) >= 1),

  -- Linking claims a job; the claim must name it.
  constraint routing_decisions_link_names_a_job
    check ((duplicate_resolution = 'linked_to_existing') = (linked_job_id is not null)),

  -- Proceeding past a near-duplicate is the failure mode. It costs a sentence.
  constraint routing_decisions_distinct_is_argued
    check (
      duplicate_resolution <> 'proceeded_distinct'
      or length(trim(coalesce(distinct_justification, ''))) >= 20
    ),

  -- §9's "the smallest justified specialist set", as an upper bound the
  -- database knows. `system_config` holds the tunable 3; this is the ceiling
  -- that a misread config cannot raise.
  constraint routing_decisions_roster_bounded
    check (cardinality(roster) <= 5),

  constraint routing_decisions_roster_is_explained
    check (length(trim(roster_reason)) >= 10),

  -- An unconfident reading must not convene a team. §6 resolves ambiguity
  -- downward; a five-agent workload off a maybe is precisely the uncontrolled
  -- multi-agent workload Phase 5 says cannot happen. One agent to ask a
  -- clarifying question is allowed; a committee is not.
  constraint routing_decisions_unconfident_stays_small
    check (confident or cardinality(roster) <= 1),

  constraint routing_decisions_depth_bounded
    check (delegation_depth between 0 and 3)
);

create index routing_decisions_by_job on public.routing_decisions (job_id);
create index routing_decisions_by_time on public.routing_decisions (decided_at desc);

comment on table public.routing_decisions is
  'One row per routing decision (§9). The duplicate search is NOT NULL and '
  'non-empty by constraint, which is what makes "enforced by the router as a '
  'required query" a fact about the schema rather than a claim about a worker.';
comment on column public.routing_decisions.duplicate_candidates is
  'What the search returned, verbatim, including the empty case. Evidence of a '
  'moment, not live state - the candidate jobs move on and this must not.';
comment on column public.routing_decisions.roster is
  'Staff slugs. Empty is a valid and common answer: §9 says trivial work spawns '
  'no subagents, so "nobody" is a decision and is recorded as one.';

-- A routing decision is a record of what was decided, so it is append-only for
-- the same reason the ledger is. A router that can rewrite its own reasoning
-- after the outcome is known cannot be audited.
revoke update, delete, truncate on public.routing_decisions from ai_team_app;

create trigger routing_decisions_reject_update
  before update on public.routing_decisions
  for each row execute function app.reject_ledger_mutation();

create trigger routing_decisions_reject_truncate
  before truncate on public.routing_decisions
  for each statement execute function app.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Runaway delegation
--
-- `jobs.parent_job_id` is self-referential with no depth limit, which is
-- correct for the data model and dangerous for an agent that can enqueue work.
-- Delegation that spawns delegation is how a single question becomes a
-- thousand jobs, and the cost is unbounded in exactly the way §6's cost
-- governor exists to prevent.
--
-- Enforced in a trigger rather than in the enqueue path because there is more
-- than one enqueue path and there will be more later. A cap that each caller
-- must remember is a cap that the next caller forgets.
-- ---------------------------------------------------------------------------

create or replace function app.job_depth(p_job_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with recursive ancestry as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job_id
    union all
    select j.job_id, j.parent_job_id, a.depth + 1
      from public.jobs j join ancestry a on j.job_id = a.parent_job_id
      -- Belt and braces against a cycle the CHECK cannot see. `no_self_parent`
      -- stops a job parenting itself; it cannot stop A->B->A, and a recursive
      -- CTE over a cycle does not terminate.
      where a.depth < 50
  )
  select coalesce(max(depth), 0) from ancestry;
$$;

comment on function app.job_depth(uuid) is
  'How many parents a job has above it. Bounded at 50 so a parent cycle fails '
  'as a wrong number rather than as a hung query.';

create or replace function app.enforce_delegation_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_depth integer;
  v_max integer;
begin
  if new.parent_job_id is null then
    return new;
  end if;

  select coalesce((value #>> '{}')::integer, 3)
    into v_max
    from public.system_config where key = 'agents.max_delegation_depth';
  if v_max is null then v_max := 3; end if;

  v_parent_depth := app.job_depth(new.parent_job_id);

  if v_parent_depth + 1 > v_max then
    raise exception
      'job cannot be created at delegation depth %: the limit is %. §9 caps '
      'delegation because delegation that spawns delegation is how one question '
      'becomes a thousand jobs. If this work genuinely needs another level, it '
      'needs a person to say so, not a deeper default.',
      v_parent_depth + 1, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger jobs_enforce_delegation_depth
  before insert or update of parent_job_id on public.jobs
  for each row execute function app.enforce_delegation_depth();

comment on function app.enforce_delegation_depth() is
  '§9''s runaway-delegation guard. A trigger rather than an enqueue-path check '
  'because there is more than one enqueue path and there will be more later.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.routing_decisions enable row level security;
alter table public.routing_decisions force  row level security;

grant select, insert on public.routing_decisions to ai_team_app;
grant execute on function app.job_depth(uuid) to ai_team_app;

create policy routing_decisions_app_read on public.routing_decisions
  for select to ai_team_app using (true);
create policy routing_decisions_app_insert on public.routing_decisions
  for insert to ai_team_app with check (true);

insert into public.system_config (key, value, description, self_adjustable) values
  ('agents.max_delegation_depth', '3'::jsonb,
   '§9: how many levels of delegation are permitted below a top-level job. Not self-adjustable - a delegation cap an agent can raise is not a cap.', false)
on conflict (key) do nothing;

commit;
