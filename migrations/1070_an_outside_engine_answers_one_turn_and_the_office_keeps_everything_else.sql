-- 1070 - an outside engine answers ONE turn the person chose to send it, and the office keeps everything else (Hermes, HD-1..HD-14).
--
-- WHAT THIS IS. The person may choose, per message, to have the draft answer written by Hermes (an outside agent on a host they
-- control) instead of by the team. This migration adds the office's side of that and nothing of Hermes's: the person's choice, one
-- bridge per host, one run per job, the record of every read the office served to a run, and the functions that move a run through
-- its life. The task system, the approval system and the permission system are untouched and stay authoritative. A run is read-only
-- in v1: the only credential Hermes holds is an MCP client of kind 'engine' that the office's own MCP function binds to the run's
-- project and to the read tools below.
--
-- WHAT IS DELIBERATELY ABSENT.
--   * No automatic choice. Nothing here picks an engine; inbound_commands.engine is the person's word and is write-once.
--   * No fallback. If Hermes is unavailable the handler says so and does nothing else (no team turn, no paid model).
--   * No unrestricted database credential for Hermes, and no new auth system (one bridge token, hashed; one MCP token, hashed).
--   * No write tool, no outbound contact, no skill adoption. Those are later milestones behind their own gates.
--
-- HOW A RUN MOVES (the state machine is enforced by the guard trigger, not by a comment):
--   open --claim--> running --finish--> completed | failed | cancelled          (terminal, write-once)
--   running --lease lapses--> open (claims < 3) or failed 'bridge_lost'
--   open | running --deadline passes--> expired
-- A claim is an ATTEMPT: claim_gen counts them and is the fence every later call must present. A new attempt is a new Hermes run
-- (M0 finding D-2: after a Hermes restart the same idempotency key replays the dead run), so hermes_claim_gen records which attempt
-- the stored hermes_run_id belongs to, and a new attempt is told the previous id so the bridge can stop it first.
--
-- NUMBERS. 1070 was reserved for this work; 1060 to 1062 belong to the activity ledger branch. The ledger door
-- app.record_external_activity is called only when it exists (to_regprocedure), through app.engine_mirror, and a failed mirror is
-- written to engine_runs.ledger_note rather than swallowed. This migration creates no ledger table and no competing event store.
--
-- ROLLBACK. Nothing reads these tables until the worker handler (M4) is deployed and engine.hermes.offices names an office, so a
-- database-only rollback is: drop the three tables and the app.engine_* and public.engine_* functions, drop the column
-- inbound_commands.engine, restore mcp_clients_kind_known and app.mcp_write_client from migrations 0920 and 0742. Roll the worker back
-- BEFORE the database, as every note in this repository says.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. The person's choice, on the command (HD-13). Write-once: what was chosen is what was asked.
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.inbound_commands
  add column if not exists engine text not null default 'team';
alter table public.inbound_commands
  add constraint inbound_commands_engine_known check (engine in ('team', 'hermes'));

create function app.inbound_command_engine_is_write_once() returns trigger
 language plpgsql security definer set search_path to ''
as $f$
begin
  if new.engine is distinct from old.engine then
    raise exception 'the engine a person chose for a message cannot be changed afterwards (% to %)', old.engine, new.engine
      using errcode = '55000';
  end if;
  return new;
end
$f$;
revoke all on function app.inbound_command_engine_is_write_once() from public, anon, authenticated, service_role;
create trigger b2_engine_is_write_once
  before update of engine on public.inbound_commands
  for each row execute function app.inbound_command_engine_is_write_once();

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. The engine MCP client kind (HD-5). Widened from the live constraint by one value; the others are not retyped from memory.
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.mcp_clients drop constraint mcp_clients_kind_known;
alter table public.mcp_clients
  add constraint mcp_clients_kind_known check (kind = any (array['chatgpt', 'claude', 'other', 'engine']));
-- A same-office composite key, so a bridge can only ever name a client of its own office.
alter table public.mcp_clients add constraint mcp_clients_id_office_key unique (client_id, office_id);

-- Defence in depth (HD-7): a client of kind 'engine' can never be a writing client until a later milestone says so. Spliced from the
-- live definition; the only change is `k.kind <> 'engine'`.
create or replace function app.mcp_write_client(p_office uuid, p_client_id text)
 returns text
 language plpgsql stable security definer set search_path to ''
as $function$
declare v_via text;
begin
  perform app.require_office(p_office);
  select case k.kind when 'chatgpt' then 'chatgpt' when 'claude' then 'claude' else 'mcp' end into v_via
    from public.mcp_clients k
   where k.client_id = p_client_id and k.office_id = p_office and k.enabled and 'write' = any (k.scopes)
     and k.kind <> 'engine';
  return v_via;
end
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------------------------------------------------------
-- 3.1 A bridge: one Hermes host, one office, one engine. At most one ENABLED bridge per office and engine (v1).
create table public.engine_bridges (
  bridge_id         uuid primary key default gen_random_uuid(),
  office_id         uuid not null references public.offices(office_id),
  engine            text not null check (engine in ('hermes')),
  display_name      text not null check (length(btrim(display_name)) between 3 and 60),
  token_sha256      text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  mcp_client_id     text not null references public.mcp_clients(client_id),
  enabled           boolean not null default true,
  disabled_reason   text check (disabled_reason is null or length(disabled_reason) <= 300),
  -- What the bridge said about its own host at its last claim: Hermes answering, only the office toolset enabled. An unhealthy
  -- bridge is not available, whatever its last_seen_at says.
  healthy           boolean not null default true,
  unhealthy_reason  text check (unhealthy_reason is null or length(unhealthy_reason) <= 300),
  last_seen_at      timestamptz,
  created_at        timestamptz not null default app.now_utc(),
  constraint engine_bridges_disabled_has_reason check (enabled or disabled_reason is not null),
  constraint engine_bridges_id_office_key unique (bridge_id, office_id),
  constraint engine_bridges_client_same_office
    foreign key (mcp_client_id, office_id) references public.mcp_clients (client_id, office_id)
);
create unique index engine_bridges_one_enabled on public.engine_bridges (office_id, engine) where enabled;

-- 3.2 One outside attempt at one turn (HD-4). At most one per job.
create table public.engine_runs (
  run_id            uuid primary key default gen_random_uuid(),
  office_id         uuid not null references public.offices(office_id),
  job_id            uuid not null references public.jobs(job_id),
  project_id        uuid references public.projects(project_id),
  engine            text not null check (engine in ('hermes')),
  state             text not null default 'open'
                      check (state in ('open', 'running', 'completed', 'failed', 'cancelled', 'expired')),
  bridge_id         uuid references public.engine_bridges(bridge_id),
  claim_gen         integer not null default 0 check (claim_gen between 0 and 3),
  lease_until       timestamptz,
  deadline_at       timestamptz not null,
  request           jsonb not null check (pg_column_size(request) <= 65536),
  hermes_run_id     text check (hermes_run_id ~ '^run_[0-9a-f]{32}$'),
  hermes_claim_gen  integer check (hermes_claim_gen is null or hermes_claim_gen between 1 and 3),
  previous_hermes_run_id text check (previous_hermes_run_id ~ '^run_[0-9a-f]{32}$'),
  result            jsonb check (result is null or pg_column_size(result) <= 32768),
  failure           text check (failure is null or length(failure) <= 300),
  ledger_note       text check (ledger_note is null or length(ledger_note) <= 200),
  created_at        timestamptz not null default app.now_utc(),
  started_at        timestamptz,
  finished_at       timestamptz,
  constraint engine_runs_id_office_key unique (run_id, office_id),
  constraint engine_runs_job_same_office foreign key (job_id, office_id) references public.jobs (job_id, office_id),
  constraint engine_runs_project_same_office foreign key (project_id, office_id) references public.projects (project_id, office_id),
  constraint engine_runs_bridge_same_office foreign key (bridge_id, office_id) references public.engine_bridges (bridge_id, office_id),
  constraint engine_runs_running_is_held check (state <> 'running' or (bridge_id is not null and lease_until is not null)),
  constraint engine_runs_terminal_has_time check (state in ('open', 'running') or finished_at is not null),
  constraint engine_runs_hermes_id_has_a_claim check ((hermes_run_id is null) = (hermes_claim_gen is null))
);
create unique index engine_runs_one_per_job on public.engine_runs (office_id, job_id);
create unique index engine_runs_one_running_per_bridge on public.engine_runs (bridge_id) where state = 'running';
create index engine_runs_claimable on public.engine_runs (office_id, created_at) where state = 'open';

-- 3.3 Every MCP call the office served to a run: the observation record and the grounding source (HD-8). Append-only.
create table public.engine_run_calls (
  call_id           uuid primary key default gen_random_uuid(),
  office_id         uuid not null references public.offices(office_id),
  run_id            uuid not null references public.engine_runs(run_id),
  at                timestamptz not null default app.now_utc(),
  tool              text not null check (tool ~ '^[a-z][a-z0-9_]{1,39}$'),
  verdict           text not null check (verdict in ('served', 'refused', 'failed')),
  because           text check (because is null or length(because) <= 200),
  args_sha256       text not null check (args_sha256 ~ '^[0-9a-f]{64}$'),
  domain            text check (domain is null or domain in ('documents', 'projects', 'tasks', 'mail', 'calendar', 'contacts')),
  complete          boolean not null default false,
  result_chars      integer not null default 0 check (result_chars >= 0),
  result_excerpt    text check (result_excerpt is null or length(result_excerpt) <= 4000),
  constraint engine_run_calls_run_same_office foreign key (run_id, office_id) references public.engine_runs (run_id, office_id)
);
create index engine_run_calls_by_run on public.engine_run_calls (office_id, run_id, at);

-- 3.4 The office model's own rules, applied to the three new carriers.
create trigger a1_office_write_once before update on public.engine_bridges
  for each row execute function app.office_id_is_write_once();
create trigger a1_office_write_once before update on public.engine_runs
  for each row execute function app.office_id_is_write_once();
create trigger a1_office_write_once before update on public.engine_run_calls
  for each row execute function app.office_id_is_write_once();

create trigger engine_run_calls_reject_update before update on public.engine_run_calls
  for each row execute function app.reject_ledger_mutation();
create trigger engine_run_calls_reject_delete before delete on public.engine_run_calls
  for each row execute function app.reject_ledger_mutation();
create trigger engine_run_calls_reject_truncate before truncate on public.engine_run_calls
  for each statement execute function app.reject_ledger_mutation();

alter table public.engine_bridges enable row level security;
alter table public.engine_bridges force row level security;
alter table public.engine_runs enable row level security;
alter table public.engine_runs force row level security;
alter table public.engine_run_calls enable row level security;
alter table public.engine_run_calls force row level security;
revoke all on table public.engine_bridges, public.engine_runs, public.engine_run_calls
  from public, anon, authenticated, service_role;

comment on table public.engine_bridges is
  'One Hermes host bridging to one office (HD-3, HD-6). token_sha256 is a hash; the credential is shown once by the operator script and never stored. Written only by the app.engine_* functions.';
comment on table public.engine_runs is
  'One outside attempt at one turn (HD-4), at most one per job. claim_gen is the fence every bridge call presents; hermes_claim_gen says which attempt the stored hermes_run_id belongs to. Terminal states are write-once.';
comment on table public.engine_run_calls is
  'Every MCP call the office served to an engine run, appended by the office, never by Hermes. The grounding source for the coherence gates (HD-8). result_excerpt is redacted in SQL again, whatever the caller did.';

-- The life of a run, enforced. Terminal states do not move; a run's job, request and deadline are fixed when it opens; only the
-- moves in the diagram above are legal.
create function app.engine_runs_guard() returns trigger
 language plpgsql security definer set search_path to ''
as $f$
begin
  if old.state in ('completed', 'failed', 'cancelled', 'expired') then
    if new.state is distinct from old.state then
      raise exception 'an engine run that has ended cannot change state (% to %)', old.state, new.state using errcode = '55000';
    end if;
    if new.result is distinct from old.result or new.failure is distinct from old.failure
       or new.finished_at is distinct from old.finished_at or new.hermes_run_id is distinct from old.hermes_run_id then
      raise exception 'an engine run that has ended cannot be rewritten' using errcode = '55000';
    end if;
  end if;
  if new.job_id is distinct from old.job_id or new.engine is distinct from old.engine
     or new.request is distinct from old.request or new.deadline_at is distinct from old.deadline_at
     or new.created_at is distinct from old.created_at or new.project_id is distinct from old.project_id then
    raise exception 'an engine run''s job, request, engine and deadline are fixed when it opens' using errcode = '55000';
  end if;
  if new.claim_gen < old.claim_gen then
    raise exception 'an engine run''s claim number only goes up' using errcode = '55000';
  end if;
  if new.state is distinct from old.state and (old.state, new.state) not in (
       ('open', 'running'), ('open', 'expired'), ('open', 'failed'), ('open', 'cancelled'),
       ('running', 'open'), ('running', 'completed'), ('running', 'failed'), ('running', 'cancelled'), ('running', 'expired')) then
    raise exception 'an engine run cannot move from % to %', old.state, new.state using errcode = '55000';
  end if;
  return new;
end
$f$;
revoke all on function app.engine_runs_guard() from public, anon, authenticated, service_role;
create trigger b1_engine_run_guard before update on public.engine_runs
  for each row execute function app.engine_runs_guard();

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. The outside provider's row, so inference_usage can name it (HD-8). Disabled: the office's router must never pick it.
-- ---------------------------------------------------------------------------------------------------------------------------
insert into public.providers (provider, display_name, api_status, priority, enabled, disabled_reason, free_only, base_url, notes)
values ('hermes', 'Hermes (an outside engine)', 'official', 1000, false,
        'An outside engine, recorded for provenance only. It is never a candidate for the office router: a person chooses it, per message.',
        true, 'https://openrouter.ai/api/v1',
        'Rows in inference_usage for this provider describe a turn an outside engine wrote. Zero cost by construction: Hermes only ever uses zero-priced models.')
on conflict (provider) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Small readers: settings, the v1 tool allowlist, the redactor, the request validator
-- ---------------------------------------------------------------------------------------------------------------------------
-- An integer setting, clamped to its bounds; absent or malformed is the default. In the pattern of app.answer_envelope_on.
create function app.engine_setting(p_key text, p_default integer, p_min integer, p_max integer) returns integer
 language sql stable security definer set search_path to ''
as $f$
  select greatest(p_min, least(p_max, coalesce(
    (select case when jsonb_typeof(c.value) = 'number' and (c.value #>> '{}') ~ '^[0-9]{1,6}$' then (c.value #>> '{}')::integer end
       from public.system_config c where c.key = p_key),
    p_default)))
$f$;
revoke all on function app.engine_setting(text, integer, integer, integer) from public, anon, authenticated, service_role;

-- True only when the setting is a JSON array naming this office. Absent, a string, an object, null: false (off is the default).
create function app.engine_enabled(p_office uuid, p_engine text) returns boolean
 language sql stable security definer set search_path to ''
as $f$
  select p_engine = 'hermes' and p_office is not null and coalesce(
    (select case when jsonb_typeof(c.value) = 'array' then c.value ? p_office::text else false end
       from public.system_config c where c.key = 'engine.hermes.offices'),
    false)
$f$;
revoke all on function app.engine_enabled(uuid, text) from public, anon, authenticated, service_role;

-- The v1 allowlist: the read tools an engine client may call. ONE list; the MCP function's ENGINE_READ_TOOLS must equal it and a test
-- compares them, because two lists compared by eye is how they come to differ.
create function app.engine_read_tools() returns text[]
 language sql immutable security definer set search_path to ''
as $f$
  select array['check_job', 'inspect_activity', 'list_events', 'list_projects', 'list_staff', 'list_tasks',
               'read_document', 'recent_work', 'search_documents', 'search_project']
$f$;
revoke all on function app.engine_read_tools() from public, anon, authenticated, service_role;

-- Credential-shaped text becomes [redacted]. Applied again in SQL to everything an engine hands back that is stored or shown,
-- because a caller's redaction is a claim about the caller. Shapes, not a list of known secrets: a prefix plus material.
create function app.engine_redact(p_text text) returns text
 language sql immutable security definer set search_path to ''
as $f$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(p_text, ''),
    'xox[a-z]-[A-Za-z0-9-]{6,}', '[redacted]', 'g'),
    '(sbp_|ntn_|ghp_|gho_|github_pat_)[A-Za-z0-9_]{10,}', '[redacted]', 'g'),
    'sk-[A-Za-z0-9_-]{16,}', '[redacted]', 'g'),
    'mcp_[A-Za-z0-9]{16,}', '[redacted]', 'g'),
    '(Bearer|bearer|BEARER)[[:space:]]+[A-Za-z0-9._~+/=-]{16,}', '\1 [redacted]', 'g'),
    'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}', '[redacted]', 'g'),
    'postgres(ql)?://[^[:space:]@]+:[^[:space:]@]+@', 'postgres://[redacted]@', 'g')
$f$;
revoke all on function app.engine_redact(text) from public, anon, authenticated, service_role;

-- What a run request may contain (INTERFACE-CONTRACTS section 7). Null when fine, else the first problem in plain words.
create function app.engine_request_problem(p_request jsonb) returns text
 language plpgsql immutable security definer set search_path to ''
as $f$
declare v_key text; v_turn jsonb; v_total integer := 0; v_n integer := 0;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then return 'the request is not an object'; end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('input', 'instructions', 'conversation_history', 'model') then
      return format('the request has a key it may not have: %s', left(v_key, 40));
    end if;
  end loop;
  if jsonb_typeof(p_request -> 'input') is distinct from 'string' or length(btrim(p_request ->> 'input')) = 0
     or length(p_request ->> 'input') > 20000 then
    return 'input must be a non-empty string of at most 20,000 characters';
  end if;
  if jsonb_typeof(p_request -> 'instructions') is distinct from 'string' or length(p_request ->> 'instructions') > 12000 then
    return 'instructions must be a string of at most 12,000 characters';
  end if;
  if jsonb_typeof(p_request -> 'conversation_history') is distinct from 'array' then
    return 'conversation_history must be an array';
  end if;
  for v_turn in select value from jsonb_array_elements(p_request -> 'conversation_history') loop
    v_n := v_n + 1;
    -- Checked in separate statements: SQL does not promise to stop an OR at its first true arm, and jsonb_object_keys raises on a
    -- value that is not an object.
    if jsonb_typeof(v_turn) <> 'object' then
      return 'every conversation turn is exactly {role: user or assistant, content: string}';
    end if;
    if (select count(*) from jsonb_object_keys(v_turn)) <> 2
       or (v_turn ->> 'role') is null or (v_turn ->> 'role') not in ('user', 'assistant')
       or jsonb_typeof(v_turn -> 'content') is distinct from 'string' then
      return 'every conversation turn is exactly {role: user or assistant, content: string}';
    end if;
    v_total := v_total + length(v_turn ->> 'content');
  end loop;
  if v_n > 20 then return 'conversation_history has more than 20 turns'; end if;
  if v_total > 24000 then return 'conversation_history is longer than 24,000 characters'; end if;
  if p_request ? 'model' and (jsonb_typeof(p_request -> 'model') is distinct from 'string'
       or (p_request ->> 'model') !~ '^[a-z0-9][a-z0-9._/:-]{2,120}$') then
    return 'model must be a model slug';
  end if;
  return null;
end
$f$;
revoke all on function app.engine_request_problem(jsonb) from public, anon, authenticated, service_role;

-- What a finished run may hand back (section 7 EngineRunResult). Null when fine.
create function app.engine_result_problem(p_outcome text, p_result jsonb) returns text
 language plpgsql immutable security definer set search_path to ''
as $f$
declare v_key text; v_notes integer;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then return 'the result is not an object'; end if;
  for v_key in select jsonb_object_keys(p_result) loop
    if v_key not in ('hermes_run_id', 'answer', 'model', 'usage', 'turn_exit_reason', 'failure', 'tools_started', 'approvals_denied', 'notes') then
      return format('the result has a key it may not have: %s', left(v_key, 40));
    end if;
  end loop;
  if jsonb_typeof(p_result -> 'tools_started') is distinct from 'number' or (p_result ->> 'tools_started') !~ '^[0-9]{1,6}$'
     or jsonb_typeof(p_result -> 'approvals_denied') is distinct from 'number' or (p_result ->> 'approvals_denied') !~ '^[0-9]{1,6}$' then
    return 'tools_started and approvals_denied are required whole numbers';
  end if;
  if p_result ? 'answer' and (jsonb_typeof(p_result -> 'answer') is distinct from 'string' or length(p_result ->> 'answer') > 16000) then
    return 'answer must be a string of at most 16,000 characters';
  end if;
  if p_outcome = 'completed' and (not (p_result ? 'answer') or length(btrim(p_result ->> 'answer')) = 0) then
    return 'a completed run needs a non-empty answer';
  end if;
  if p_outcome = 'failed' and (jsonb_typeof(p_result -> 'failure') is distinct from 'string' or length(btrim(p_result ->> 'failure')) = 0) then
    return 'a failed run needs a failure sentence';
  end if;
  if p_result ? 'model' and (jsonb_typeof(p_result -> 'model') is distinct from 'string' or length(p_result ->> 'model') > 160) then
    return 'model must be a short string';
  end if;
  if p_result ? 'hermes_run_id' and p_result -> 'hermes_run_id' <> 'null'::jsonb
     and (jsonb_typeof(p_result -> 'hermes_run_id') is distinct from 'string' or (p_result ->> 'hermes_run_id') !~ '^run_[0-9a-f]{32}$') then
    return 'hermes_run_id is not a Hermes run id';
  end if;
  if p_result ? 'usage' and (jsonb_typeof(p_result -> 'usage') is distinct from 'object'
       or (p_result #>> '{usage,input_tokens}') !~ '^[0-9]{1,9}$' or (p_result #>> '{usage,output_tokens}') !~ '^[0-9]{1,9}$') then
    return 'usage must be {input_tokens, output_tokens} as whole numbers';
  end if;
  if p_result ? 'turn_exit_reason' and (jsonb_typeof(p_result -> 'turn_exit_reason') is distinct from 'string' or length(p_result ->> 'turn_exit_reason') > 80) then
    return 'turn_exit_reason must be a short string';
  end if;
  if p_result ? 'notes' then
    if jsonb_typeof(p_result -> 'notes') is distinct from 'array' then return 'notes must be an array'; end if;
    select count(*) into v_notes from jsonb_array_elements(p_result -> 'notes');
    if v_notes > 5 or exists (select 1 from jsonb_array_elements(p_result -> 'notes') n
                               where jsonb_typeof(n.value) <> 'string' or length(n.value #>> '{}') > 120) then
      return 'notes are at most five short strings';
    end if;
  end if;
  return null;
end
$f$;
revoke all on function app.engine_result_problem(text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 6. The ledger mirror and the wake-up. Both are best-effort around the real transition and never replace it.
-- ---------------------------------------------------------------------------------------------------------------------------
-- Report to the activity ledger only if that branch's door exists here. A failure is written to the run, not swallowed.
create function app.engine_mirror(p_office uuid, p_run uuid, p_type text, p_event text, p_summary text, p_job uuid, p_project uuid)
 returns void
 language plpgsql security definer set search_path to ''
as $f$
begin
  if to_regprocedure('app.record_external_activity(uuid,text,text,text,text,text,text,uuid,uuid,uuid,jsonb,jsonb)') is null then
    return;
  end if;
  begin
    execute 'select app.record_external_activity(p_office => $1, p_worker => $2, p_event_type => $3, p_idempotency_key => $4, '
         || 'p_summary => $5, p_project_id => $6, p_job_id => $7)'
      using p_office, 'hermes', p_type, 'run:' || p_run::text || ':' || p_event, left(app.engine_redact(p_summary), 300), p_project, p_job;
  exception when others then
    update public.engine_runs set ledger_note = left(sqlstate || ': ' || sqlerrm, 200)
     where run_id = p_run and office_id = p_office;
  end;
end
$f$;
revoke all on function app.engine_mirror(uuid, uuid, text, text, text, uuid, uuid) from public, anon, authenticated, service_role;

-- Wake a job that is waiting for its run, so the handler runs now and finds the run's final state. A job that is not paused for a
-- dependency is left alone: this never un-pauses a pause somebody else set.
create function app.engine_wake(p_job uuid, p_why text) returns boolean
 language plpgsql security definer set search_path to ''
as $f$
declare v_reason text; v_answer jsonb;
begin
  select p.reason into v_reason from public.job_pauses p
   where p.job_id = p_job and p.resumed_at is null order by p.at desc limit 1;
  if v_reason is distinct from 'dependency_wait'
     or not exists (select 1 from public.jobs j where j.job_id = p_job and j.state::text = 'paused') then
    return false;
  end if;
  v_answer := app.resume_job(p_job, p_why);
  return coalesce((v_answer ->> 'ok')::boolean, false);
end
$f$;
revoke all on function app.engine_wake(uuid, text) from public, anon, authenticated, service_role;

-- Move every non-terminal run of an office past its deadline to 'expired', and every run whose lease lapsed to open or failed.
-- Called inside the claim and for_job functions, so no separate sweep exists to forget.
create function app.engine_settle_office(p_office uuid) returns void
 language plpgsql security definer set search_path to ''
as $f$
declare r record;
begin
  for r in
    update public.engine_runs e
       set state = 'expired', finished_at = app.now_utc(), failure = 'the deadline passed'
     where e.office_id = p_office and e.state in ('open', 'running') and e.deadline_at < app.now_utc()
    returning e.run_id, e.job_id, e.project_id
  loop
    perform app.engine_wake(r.job_id, 'Hermes ran out of time');
    perform app.engine_mirror(p_office, r.run_id, 'external.worker_error', 'expired', 'Hermes did not finish before the deadline.', r.job_id, r.project_id);
  end loop;
  for r in
    update public.engine_runs e
       set state = case when e.claim_gen < 3 then 'open' else 'failed' end,
           bridge_id = case when e.claim_gen < 3 then null else e.bridge_id end,
           lease_until = case when e.claim_gen < 3 then null else e.lease_until end,
           failure = case when e.claim_gen < 3 then e.failure else 'bridge_lost' end,
           finished_at = case when e.claim_gen < 3 then null else app.now_utc() end
     where e.office_id = p_office and e.state = 'running' and e.lease_until < app.now_utc()
    returning e.run_id, e.job_id, e.project_id, e.state
  loop
    if r.state = 'failed' then
      perform app.engine_wake(r.job_id, 'the host running Hermes stopped answering');
      perform app.engine_mirror(p_office, r.run_id, 'external.worker_error', 'bridge_lost', 'The host running Hermes stopped answering.', r.job_id, r.project_id);
    end if;
  end loop;
end
$f$;
revoke all on function app.engine_settle_office(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 7. Availability and opening (the worker handler's side)
-- ---------------------------------------------------------------------------------------------------------------------------
create function app.engine_available(p_office uuid, p_engine text) returns jsonb
 language plpgsql stable security definer set search_path to ''
as $f$
declare v_daily integer; v_seen timestamptz; v_healthy boolean; v_found boolean; v_used integer; v_why text; v_mins integer;
begin
  perform app.require_office(p_office);
  if not app.engine_enabled(p_office, p_engine) then
    return jsonb_build_object('available', false, 'because', 'Hermes isn''t switched on for this office');
  end if;
  select true, b.last_seen_at, b.healthy, b.unhealthy_reason into v_found, v_seen, v_healthy, v_why
    from public.engine_bridges b
    join public.mcp_clients k on k.client_id = b.mcp_client_id and k.office_id = b.office_id
   where b.office_id = p_office and b.engine = p_engine and b.enabled and k.enabled
   order by b.last_seen_at desc nulls last limit 1;
  if v_found is not true then
    return jsonb_build_object('available', false, 'because', 'Hermes has no host set up for this office');
  end if;
  if v_seen is null then
    return jsonb_build_object('available', false, 'because', 'Hermes''s host hasn''t checked in yet');
  end if;
  if v_seen < app.now_utc() - interval '120 seconds' then
    v_mins := greatest(2, ceil(extract(epoch from (app.now_utc() - v_seen)) / 60.0)::integer);
    return jsonb_build_object('available', false, 'because', format('Hermes''s host hasn''t checked in for %s minutes', v_mins));
  end if;
  if v_healthy is not true then
    return jsonb_build_object('available', false, 'because',
      'Hermes''s host says it isn''t ready' || case when v_why is null then '' else ' (' || left(v_why, 120) || ')' end);
  end if;
  v_daily := app.engine_setting('engine.hermes.daily_runs', 20, 0, 1000);
  select count(*) into v_used from public.engine_runs r
   where r.office_id = p_office and r.engine = p_engine
     and r.created_at >= date_trunc('day', app.now_utc() at time zone 'utc') at time zone 'utc';
  if v_used >= v_daily then
    return jsonb_build_object('available', false, 'because', format('Hermes has used today''s %s runs', v_daily));
  end if;
  return jsonb_build_object('available', true, 'because', null);
end
$f$;
revoke all on function app.engine_available(uuid, text) from public, anon, authenticated, service_role;

create function app.engine_run_open(p_office uuid, p_job uuid, p_engine text, p_request jsonb) returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare v_job record; v_run record; v_avail jsonb; v_problem text; v_deadline integer; v_id uuid;
begin
  perform app.require_office(p_office);
  if p_engine is distinct from 'hermes' then
    return jsonb_build_object('error', 'unknown_engine', 'because', 'That engine is not one this office knows.');
  end if;
  select j.job_id, j.project_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  if not found then
    return jsonb_build_object('error', 'no_such_job', 'because', 'That job is not in this office.');
  end if;
  select r.run_id, r.state into v_run from public.engine_runs r where r.office_id = p_office and r.job_id = p_job;
  if found then
    return jsonb_build_object('run_id', v_run.run_id, 'state', v_run.state, 'opened', false);
  end if;
  -- Only a person can choose an engine, so only a turn that came through a person's own door can open a run. Stricter than
  -- app.may_act_outside (which also admits the office's own internal work): a duty or a hand-off never chooses Hermes.
  if app.job_origin(p_job) is distinct from 'trusted' then
    return jsonb_build_object('error', 'not_from_a_person', 'because', 'Only a message you send yourself can be sent to Hermes.');
  end if;
  v_avail := app.engine_available(p_office, p_engine);
  if (v_avail ->> 'available')::boolean is not true then
    return jsonb_build_object('error', 'unavailable', 'because', v_avail ->> 'because');
  end if;
  v_problem := app.engine_request_problem(p_request);
  if v_problem is not null then
    return jsonb_build_object('error', 'bad_request', 'because', v_problem);
  end if;
  v_deadline := app.engine_setting('engine.hermes.deadline_s', 900, 120, 1800);
  insert into public.engine_runs (office_id, job_id, project_id, engine, deadline_at, request)
  values (p_office, p_job, v_job.project_id, p_engine, app.now_utc() + make_interval(secs => v_deadline), p_request)
  on conflict (office_id, job_id) do nothing
  returning run_id into v_id;
  if v_id is null then
    select r.run_id, r.state into v_run from public.engine_runs r where r.office_id = p_office and r.job_id = p_job;
    return jsonb_build_object('run_id', v_run.run_id, 'state', v_run.state, 'opened', false);
  end if;
  return jsonb_build_object('run_id', v_id, 'state', 'open', 'opened', true);
end
$f$;
revoke all on function app.engine_run_open(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

create function app.engine_run_for_job(p_office uuid, p_job uuid) returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare v_run record;
begin
  perform app.require_office(p_office);
  perform app.engine_settle_office(p_office);
  select r.run_id, r.state, r.engine, r.deadline_at, r.result, r.failure into v_run
    from public.engine_runs r where r.office_id = p_office and r.job_id = p_job;
  if not found then return null; end if;
  return jsonb_build_object('run_id', v_run.run_id, 'state', v_run.state, 'engine', v_run.engine,
                            'deadline_at', v_run.deadline_at, 'result', v_run.result, 'failure', v_run.failure);
end
$f$;
revoke all on function app.engine_run_for_job(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 8. The bridge's side: authentication, claim, heartbeat, finish
-- ---------------------------------------------------------------------------------------------------------------------------
-- Authentication for the engine gateway. Not office-first, because the office is what it establishes (like app.mcp_client_for).
-- Null for an unknown, retired or disabled bridge, an inactive office, or a disabled MCP client. last_seen_at moves at most every 10 s.
create function app.engine_bridge_for(p_token_sha256 text) returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare b record;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then return null; end if;
  select x.bridge_id, x.office_id, x.engine, x.mcp_client_id into b
    from public.engine_bridges x
    join public.offices o on o.office_id = x.office_id and o.state = 'active' and o.kind <> 'system'
    join public.mcp_clients k on k.client_id = x.mcp_client_id and k.office_id = x.office_id and k.enabled
   where x.token_sha256 = p_token_sha256 and x.enabled;
  if not found then return null; end if;
  update public.engine_bridges set last_seen_at = app.now_utc()
   where bridge_id = b.bridge_id and office_id = b.office_id
     and (last_seen_at is null or last_seen_at < app.now_utc() - interval '10 seconds');
  return jsonb_build_object('bridge_id', b.bridge_id, 'office_id', b.office_id, 'engine', b.engine, 'mcp_client_id', b.mcp_client_id);
end
$f$;
revoke all on function app.engine_bridge_for(text) from public, anon, authenticated, service_role;

-- What the bridge said about its own host (section 5.1 preflight). An unhealthy bridge claims nothing and is not available.
create function app.engine_bridge_report(p_office uuid, p_bridge uuid, p_healthy boolean, p_reason text) returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
begin
  perform app.require_office(p_office);
  update public.engine_bridges
     set healthy = coalesce(p_healthy, false),
         unhealthy_reason = case when coalesce(p_healthy, false) then null else left(app.engine_redact(coalesce(p_reason, 'not ready')), 300) end
   where bridge_id = p_bridge and office_id = p_office and enabled;
  return jsonb_build_object('ok', found);
end
$f$;
revoke all on function app.engine_bridge_report(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;

create function app.engine_run_claim(p_office uuid, p_bridge uuid) returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare v_bridge record; v_run record; v_out jsonb;
begin
  perform app.require_office(p_office);
  select b.bridge_id, b.engine, b.healthy into v_bridge from public.engine_bridges b
   where b.bridge_id = p_bridge and b.office_id = p_office and b.enabled;
  if not found then
    return jsonb_build_object('run', null, 'refused', 'this bridge is not enabled');
  end if;
  -- 1. A bridge that already holds a running run gets it back: a restarted bridge resumes, it does not orphan the run.
  select r.* into v_run from public.engine_runs r
   where r.office_id = p_office and r.bridge_id = p_bridge and r.state = 'running' and r.lease_until >= app.now_utc()
     and r.deadline_at >= app.now_utc() for update;
  if found then
    update public.engine_runs set lease_until = app.now_utc() + interval '90 seconds' where run_id = v_run.run_id and office_id = p_office;
  else
    -- 2 and 3. Lapsed leases and passed deadlines are settled before anything is handed out.
    perform app.engine_settle_office(p_office);
    if not app.engine_enabled(p_office, v_bridge.engine) or v_bridge.healthy is not true then
      return jsonb_build_object('run', null);
    end if;
    -- 4. The oldest open run of this office whose job is still waiting for it and has not been told to stop.
    select r.* into v_run
      from public.engine_runs r
      join public.jobs j on j.job_id = r.job_id and j.office_id = r.office_id
     where r.office_id = p_office and r.state = 'open'
       and j.state::text = 'paused' and j.stop_requested_at is null
     order by r.created_at, r.run_id
     limit 1
       for update of r skip locked;
    if not found then return jsonb_build_object('run', null); end if;
    update public.engine_runs
       set state = 'running', bridge_id = p_bridge, claim_gen = claim_gen + 1,
           lease_until = app.now_utc() + interval '90 seconds', started_at = coalesce(started_at, app.now_utc())
     where run_id = v_run.run_id and office_id = p_office
    returning * into v_run;
    if v_run.claim_gen = 1 then
      perform app.engine_mirror(p_office, v_run.run_id, 'external.research_started', 'started',
                                'Hermes started working on a message.', v_run.job_id, v_run.project_id);
    end if;
  end if;
  v_out := jsonb_build_object(
    'run_id', v_run.run_id, 'claim_gen', v_run.claim_gen, 'job_id', v_run.job_id, 'deadline_at', v_run.deadline_at,
    'request', v_run.request,
    -- Attach only to a Hermes run started under THIS attempt; an earlier attempt's run is named so the bridge can stop it first.
    'hermes_run_id', case when v_run.hermes_claim_gen = v_run.claim_gen then v_run.hermes_run_id else null end,
    'previous_hermes_run_id', case when v_run.hermes_claim_gen is distinct from v_run.claim_gen then v_run.hermes_run_id else null end);
  return jsonb_build_object('run', v_out);
end
$f$;
revoke all on function app.engine_run_claim(uuid, uuid) from public, anon, authenticated, service_role;

create function app.engine_run_heartbeat(p_office uuid, p_bridge uuid, p_run uuid, p_claim_gen integer, p_hermes_run_id text default null)
 returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare v_run record; v_job record; v_why text; v_lease timestamptz;
begin
  perform app.require_office(p_office);
  select r.* into v_run from public.engine_runs r
   where r.run_id = p_run and r.office_id = p_office and r.state = 'running' and r.bridge_id = p_bridge and r.claim_gen = p_claim_gen
     for update;
  if not found then
    return jsonb_build_object('stop', true, 'because', 'not yours', 'lease_until', null);
  end if;
  if p_hermes_run_id is not null then
    if p_hermes_run_id !~ '^run_[0-9a-f]{32}$' then
      return jsonb_build_object('stop', true, 'because', 'that is not a Hermes run id', 'lease_until', null);
    end if;
    if v_run.hermes_claim_gen is not null and v_run.hermes_claim_gen = v_run.claim_gen and v_run.hermes_run_id is distinct from p_hermes_run_id then
      return jsonb_build_object('stop', true, 'because', 'this attempt already has a different Hermes run', 'lease_until', null);
    end if;
    if v_run.hermes_claim_gen is distinct from v_run.claim_gen then
      update public.engine_runs
         set previous_hermes_run_id = coalesce(hermes_run_id, previous_hermes_run_id),
             hermes_run_id = p_hermes_run_id, hermes_claim_gen = claim_gen
       where run_id = p_run and office_id = p_office;
    end if;
  end if;
  select j.state::text as state, j.stop_requested_at into v_job from public.jobs j where j.job_id = v_run.job_id and j.office_id = p_office;
  v_why := case
    when v_job.state in ('cancelled', 'failed', 'complete') then 'the job has ended'
    when v_job.stop_requested_at is not null then 'a person pressed Stop'
    when v_run.deadline_at < app.now_utc() then 'the deadline passed'
    when not app.engine_enabled(p_office, v_run.engine) then 'Hermes was switched off for this office'
    else null end;
  v_lease := app.now_utc() + interval '90 seconds';
  update public.engine_runs set lease_until = v_lease where run_id = p_run and office_id = p_office;
  return jsonb_build_object('stop', v_why is not null, 'because', v_why, 'lease_until', v_lease);
end
$f$;
revoke all on function app.engine_run_heartbeat(uuid, uuid, uuid, integer, text) from public, anon, authenticated, service_role;

create function app.engine_run_finish(p_office uuid, p_bridge uuid, p_run uuid, p_claim_gen integer, p_outcome text, p_result jsonb)
 returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare v_run record; v_problem text; v_failure text; v_answer text; v_job record; v_resumed boolean := false;
        v_in integer := 0; v_out integer := 0; v_model text; v_outcome text; v_tools integer;
begin
  perform app.require_office(p_office);
  if p_outcome is null or p_outcome not in ('completed', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'bad_outcome');
  end if;
  select r.* into v_run from public.engine_runs r
   where r.run_id = p_run and r.office_id = p_office and r.bridge_id = p_bridge and r.claim_gen = p_claim_gen for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_yours');
  end if;
  -- Idempotent: a finish that arrives after the run ended changes nothing and says what state it is in.
  if v_run.state in ('completed', 'failed', 'cancelled', 'expired') then
    return jsonb_build_object('ok', true, 'resumed', false, 'state', v_run.state);
  end if;
  if v_run.state <> 'running' then
    return jsonb_build_object('ok', false, 'error', 'not_running');
  end if;
  v_problem := app.engine_result_problem(p_outcome, p_result);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'error', 'bad_result', 'because', v_problem);
  end if;
  v_failure := case when p_result ? 'failure' then left(app.engine_redact(p_result ->> 'failure'), 300) else null end;
  v_answer := case when p_result ? 'answer' then app.engine_redact(p_result ->> 'answer') else null end;
  v_model := coalesce(nullif(btrim(p_result ->> 'model'), ''), 'hermes-agent');
  v_in := coalesce((p_result #>> '{usage,input_tokens}')::integer, 0);
  v_out := coalesce((p_result #>> '{usage,output_tokens}')::integer, 0);
  v_tools := (p_result ->> 'tools_started')::integer;
  update public.engine_runs
     set state = p_outcome, finished_at = app.now_utc(), lease_until = null,
         failure = v_failure,
         result = (p_result - 'answer' - 'failure') || jsonb_strip_nulls(jsonb_build_object('answer', v_answer, 'failure', v_failure))
   where run_id = p_run and office_id = p_office;

  -- One inference row, only when the engine actually spent model capacity (a finished answer, or tokens reported). A failed or
  -- stopped run that spent nothing writes none, so the handler's own plain sentence is not mistaken for a model-composed one.
  select j.correlation_id, j.job_id into v_job from public.jobs j where j.job_id = v_run.job_id and j.office_id = p_office;
  if v_job.job_id is not null and (p_outcome = 'completed' or v_in + v_out > 0) then
    v_outcome := case when p_outcome = 'completed' then 'ok'
                      when coalesce(v_failure, '') ~* 'limit|429|rate' then 'rate_limited'
                      else 'provider_error' end;
    insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens,
                                        cost_usd, provider_reported_cost, provenance, latency_ms, office_id)
    values ('hermes', v_model, v_job.job_id, v_job.correlation_id, v_outcome, v_in, v_out, 0, null, 'estimated',
            (extract(epoch from (app.now_utc() - coalesce(v_run.started_at, v_run.created_at))) * 1000)::integer, p_office);
  end if;

  if p_outcome = 'completed' then
    perform app.engine_mirror(p_office, p_run, 'external.research_completed', 'completed',
                              format('Hermes finished a message (%s tool calls).', v_tools), v_run.job_id, v_run.project_id);
  elsif p_outcome = 'failed' then
    perform app.engine_mirror(p_office, p_run, 'external.worker_error', 'failed',
                              coalesce(v_failure, 'Hermes could not finish a message.'), v_run.job_id, v_run.project_id);
  end if;
  v_resumed := app.engine_wake(v_run.job_id, 'Hermes ' || p_outcome);
  return jsonb_build_object('ok', true, 'resumed', v_resumed, 'state', p_outcome);
end
$f$;
revoke all on function app.engine_run_finish(uuid, uuid, uuid, integer, text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 9. The MCP side: the gate before every call, the record after it, the grounding the coherence gates read
-- ---------------------------------------------------------------------------------------------------------------------------
-- Asked by the MCP function for EVERY tools/call, whatever the client. A client that is not an engine client passes through
-- untouched (is_engine false); an engine client is allowed only while its bridge holds exactly one live running run, and only for a
-- read tool, and the answer names the run's project and job so the function can bind the call to them.
create function app.engine_tool_gate(p_office uuid, p_mcp_client text, p_tool text) returns jsonb
 language plpgsql stable security definer set search_path to ''
as $f$
declare v_kind text; v_bridge record; v_run record; v_n integer;
begin
  perform app.require_office(p_office);
  select k.kind into v_kind from public.mcp_clients k where k.client_id = p_mcp_client and k.office_id = p_office and k.enabled;
  if v_kind is null then
    return jsonb_build_object('allow', false, 'is_engine', false, 'because', 'that client is not known to this office');
  end if;
  if v_kind <> 'engine' then
    return jsonb_build_object('allow', true, 'is_engine', false);
  end if;
  if p_tool is null or not (p_tool = any (app.engine_read_tools())) then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'that tool is not one Hermes may use here');
  end if;
  select b.bridge_id into v_bridge from public.engine_bridges b
   where b.mcp_client_id = p_mcp_client and b.office_id = p_office and b.enabled;
  if not found then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'this credential belongs to no enabled bridge');
  end if;
  select count(*) into v_n from public.engine_runs r
   where r.bridge_id = v_bridge.bridge_id and r.office_id = p_office and r.state = 'running';
  if v_n <> 1 then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'there is no run in progress for this credential');
  end if;
  select r.run_id, r.project_id, r.job_id, r.lease_until, r.deadline_at into v_run from public.engine_runs r
   where r.bridge_id = v_bridge.bridge_id and r.office_id = p_office and r.state = 'running';
  if v_run.lease_until < app.now_utc() or v_run.deadline_at < app.now_utc() then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'the run is out of time');
  end if;
  if not app.engine_enabled(p_office, 'hermes') then
    return jsonb_build_object('allow', false, 'is_engine', true, 'because', 'Hermes is switched off for this office');
  end if;
  return jsonb_build_object('allow', true, 'is_engine', true, 'run_id', v_run.run_id, 'project_id', v_run.project_id, 'job_id', v_run.job_id);
end
$f$;
revoke all on function app.engine_tool_gate(uuid, text, text) from public, anon, authenticated, service_role;

create function app.engine_record_call(p_office uuid, p_run uuid, p_tool text, p_verdict text, p_args_sha256 text, p_domain text,
                                       p_complete boolean, p_result_chars integer, p_result_excerpt text, p_because text) returns void
 language plpgsql security definer set search_path to ''
as $f$
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.engine_runs r where r.run_id = p_run and r.office_id = p_office and r.state in ('open', 'running')) then
    raise exception 'no engine run in progress to record this call against' using errcode = '55000';
  end if;
  insert into public.engine_run_calls (office_id, run_id, tool, verdict, because, args_sha256, domain, complete, result_chars, result_excerpt)
  values (p_office, p_run, p_tool, p_verdict, left(app.engine_redact(p_because), 200), p_args_sha256, p_domain,
          coalesce(p_complete, false), greatest(coalesce(p_result_chars, 0), 0),
          case when p_result_excerpt is null then null else left(app.engine_redact(p_result_excerpt), 4000) end);
end
$f$;
revoke all on function app.engine_record_call(uuid, uuid, text, text, text, text, boolean, integer, text, text) from public, anon, authenticated, service_role;

-- What the run was actually shown, for the coherence gates: SERVED calls only, oldest first, 24,000 characters in total with the
-- oldest dropped first (and the number dropped returned), so a gate never grounds an answer in something the office refused.
create function app.engine_run_grounding(p_office uuid, p_run uuid) returns jsonb
 language plpgsql stable security definer set search_path to ''
as $f$
declare v_excerpts text[]; v_dropped integer; v_domains text[]; v_complete text[]; v_tools text[];
begin
  perform app.require_office(p_office);
  with served as (
    select c.at, c.call_id, c.result_excerpt,
           sum(length(c.result_excerpt)) over (order by c.at desc, c.call_id desc) as running
      from public.engine_run_calls c
     where c.office_id = p_office and c.run_id = p_run and c.verdict = 'served' and c.result_excerpt is not null)
  select coalesce(array_agg(s.result_excerpt order by s.at, s.call_id) filter (where s.running <= 24000), '{}'),
         count(*) filter (where s.running > 24000)
    into v_excerpts, v_dropped from served s;
  select coalesce(array_agg(distinct c.domain) filter (where c.domain is not null), '{}'),
         coalesce(array_agg(distinct c.domain) filter (where c.domain is not null and c.complete), '{}'),
         coalesce(array_agg(distinct c.tool), '{}')
    into v_domains, v_complete, v_tools
    from public.engine_run_calls c where c.office_id = p_office and c.run_id = p_run and c.verdict = 'served';
  return jsonb_build_object('excerpts', to_jsonb(v_excerpts), 'dropped', v_dropped, 'domains', to_jsonb(v_domains),
                            'complete_domains', to_jsonb(v_complete), 'tools', to_jsonb(v_tools));
end
$f$;
revoke all on function app.engine_run_grounding(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 10. Minting and retiring a bridge (operator and Settings). No public wrapper for minting: it runs from the operator script.
-- ---------------------------------------------------------------------------------------------------------------------------
create function app.engine_mint_bridge(p_office uuid, p_engine text, p_display text, p_bridge_token_sha256 text, p_mcp_token_sha256 text)
 returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare v_client text; v_bridge uuid;
begin
  perform app.require_office(p_office);
  if p_engine is distinct from 'hermes' then raise exception 'unknown engine' using errcode = '22023'; end if;
  if p_display is null or length(btrim(p_display)) not between 3 and 50 then
    raise exception 'a bridge needs a name of 3 to 50 characters' using errcode = '22023';
  end if;
  if p_bridge_token_sha256 !~ '^[0-9a-f]{64}$' or p_mcp_token_sha256 !~ '^[0-9a-f]{64}$' or p_bridge_token_sha256 = p_mcp_token_sha256 then
    raise exception 'the two credentials must be two different sha256 hashes' using errcode = '22023';
  end if;
  v_client := 'hermes-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, office_id, kind)
  values (v_client, 'Hermes · ' || btrim(p_display), p_mcp_token_sha256, array['read'], p_office, 'engine');
  insert into public.engine_bridges (office_id, engine, display_name, token_sha256, mcp_client_id)
  values (p_office, p_engine, btrim(p_display), p_bridge_token_sha256, v_client)
  returning bridge_id into v_bridge;
  return jsonb_build_object('bridge_id', v_bridge, 'mcp_client_id', v_client);
end
$f$;
revoke all on function app.engine_mint_bridge(uuid, text, text, text, text) from public, anon, authenticated, service_role;

create function app.engine_retire_bridge(p_office uuid, p_bridge uuid, p_reason text) returns jsonb
 language plpgsql security definer set search_path to ''
as $f$
declare v_client text; v_n integer := 0; r record;
begin
  perform app.require_office(p_office);
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'say why the bridge is being retired' using errcode = '22023';
  end if;
  update public.engine_bridges set enabled = false, disabled_reason = left(btrim(p_reason), 300)
   where bridge_id = p_bridge and office_id = p_office and enabled
  returning mcp_client_id into v_client;
  if v_client is null then
    return jsonb_build_object('ok', false, 'error', 'no such enabled bridge in this office');
  end if;
  update public.mcp_clients set enabled = false, disabled_reason = 'its Hermes bridge was retired'
   where client_id = v_client and office_id = p_office and enabled;
  for r in
    update public.engine_runs e set state = 'failed', finished_at = app.now_utc(), lease_until = null, failure = 'bridge retired'
     where e.office_id = p_office and e.bridge_id = p_bridge and e.state = 'running'
    returning e.job_id, e.run_id, e.project_id
  loop
    v_n := v_n + 1;
    perform app.engine_wake(r.job_id, 'its Hermes bridge was retired');
    perform app.engine_mirror(p_office, r.run_id, 'external.worker_error', 'retired', 'The Hermes bridge was retired.', r.job_id, r.project_id);
  end loop;
  return jsonb_build_object('ok', true, 'runs_failed', v_n);
end
$f$;
revoke all on function app.engine_retire_bridge(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 11. Public wrappers (PostgREST exposes only public). service_role only, named arguments, the office first and filled in by the
-- edge function from the verified credential, never from a request body.
-- ---------------------------------------------------------------------------------------------------------------------------
create function public.engine_bridge_for(p_token_sha256 text) returns jsonb
 language sql security definer set search_path to ''
as $f$ select app.engine_bridge_for(p_token_sha256 => p_token_sha256) $f$;
create function public.engine_bridge_report(p_office uuid, p_bridge uuid, p_healthy boolean, p_reason text) returns jsonb
 language sql security definer set search_path to ''
as $f$ select app.engine_bridge_report(p_office => p_office, p_bridge => p_bridge, p_healthy => p_healthy, p_reason => p_reason) $f$;
create function public.engine_run_claim(p_office uuid, p_bridge uuid) returns jsonb
 language sql security definer set search_path to ''
as $f$ select app.engine_run_claim(p_office => p_office, p_bridge => p_bridge) $f$;
create function public.engine_run_heartbeat(p_office uuid, p_bridge uuid, p_run uuid, p_claim_gen integer, p_hermes_run_id text default null)
 returns jsonb
 language sql security definer set search_path to ''
as $f$ select app.engine_run_heartbeat(p_office => p_office, p_bridge => p_bridge, p_run => p_run, p_claim_gen => p_claim_gen,
                                       p_hermes_run_id => p_hermes_run_id) $f$;
create function public.engine_run_finish(p_office uuid, p_bridge uuid, p_run uuid, p_claim_gen integer, p_outcome text, p_result jsonb)
 returns jsonb
 language sql security definer set search_path to ''
as $f$ select app.engine_run_finish(p_office => p_office, p_bridge => p_bridge, p_run => p_run, p_claim_gen => p_claim_gen,
                                    p_outcome => p_outcome, p_result => p_result) $f$;
create function public.engine_tool_gate(p_office uuid, p_mcp_client text, p_tool text) returns jsonb
 language sql security definer set search_path to ''
as $f$ select app.engine_tool_gate(p_office => p_office, p_mcp_client => p_mcp_client, p_tool => p_tool) $f$;
create function public.engine_record_call(p_office uuid, p_run uuid, p_tool text, p_verdict text, p_args_sha256 text, p_domain text,
                                          p_complete boolean, p_result_chars integer, p_result_excerpt text, p_because text) returns void
 language sql security definer set search_path to ''
as $f$ select app.engine_record_call(p_office => p_office, p_run => p_run, p_tool => p_tool, p_verdict => p_verdict,
                                     p_args_sha256 => p_args_sha256, p_domain => p_domain, p_complete => p_complete,
                                     p_result_chars => p_result_chars, p_result_excerpt => p_result_excerpt, p_because => p_because) $f$;

revoke all on function public.engine_bridge_for(text) from public, anon, authenticated;
revoke all on function public.engine_bridge_report(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.engine_run_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.engine_run_heartbeat(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.engine_run_finish(uuid, uuid, uuid, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.engine_tool_gate(uuid, text, text) from public, anon, authenticated;
revoke all on function public.engine_record_call(uuid, uuid, text, text, text, text, boolean, integer, text, text) from public, anon, authenticated;
grant execute on function public.engine_bridge_for(text) to service_role;
grant execute on function public.engine_bridge_report(uuid, uuid, boolean, text) to service_role;
grant execute on function public.engine_run_claim(uuid, uuid) to service_role;
grant execute on function public.engine_run_heartbeat(uuid, uuid, uuid, integer, text) to service_role;
grant execute on function public.engine_run_finish(uuid, uuid, uuid, integer, text, jsonb) to service_role;
grant execute on function public.engine_tool_gate(uuid, text, text) to service_role;
grant execute on function public.engine_record_call(uuid, uuid, text, text, text, text, boolean, integer, text, text) to service_role;
