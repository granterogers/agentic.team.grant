-- 0012 — blockers and inference usage accounting
--
-- Gate 5's acceptance criteria are wider than the router. They are:
--
--   "no paid call, non-urgent work queues, blocked urgent work raises a
--    blocker, local usage records stay correct."
--
-- The first is proven. The other three had nowhere to be recorded: there was no
-- blocker table and no usage table, so "raises a blocker" and "usage records
-- stay correct" could only have been asserted. This migration gives both a
-- home, with the constraints that make the assertion checkable.
--
-- Two design points earn their keep:
--
--   1. §12 requires a blocker to answer "can work continue around it?". That is
--      a required column here, not an optional one, because a blocker that does
--      not say whether it halts everything cannot be triaged — and a nullable
--      column would let every producer skip the one field that decides urgency.
--
--   2. §11 classifies every capacity figure as AUTHORITATIVE, CALCULATED or
--      ESTIMATED and says "never present estimated quota as authoritative". A
--      free-text provenance column would decay into whatever each caller felt
--      like writing. It is an enum, and a CHECK ties the classification to the
--      evidence: AUTHORITATIVE requires the provider's own reported figure to
--      be present.

begin;

-- ---------------------------------------------------------------------------
-- Usage provenance (§11)
-- ---------------------------------------------------------------------------

create type public.usage_provenance as enum (
  'authoritative',   -- the provider reported this figure directly
  'calculated',      -- known quota + complete local accounting
  'estimated'        -- incomplete provider information or partial accounting
);

comment on type public.usage_provenance is
  '§11. Never present estimated quota as authoritative. Notebook has no live '
  'usage counters, so its figures are always estimated.';

-- Every inference call, whether it succeeded or not.
--
-- §11 says "track local usage for every provider even where provider-side
-- metrics exist", so this is not a cache of OpenRouter's numbers — it is the
-- local ledger those numbers are reconciled against. Failed calls are recorded
-- too: a 429 is usage information even though it produced no tokens.
create table public.inference_usage (
  usage_id          uuid        primary key default gen_random_uuid(),

  provider          text        not null references public.providers (provider),
  model_id          text        not null,

  job_id            uuid        references public.jobs (job_id),
  correlation_id    uuid        not null,

  -- What happened. 'ok' means content came back; everything else names the
  -- failure so the table can answer "how often does this model return nothing?"
  outcome           text        not null,

  prompt_tokens     integer     not null default 0,
  completion_tokens integer     not null default 0,

  -- Charged cost. Zero is the only value the enforcement layers permit; the
  -- column exists so that a non-zero charge, if one ever occurs, is recorded
  -- rather than lost. It is the evidence for the "no paid call" claim.
  cost_usd          numeric(12, 8) not null default 0,

  -- What the provider itself said the cost was, verbatim and nullable. Distinct
  -- from cost_usd: null means the provider reported nothing, which is exactly
  -- when a figure must not be called authoritative.
  provider_reported_cost numeric(12, 8),

  provenance        public.usage_provenance not null,

  occurred_at       timestamptz not null default app.now_utc(),

  constraint inference_usage_outcome_known
    check (outcome in (
      'ok', 'empty_completion', 'provider_error', 'rate_limited',
      'transport_error', 'malformed_response', 'refused_paid', 'unavailable'
    )),
  constraint inference_usage_tokens_non_negative
    check (prompt_tokens >= 0 and completion_tokens >= 0),
  constraint inference_usage_cost_non_negative
    check (cost_usd >= 0),

  -- The constraint that makes provenance mean something. A row may only claim
  -- to be authoritative if the provider actually reported the figure.
  constraint inference_usage_authoritative_needs_provider_figure
    check (provenance <> 'authoritative' or provider_reported_cost is not null)
);

create index inference_usage_by_time on public.inference_usage (occurred_at desc);
create index inference_usage_by_correlation on public.inference_usage (correlation_id);
create index inference_usage_by_model on public.inference_usage (provider, model_id, occurred_at desc);

comment on table public.inference_usage is
  'Local accounting for every inference attempt (§11). Failures are rows too: a '
  '429 is usage information even though it produced no tokens.';
comment on column public.inference_usage.provider_reported_cost is
  'Verbatim provider figure, nullable. Null is precisely when a cost must not be '
  'classified authoritative, which the CHECK constraint enforces.';

-- Usage is append-only for the same reason the ledger is: a corrected figure
-- must be a new row, not a rewritten one, or "usage records stay correct"
-- becomes unfalsifiable.
revoke update, delete, truncate on public.inference_usage from ai_team_app;

create trigger inference_usage_reject_update
  before update on public.inference_usage
  for each row execute function app.reject_ledger_mutation();

create trigger inference_usage_reject_truncate
  before truncate on public.inference_usage
  for each statement execute function app.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Blockers (§12, "Needs Me")
-- ---------------------------------------------------------------------------

create type public.blocker_state as enum (
  'open',
  'resolved',    -- Grant acted
  'expired',     -- its deadline passed unanswered
  'withdrawn'    -- the work no longer needs it
);

-- §12: "Anything requiring Grant creates a blocker with: project, job,
-- requested action, why it is needed, real deadline if any, consequences of
-- delay, approval options, originating agent, and whether work can continue
-- around it." Every one of those is a column, and the ones that are not
-- genuinely optional are NOT NULL.
--
-- The paragraph after that list gives the reason: "This prevents random agent
-- messages from becoming the approval system." A blocker missing its
-- consequences-of-delay is a random agent message wearing a table row, so the
-- schema refuses it.
create table public.blockers (
  blocker_id        uuid        primary key default gen_random_uuid(),

  project_id        uuid        references public.projects (project_id),
  job_id            uuid        references public.jobs (job_id),

  requested_action  text        not null,
  why_needed        text        not null,

  -- "real deadline if any" — nullable, and named to discourage inventing one.
  real_deadline     timestamptz,

  consequences_of_delay text    not null,

  -- Approval options as an array so the UI renders buttons rather than parsing
  -- prose. At least one, or there is nothing for Grant to do.
  approval_options  text[]      not null,

  originating_agent text        not null,

  -- The triage field. Required: see the comment above.
  work_can_continue boolean     not null,

  state             public.blocker_state not null default 'open',
  resolved_at       timestamptz,
  resolution        text,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),

  constraint blockers_requested_action_substantive
    check (length(requested_action) between 3 and 2000),
  constraint blockers_why_needed_substantive
    check (length(why_needed) between 3 and 2000),
  constraint blockers_consequences_substantive
    check (length(consequences_of_delay) between 3 and 2000),
  constraint blockers_has_an_option
    check (array_length(approval_options, 1) >= 1),
  constraint blockers_deadline_after_creation
    check (real_deadline is null or real_deadline > created_at),
  -- A settled blocker says when it settled. An open one has not.
  constraint blockers_resolved_iff_settled
    check ((state <> 'open') = (resolved_at is not null))
);

create index blockers_open_first on public.blockers (created_at desc)
  where state = 'open';
create index blockers_by_job on public.blockers (job_id) where job_id is not null;

create trigger blockers_touch_updated_at
  before update on public.blockers
  for each row execute function app.touch_updated_at();

comment on table public.blockers is
  '§12 "Needs Me". Every field the spec names is a column, and the ones that '
  'are not genuinely optional are NOT NULL — a blocker without its '
  'consequences-of-delay is a random agent message wearing a table row.';

alter table public.inference_usage enable row level security;
alter table public.inference_usage force row level security;
alter table public.blockers enable row level security;
alter table public.blockers force row level security;

grant select, insert on public.inference_usage to ai_team_app;
grant select, insert, update on public.blockers to ai_team_app;

create policy inference_usage_app_read on public.inference_usage
  for select to ai_team_app using (true);
create policy inference_usage_app_append on public.inference_usage
  for insert to ai_team_app with check (true);
create policy blockers_app_read on public.blockers
  for select to ai_team_app using (true);
create policy blockers_app_write on public.blockers
  for insert to ai_team_app with check (true);
create policy blockers_app_settle on public.blockers
  for update to ai_team_app using (true) with check (true);

-- ---------------------------------------------------------------------------
-- The urgency boundary
-- ---------------------------------------------------------------------------

-- Gate 5 distinguishes urgent from non-urgent work, and the distinction decides
-- whether a failure queues quietly or pages Grant. It is therefore
-- configuration, not a constant in a TypeScript file (§4), and it is NOT
-- self-adjustable: a system that can widen its own definition of "urgent" can
-- talk itself into paging Grant about anything.
insert into public.system_config (key, value, description, self_adjustable)
values (
  'jobs.urgent_priority_max',
  '20'::jsonb,
  'A job with priority <= this is urgent: if inference is unavailable it raises '
  'a blocker instead of queueing quietly. Lower priority number = more urgent, '
  'matching the dequeue order.',
  false
)
on conflict (key) do nothing;

commit;
