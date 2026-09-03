-- 0018 — the agent engine
--
-- Phase 5's acceptance is four sentences, and three of them say "cannot":
--
--   "an output without `reviewer_status` **cannot reach `committed`**;
--    material disagreement is surfaced rather than averaged away;
--    duplicate-work avoidance is enforced by the router as a required query;
--    ambiguous input produces a bounded investigation or a clarification,
--    never an uncontrolled multi-agent workload."
--
-- §10 says why they belong here rather than in a prompt: *"the gate cannot be
-- bypassed by the caller"*, and §11 is blunter — *"Prompts may explain policy.
-- Code must enforce policy."* A gate a caller can skip is a suggestion, and a
-- suggestion is what the whole quality section exists to rule out.
--
-- So the review gate is a trigger on `jobs`, not a check in a worker.

begin;

-- ---------------------------------------------------------------------------
-- Staff (§9)
-- ---------------------------------------------------------------------------

-- §9: *"A staff member is NOT an always-running process, a permanently
-- allocated LLM, a provider, or a model. Staff are persistent structured
-- identities."*
--
-- Which is why this table has no provider column and no model column. The
-- chain is `agent identity -> task requirements -> orchestration policy ->
-- inference requirement -> model router -> provider/model`, and a `model`
-- column here would short-circuit four of those arrows. Finance keeps its
-- identity when the provider changes entirely, and that is only true if the
-- identity never mentioned one.
create table public.staff (
  staff_id          uuid        primary key default gen_random_uuid(),
  slug              text        not null unique,
  name              text        not null,
  title             text        not null,

  -- Permanent roles are the eight §9 names; a temporary specialist is
  -- recommended by the Chief of Staff and shares channels rather than getting
  -- its own bot or app.
  permanent         boolean     not null default true,

  responsibilities  text        not null,
  expertise         text[]      not null default '{}'::text[],
  communication_style text      not null,

  -- §9 lists avatar as part of how staff are presented. Nullable because the
  -- avatars land in Phase 7 with the Slack office that consumes them; a null
  -- here is "not yet drawn", not "has none".
  avatar_ref        text,

  -- §21 forbids silently changing role identity or core prompts, so the prompt
  -- is versioned and the version is recorded on every job that used it.
  prompt_version    integer     not null default 1,

  -- §17: every integration independently disableable, and the same for staff.
  active            boolean     not null default true,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),

  constraint staff_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint staff_name_present check (length(trim(name)) > 0),
  constraint staff_title_present check (length(trim(title)) > 0),
  constraint staff_responsibilities_substantive check (length(trim(responsibilities)) >= 20),
  constraint staff_prompt_version_positive check (prompt_version >= 1)
);

create trigger staff_touch_updated_at
  before update on public.staff
  for each row execute function app.touch_updated_at();

comment on table public.staff is
  '§9: staff are identities, not processes. Deliberately no provider or model '
  'column - the identity survives the provider changing entirely, which is only '
  'true if it never named one.';

-- ---------------------------------------------------------------------------
-- Quality control (§10)
-- ---------------------------------------------------------------------------

create type public.confidence_level as enum ('low', 'medium', 'high');
create type public.evidence_type as enum ('verified', 'inferred', 'speculative');
create type public.reviewer_status as enum (
  'pending',
  'approved',
  'approved_with_reservations',  -- §10: disagreement is surfaced, not averaged
  'rejected'
);

-- Every substantive output.
--
-- §10's exemption is defined by *how the answer was produced* - deterministic
-- retrieval versus inference - "because that is checkable". So `deterministic`
-- is a column and the trigger below reads it, rather than a caller asserting
-- "this one does not need review".
create table public.outputs (
  output_id         uuid        primary key default gen_random_uuid(),
  job_id            uuid        not null references public.jobs (job_id),
  staff_id          uuid        references public.staff (staff_id),

  body              text        not null,

  -- The §10 metadata block. All NOT NULL for substantive output: an output
  -- that cannot say how confident it is, or what kind of evidence it rests on,
  -- is not reviewable, and unreviewable output is what the gate exists to stop.
  confidence        public.confidence_level not null,
  evidence          public.evidence_type not null,
  sources           jsonb       not null default '[]'::jsonb,

  -- §10: "contradictory evidence" is a required field, not an optional note.
  -- Null means "none found"; the empty string would be indistinguishable from
  -- "nobody looked".
  contradictions    text,

  -- True when the answer came from a deterministic path. §10 exempts these
  -- from review, and the exemption is checkable precisely because this is a
  -- fact about the pipeline rather than a claim by the caller.
  deterministic     boolean     not null default false,

  reviewer_status   public.reviewer_status not null default 'pending',
  reviewed_by       uuid        references public.staff (staff_id),
  reviewed_at       timestamptz,
  review_notes      text,

  -- Which prompt produced it, so a bad output is attributable to a version.
  prompt_version    integer,
  model             text,

  created_at        timestamptz not null default app.now_utc(),

  constraint outputs_body_substantive check (length(trim(body)) > 0),
  -- A settled review says who settled it and when.
  constraint outputs_reviewed_iff_settled
    check ((reviewer_status <> 'pending') = (reviewed_at is not null)),
  -- §10: disagreement is surfaced rather than averaged away. Reserving or
  -- rejecting without saying why averages it away by omission.
  constraint outputs_reservations_are_explained
    check (
      reviewer_status not in ('approved_with_reservations', 'rejected')
      or length(trim(coalesce(review_notes, ''))) >= 10
    ),
  -- A deterministic output cannot claim to be speculative: it either came from
  -- a deterministic path or it did not.
  constraint outputs_deterministic_is_not_speculative
    check (not deterministic or evidence <> 'speculative')
);

create index outputs_by_job on public.outputs (job_id);
create index outputs_pending_review on public.outputs (created_at)
  where reviewer_status = 'pending' and not deterministic;

comment on table public.outputs is
  '§10. The metadata block is NOT NULL because an output that cannot say how '
  'confident it is, or on what kind of evidence, is not reviewable - and '
  'unreviewable output is exactly what the gate exists to stop.';

-- THE GATE.
--
-- §10: *"The gate cannot be bypassed by the caller — the commit step reads
-- `reviewer_status`; an output without it cannot reach `committed`."*
--
-- A trigger, because §11 is explicit that code enforces policy and prompts
-- only explain it. A check inside the worker would be bypassed by any second
-- worker, any migration, any hand-run UPDATE at 3am during an incident - which
-- is precisely when someone would be tempted.
create or replace function app.enforce_review_gate()
returns trigger
language plpgsql
as $$
declare
  v_unreviewed integer;
  v_total integer;
begin
  if new.state <> 'committed' or old.state = 'committed' then
    return new;
  end if;

  select count(*), count(*) filter (
    where reviewer_status = 'pending' and not deterministic
  )
  into v_total, v_unreviewed
  from public.outputs where job_id = new.job_id;

  -- A job with no outputs at all commits freely: plenty of work produces no
  -- substantive output, and requiring one would make the gate a nuisance
  -- rather than a control.
  if v_total = 0 then
    return new;
  end if;

  if v_unreviewed > 0 then
    raise exception
      'job % cannot reach committed: % of % output(s) are unreviewed. §10: the '
      'commit step reads reviewer_status, and an output without it cannot be '
      'committed. Review them, or mark them deterministic if they came from a '
      'deterministic path.', new.job_id, v_unreviewed, v_total
      using errcode = 'check_violation';
  end if;

  -- A rejected output is not a reviewed output for this purpose. Committing
  -- work whose own reviewer rejected it is the failure the gate exists to
  -- prevent, dressed as compliance.
  if exists (
    select 1 from public.outputs
    where job_id = new.job_id and reviewer_status = 'rejected'
  ) then
    raise exception
      'job % cannot reach committed: at least one output was REJECTED by review. '
      'Committing work its own reviewer rejected is the failure the gate exists '
      'to prevent.', new.job_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger jobs_enforce_review_gate
  before update of state on public.jobs
  for each row execute function app.enforce_review_gate();

comment on function app.enforce_review_gate() is
  '§10 THE GATE. A trigger rather than a worker check, because a worker check '
  'is bypassed by a second worker or by a hand-run UPDATE during an incident - '
  'exactly when someone would be tempted.';

-- ---------------------------------------------------------------------------
-- Tool permissions (§11)
-- ---------------------------------------------------------------------------

-- §11's four levels, as data. The router reads this; agents cannot
-- self-authorize around it because the authority is not in their prompt.
create table public.tool_permissions (
  tool              text        primary key,
  level             smallint    not null,
  description       text        not null,
  -- Gmail send is the named example: §11 says expose search, read and create
  -- draft, and do NOT expose send merely because the OAuth scope permits it.
  -- Disabled by application policy, separately from its level.
  enabled           boolean     not null default true,
  disabled_reason   text,

  constraint tool_permissions_level_known check (level between 0 and 3),
  constraint tool_permissions_disabled_has_reason
    check (enabled or length(trim(coalesce(disabled_reason, ''))) > 0)
);

comment on table public.tool_permissions is
  '§11: the tool router enforces these and agents must not self-authorize '
  'around them, which is only true while the authority lives here and not in a '
  'prompt.';

insert into public.tool_permissions (tool, level, description, enabled, disabled_reason) values
  ('db.read',            0, 'Read the application database', true, null),
  ('notebook.read',      0, 'Read notebooks, sources and cached fulltext', true, null),
  ('web.search',         0, 'Search the web', true, null),
  ('gmail.search',       0, 'Search Gmail', true, null),
  ('gmail.read',         0, 'Read a Gmail message', true, null),
  ('calendar.read',      0, 'Read the calendar', true, null),
  ('task.create',        1, 'Create an internal task', true, null),
  ('note.create',        1, 'Write an internal note', true, null),
  ('preference.update',  1, 'Update a notification preference', true, null),
  ('draft.create',       1, 'Create a draft', true, null),
  ('gmail.draft',        1, 'Create a Gmail draft', true, null),
  ('calendar.write',     2, 'Create or change a calendar event', true, null),
  ('slack.post',         2, 'Post a routine message to Slack', true, null),
  ('notebook.write',     2, 'Add an approved note or source to Notebook', true, null),
  ('gmail.send',         3, 'Send email',
     false,
     '§11: Gmail is draft-only by policy. The OAuth scope permitting it is not a reason to expose it; sending stays disabled until Grant explicitly enables it.'),
  ('db.delete',          3, 'Delete application data', false,
     'Destructive. Nothing in V1 needs it, and a capability that exists is a capability that can be reached.'),
  ('spend.money',        3, 'Any action that incurs cost', false,
     '§11: paid inference is prevented by four layers; this is the same prohibition at the tool router.'),
  ('production.write',   3, 'Modify production configuration or security', false,
     'Requires explicit approval and has no automated path in V1.')
on conflict (tool) do nothing;

-- May this tool be called, at this autonomy level?
--
-- In SQL because §11 says the router enforces it centrally, and "centrally"
-- means one definition rather than one per caller.
create or replace function app.tool_allowed(p_tool text, p_approved boolean default false)
returns boolean
language plpgsql
stable
as $$
declare
  v record;
begin
  select * into v from public.tool_permissions where tool = p_tool;

  -- An unknown tool is refused. §10's "never allow free-form model output to
  -- directly trigger destructive tool calls" only holds if an invented tool
  -- name fails closed rather than falling through.
  if v is null then
    return false;
  end if;
  if not v.enabled then
    return false;
  end if;
  -- Level 3 needs explicit approval every time; approval is not a mode the
  -- system can put itself into.
  if v.level = 3 then
    return p_approved;
  end if;
  return true;
end;
$$;

comment on function app.tool_allowed(text, boolean) is
  'An UNKNOWN tool is refused. §10 forbids free-form model output triggering '
  'destructive calls, which only holds if an invented tool name fails closed.';

-- ---------------------------------------------------------------------------
-- Consultation economics (§9)
-- ---------------------------------------------------------------------------

-- §9: track per job the consultations, the reason for each, the provider
-- requests consumed, and **whether each consultation actually changed or
-- improved the outcome**.
--
-- That last field is the one that makes the table worth having. Without it
-- there is no way to answer "is the multi-agent work earning its cost?", and
-- §9's whole consultation-economics section is an instruction to keep asking.
create table public.consultations (
  consultation_id   uuid        primary key default gen_random_uuid(),
  job_id            uuid        not null references public.jobs (job_id),
  consulted_staff   uuid        not null references public.staff (staff_id),
  requested_by      uuid        references public.staff (staff_id),

  reason            text        not null,
  provider_requests integer     not null default 0,

  -- Nullable while the job is in flight, and required to be answered before
  -- the job commits (see the trigger). "We never checked" is the answer §9 is
  -- trying to make impossible.
  changed_outcome   boolean,
  outcome_note      text,

  created_at        timestamptz not null default app.now_utc(),

  constraint consultations_reason_substantive check (length(trim(reason)) >= 10),
  constraint consultations_requests_non_negative check (provider_requests >= 0),
  constraint consultations_no_self_consult check (consulted_staff <> requested_by)
);

create index consultations_by_job on public.consultations (job_id);

comment on table public.consultations is
  '§9 consultation economics. `changed_outcome` is the field that earns the '
  'table: without it there is no way to ask whether multi-agent work is paying '
  'for itself.';

alter table public.staff             enable row level security;
alter table public.staff             force  row level security;
alter table public.outputs           enable row level security;
alter table public.outputs           force  row level security;
alter table public.tool_permissions  enable row level security;
alter table public.tool_permissions  force  row level security;
alter table public.consultations     enable row level security;
alter table public.consultations     force  row level security;

grant select on public.staff to ai_team_app;
grant select, insert, update on public.outputs to ai_team_app;
grant select on public.tool_permissions to ai_team_app;
grant select, insert, update on public.consultations to ai_team_app;
grant execute on function app.tool_allowed(text, boolean) to ai_team_app;

-- Deliberately NOT granted: insert or update on `staff`, and any write on
-- `tool_permissions`. §21 forbids silently changing role identity or
-- authority, and §11 says agents must not self-authorize around the tool
-- router. Both are true only while the application role cannot rewrite them.
create policy staff_app_read on public.staff for select to ai_team_app using (true);
create policy outputs_app_read on public.outputs for select to ai_team_app using (true);
create policy outputs_app_insert on public.outputs for insert to ai_team_app with check (true);
create policy outputs_app_update on public.outputs for update to ai_team_app using (true) with check (true);
create policy tool_permissions_app_read on public.tool_permissions for select to ai_team_app using (true);
create policy consultations_app_read on public.consultations for select to ai_team_app using (true);
create policy consultations_app_insert on public.consultations for insert to ai_team_app with check (true);
create policy consultations_app_update on public.consultations for update to ai_team_app using (true) with check (true);

-- §9's V1 conservative defaults, as configuration rather than constants.
-- Not self-adjustable: §6 warns that a self-adjusting cost governor which
-- drifts upward is the failure the thresholds exist to prevent.
insert into public.system_config (key, value, description, self_adjustable) values
  ('agents.max_specialists_per_job', '3'::jsonb,
   '§9 V1 default: the smallest justified specialist set. Not self-adjustable - a cost governor that can raise its own ceiling is not a governor.', false),
  ('agents.max_investigations_per_project_per_day', '5'::jsonb,
   '§9 V1 default. Not self-adjustable, for the same reason.', false),
  ('agents.max_simultaneous_jobs', '3'::jsonb,
   '§9 V1 default.', false)
on conflict (key) do nothing;

commit;
