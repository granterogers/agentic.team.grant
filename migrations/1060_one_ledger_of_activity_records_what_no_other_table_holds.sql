-- 1060: the unified activity ledger, part 1 of 2 - the native table, the taxonomy, the redactor and the writers.
--
-- WHAT THE AUDIT FOUND (docs/activity-ledger/ARCHITECTURE.md, "Existing-system audit")
--
-- The office already records most of its own history, each in the table that owns the state:
--   job lifecycle      public.job_state_transitions  written BY TRIGGER in the same transaction as the state change
--                      (app.log_job_creation, app.enforce_job_transition), so no code path can move a job unrecorded
--   requests           public.inbound_commands        one row per message / voice note, written by the adapter
--   routing            public.routing_decisions
--   approvals          public.blockers                a question with options, an answer and a time
--   deliveries         public.deliveries              claimed -> sent | failed | suppressed, message_ref when the provider confirmed
--   outputs, review    public.outputs                 reviewer_status / reviewed_at
--   model calls, cost  public.inference_usage         provenance authoritative | calculated | estimated
--   impediments        public.job_impediments         append-only
--   actions, undo      public.events                  the action ledger (before/after state, reversal, compensation)
-- What exists NOWHERE: a way to read them as one history; and a home for activity that has no source row of its own
-- (a recovery sweep that reclaimed work, a rate limit, a budget threshold, anything an external worker reports).
--
-- WHAT THIS ADDS - and what it deliberately does not
--
--   * It does NOT copy job, delivery, approval or request history into a second table. A copy is a second source of truth
--     that can disagree with the first (this repository's oldest lesson, 0310), and an audit row written beside a state change
--     can be omitted by a path nobody remembered. The existing rows ARE the events; 1061 reads them as one stream with
--     deterministic ids, and the guarantee "a transition cannot happen without its record" is the one the transition trigger
--     already gives.
--   * public.activity_events: an append-only, typed, office-scoped ledger for ONLY what no other table holds. Update, delete
--     and truncate are refused by the same trigger public.events uses; a correction is a NEW row that supersedes the old.
--   * public.activity_event_types: the taxonomy as DATA (a TypeScript list is one Grant cannot add to, 0366), with the
--     default category, severity and visibility of every event type, projected or native, and which native types an
--     external worker may report.
--   * app.activity_redact / activity_clean: ONE redactor for text and metadata, the SQL twin of src/text/secrets.ts
--     (scripts/isolated/activity-redaction.ts compares them over the same cases).
--   * app.record_activity (strict, for the same transaction as the thing it records), app.record_activity_safely (never
--     raises, never recurses: a failure is counted in public.activity_write_failures, which has no writer that records an
--     event), app.record_external_activity (the only door an external worker's report may come through).
--   * Everything native is behind a default-OFF switch, `activity.ledger_enabled` in system_config. With it off the writers
--     return null and write nothing, and the read section answers that the ledger is off.
--
-- The delivery guarantee is stated plainly in the architecture document: at-least-once from the caller, made effectively-once
-- by the (office, idempotency key) unique index, atomic with the caller's transaction when the strict writer is used. Nothing
-- here claims exactly-once across an external service.
--
-- Additive only. No existing function, table, column or constraint is changed. Rollback: leave the switch off; the objects are
-- inert. Forward recovery: this file is idempotent. History is never dropped as a rollback strategy.
--
-- No begin/commit: the runner applies a file as one all-or-nothing unit.

-- ------------------------------------------------------------------------------------------------ the switch

insert into public.system_config (key, value, description, self_adjustable)
values ('activity.ledger_enabled', 'false'::jsonb,
        'Whether the native activity ledger accepts writes and the activity read section answers. Default off until verified (1060).',
        false)
on conflict (key) do nothing;

create or replace function app.activity_ledger_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.value = 'true'::jsonb from public.system_config c where c.key = 'activity.ledger_enabled'), false)
$$;

comment on function app.activity_ledger_on() is
  'True only when system_config activity.ledger_enabled is the JSON value true. Absent or anything else is off (fails closed).';

-- ------------------------------------------------------------------------------------------------ the taxonomy

create table if not exists public.activity_event_types (
  event_type          text primary key
                      check (event_type ~ '^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)+$'),
  category            text not null check (category in
                        ('request','job','approval','output','delivery','tool','reliability','usage','integration','external')),
  source              text not null check (source in ('projected','native')),
  default_visibility  text not null check (default_visibility in ('user','diagnostic','operator')),
  default_severity    text not null check (default_severity in ('debug','info','notice','warning','error','critical')),
  external_writable   boolean not null default false,
  description         text not null check (length(description) between 10 and 300),
  check (not (external_writable and source <> 'native'))
);

comment on table public.activity_event_types is
  'The activity taxonomy as data: every event type the unified ledger can show, where it comes from (projected from the table that '
  'owns the state, or native), who may see it by default and which native types an external worker may report. A type absent from '
  'here cannot be written natively (foreign key) and a projected type absent from here is shown as an action of the action ledger.';
comment on column public.activity_event_types.source is
  'projected: read from the authoritative table that already records it (never copied). native: written to public.activity_events.';
comment on column public.activity_event_types.default_visibility is
  'user: ordinary Team HQ activity. diagnostic: shown on request, for the person debugging their own office. operator: the deployment''s operator only.';

alter table public.activity_event_types enable row level security;
revoke all on public.activity_event_types from anon, authenticated;

insert into public.activity_event_types (event_type, category, source, default_visibility, default_severity, external_writable, description) values
  ('request.received',        'request',     'projected', 'user',       'info',    false, 'An instruction arrived from a person on a channel (Telegram, Slack, Team HQ, voice). Content is never copied.'),
  ('request.routed',          'request',     'projected', 'diagnostic', 'info',    false, 'The office decided who handles a request, and whether that reading was confident.'),
  ('job.created',             'job',         'projected', 'diagnostic', 'info',    false, 'A unit of work was queued.'),
  ('job.delegated',           'job',         'projected', 'user',       'info',    false, 'A job was queued by another job: work handed to a specialist.'),
  ('job.started',             'job',         'projected', 'diagnostic', 'info',    false, 'A worker began the job.'),
  ('job.paused',              'job',         'projected', 'diagnostic', 'notice',  false, 'The job was parked, waiting for something.'),
  ('job.waiting',             'job',         'projected', 'diagnostic', 'info',    false, 'The job is waiting on an external service or on a person.'),
  ('job.state_changed',       'job',         'projected', 'diagnostic', 'debug',   false, 'An internal step of the job lifecycle (review, commit, notify).'),
  ('job.completed',           'job',         'projected', 'user',       'info',    false, 'The job finished.'),
  ('job.failed',              'job',         'projected', 'user',       'error',   false, 'The job ended in failure.'),
  ('job.cancelled',           'job',         'projected', 'user',       'notice',  false, 'The job was called off.'),
  ('retry.scheduled',         'reliability', 'projected', 'diagnostic', 'warning', false, 'A job was set to try again after a failed or abandoned attempt.'),
  ('job.impeded',             'job',         'projected', 'diagnostic', 'warning', false, 'A job could not do something it needed (a tool, skill, data or an answer).'),
  ('action.blocked',          'approval',    'projected', 'user',       'warning', false, 'An action was stopped because it needs a permission nobody had granted.'),
  ('approval.requested',      'approval',    'projected', 'user',       'notice',  false, 'The office asked a person to decide something.'),
  ('approval.granted',        'approval',    'projected', 'user',       'info',    false, 'A person said yes.'),
  ('approval.denied',         'approval',    'projected', 'user',       'info',    false, 'A person said no.'),
  ('approval.expired',        'approval',    'projected', 'user',       'notice',  false, 'A question lapsed without an answer.'),
  ('approval.withdrawn',      'approval',    'projected', 'user',       'info',    false, 'The office withdrew a question that no longer applies.'),
  ('output.created',          'output',      'projected', 'user',       'info',    false, 'A specialist produced an answer or document. The text is not copied here.'),
  ('output.reviewed',         'output',      'projected', 'user',       'info',    false, 'An output was reviewed (approved, approved with reservations, rejected or superseded).'),
  ('delivery.attempted',      'delivery',    'projected', 'diagnostic', 'info',    false, 'A send to a channel was started. Not evidence that it arrived.'),
  ('delivery.succeeded',      'delivery',    'projected', 'user',       'info',    false, 'A message was sent; confirmed when the provider returned a message reference.'),
  ('delivery.failed',         'delivery',    'projected', 'user',       'error',   false, 'A message could not be sent.'),
  ('delivery.suppressed',     'delivery',    'projected', 'diagnostic', 'notice',  false, 'A message was deliberately not sent (containment, a duplicate, a policy).'),
  ('inference.completed',     'usage',       'projected', 'diagnostic', 'info',    false, 'A model call finished, with tokens, latency and cost where the provider gave it.'),
  ('system.recovered',        'reliability', 'native',    'operator',   'warning', false, 'A recovery sweep reclaimed work abandoned by a worker that stopped.'),
  ('budget.threshold_reached','usage',       'native',    'user',       'warning', false, 'A spending or capacity threshold was crossed.'),
  ('integration.rate_limited','integration', 'native',    'diagnostic', 'warning', false, 'An external service refused calls for a while (a rate limit or a throttle).'),
  ('tool.requested',          'tool',        'native',    'diagnostic', 'info',    false, 'An agent asked to use a tool.'),
  ('tool.completed',          'tool',        'native',    'diagnostic', 'info',    false, 'A tool call finished and returned.'),
  ('tool.failed',             'tool',        'native',    'diagnostic', 'warning', false, 'A tool call failed.'),
  ('activity.corrected',      'reliability', 'native',    'user',       'notice',  false, 'A recorded activity was superseded by a correction; the original is kept.'),
  ('external.research_started',   'external', 'native',   'diagnostic', 'info',    true,  'An external research worker started a task the office gave it.'),
  ('external.research_completed', 'external', 'native',   'user',       'info',    true,  'An external research worker finished and produced a result for review.'),
  ('external.output_produced',    'external', 'native',   'user',       'info',    true,  'An external worker produced an output, held for review.'),
  ('external.skill_proposed',     'external', 'native',   'user',       'notice',  true,  'An external worker proposed a skill. It is a proposal; nothing is installed by this event.'),
  ('external.evaluation_completed','external','native',   'diagnostic', 'info',    true,  'An evaluation of an external worker''s output finished.'),
  ('external.usage_recorded',     'external', 'native',   'diagnostic', 'info',    true,  'An external worker reported the resources a task used.'),
  ('external.worker_error',       'external', 'native',   'diagnostic', 'error',   true,  'An external worker reported an error.'),
  ('external.review_decided',     'external', 'native',   'user',       'info',    true,  'A person reviewed an external worker''s output.')
on conflict (event_type) do nothing;

-- ------------------------------------------------------------------------------------------------ the native ledger

create table if not exists public.activity_events (
  activity_id             uuid        primary key default gen_random_uuid(),
  office_id               uuid        not null references public.offices (office_id),
  event_type              text        not null references public.activity_event_types (event_type),
  schema_version          smallint    not null default 1 check (schema_version >= 1),
  occurred_at             timestamptz not null default app.now_utc(),
  recorded_at             timestamptz not null default app.now_utc(),
  actor_kind              text        not null check (actor_kind in ('user','agent','system','external')),
  actor                   text        not null check (length(btrim(actor)) between 1 and 80),
  agent_slug              text        check (agent_slug is null or length(agent_slug) between 1 and 60),
  project_id              uuid,
  job_id                  uuid,
  parent_job_id           uuid,
  correlation_id          uuid,
  causation_id            uuid,
  source_interface        text        check (source_interface is null or source_interface in
                                        ('teamhq','chatgpt','claude','mcp','telegram','slack','voice','worker','system','external')),
  status                  text        not null check (status in
                                        ('recorded','requested','authorised','declined','attempted','completed','confirmed',
                                         'failed','blocked','cancelled','scheduled','expired')),
  severity                text        not null check (severity in ('debug','info','notice','warning','error','critical')),
  visibility              text        not null check (visibility in ('user','diagnostic','operator')),
  tool                    text        check (tool is null or length(tool) <= 80),
  model                   text        check (model is null or length(model) <= 120),
  summary                 text        not null check (length(summary) between 1 and 300),
  metadata                jsonb       not null default '{}'::jsonb
                                      check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  evidence_ref            jsonb       check (evidence_ref is null or (jsonb_typeof(evidence_ref) = 'object'
                                                                  and evidence_ref ? 'kind' and evidence_ref ? 'id')),
  idempotency_key         text        not null check (length(idempotency_key) between 8 and 200),
  supersedes_activity_id  uuid,
  provenance              text        not null default 'native' check (provenance in ('native','external')),
  constraint activity_events_idempotent unique (office_id, idempotency_key),
  constraint activity_events_id_office_key unique (activity_id, office_id),
  constraint activity_events_project_same_office foreign key (project_id, office_id)
    references public.projects (project_id, office_id),
  constraint activity_events_job_same_office foreign key (job_id, office_id)
    references public.jobs (job_id, office_id),
  constraint activity_events_parent_job_same_office foreign key (parent_job_id, office_id)
    references public.jobs (job_id, office_id),
  constraint activity_events_supersedes_same_office foreign key (supersedes_activity_id, office_id)
    references public.activity_events (activity_id, office_id),
  constraint activity_events_no_self_supersession check (supersedes_activity_id is null or supersedes_activity_id <> activity_id),
  constraint activity_events_external_is_marked check ((actor_kind = 'external') = (provenance = 'external'))
);

comment on table public.activity_events is
  'Native, append-only activity with no other home: recovery sweeps, rate limits, thresholds, tool calls and what an external worker '
  'reports. NOT a copy of jobs, deliveries, approvals or requests: those are read from their own tables (app.activity_read, 1061). '
  'Update, delete and truncate are refused; a correction is a new row with supersedes_activity_id. Holds references and short redacted '
  'summaries, never message text, document text or credentials.';
comment on column public.activity_events.occurred_at is 'When the thing happened, as the writer knows it. recorded_at is when the ledger took it.';
comment on column public.activity_events.causation_id is
  'The id of the activity that caused this one: a native activity_id or the deterministic id app.activity_read gives a projected event. No foreign key, deliberately: it may name a projected event.';
comment on column public.activity_events.idempotency_key is
  'Chosen by the writer from what the event IS (e.g. recovery:<sweep id>), never random. A second write with the same key is a no-op that returns the first row.';
comment on column public.activity_events.status is
  'What is true of the thing, in the lifecycle requested -> authorised -> attempted -> completed -> confirmed. attempted is never read as completed, and completed is never read as confirmed (an external service said so).';

alter table public.activity_events enable row level security;
alter table public.activity_events force row level security;
revoke all on public.activity_events from anon, authenticated;

drop policy if exists activity_events_app_append on public.activity_events;
create policy activity_events_app_append on public.activity_events for insert to ai_team_app with check (true);
drop policy if exists activity_events_app_read on public.activity_events;
create policy activity_events_app_read on public.activity_events for select to ai_team_app using (true);

create index if not exists activity_events_office_time_idx on public.activity_events (office_id, occurred_at desc, activity_id desc);
create index if not exists activity_events_project_time_idx on public.activity_events (project_id, occurred_at desc) where project_id is not null;
create index if not exists activity_events_job_idx on public.activity_events (job_id, occurred_at) where job_id is not null;
create index if not exists activity_events_correlation_idx on public.activity_events (correlation_id, occurred_at) where correlation_id is not null;
create unique index if not exists activity_events_one_correction on public.activity_events (supersedes_activity_id) where supersedes_activity_id is not null;

drop trigger if exists a1_office_write_once on public.activity_events;
create trigger a1_office_write_once before update of office_id on public.activity_events
  for each row execute function app.office_id_is_write_once();
drop trigger if exists activity_events_reject_update on public.activity_events;
create trigger activity_events_reject_update before update on public.activity_events
  for each row execute function app.reject_ledger_mutation();
drop trigger if exists activity_events_reject_delete on public.activity_events;
create trigger activity_events_reject_delete before delete on public.activity_events
  for each row execute function app.reject_ledger_mutation();
drop trigger if exists activity_events_reject_truncate on public.activity_events;
create trigger activity_events_reject_truncate before truncate on public.activity_events
  for each statement execute function app.reject_ledger_mutation();

-- A native event may only carry the type's own category of visibility upward, never below what the taxonomy says: a diagnostic
-- type cannot be written as 'user' to put it on an ordinary person's page. Enforced by a trigger because a CHECK cannot read another table.
create or replace function app.activity_visibility_not_below_taxonomy()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
declare v_default text;
begin
  select t.default_visibility into v_default from public.activity_event_types t where t.event_type = new.event_type;
  if v_default is null then
    raise exception 'unknown activity type %', new.event_type using errcode = '23503';
  end if;
  if (case new.visibility when 'user' then 0 when 'diagnostic' then 1 else 2 end)
     < (case v_default when 'user' then 0 when 'diagnostic' then 1 else 2 end) then
    raise exception 'activity type % may not be shown more widely than its taxonomy allows (%)', new.event_type, v_default
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists activity_events_visibility on public.activity_events;
create trigger activity_events_visibility before insert on public.activity_events
  for each row execute function app.activity_visibility_not_below_taxonomy();

-- ------------------------------------------------------------------------------------------------ the failure counter

create table if not exists public.activity_write_failures (
  failure_id   uuid        primary key default gen_random_uuid(),
  office_id    uuid        not null references public.offices (office_id),
  event_type   text        not null check (length(event_type) <= 80),
  sqlstate     text        not null check (length(sqlstate) <= 8),
  reason       text        not null check (length(reason) <= 200),
  occurred_at  timestamptz not null default app.now_utc()
);

comment on table public.activity_write_failures is
  'A counter, not an event stream: one row for each native write that was refused or failed, so the failure is not silent. Nothing '
  'that writes here records an activity (no recursion), and the writer stops adding rows for an office after 200 in an hour, so a '
  'broken writer cannot turn into a storm. Short redacted reasons only.';

alter table public.activity_write_failures enable row level security;
alter table public.activity_write_failures force row level security;
revoke all on public.activity_write_failures from anon, authenticated;
drop policy if exists activity_write_failures_app on public.activity_write_failures;
create policy activity_write_failures_app on public.activity_write_failures for all to ai_team_app using (true) with check (true);
create index if not exists activity_write_failures_office_time_idx on public.activity_write_failures (office_id, occurred_at desc);

-- ------------------------------------------------------------------------------------------------ the redactor

-- The SQL twin of redactSecrets in src/text/secrets.ts. Postgres regexes have no lookbehind, so the Authorization family keeps the
-- scheme by capturing and restoring it. scripts/isolated/activity-redaction.ts drives both over the same cases and fails on any difference.
create or replace function app.activity_redact(p_text text)
returns text
language plpgsql
immutable
set search_path = 'pg_catalog'
as $$
declare t text := p_text;
begin
  if t is null or t = '' then return t; end if;
  t := regexp_replace(t, 'xox[abeprs]-[A-Za-z0-9-]{6,}', '[redacted:slack]', 'g');
  t := regexp_replace(t, 'sk-(?:proj-|or-|ant-|live-)?[A-Za-z0-9_-]{12,}', '[redacted:openai]', 'g');
  t := regexp_replace(t, 'sbp_[A-Za-z0-9]{16,}', '[redacted:supabase]', 'g');
  t := regexp_replace(t, '(?:ntn_|secret_)[A-Za-z0-9]{16,}', '[redacted:notion]', 'g');
  t := regexp_replace(t, 'AIza[A-Za-z0-9_-]{20,}', '[redacted:google]', 'g');
  t := regexp_replace(t, '\m1//[A-Za-z0-9_-]{20,}', '[redacted:google-oauth]', 'g');
  t := regexp_replace(t, '\m(?:gh[posur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})', '[redacted:github]', 'g');
  t := regexp_replace(t, '\m[0-9]{6,}:[A-Za-z0-9_-]{30,}', '[redacted:telegram]', 'g');
  t := regexp_replace(t, '\meyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', '[redacted:jwt]', 'g');
  t := regexp_replace(t, '\m(?:AKIA|ASIA)[A-Z0-9]{16}\M', '[redacted:aws]', 'g');
  t := regexp_replace(t, '\m(Bearer|Basic|Token)([[:space:]]+)[A-Za-z0-9._~+/=-]{8,}', '\1\2[redacted:authorization]', 'gi');
  t := regexp_replace(t, '\m(?=[A-Za-z0-9_+/=-]*[0-9])[A-Za-z0-9_+/=-]{40,}\M', '[redacted:long-opaque]', 'g');
  t := regexp_replace(t, '-----BEGIN [A-Z ]*PRIVATE KEY-----', '[redacted:private-key]', 'g');
  return t;
end
$$;

comment on function app.activity_redact(text) is
  'Takes credential-shaped text out. SQL twin of redactSecrets (src/text/secrets.ts) plus a PEM private key header; parity is proved by scripts/isolated/activity-redaction.ts.';

-- Metadata is DATA the writer chose, so it is refused when it is abusive and cleaned when it is merely careless.
--   refused:  not an object; more than 40 keys at one level; a key that is not a short snake_case word; deeper than 4 levels; over 4 KB.
--   cleaned:  a value under a key that names a credential or message content becomes a marker; strings are redacted and cut at 200.
create or replace function app.activity_clean(p_meta jsonb, p_depth integer default 0)
returns jsonb
language plpgsql
immutable
set search_path = 'pg_catalog', 'app'
as $$
declare
  k text; v jsonb; out jsonb := '{}'::jsonb; n integer := 0; item jsonb; arr jsonb := '[]'::jsonb; i integer := 0;
begin
  if p_meta is null then return '{}'::jsonb; end if;
  if jsonb_typeof(p_meta) <> 'object' then
    raise exception 'activity metadata must be a JSON object' using errcode = '22023';
  end if;
  if p_depth > 4 then
    raise exception 'activity metadata is nested too deeply' using errcode = '22023';
  end if;
  for k, v in select key, value from jsonb_each(p_meta) loop
    n := n + 1;
    if n > 40 then raise exception 'activity metadata has too many keys' using errcode = '22023'; end if;
    if k !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'activity metadata key is not a short snake_case word' using errcode = '22023';
    end if;
    if k ~* '(secret|token|passw|authorization|api_?key|cookie|credential|bearer|private_?key|session|signature)' then
      out := out || jsonb_build_object(k, '[redacted:key]');
    elsif k ~* '^(body|text|content|transcript|instruction|prompt|message|document|payload|raw|headers|email|address|phone|query)$' then
      out := out || jsonb_build_object(k, '[not stored: reference the record]');
    elsif jsonb_typeof(v) = 'object' then
      out := out || jsonb_build_object(k, app.activity_clean(v, p_depth + 1));
    elsif jsonb_typeof(v) = 'array' then
      arr := '[]'::jsonb; i := 0;
      for item in select value from jsonb_array_elements(v) loop
        i := i + 1;
        exit when i > 20;
        if jsonb_typeof(item) = 'string' then
          arr := arr || to_jsonb(left(app.activity_redact(item #>> '{}'), 200));
        elsif jsonb_typeof(item) in ('number','boolean','null') then
          arr := arr || item;
        else
          arr := arr || '"[nested value not stored]"'::jsonb;
        end if;
      end loop;
      out := out || jsonb_build_object(k, arr);
    elsif jsonb_typeof(v) = 'string' then
      out := out || jsonb_build_object(k, left(app.activity_redact(v #>> '{}'), 200));
    else
      out := out || jsonb_build_object(k, v);
    end if;
  end loop;
  if p_depth = 0 and pg_column_size(out) > 4096 then
    raise exception 'activity metadata is larger than 4 KB' using errcode = '22023';
  end if;
  return out;
end
$$;

comment on function app.activity_clean(jsonb, integer) is
  'The one cleaner for native activity metadata: refuses an abusive shape, replaces credential-named and content-named keys with a marker, redacts and cuts string values.';

-- ------------------------------------------------------------------------------------------------ the writers

-- Strict: raises on a refusal and is meant to be called IN THE SAME TRANSACTION as the state change it records, so the two commit or
-- roll back together. Returns the activity id (the existing one when the idempotency key was already used by the same event type),
-- or null when the ledger is switched off.
create or replace function app.record_activity(
  p_office            uuid,
  p_event_type        text,
  p_idempotency_key   text,
  p_actor_kind        text,
  p_actor             text,
  p_summary           text,
  p_status            text default 'recorded',
  p_severity          text default null,
  p_visibility        text default null,
  p_agent_slug        text default null,
  p_project_id        uuid default null,
  p_job_id            uuid default null,
  p_parent_job_id     uuid default null,
  p_correlation_id    uuid default null,
  p_causation_id      uuid default null,
  p_source_interface  text default null,
  p_tool              text default null,
  p_model             text default null,
  p_metadata          jsonb default '{}'::jsonb,
  p_evidence_ref      jsonb default null,
  p_occurred_at       timestamptz default null,
  p_supersedes        uuid default null,
  p_provenance        text default 'native'
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare
  v_type public.activity_event_types%rowtype;
  v_id uuid;
  v_existing public.activity_events%rowtype;
  v_meta jsonb;
begin
  perform app.require_office(p_office);
  if not app.activity_ledger_on() then
    return null;
  end if;

  select * into v_type from public.activity_event_types where event_type = p_event_type;
  if not found or v_type.source <> 'native' then
    raise exception 'activity type % is not a native type', p_event_type using errcode = '23503';
  end if;

  v_meta := app.activity_clean(p_metadata);

  insert into public.activity_events (
    office_id, event_type, occurred_at, actor_kind, actor, agent_slug, project_id, job_id, parent_job_id,
    correlation_id, causation_id, source_interface, status, severity, visibility, tool, model, summary,
    metadata, evidence_ref, idempotency_key, supersedes_activity_id, provenance
  ) values (
    p_office, p_event_type, coalesce(p_occurred_at, app.now_utc()), p_actor_kind, p_actor, p_agent_slug, p_project_id, p_job_id,
    p_parent_job_id, p_correlation_id, p_causation_id, p_source_interface, p_status,
    coalesce(p_severity, v_type.default_severity), coalesce(p_visibility, v_type.default_visibility), p_tool, p_model,
    left(app.activity_redact(p_summary), 300), v_meta, p_evidence_ref, p_idempotency_key, p_supersedes, p_provenance
  )
  on conflict (office_id, idempotency_key) do nothing
  returning activity_id into v_id;

  if v_id is null then
    -- Already recorded. Return the first row, but refuse a key that is being reused for a DIFFERENT event: that is a caller bug and
    -- silently returning the other event's id would hide it.
    select * into v_existing from public.activity_events
     where office_id = p_office and idempotency_key = p_idempotency_key;
    if v_existing.event_type is distinct from p_event_type then
      raise exception 'idempotency key already used for a different activity type' using errcode = '23505';
    end if;
    return v_existing.activity_id;
  end if;
  return v_id;
end
$$;

comment on function app.record_activity(uuid, text, text, text, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, timestamptz, uuid, text) is
  'Strict native writer. Same-transaction with the change it records. Idempotent on (office, key); refuses a key reused for another type. Null when the ledger is off. Not callable by an external worker: they use record_external_activity.';

-- Never raises and never records an activity about its own failure. A refusal is counted (bounded) and returns null.
create or replace function app.record_activity_safely(
  p_office            uuid,
  p_event_type        text,
  p_idempotency_key   text,
  p_actor_kind        text,
  p_actor             text,
  p_summary           text,
  p_status            text default 'recorded',
  p_severity          text default null,
  p_agent_slug        text default null,
  p_project_id        uuid default null,
  p_job_id            uuid default null,
  p_correlation_id    uuid default null,
  p_source_interface  text default null,
  p_metadata          jsonb default '{}'::jsonb,
  p_evidence_ref      jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
begin
  begin
    return app.record_activity(
      p_office => p_office, p_event_type => p_event_type, p_idempotency_key => p_idempotency_key,
      p_actor_kind => p_actor_kind, p_actor => p_actor, p_summary => p_summary, p_status => p_status,
      p_severity => p_severity, p_agent_slug => p_agent_slug, p_project_id => p_project_id, p_job_id => p_job_id,
      p_correlation_id => p_correlation_id, p_source_interface => p_source_interface,
      p_metadata => p_metadata, p_evidence_ref => p_evidence_ref);
  exception when others then
    -- A subtransaction: only this block is rolled back, never the caller's work. The counter has no writer that records an event.
    begin
      if p_office is not null
         and (select count(*) from public.activity_write_failures f
               where f.office_id = p_office and f.occurred_at > app.now_utc() - interval '1 hour') < 200
         and exists (select 1 from public.offices o where o.office_id = p_office) then
        insert into public.activity_write_failures (office_id, event_type, sqlstate, reason)
        values (p_office, left(coalesce(p_event_type, '?'), 80), left(sqlstate, 8), left(app.activity_redact(sqlerrm), 200));
      end if;
    exception when others then
      null;
    end;
    return null;
  end;
end
$$;

comment on function app.record_activity_safely(uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, text, jsonb, jsonb) is
  'Best-effort writer for the worker path: never raises, never recurses, counts what it could not write in activity_write_failures (bounded to 200 an hour per office).';

-- The one door for what an external worker reports. Nothing the worker supplies can widen its own reach: the type must be one the
-- taxonomy marks external_writable, the actor is forced to external:<worker>, visibility is the taxonomy's, severity cannot be
-- critical, status cannot claim confirmation, and the office is whatever the CALLER (an authenticated application boundary) names
-- and the project and job must belong to it (composite keys).
create or replace function app.record_external_activity(
  p_office          uuid,
  p_worker          text,
  p_event_type      text,
  p_idempotency_key text,
  p_summary         text,
  p_status          text default 'recorded',
  p_severity        text default null,
  p_project_id      uuid default null,
  p_job_id          uuid default null,
  p_correlation_id  uuid default null,
  p_metadata        jsonb default '{}'::jsonb,
  p_evidence_ref    jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $$
declare v_type public.activity_event_types%rowtype;
begin
  perform app.require_office(p_office);
  if p_worker is null or p_worker !~ '^[a-z][a-z0-9_-]{1,39}$' then
    raise exception 'external worker name is not valid' using errcode = '22023';
  end if;
  select * into v_type from public.activity_event_types where event_type = p_event_type and external_writable;
  if not found then
    raise exception 'activity type % may not be reported by an external worker', p_event_type using errcode = '42501';
  end if;
  if p_severity = 'critical' then
    raise exception 'an external worker may not report critical severity' using errcode = '42501';
  end if;
  if p_status in ('confirmed', 'authorised') then
    raise exception 'an external worker may not claim % ', p_status using errcode = '42501';
  end if;
  return app.record_activity(
    p_office => p_office, p_event_type => p_event_type, p_idempotency_key => 'ext:' || p_worker || ':' || p_idempotency_key,
    p_actor_kind => 'external', p_actor => 'external:' || p_worker, p_summary => p_summary, p_status => p_status,
    p_severity => p_severity, p_visibility => v_type.default_visibility, p_project_id => p_project_id, p_job_id => p_job_id,
    p_correlation_id => p_correlation_id, p_source_interface => 'external', p_metadata => p_metadata,
    p_evidence_ref => p_evidence_ref, p_provenance => 'external');
end
$$;

comment on function app.record_external_activity(uuid, text, text, text, text, text, text, uuid, uuid, uuid, jsonb, jsonb) is
  'The only way an external worker''s report enters the ledger. Contract in docs/activity-ledger/EXTERNAL-AGENT-CONTRACT.md. Not exposed through the gateway yet: a future authenticated boundary calls it.';

-- Execute rights: server side only. A browser key reaches none of these.
revoke all on function app.activity_ledger_on() from public, anon, authenticated;
revoke all on function app.activity_redact(text) from public, anon, authenticated;
revoke all on function app.activity_clean(jsonb, integer) from public, anon, authenticated;
revoke all on function app.record_activity(uuid, text, text, text, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, timestamptz, uuid, text) from public, anon, authenticated;
revoke all on function app.record_activity_safely(uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.record_external_activity(uuid, text, text, text, text, text, text, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
