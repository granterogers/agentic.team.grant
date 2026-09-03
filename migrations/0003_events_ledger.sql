-- 0003 — The event ledger
--
-- Master spec §6 and core-invariants §3. Append-only: never updated, never
-- deleted, "enforced at the database level ... A convention of immutability is
-- not immutability."
--
-- REVOKE alone does not achieve that, which is why there are four layers below.
-- Revoking UPDATE and DELETE from the application role leaves three ways to
-- mutate history: connecting as the owner, TRUNCATE (which bypasses row
-- triggers entirely), and a future migration that re-grants by accident. Each
-- layer closes one, and CI closes the fourth.

create table public.events (
  event_id             uuid        primary key default gen_random_uuid(),

  -- The spine of "explain this action" (§6). Every job, output and event
  -- belonging to one instruction shares it.
  correlation_id       uuid        not null,
  project_id           uuid        references public.projects (project_id),

  -- Who. Split into kind and identity because policy cares about the kind
  -- ("was this autonomous?") and audit cares about the identity.
  actor_kind           text        not null,
  actor                text        not null,

  -- What caused it, and what it was. `trigger` is spec wording; verified it is
  -- usable unquoted in Postgres 17 rather than renaming a spec field.
  trigger              text        not null,
  action_type          text        not null,

  occurred_at          timestamptz not null default app.now_utc(),

  before_state         jsonb,
  after_state          jsonb,

  -- §6: "Never store or expose chain-of-thought. Enforced at the write
  -- boundary: the ledger accepts only a short structured rationale."
  -- The length limit is that enforcement. A reasoning dump does not fit.
  rationale_summary    text,

  source_refs          jsonb       not null default '[]'::jsonb,
  provider_used        text,
  tool_used            text,

  -- §6: set at write time by the code performing the action, never inferred
  -- later. "If the author cannot say how to undo it, it is reversible = false."
  reversible           boolean     not null,
  reversal_method      text,

  -- FK to jobs is added in 0004, which is where jobs come into existence.
  related_job_id       uuid,
  related_task_id      uuid,

  -- Undo is a compensating event keyed on the original (§6), and the UNIQUE
  -- index below is what makes pressing it twice "harmless by construction"
  -- rather than harmless by a guard in a callback handler.
  compensates_event_id uuid        references public.events (event_id),

  constraint events_actor_kind_known
    check (actor_kind in ('user', 'agent', 'system')),

  constraint events_actor_present
    check (length(trim(actor)) > 0),

  -- Dotted lowercase, e.g. `job.committed`, `notebook.source_added`. A
  -- free-form action_type makes the ledger unqueryable within a month.
  constraint events_action_type_format
    check (action_type ~ '^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)+$'),

  -- Reversibility and its method travel together in both directions. Claiming
  -- reversible without saying how is the failure mode that produces an Undo
  -- button which cannot undo (§6).
  constraint events_reversal_method_iff_reversible
    check (reversible = (reversal_method is not null)),

  constraint events_rationale_is_a_summary
    check (rationale_summary is null or length(rationale_summary) <= 1000),

  constraint events_source_refs_is_array
    check (jsonb_typeof(source_refs) = 'array'),

  constraint events_no_self_compensation
    check (compensates_event_id is null or compensates_event_id <> event_id)
);

comment on table public.events is
  'Append-only event ledger (§6). Never updated, never deleted — enforced by '
  'REVOKE, a row trigger, a TRUNCATE trigger and RLS, not by convention. Undo '
  'appends a compensating row rather than rewriting history.';

comment on column public.events.rationale_summary is
  'Short structured rationale. NEVER chain-of-thought (§6) — the 1000-character '
  'limit is the write-boundary enforcement of that rule.';

comment on column public.events.compensates_event_id is
  'The event this one reverses. UNIQUE, so a duplicate Undo — including two '
  'genuinely concurrent Telegram callback redeliveries — collides on the index '
  'instead of compensating twice.';

-- ---------------------------------------------------------------------------
-- The constraint that makes Undo idempotent
--
-- §6 is specific about why this must be structural: Telegram's documented retry
-- contract is one sentence with no retry count or ordering guarantee, and
-- duplicate deliveries can be genuinely concurrent. A unique index is decided
-- by the database under concurrency — one insert wins, the other gets 23505.
-- A guard in the button handler is decided by a race.
--
-- NULLs are distinct in a Postgres unique index, so ordinary events are
-- unaffected however many there are.
-- ---------------------------------------------------------------------------
create unique index events_one_compensation_per_event
  on public.events (compensates_event_id)
  where compensates_event_id is not null;

-- ---------------------------------------------------------------------------
-- Indexes for the queries the ledger actually serves
-- ---------------------------------------------------------------------------

-- "Explain this action" — the §6 explanation surface.
create index events_correlation_idx on public.events (correlation_id, occurred_at);

-- Project history, newest first.
create index events_project_time_idx on public.events (project_id, occurred_at desc);

-- "What has been done of this kind lately", for duplicate-work avoidance (§6).
create index events_action_time_idx on public.events (action_type, occurred_at desc);

-- Reversible-and-not-yet-reversed, for the Undo affordance. Partial, because
-- irreversible events are the majority and never appear in this query.
create index events_reversible_idx on public.events (occurred_at desc)
  where reversible;

-- ---------------------------------------------------------------------------
-- LAYER 1 — REVOKE from every non-owner role (§6, verbatim requirement)
-- ---------------------------------------------------------------------------
revoke all on public.events from public;

grant select, insert on public.events to ai_team_app;

-- Stated explicitly rather than merely omitted, so the intent survives someone
-- later granting ALL by habit. These are no-ops today and load-bearing later.
revoke update, delete, truncate on public.events from ai_team_app;
revoke update, delete, truncate on public.events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- LAYER 2 — a row trigger, which binds the owner too
--
-- REVOKE cannot restrain the table owner, and migrations necessarily run as the
-- owner. This trigger fires for every role including postgres, so a mistaken
-- UPDATE in a future migration fails loudly instead of quietly rewriting
-- history.
--
-- It restrains DML only. DDL is deliberately still possible, because a future
-- migration must be able to add a column — and adding a column does not falsify
-- a single recorded event.
-- ---------------------------------------------------------------------------
create or replace function app.reject_ledger_mutation()
  returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception
    'events is append-only: % on public.events is never permitted (master spec §6)',
    tg_op
    using errcode = '42501',
          hint = 'To reverse an action, INSERT a compensating event with '
                 'compensates_event_id set to the original event_id.';
end
$$;

comment on function app.reject_ledger_mutation() is
  'Blocks UPDATE and DELETE on the ledger for every role, owner included — '
  'REVOKE cannot restrain the owner, and migrations run as the owner.';

create trigger events_reject_update
  before update on public.events
  for each row execute function app.reject_ledger_mutation();

create trigger events_reject_delete
  before delete on public.events
  for each row execute function app.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- LAYER 3 — TRUNCATE
--
-- TRUNCATE bypasses row triggers completely and is not DELETE, so revoking
-- DELETE does not stop it. It needs its own statement-level trigger, and it is
-- the hole most likely to be missed: a ledger that is append-only against
-- DELETE but erasable by one TRUNCATE is not append-only.
-- ---------------------------------------------------------------------------
create trigger events_reject_truncate
  before truncate on public.events
  for each statement execute function app.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- LAYER 4 — row-level security, forced
--
-- SELECT and INSERT policies only. There is no UPDATE or DELETE policy, so even
-- if a future migration re-granted the privilege, RLS would still refuse.
-- FORCE subjects the owner to the policies as well.
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.events force row level security;

create policy events_app_read on public.events
  for select to ai_team_app using (true);

create policy events_app_append on public.events
  for insert to ai_team_app with check (true);

-- ---------------------------------------------------------------------------
-- The write boundary
--
-- §6 requires that "agents have no API that could dump raw reasoning into it".
-- This function is that API: an explicit parameter list with no free-form
-- passthrough, so there is nowhere for a reasoning trace to go.
--
-- SECURITY INVOKER on purpose — it must not become a way around RLS.
-- ---------------------------------------------------------------------------
create or replace function public.append_event(
  p_correlation_id       uuid,
  p_actor_kind           text,
  p_actor                text,
  p_trigger              text,
  p_action_type          text,
  p_reversible           boolean,
  p_project_id           uuid    default null,
  p_before_state         jsonb   default null,
  p_after_state          jsonb   default null,
  p_rationale_summary    text    default null,
  p_source_refs          jsonb   default '[]'::jsonb,
  p_provider_used        text    default null,
  p_tool_used            text    default null,
  p_reversal_method      text    default null,
  p_related_job_id       uuid    default null,
  p_related_task_id      uuid    default null,
  p_compensates_event_id uuid    default null
)
  returns uuid
  language sql
  security invoker
  set search_path = pg_catalog, public
as $$
  insert into public.events (
    correlation_id, actor_kind, actor, trigger, action_type, reversible,
    project_id, before_state, after_state, rationale_summary, source_refs,
    provider_used, tool_used, reversal_method, related_job_id, related_task_id,
    compensates_event_id
  ) values (
    p_correlation_id, p_actor_kind, p_actor, p_trigger, p_action_type, p_reversible,
    p_project_id, p_before_state, p_after_state, p_rationale_summary, p_source_refs,
    p_provider_used, p_tool_used, p_reversal_method, p_related_job_id, p_related_task_id,
    p_compensates_event_id
  )
  returning event_id
$$;

comment on function public.append_event is
  'The only intended way to write the ledger. An explicit parameter list with '
  'no free-form passthrough, so there is nowhere for chain-of-thought to go '
  '(§6). SECURITY INVOKER, so it is not a way around RLS.';

grant execute on function public.append_event to ai_team_app;
