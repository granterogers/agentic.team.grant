-- Numbering note (6 Oct 2026): below, "0897" means the project calendar, now migration 0906, and "0900" the documents
-- migration, now 0907. The Public Sample Office's applied 0897 and 0900 are different migrations.
begin;

-- ---------------------------------------------------------------------------
-- 0922 - the projections behind the MCP tools ChatGPT and Claude are given (0920's `mcp_clients.kind` names which)
--
-- 0065-0068 gave external assistants five read tools and four write tools over a fixed list. Grant's requirement is that
-- an assistant can work a project: search it, list and change its tasks, read and (once 0897 is applied) change its
-- calendar, inspect its activity, ask the team, start research and request an artifact - and that each thing it does
-- shows in Activity as "Grant via ChatGPT".
--
-- ## The rules every function here keeps
--
--   - The OFFICE is the first argument and comes from the client's credential in the edge function, never from the
--     model. Every function re-checks that the named client belongs to that office, is enabled and (for a write) holds
--     the `write` scope, so a caller that reaches `public.mcp_*` without the edge function is no better off.
--   - A project is named by slug and must be active, not a fixture and in the office; anything else answers like a
--     project that does not exist.
--   - A write sets the transaction's ambient door (`app.via`, 0920) to the client's kind, so any event it appends is
--     recorded as "via ChatGPT" / "via Claude". It never claims Team HQ.
--   - Nothing is deleted. A task cannot be cancelled from here, an event cannot be removed.
--   - What reaches outside the office goes through the policy (`app.authorize_effect`, the SQL half of
--     `src/agents/approval.ts`'s `mayAct`): a verdict of `ask` or `refuse` enqueues NOTHING and is returned to the
--     assistant as "waiting for the owner", with the policy's own reason. A `proceed` is the only thing that starts work.
--
-- ## ask_team is deliberately NOT a trusted turn
--
-- `app.say_in_project` (the Team HQ composer) writes a command whose key matches `app.adapter_key_ok`, so its job is
-- `trusted` - Grant's own words. Text an assistant forwards is a model's rendering, one prompt injection away from
-- anything. `mcp_ask_team` writes the same command with a key the adapter does not produce, so the job's origin is
-- `unknown`: the team may think, answer and draft, and `app.job_origin` / containment refuse anything it then tries to
-- do outside the office. The answer is read back with check_job. `context.via` carries the client's kind so Activity
-- can say who asked.
-- ---------------------------------------------------------------------------

-- A client that may write for this office, or NULL. Returns its provenance word.
create or replace function app.mcp_write_client(p_office uuid, p_client_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare v_via text;
begin
  perform app.require_office(p_office);
  select case k.kind when 'chatgpt' then 'chatgpt' when 'claude' then 'claude' else 'mcp' end into v_via
    from public.mcp_clients k
   where k.client_id = p_client_id and k.office_id = p_office and k.enabled and 'write' = any (k.scopes);
  return v_via;
end
$f$;

create or replace function app.mcp_project_id(p_office uuid, p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $f$
  select project_id from public.projects
   where office_id = p_office and slug = btrim(coalesce(p_slug, '')) and status = 'active' and not is_fixture
$f$;

-- ---- reads -----------------------------------------------------------------

create or replace function app.mcp_project_search(p_office uuid, p_query text, p_project text, p_limit integer, p_kinds text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare v_project uuid;
begin
  perform app.require_office(p_office);
  if nullif(btrim(coalesce(p_project, '')), '') is not null then
    v_project := app.mcp_project_id(p_office, p_project);
    if v_project is null then return jsonb_build_object('error', format('no active project with slug %L', p_project)); end if;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind', r.kind, 'id', r.id, 'title', r.title, 'snippet', r.snippet,
             'project', r.project_slug, 'score', r.score, 'at', r.at) order by r.score desc, r.at desc)
      from app.project_search(p_office, p_query, v_project, p_limit, p_kinds) r), '[]'::jsonb);
end
$f$;

create or replace function app.mcp_list_tasks(p_office uuid, p_project text, p_state text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare v_project uuid; v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  perform app.require_office(p_office);
  if nullif(btrim(coalesce(p_project, '')), '') is not null then
    v_project := app.mcp_project_id(p_office, p_project);
    if v_project is null then return jsonb_build_object('error', format('no active project with slug %L', p_project)); end if;
  end if;
  if p_state is not null and p_state not in ('open', 'todo', 'doing', 'blocked', 'done') then
    return jsonb_build_object('error', 'state is one of open, todo, doing, blocked, done');
  end if;
  return coalesce((
    select jsonb_agg(x.v order by x.ord) from (
      select jsonb_build_object(
               'id', t.task_id, 'title', t.title, 'detail', t.detail, 'state', t.state, 'due_on', t.due_on,
               'project', p.slug, 'blocked_on', nullif(t.blocked_on, '')) as v,
             row_number() over (order by (t.due_on is null), t.due_on, t.created_at desc) as ord
        from public.tasks t
        join public.projects p on p.project_id = t.project_id and p.office_id = p_office and not p.is_fixture
       where t.office_id = p_office
         and (v_project is null or t.project_id = v_project)
         and t.state <> 'cancelled'
         and not app.harness_task(t.is_fixture, t.job_id)
         and (p_state is null
              or (p_state = 'open' and t.state in ('todo', 'doing', 'blocked'))
              or t.state = p_state)
       order by (t.due_on is null), t.due_on, t.created_at desc
       limit v_limit) x), '[]'::jsonb);
end
$f$;

create or replace function app.mcp_activity(p_office uuid, p_project text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare v_project uuid;
begin
  perform app.require_office(p_office);
  if nullif(btrim(coalesce(p_project, '')), '') is null then
    return coalesce(app.hq_studio_lately(p_office, greatest(1, least(coalesce(p_limit, 25), 100))) -> 'office', '[]'::jsonb);
  end if;
  v_project := app.mcp_project_id(p_office, p_project);
  if v_project is null then return jsonb_build_object('error', format('no active project with slug %L', p_project)); end if;
  return app.studio_activity(v_project, greatest(1, least(coalesce(p_limit, 25), 100)));
end
$f$;

-- Which OPTIONAL tools this database can serve. Calendar needs 0897's public.hq_event_* wrappers.
create or replace function app.mcp_optional_tools(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare out_ text[] := '{}';
begin
  perform app.require_office(p_office);
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hq_event_list')
    then out_ := array_append(out_, 'list_events'); end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hq_event_create')
    then out_ := array_append(out_, 'create_event'); end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hq_event_update')
    then out_ := array_append(out_, 'update_event'); end if;
  return to_jsonb(out_);
end
$f$;

-- ---- writes ----------------------------------------------------------------

create or replace function app.mcp_task_add(
  p_office uuid, p_client_id text, p_project text, p_title text,
  p_detail text default null, p_due_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare v_via text; v_project uuid;
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  v_project := app.mcp_project_id(p_office, p_project);
  if v_project is null then return jsonb_build_object('error', format('no active project with slug %L', p_project)); end if;
  perform set_config('app.via', v_via, true);
  -- The task row itself carries the client (added_by), and Activity reads the door from it, so no second event is
  -- written for a creation: one fact, one place.
  return app.task_add(p_office, v_project, p_title, p_detail, p_due_on, null, false, 'mcp:' || p_client_id, null);
end
$f$;

create or replace function app.mcp_task_update(
  p_office uuid, p_client_id text, p_task_id text,
  p_state text default null, p_title text default null, p_detail text default null,
  p_due_on date default null, p_blocked_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_via text; v_id uuid; v_project uuid; v_title text; v jsonb; v_changed text[] := '{}';
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  begin v_id := p_task_id::uuid; exception when others then return jsonb_build_object('error', 'that is not a task id'); end;
  select t.project_id, t.title into v_project, v_title
    from public.tasks t join public.projects p on p.project_id = t.project_id and p.office_id = p_office and not p.is_fixture
   where t.task_id = v_id and t.office_id = p_office;
  if v_project is null then return jsonb_build_object('error', 'no task with that id'); end if;
  -- Taking work back is not an assistant's to do: no cancelling, no deleting.
  if p_state is not null and p_state not in ('todo', 'doing', 'blocked', 'done') then
    return jsonb_build_object('error', 'an assistant may set a task to todo, doing, blocked or done; it cannot cancel or delete one');
  end if;
  if p_state is null and p_title is null and p_detail is null and p_due_on is null then
    return jsonb_build_object('error', 'nothing to change');
  end if;
  perform set_config('app.via', v_via, true);
  if p_title is not null or p_detail is not null or p_due_on is not null then
    v := app.hq_task_update(p_office, p_task_id, p_title, p_detail, p_due_on);
    if v ? 'error' then return v; end if;
    v_changed := array_append(v_changed, 'details');
  end if;
  if p_state is not null then
    -- p_by stays null: the office's principal list does not know an MCP client, and the door is recorded below.
    v := app.hq_task_state(p_office, p_task_id, p_state, p_blocked_reason, null);
    if v ? 'error' then return v; end if;
    v_changed := array_append(v_changed, 'state: ' || p_state);
  end if;
  perform app.append_event(p_office, gen_random_uuid(), 'user', app.office_actor(p_office), 'mcp', 'task.updated', false,
                           v_project, null, null, left(format('changed %s (%s)', left(v_title, 80), array_to_string(v_changed, ', ')), 1000));
  return jsonb_build_object('ok', true, 'id', v_id, 'changed', to_jsonb(v_changed));
end
$f$;

-- ask_team: a question or request to the team. NOT a trusted turn (see the header).
create or replace function app.mcp_ask_team(
  p_office uuid, p_client_id text, p_project text, p_text text, p_to text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_via text; v_project uuid; v_to text; v_key text; v_command uuid; v_queued jsonb; v_said text := nullif(btrim(coalesce(p_text, '')), '');
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  v_project := app.mcp_project_id(p_office, p_project);
  if v_project is null then return jsonb_build_object('error', format('no active project with slug %L', p_project)); end if;
  if v_said is null then return jsonb_build_object('error', 'there is nothing to ask'); end if;
  if length(v_said) > 4000 then return jsonb_build_object('error', 'keep the question under 4000 characters'); end if;
  v_to := nullif(btrim(coalesce(p_to, '')), '');
  if v_to is not null and not exists (select 1 from public.staff s where s.slug = v_to and s.active) then
    return jsonb_build_object('error', format('nobody on the team is called %L (see list_staff)', v_to));
  end if;
  perform set_config('app.via', v_via, true);
  -- A key the production adapters do not produce: app.adapter_key_ok says no, so this turn is 'unknown' - it may
  -- answer and draft, never act outside the office.
  v_key := 'teamhq:mcp_message:' || replace(gen_random_uuid()::text, '-', '');
  insert into public.inbound_commands
    (office_id, origin_channel, origin_ref, actor, instruction, addressed_to, dedupe_key, project_id, context)
  values (p_office, 'teamhq', v_key, app.office_actor(p_office), v_said, v_to, v_key, v_project,
          jsonb_build_object('project_id', v_project, 'via', v_via, 'client_id', p_client_id))
  returning command_id into v_command;
  v_queued := app.enqueue_inbound(v_command);
  if v_queued ? 'error' then return v_queued; end if;
  return jsonb_build_object('job_id', v_queued ->> 'job_id', 'state', 'queued',
    'note', 'the team answers in the project conversation; call check_job with the id to read it');
end
$f$;

-- start_research: the policy decides, not the assistant. Only a `proceed` for web.read enqueues anything.
create or replace function app.mcp_start_research(
  p_office uuid, p_client_id text, p_project text, p_topic text, p_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_via text; v_project uuid; v_decision jsonb; v_text text; v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  v_project := app.mcp_project_id(p_office, p_project);
  if v_project is null then return jsonb_build_object('error', format('no active project with slug %L', p_project)); end if;
  if nullif(btrim(coalesce(p_topic, '')), '') is null then return jsonb_build_object('error', 'say what to research'); end if;
  if v_url is not null and (v_url !~* '^https://[^[:space:]]+$' or length(v_url) > 1900) then
    return jsonb_build_object('error', 'a research url must be an https address');
  end if;
  v_decision := app.authorize_effect(p_office => p_office, p_project => v_project, p_tool => 'web.read');
  if coalesce(v_decision ->> 'verdict', 'ask') <> 'proceed' then
    return jsonb_build_object(
      'status', case when v_decision ->> 'verdict' = 'refuse' then 'refused' else 'needs_approval' end,
      'because', coalesce(v_decision ->> 'because', 'The policy did not say why, so it asks.'),
      'note', 'nothing was started; the owner decides in Team HQ');
  end if;
  v_text := 'Research this for the project and report what you find, with sources: ' || btrim(p_topic)
            || case when v_url is not null then E'\nStart from this page: ' || v_url else '' end;
  return app.mcp_ask_team(p_office, p_client_id, p_project, v_text, 'research-director');
end
$f$;

-- generate_artifact: a written report from what the project holds, as a file. Policy first.
create or replace function app.mcp_generate_artifact(
  p_office uuid, p_client_id text, p_project text, p_brief text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare v_via text; v_project uuid; v_decision jsonb; v_job uuid; v_brief text := nullif(btrim(coalesce(p_brief, '')), '');
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  v_project := app.mcp_project_id(p_office, p_project);
  if v_project is null then return jsonb_build_object('error', format('no active project with slug %L', p_project)); end if;
  if v_brief is null then return jsonb_build_object('error', 'say what the report should cover'); end if;
  if length(v_brief) > 2000 then return jsonb_build_object('error', 'keep the brief under 2000 characters'); end if;
  v_decision := app.authorize_effect(p_office => p_office, p_project => v_project, p_tool => 'document.create');
  if coalesce(v_decision ->> 'verdict', 'ask') <> 'proceed' then
    return jsonb_build_object(
      'status', case when v_decision ->> 'verdict' = 'refuse' then 'refused' else 'needs_approval' end,
      'because', coalesce(v_decision ->> 'because', 'The policy did not say why, so it asks.'),
      'note', 'nothing was started; the owner decides in Team HQ');
  end if;
  insert into public.jobs
    (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, announce, pinned_config)
  values (p_office, gen_random_uuid(), v_project, format('mcp-%s-%s', p_client_id, gen_random_uuid()),
          'artifact.report', format('mcp:%s', p_client_id), 200,
          -- Nothing is pushed to the owner's phone by an assistant's request; the file is read back with check_job.
          false,
          jsonb_build_object('brief', v_brief, 'by', 'chief-of-staff'))
  returning job_id into v_job;
  return jsonb_build_object('job_id', v_job, 'kind', 'artifact.report', 'state', 'queued',
    'note', 'the worker writes it into the project as a document; call check_job with the id');
end
$f$;

-- ---- public wrappers (PostgREST reads only `public`) ----------------------

create or replace function public.mcp_project_search(p_office uuid, p_query text, p_project text default null, p_limit integer default 10, p_kinds text default null)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select app.mcp_project_search(p_office, p_query, p_project, p_limit, p_kinds) $f$;

create or replace function public.mcp_list_tasks(p_office uuid, p_project text default null, p_state text default null, p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select app.mcp_list_tasks(p_office, p_project, p_state, p_limit) $f$;

create or replace function public.mcp_activity(p_office uuid, p_project text default null, p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select app.mcp_activity(p_office, p_project, p_limit) $f$;

create or replace function public.mcp_optional_tools(p_office uuid)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select app.mcp_optional_tools(p_office) $f$;

create or replace function public.mcp_task_add(p_office uuid, p_client_id text, p_project text, p_title text, p_detail text default null, p_due_on date default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_task_add(p_office, p_client_id, p_project, p_title, p_detail, p_due_on) $f$;

create or replace function public.mcp_task_update(p_office uuid, p_client_id text, p_task_id text, p_state text default null, p_title text default null, p_detail text default null, p_due_on date default null, p_blocked_reason text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_task_update(p_office, p_client_id, p_task_id, p_state, p_title, p_detail, p_due_on, p_blocked_reason) $f$;

create or replace function public.mcp_ask_team(p_office uuid, p_client_id text, p_project text, p_text text, p_to text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_ask_team(p_office, p_client_id, p_project, p_text, p_to) $f$;

create or replace function public.mcp_start_research(p_office uuid, p_client_id text, p_project text, p_topic text, p_url text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_start_research(p_office, p_client_id, p_project, p_topic, p_url) $f$;

create or replace function public.mcp_generate_artifact(p_office uuid, p_client_id text, p_project text, p_brief text)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_generate_artifact(p_office, p_client_id, p_project, p_brief) $f$;

-- ---- calendar (needs 0897's public.hq_event_* wrappers; absent here, so these answer "not available") ---------------
--
-- The sibling migration owns the calendar. These do two things it cannot: they check the client and set the ambient door
-- (so whatever event the calendar writes is "via ChatGPT"), and they call the calendar by NAMED arguments, turning a
-- contract mismatch into a sentence rather than a crash. The contract assumed, to be confirmed when 0897 lands:
--
--   public.hq_event_list  (p_office, p_project text, p_from timestamptz, p_to timestamptz, p_limit integer)
--   public.hq_event_create(p_office, p_project text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz,
--                          p_location text, p_notes text)
--   public.hq_event_update(p_office, p_event_id text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz,
--                          p_location text, p_notes text)
create or replace function app.mcp_event_call(p_fn text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare v jsonb; v_names text;
begin
  if p_fn not in ('hq_event_list', 'hq_event_create', 'hq_event_update')
     or not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = p_fn) then
    return jsonb_build_object('error', 'the calendar is not available in this deployment yet');
  end if;
  -- only the arguments the caller actually gave: a missing one is the calendar function's own default
  select string_agg(format('%I => %L', k, case when jsonb_typeof(p_args -> k) = 'string' then p_args ->> k else (p_args -> k)::text end), ', ')
    into v_names from jsonb_object_keys(p_args) k where p_args -> k <> 'null'::jsonb;
  begin
    execute format('select to_jsonb(public.%I(%s))', p_fn, v_names) into v;
  exception
    when undefined_function then
      return jsonb_build_object('error', 'the calendar did not accept this call (its signature differs from the one the assistant tools expect)');
    when others then
      return jsonb_build_object('error', left(sqlerrm, 300));
  end;
  return coalesce(v, 'null'::jsonb);
end
$f$;

create or replace function app.mcp_event_list(p_office uuid, p_project text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
begin
  perform app.require_office(p_office);
  if nullif(btrim(coalesce(p_project, '')), '') is not null and app.mcp_project_id(p_office, p_project) is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;
  return app.mcp_event_call('hq_event_list', jsonb_strip_nulls(jsonb_build_object(
    'p_office', p_office, 'p_project', p_project, 'p_from', p_from, 'p_to', p_to, 'p_limit', greatest(1, least(coalesce(p_limit, 25), 100)))));
end
$f$;

create or replace function app.mcp_event_create(p_office uuid, p_client_id text, p_project text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz default null, p_location text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare v_via text;
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  if app.mcp_project_id(p_office, p_project) is null then return jsonb_build_object('error', format('no active project with slug %L', p_project)); end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null or p_starts_at is null then return jsonb_build_object('error', 'an event needs a title and a start time'); end if;
  perform set_config('app.via', v_via, true);
  return app.mcp_event_call('hq_event_create', jsonb_strip_nulls(jsonb_build_object(
    'p_office', p_office, 'p_project', btrim(p_project), 'p_title', btrim(p_title), 'p_starts_at', p_starts_at,
    'p_ends_at', p_ends_at, 'p_location', p_location, 'p_notes', p_notes)));
end
$f$;

create or replace function app.mcp_event_update(p_office uuid, p_client_id text, p_event_id text, p_title text default null, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_location text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare v_via text;
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  if nullif(btrim(coalesce(p_event_id, '')), '') is null then return jsonb_build_object('error', 'which event?'); end if;
  perform set_config('app.via', v_via, true);
  return app.mcp_event_call('hq_event_update', jsonb_strip_nulls(jsonb_build_object(
    'p_office', p_office, 'p_event_id', btrim(p_event_id), 'p_title', p_title, 'p_starts_at', p_starts_at,
    'p_ends_at', p_ends_at, 'p_location', p_location, 'p_notes', p_notes)));
end
$f$;

create or replace function public.mcp_event_list(p_office uuid, p_project text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select app.mcp_event_list(p_office, p_project, p_from, p_to, p_limit) $f$;
create or replace function public.mcp_event_create(p_office uuid, p_client_id text, p_project text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz default null, p_location text default null, p_notes text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_event_create(p_office, p_client_id, p_project, p_title, p_starts_at, p_ends_at, p_location, p_notes) $f$;
create or replace function public.mcp_event_update(p_office uuid, p_client_id text, p_event_id text, p_title text default null, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_location text default null, p_notes text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_event_update(p_office, p_client_id, p_event_id, p_title, p_starts_at, p_ends_at, p_location, p_notes) $f$;

commit;
