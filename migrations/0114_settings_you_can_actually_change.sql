-- 0114 — Settings you can actually change
--
-- Thirty-two configuration keys exist and the page could edit nine of them. The
-- rest — the timezone the whole system reports in, how many jobs run at once,
-- how far back a conversation is remembered, how often the notebook is synced —
-- needed a migration, a deploy and someone who knows SQL.
--
-- That is the wrong line. A migration is right for a key whose meaning is
-- structural: `notebook.disabled_reason` explains a decision, and editing it
-- from a form would let someone rewrite history in a text box. It is wrong for
-- a number Grant should be able to turn down on a Tuesday because the team is
-- being noisy.
--
-- ## What is still not editable, and why
--
--   - `notebook.ceiling_is_measured` — a FACT, learned from a refusal (0078).
--     A page that could set it would let a guess be relabelled as a
--     measurement, which is the exact distinction §11 exists to protect.
--   - `notebook.disabled_reason`, `slack.subject_user_id`, `staff.avatar_base_url`
--     — identity and history, not preference.
--   - `google.*` — edited through the Google card, which knows the four steps.
--     Two ways to set the same key is one way to set it wrongly.
--
-- ## Why the validation is per key and not one rule
--
-- Because a wrong number here is not a rejected form, it is a system that
-- behaves oddly a day later. `agents.max_simultaneous_jobs` set to 0 stops the
-- team silently; `conversation.window_minutes` set to 6000 makes every reply
-- carry a week of context and cost accordingly. Each key knows its own range.

begin;

create or replace function app.hq_set_setting(p_key text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_json jsonb;
  v_num  numeric;
begin
  if p_key not in (
    -- Where things live.
    'db.project_ref', 'db.region',
    'backup.s3_bucket', 'backup.s3_endpoint', 'backup.s3_region',
    -- Google, still settable so the setup card can write the client id.
    'google.client_id', 'google.redirect_uri', 'google.scopes',
    -- Integrations, on and off.
    'calendar.enabled', 'calendar.calendar_id',
    'notebook.enabled', 'knowledge.read_new_sources',
    -- Numbers Grant should be able to turn down without a deploy.
    'notebook.window_units', 'notebook.week_units', 'notebook.sync_interval_minutes',
    'agents.max_simultaneous_jobs', 'agents.max_delegation_depth',
    'agents.max_specialists_per_job', 'agents.max_live_specialists',
    'agents.max_investigations_per_project_per_day',
    'conversation.window_minutes', 'conversation.max_turns',
    'knowledge.new_source_jobs_per_hour', 'knowledge.new_source_min_chars',
    'ui.needs_me_cap', 'grant.timezone'
  ) then
    return jsonb_build_object('error', format('%L is not a setting this page may change', p_key));
  end if;

  -- Booleans stay booleans. 'false' as a STRING is truthy in every language
  -- that will read this, which is the kind of bug that turns an integration on.
  if p_key in ('calendar.enabled', 'notebook.enabled', 'knowledge.read_new_sources') then
    if lower(trim(p_value)) not in ('true', 'false') then
      return jsonb_build_object('error', 'that setting is on or off');
    end if;
    v_json := to_jsonb(lower(trim(p_value))::boolean);

  elsif p_key in (
    'notebook.window_units', 'notebook.week_units', 'notebook.sync_interval_minutes',
    'agents.max_simultaneous_jobs', 'agents.max_delegation_depth',
    'agents.max_specialists_per_job', 'agents.max_live_specialists',
    'agents.max_investigations_per_project_per_day',
    'conversation.window_minutes', 'conversation.max_turns',
    'knowledge.new_source_jobs_per_hour', 'knowledge.new_source_min_chars',
    'ui.needs_me_cap'
  ) then
    begin
      v_num := trim(p_value)::numeric;
    exception when others then
      return jsonb_build_object('error', 'that setting is a number');
    end;
    if v_num <> trunc(v_num) then
      return jsonb_build_object('error', 'that setting is a whole number');
    end if;
    -- Each key's own range. A wrong number here is not a rejected form, it is
    -- a system behaving oddly a day later.
    if v_num < 1 then
      return jsonb_build_object('error', 'that setting must be at least 1 — zero would stop the team');
    end if;
    if p_key like 'agents.max%' and v_num > 20 then
      return jsonb_build_object('error', 'that is high enough to be a runaway; 20 is the ceiling');
    end if;
    if p_key = 'conversation.window_minutes' and v_num > 240 then
      return jsonb_build_object(
        'error', 'over four hours of context would make every reply expensive; 240 is the ceiling');
    end if;
    if p_key = 'conversation.max_turns' and v_num > 40 then
      return jsonb_build_object('error', '40 turns is the ceiling — beyond it the question gets buried');
    end if;
    if p_key = 'notebook.sync_interval_minutes' and v_num < 5 then
      return jsonb_build_object('error', 'syncing more often than every five minutes achieves nothing');
    end if;
    v_json := to_jsonb(v_num::bigint);

  elsif p_key = 'grant.timezone' then
    -- Checked against Postgres's own list rather than a regex. A timezone that
    -- does not exist makes every date in the system silently UTC.
    if not exists (select 1 from pg_timezone_names where name = trim(p_value)) then
      return jsonb_build_object('error', format('%L is not a timezone Postgres knows', p_value));
    end if;
    v_json := to_jsonb(trim(p_value));

  else
    v_json := to_jsonb(trim(p_value));
  end if;

  insert into public.system_config (key, value, description)
  values (p_key, v_json, 'set from Team HQ')
  on conflict (key) do update set value = excluded.value;

  return jsonb_build_object('ok', true, 'key', p_key, 'value', v_json);
end;
$$;

commit;
