begin;

-- ---------------------------------------------------------------------------
-- 0924 - the MCP calendar tools call the calendar that actually exists (0897)
--
-- 0922 was written before 0897 and ASSUMED hq_event_list / hq_event_create / hq_event_update, which do not exist.
-- The real calendar (0897) is app.hq_project_events, app.hq_event_add, app.hq_event_update (public wrappers of the same
-- names). This migration replaces app.mcp_event_* and the public wrappers so that an external assistant creates,
-- changes and lists events THROUGH them, never beside them.
--
--   channel    chatgpt | claude (from mcp_clients.kind, 0920), 'external' for any other client. It is stored on the event
--              (project_events.origin_channel) and shown in Activity's entry text.
--   authority  always 'agent'. The calendar's sync then asks the approval policy (tool calendar.write, level 2) before
--              anything reaches Google; a person's own rows are unaffected. An update by an assistant also stamps the
--              row 'agent', so a person's event an assistant edited is held for approval like any other agent write.
--   door       app.via is set to the client's kind (as for tasks), so the events row 0897 appends reads
--              "via ChatGPT" / "via Claude" / "via External assistant" in Activity.
--
-- NOT added: delete. app.hq_event_delete HARD-DELETES an event that never reached Google (no tombstone, nothing to
-- restore); only a Google-linked event is tombstoned. "Nothing is deleted" (0922) is kept: an assistant cannot remove
-- an event.
--
-- Signatures change (create/update gain p_all_day; update's id is a uuid), so the old overloads are dropped by exact
-- signature first (CLAUDE.md: create or replace would leave a second, ambiguous overload).
-- app.mcp_event_call (the by-name dispatcher for the guessed contract) is dropped: nothing else calls it.
-- ---------------------------------------------------------------------------

drop function if exists public.mcp_event_list(uuid, text, timestamptz, timestamptz, integer);
drop function if exists public.mcp_event_create(uuid, text, text, text, timestamptz, timestamptz, text, text);
drop function if exists public.mcp_event_update(uuid, text, text, text, timestamptz, timestamptz, text, text);
drop function if exists app.mcp_event_list(uuid, text, timestamptz, timestamptz, integer);
drop function if exists app.mcp_event_create(uuid, text, text, text, timestamptz, timestamptz, text, text);
drop function if exists app.mcp_event_update(uuid, text, text, text, timestamptz, timestamptz, text, text);
drop function if exists app.mcp_event_call(text, jsonb);

-- The word 0897 stores as the event's origin channel: the client's kind, 'external' for anything else.
create or replace function app.mcp_event_channel(p_via text)
returns text
language sql
immutable
set search_path = ''
as $f$ select case p_via when 'chatgpt' then 'chatgpt' when 'claude' then 'claude' else 'external' end $f$;

create or replace function app.mcp_event_list(
  p_office uuid, p_project text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_from timestamptz := coalesce(p_from, app.now_utc());
  v_to timestamptz := coalesce(p_to, v_from + interval '90 days');
  v_scope text := 'project';
  v jsonb; v_total integer;
begin
  perform app.require_office(p_office);
  if nullif(btrim(coalesce(p_project, '')), '') is null then
    v_scope := 'all';   -- every ACTIVE, non-fixture project's events (0897); never the raw Google cache
  elsif app.mcp_project_id(p_office, p_project) is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;
  v := app.hq_project_events(p_office, nullif(btrim(coalesce(p_project, '')), ''),
                             v_from::text, v_to::text, v_scope);
  if v ? 'error' then return v; end if;
  v_total := jsonb_array_length(v -> 'events');
  return jsonb_build_object(
    'ok', true, 'scope', v_scope, 'project', v -> 'project', 'from', v -> 'from', 'to', v -> 'to',
    'total', v_total, 'truncated', v_total > v_limit,
    'events', coalesce((select jsonb_agg(e.value order by e.ord) from jsonb_array_elements(v -> 'events') with ordinality e(value, ord)
                         where e.ord <= v_limit), '[]'::jsonb));
end
$f$;

create or replace function app.mcp_event_create(
  p_office uuid, p_client_id text, p_project text, p_title text, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_all_day boolean default false, p_location text default null,
  p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare v_via text;
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  if app.mcp_project_id(p_office, p_project) is null then
    return jsonb_build_object('error', format('no active project with slug %L', p_project));
  end if;
  perform set_config('app.via', v_via, true);
  return app.hq_event_add(
    p_office => p_office, p_slug => btrim(p_project), p_title => p_title, p_starts_at => p_starts_at,
    p_ends_at => p_ends_at, p_all_day => coalesce(p_all_day, false), p_notes => p_notes, p_location => p_location,
    p_channel => app.mcp_event_channel(v_via), p_authority => 'agent');
end
$f$;

create or replace function app.mcp_event_update(
  p_office uuid, p_client_id text, p_event_id text, p_title text default null, p_starts_at timestamptz default null,
  p_ends_at timestamptz default null, p_all_day boolean default null, p_location text default null,
  p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare v_via text; v_id uuid;
begin
  v_via := app.mcp_write_client(p_office, p_client_id);
  if v_via is null then return jsonb_build_object('error', 'no such client, or it is read-only'); end if;
  begin v_id := btrim(coalesce(p_event_id, ''))::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not an event id (a Google-only event cannot be changed here)');
  end;
  -- the event must be this office's, native, live, and in an active non-fixture project
  if not exists (select 1 from public.project_events e
                   join public.projects p on p.project_id = e.project_id and p.office_id = e.office_id
                  where e.event_id = v_id and e.office_id = p_office and e.deleted_at is null
                    and p.status = 'active' and not p.is_fixture) then
    return jsonb_build_object('error', 'no such event');
  end if;
  if p_title is null and p_starts_at is null and p_ends_at is null and p_all_day is null
     and p_location is null and p_notes is null then
    return jsonb_build_object('error', 'nothing to change');
  end if;
  perform set_config('app.via', v_via, true);
  return app.hq_event_update(
    p_office => p_office, p_event => v_id, p_title => p_title, p_starts_at => p_starts_at, p_ends_at => p_ends_at,
    p_all_day => p_all_day, p_notes => p_notes, p_location => p_location,
    p_channel => app.mcp_event_channel(v_via), p_authority => 'agent');
end
$f$;

-- Calendar tools are served only where the real calendar's wrappers exist.
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
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hq_project_events')
    then out_ := array_append(out_, 'list_events'); end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hq_event_add')
    then out_ := array_append(out_, 'create_event'); end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hq_event_update')
    then out_ := array_append(out_, 'update_event'); end if;
  return to_jsonb(out_);
end
$f$;

create or replace function public.mcp_event_list(p_office uuid, p_project text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select app.mcp_event_list(p_office, p_project, p_from, p_to, p_limit) $f$;
create or replace function public.mcp_event_create(p_office uuid, p_client_id text, p_project text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz default null, p_all_day boolean default false, p_location text default null, p_notes text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_event_create(p_office, p_client_id, p_project, p_title, p_starts_at, p_ends_at, p_all_day, p_location, p_notes) $f$;
create or replace function public.mcp_event_update(p_office uuid, p_client_id text, p_event_id text, p_title text default null, p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_all_day boolean default null, p_location text default null, p_notes text default null)
returns jsonb language sql security definer set search_path = ''
as $f$ select app.mcp_event_update(p_office, p_client_id, p_event_id, p_title, p_starts_at, p_ends_at, p_all_day, p_location, p_notes) $f$;

commit;
