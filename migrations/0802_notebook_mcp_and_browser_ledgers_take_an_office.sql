-- 0802 - NotebookLM, MCP discovery and the browser ledger take an office (multi-user P3, wave 2, cluster i-integrations2, part 3 of 5).
--
-- Before:
--   * notebook_allowance summed every office's NotebookLM spend and honoured every office's refusal, so one office's
--     use set another's "you are blocked until" and "you have N units left"; notebook_record_refusal LOWERED THE
--     DEPLOYMENT'S ceiling (system_config) from whichever office was refused, which then capped everyone;
--     notebook_record_spend filed spend under any project or job id it was handed;
--   * record_notebook_artifact adopted an artifact into any project id;
--   * record_mcp_tools wrote a discovered-tool list into any provider id (and stamped it probed);
--   * record_browser_page filed a kept page into any project and stamped any job id as its producer;
--   * browser_note wrote a ledger row against any session or job id, and browser_session_expired signed out any
--     session id - the sign-in a person pasted in.
--
-- Now each takes `p_office uuid` FIRST, no default. The ledger and the refusals are the office's own: its allowance
-- is its own spend against the deployment's ceiling, and only an office that sees the deployment (the operator's, the
-- system and test offices) can LOWER the shared ceiling from a refusal - another office's refusal is still recorded
-- and still blocks that office, it just cannot change what everybody is allowed. A project, provider, session,
-- artifact or job of another office is indistinguishable from one that does not exist.
--
-- Global key, reported: artifacts_one_per_external_ref is unique on (notebook_ref, external_ref), so two offices can
-- never both adopt the same notebook artifact; the second is refused with the same words as any failed record.
--
-- NotebookLM runs on ONE Google account (the deployment's). Its real quota is that account's, not an office's; the
-- per-office ledger measures what each office spent so one office's activity is not another's, and a Google-dated
-- refusal is recorded against the office that was refused. That is the conservative reading and it is documented
-- here because the alternative (an account-wide block visible to every office) would leak one office's activity.

create function app.notebook_allowance(p_office uuid, p_operation text default null::text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_hours    integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.window_hours'), 5);
  v_window   integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.window_units'), 40);
  v_week     integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.week_units'), 300);
  v_measured boolean := coalesce((select value::text::boolean from public.system_config where key = 'notebook.ceiling_is_measured'), false);
  v_spent_w  integer;
  v_spent_7  integer;
  v_cost     integer;
  v_blocked  timestamptz;
  v_resets   timestamptz;
begin
  perform app.require_office(p_office);
  select coalesce(sum(units), 0) into v_spent_w
    from public.notebook_spend
   where office_id = p_office and succeeded and occurred_at > now() - make_interval(hours => v_hours);

  select coalesce(sum(units), 0) into v_spent_7
    from public.notebook_spend
   where office_id = p_office and succeeded and occurred_at > now() - interval '7 days';

  select units into v_cost
    from public.notebook_operation_cost where operation = p_operation;

  -- A refusal Google dated is authoritative until that moment, whatever our
  -- own arithmetic says. Their no beats our estimate.
  select resets_at into v_blocked
    from public.notebook_refusals
   where office_id = p_office and resets_at is not null and resets_at > now()
   order by resets_at desc limit 1;

  -- When the window turns over, on our own reckoning: the oldest spend inside
  -- the window ages out first, so that is the soonest anything frees up.
  select occurred_at + make_interval(hours => v_hours) into v_resets
    from public.notebook_spend
   where office_id = p_office and succeeded and occurred_at > now() - make_interval(hours => v_hours)
   order by occurred_at asc limit 1;

  return jsonb_build_object(
    'window_hours', v_hours,
    'window_spent', v_spent_w,
    'window_ceiling', v_window,
    'window_left', greatest(v_window - v_spent_w, 0),
    'week_spent', v_spent_7,
    'week_ceiling', v_week,
    'week_left', greatest(v_week - v_spent_7, 0),
    'ceiling_is_measured', v_measured,
    'operation', p_operation,
    'operation_cost', v_cost,
    'blocked_until', v_blocked,
    'window_resets_at', v_resets,
    'allowed', (
      v_blocked is null
      and (v_cost is null or v_spent_w + v_cost <= v_window)
      and (v_cost is null or v_spent_7 + v_cost <= v_week)
    ),
    -- Everything above is OUR arithmetic. Said here so no caller can present
    -- it as Google's without going out of its way.
    'source', 'our own ledger — Google exposes no usage API'
  );
end;
$function$;
revoke all on function app.notebook_allowance(uuid, text) from public, anon, authenticated, service_role;

create function app.notebook_record_refusal(p_office uuid, p_operation text, p_detail text, p_resets_at timestamp with time zone default null::timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_hours integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.window_hours'), 5);
  v_spent integer;
  v_ceiling integer := coalesce((select value::text::integer from public.system_config where key = 'notebook.window_units'), 40);
  v_lowered boolean := false;
begin
  perform app.require_office(p_office);
  select coalesce(sum(units), 0) into v_spent
    from public.notebook_spend
   where office_id = p_office and succeeded and occurred_at > now() - make_interval(hours => v_hours);

  insert into public.notebook_refusals (office_id, operation, detail, window_spend, resets_at)
  values (p_office, p_operation, left(p_detail, 500), v_spent, p_resets_at);

  -- The measurement. We were refused having spent this much, so the real
  -- ceiling is at most this much — and a configured ceiling above it is a
  -- ceiling that will let us be refused again tomorrow.
  --
  -- Only ever downward, and only from evidence. Raising it would require a
  -- successful operation ABOVE the ceiling, which cannot happen because the
  -- ceiling prevents it: the loop is one-way by construction, and a human
  -- raises it in the front end when they think we are being too careful.
  --
  -- The ceiling is the DEPLOYMENT's (one Google account), so only an office that sees the deployment may move it.
  if v_spent > 0 and v_spent < v_ceiling and app.office_sees_the_deployment(p_office) then
    update public.system_config set value = to_jsonb(v_spent) where key = 'notebook.window_units';
    update public.system_config set value = to_jsonb(true) where key = 'notebook.ceiling_is_measured';
    v_lowered := true;
  end if;

  return jsonb_build_object(
    'window_spend', v_spent, 'ceiling_lowered_to', case when v_lowered then v_spent end,
    'resets_at', p_resets_at
  );
end;
$function$;
revoke all on function app.notebook_record_refusal(uuid, text, text, timestamp with time zone) from public, anon, authenticated, service_role;

create function app.notebook_record_spend(p_office uuid, p_operation text, p_notebook text default null::text, p_project uuid default null::uuid, p_job uuid default null::uuid, p_succeeded boolean default true)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_units integer;
  v_project uuid;
  v_job uuid;
begin
  perform app.require_office(p_office);
  select units into v_units from public.notebook_operation_cost where operation = p_operation;
  if v_units is null then
    -- An operation with no price is still an operation. Charged at the median
    -- rather than free: a free unknown is how a meter stops meaning anything.
    v_units := 5;
  end if;
  -- The spend is the office's whatever it names. A project or job that is another office's, or nobody's, is not
  -- recorded against: the same for both.
  select pr.project_id into v_project from public.projects pr where pr.project_id = p_project and pr.office_id = p_office;
  select j.job_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  insert into public.notebook_spend (office_id, operation, units, notebook_ref, project_id, job_id, succeeded)
  values (p_office, p_operation, v_units, p_notebook, v_project, v_job, p_succeeded);
  return v_units;
end;
$function$;
revoke all on function app.notebook_record_spend(uuid, text, text, uuid, uuid, boolean) from public, anon, authenticated, service_role;

create function app.record_notebook_artifact(p_office uuid, p_project uuid, p_notebook_ref text, p_external_ref text, p_kind text, p_title text, p_url text default null::text, p_state text default 'generating'::text, p_detail text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_id uuid;
  v_state text := coalesce(nullif(btrim(p_state), ''), 'generating');
  v_was text;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.projects where project_id = p_project and office_id = p_office) then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;
  if coalesce(btrim(p_notebook_ref), '') = '' or coalesce(btrim(p_external_ref), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'an artifact needs the notebook it belongs to and its own id');
  end if;

  /*
    `ready` needs a link, and the constraint says so.

    Rather than let the INSERT raise, the state is DEMOTED when no URL came
    back: the artifact genuinely is finished in the notebook and the office
    genuinely cannot open it, and saying "ready, here is nothing" would be the
    fabricated link #260 forbids. `detail` carries the reason so the page and
    the answer can both say it.
  */
  if v_state = 'ready' and coalesce(btrim(p_url), '') = '' then
    v_state := 'generating';
    p_detail := coalesce(nullif(btrim(p_detail), ''),
      'Finished in the notebook, but it gave no link the office can open.');
  end if;

  select artifact_id, state into v_id, v_was
    from public.artifacts
   where notebook_ref = btrim(p_notebook_ref) and external_ref = btrim(p_external_ref)
     and project_id in (select pr.project_id from public.projects pr where pr.office_id = p_office);

  if v_id is null then
    begin
      insert into public.artifacts
        (project_id, notebook_ref, external_ref, kind, title, url, state, detail, ready_at)
      values (p_project, btrim(p_notebook_ref), btrim(p_external_ref),
              coalesce(nullif(btrim(p_kind), ''), 'unknown'),
              nullif(btrim(coalesce(p_title, '')), ''),
              nullif(btrim(coalesce(p_url, '')), ''),
              v_state, nullif(btrim(coalesce(p_detail, '')), ''),
              case when v_state = 'ready' then app.now_utc() else null end)
      returning artifact_id into v_id;
    exception when unique_violation then
      -- An artifact another office already holds (the key is global, reported): the same words as any failed record.
      return jsonb_build_object('ok', false, 'error', 'that artifact could not be recorded');
    end;
    return jsonb_build_object('ok', true, 'artifact', v_id, 'outcome', 'adopted');
  end if;

  /*
    An update never moves a terminal state backwards.

    A notebook listing that briefly reports an old artifact as pending must not
    un-finish something the office already has a link for -- the same argument
    `record_drive_document` makes about not re-stamping an unchanged file, with
    a worse failure mode: a `ready` row demoted loses its URL to the CHECK.
  */
  update public.artifacts
     set title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         kind = coalesce(nullif(btrim(p_kind), ''), kind),
         url = coalesce(nullif(btrim(coalesce(p_url, '')), ''), url),
         state = case
                   when state in ('ready', 'failed', 'abandoned') then state
                   else v_state
                 end,
         detail = coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail),
         ready_at = case
                      when ready_at is not null then ready_at
                      when v_state = 'ready' then app.now_utc()
                      else null
                    end,
         updated_at = app.now_utc()
   where artifact_id = v_id;

  return jsonb_build_object('ok', true, 'artifact', v_id,
    'outcome', case when v_was = 'ready' then 'unchanged' else 'updated' end);
end;
$function$;
revoke all on function app.record_notebook_artifact(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;

create function app.record_mcp_tools(p_office uuid, p_provider uuid, p_tools jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_tool jsonb; v_guess jsonb; v_seen text[] := array[]::text[];
  v_new integer := 0; v_gone integer := 0;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.mcp_providers where provider_id = p_provider and office_id = p_office) then
    return jsonb_build_object('error', 'no such provider');
  end if;

  for v_tool in select * from jsonb_array_elements(coalesce(p_tools, '[]'::jsonb)) loop
    if coalesce(btrim(v_tool ->> 'name'), '') = '' then continue; end if;
    v_seen := v_seen || (v_tool ->> 'name');
    v_guess := app.guess_reach(v_tool ->> 'name', v_tool ->> 'description');

    insert into public.mcp_discovered_tools
      (provider_id, external_name, description, input_schema, reach, why_that_reach)
    values (p_provider, v_tool ->> 'name',
            left(coalesce(v_tool ->> 'description', ''), 2000),
            coalesce(v_tool -> 'inputSchema', '{}'::jsonb),
            v_guess ->> 'reach', v_guess ->> 'why')
    on conflict (provider_id, external_name) do update
      set description = excluded.description,
          input_schema = excluded.input_schema,
          last_seen_at = app.now_utc(),
          vanished_at = null,
          /*
            A CONFIRMED reach is a person's judgement and survives a
            rediscovery. Overwriting it would make the confirmation worthless
            the next time the provider rewords a description.
          */
          reach = case when public.mcp_discovered_tools.reach_certainty = 'confirmed'
                       then public.mcp_discovered_tools.reach else excluded.reach end,
          why_that_reach = case when public.mcp_discovered_tools.reach_certainty = 'confirmed'
                                then public.mcp_discovered_tools.why_that_reach
                                else excluded.why_that_reach end;
    if found then v_new := v_new + 1; end if;
  end loop;

  update public.mcp_discovered_tools
     set vanished_at = app.now_utc()
   where provider_id = p_provider and vanished_at is null
     and not (external_name = any (v_seen));
  get diagnostics v_gone = row_count;

  update public.mcp_providers
     set last_probe_at = app.now_utc(), last_probe_ok = true,
         last_probe_detail = format('%s tool(s)', coalesce(array_length(v_seen, 1), 0)),
         updated_at = app.now_utc()
   where provider_id = p_provider and office_id = p_office;

  return jsonb_build_object('ok', true,
    'seen', coalesce(array_length(v_seen, 1), 0), 'vanished', v_gone);
end;
$function$;
revoke all on function app.record_mcp_tools(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create function app.record_browser_page(p_office uuid, p_project uuid, p_url text, p_title text, p_text text, p_job uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_id uuid;
  v_text text := left(coalesce(p_text, ''), 400000);
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_job uuid;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.projects where project_id = p_project and office_id = p_office) then
    return jsonb_build_object('error', 'there is no dashboard project by that id');
  end if;
  if length(trim(v_text)) = 0 then
    return jsonb_build_object('error', 'the page had no words on it');
  end if;
  if v_title is null then
    return jsonb_build_object('error', 'a kept page needs a title');
  end if;

  -- A job that is another office's, or nobody's, is not recorded as the producer: the same for both.
  select j.job_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  insert into public.documents
    (office_id, project_id, title, origin, connector, external_ref, state,
     content, content_fingerprint, content_chars, fetched_at,
     produced_by_job)
  values
    (p_office, p_project, v_title, 'source', 'browser', p_url, 'approved',
     v_text, encode(extensions.digest(v_text, 'sha256'), 'hex'), length(v_text), app.now_utc(),
     v_job)
  on conflict (project_id, external_ref) where connector = 'browser' and external_ref is not null
  do update set
     title = excluded.title,
     content = excluded.content,
     content_fingerprint = excluded.content_fingerprint,
     content_chars = excluded.content_chars,
     fetched_at = excluded.fetched_at,
     produced_by_job = excluded.produced_by_job,
     updated_at = app.now_utc()
  returning document_id into v_id;

  return jsonb_build_object('ok', true, 'document_id', v_id);
end;
$function$;
revoke all on function app.record_browser_page(uuid, uuid, text, text, text, uuid) from public, anon, authenticated, service_role;

create function app.browser_note(p_office uuid, p_session uuid, p_job uuid, p_verb text, p_url text, p_ok boolean, p_detail text, p_shot text, p_ms integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_project uuid;
  v_session uuid;
  v_job uuid;
  v_id uuid;
begin
  perform app.require_office(p_office);
  -- A session or job that is another office's, or nobody's, is not written against: the same for both.
  select s.session_id, s.project_id into v_session, v_project
    from public.browser_sessions s
    join public.projects sp on sp.project_id = s.project_id and sp.office_id = p_office
   where s.session_id = p_session;
  select j.job_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  if v_project is null then
    select j.project_id into v_project from public.jobs j where j.job_id = v_job;
  end if;
  insert into public.browser_actions
    (office_id, session_id, job_id, project_id, verb, url, ok, detail, shot_path, ms)
  values (p_office, v_session, v_job, v_project, p_verb, left(coalesce(p_url, ''), 2000), coalesce(p_ok, false),
          left(coalesce(p_detail, ''), 600), p_shot, greatest(coalesce(p_ms, 0), 0))
  returning action_id into v_id;
  if v_session is not null and coalesce(p_ok, false) then
    update public.browser_sessions
       set last_alive_at = app.now_utc(), updated_at = app.now_utc()
     where session_id = v_session;
  end if;
  return jsonb_build_object('ok', true, 'action_id', v_id);
end;
$function$;
revoke all on function app.browser_note(uuid, uuid, uuid, text, text, boolean, text, text, integer) from public, anon, authenticated, service_role;

create function app.browser_session_expired(p_office uuid, p_session uuid, p_why text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  update public.browser_sessions s
     set expired_at = coalesce(s.expired_at, app.now_utc()), updated_at = app.now_utc()
   where s.session_id = p_session
     and exists (select 1 from public.projects pr where pr.project_id = s.project_id and pr.office_id = p_office);
  if not found then
    return jsonb_build_object('error', 'there is no session by that id');
  end if;
  return jsonb_build_object('ok', true, 'why', left(coalesce(p_why, ''), 400));
end;
$function$;
revoke all on function app.browser_session_expired(uuid, uuid, text) from public, anon, authenticated, service_role;

-- Callers inside the database that held the old shapes. Each splice asserts it LANDED, and tolerates a function
-- another cluster has already converted (no old call left => nothing to do).
do $m$
declare v text;
begin
  -- voice_answer: a spoken answer about the NotebookLM allowance is the allowance of the office the command is in.
  v := pg_get_functiondef('app.voice_answer(uuid)'::regprocedure);
  if position('app.notebook_allowance()' in v) > 0 then
    v := replace(v, 'app.notebook_allowance()', 'app.notebook_allowance(c.office_id)');
    if position('app.notebook_allowance()' in v) > 0 or position('app.notebook_allowance(c.office_id)' in v) = 0 then
      raise exception 'voice_answer splice did not land';
    end if;
    execute v;
  end if;
  -- hq_settings: not converted yet (cluster d-governance owns it). It shows the allowance of the deployment's own
  -- office, which is what it showed when there was one office.
  v := pg_get_functiondef('app.hq_settings()'::regprocedure);
  if position('app.notebook_allowance()' in v) > 0 then
    v := replace(v, 'app.notebook_allowance()', 'app.notebook_allowance(app.operator_office())');
    if position('app.notebook_allowance()' in v) > 0 or position('app.notebook_allowance(app.operator_office())' in v) = 0 then
      raise exception 'hq_settings splice did not land';
    end if;
    execute v;
  end if;
end $m$;

-- the old signatures go
drop function public.notebook_allowance(text);
drop function public.record_notebook_artifact(uuid, text, text, text, text, text, text, text);
drop function app.notebook_allowance(text);
drop function app.notebook_record_refusal(text, text, timestamp with time zone);
drop function app.notebook_record_spend(text, text, uuid, uuid, boolean);
drop function app.record_notebook_artifact(uuid, text, text, text, text, text, text, text);
drop function app.record_mcp_tools(uuid, jsonb);
drop function app.record_browser_page(uuid, text, text, text, uuid);
drop function app.browser_note(uuid, uuid, text, text, boolean, text, text, integer);
drop function app.browser_session_expired(uuid, text);
