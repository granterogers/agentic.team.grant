begin;

/**
 * The records a standard-format export needs, for ONE project, inside ONE office.
 *
 * Workstream C1 (issue #470). `app.project_export` already packages a project as one JSON document; this is the
 * per-category read the standard serialisers in src/portability/formats.ts consume: contacts (vCard), calendar events
 * (iCalendar) and tasks (CSV or JSON). It returns the field names those serialisers read and nothing else, so an
 * internal column (is_fixture, office_id, an external etag) cannot reach a file a person downloads.
 *
 * ## Scope
 *
 * The project is resolved once, inside the office. A project in another office, and a project that does not exist,
 * both return null, which the gateway reports as not found. The rule is the same as app.project_export's.
 *
 * Calendar events come from two places, and the function says which:
 *   - public.project_events: events the project OWNS, created in Team HQ or elsewhere. Their calendar is
 *     'agentic-team', because a native event has no Google calendar of its own until it is synced.
 *   - Google events Grant filed to the project (public.calendar_event_projects), read from the cache. A native event
 *     that was synced to Google is also a cache row, so the cache copy is dropped to keep one event one line.
 *
 * ## Shape
 *
 *   { "project": slug, "name": name, "zone": offices.timezone,
 *     "records": [ ... one object per row, keyed by the serialiser's field names ... ] }
 *
 * `zone` is returned for events: all-day events are cut in the office's zone, not UTC (see formats.ts).
 */

create or replace function app.project_records(p_office uuid, p_project_id uuid, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_slug text;
  v_name text;
  v_zone text;
  v_rows jsonb;
begin
  perform app.require_office(p_office);

  select p.slug, p.name into v_slug, v_name
    from public.projects p
   where p.project_id = p_project_id and p.office_id = p_office;
  if not found then
    return null;
  end if;

  select o.timezone into v_zone from public.offices o where o.office_id = p_office;

  if p_kind = 'contacts' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'contact_id', c.contact_id,
             'kind', c.kind,
             'name', c.name,
             'role', c.role,
             'org', c.org,
             'stage', c.stage,
             'email', c.email,
             'phone', c.phone,
             'instagram', c.instagram,
             'website', c.website,
             'where', c."where",
             'note', c.note,
             'next', c.next,
             'next_due', c.next_due,
             'last_at', c.last_at,
             'updated_at', c.updated_at
           ) order by c.name, c.contact_id), '[]'::jsonb)
      into v_rows
      from public.contacts c
     where c.project_id = p_project_id;

  elsif p_kind = 'tasks' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'task_id', t.task_id,
             'title', t.title,
             'detail', t.detail,
             'state', t.state,
             'blocked_on', t.blocked_on,
             'due_on', t.due_on,
             'starts_on', t.starts_on,
             'priority', t.priority,
             'is_milestone', t.is_milestone,
             'parent_task_id', t.parent_task_id,
             'assigned_to_human', t.assigned_to_human,
             'added_by', t.added_by,
             'created_at', t.created_at,
             'updated_at', t.updated_at,
             'done_at', t.done_at
           ) order by t.created_at, t.task_id), '[]'::jsonb)
      into v_rows
      from public.tasks t
     where t.project_id = p_project_id
       and t.office_id = p_office;

  elsif p_kind = 'events' then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.starts_at, e.event_id), '[]'::jsonb)
      into v_rows
      from (
        select 'agentic-team'::text as calendar_id,
               pe.event_id::text as event_id,
               pe.title as summary,
               pe.notes as excerpt,
               pe.location,
               pe.starts_at,
               pe.ends_at,
               pe.all_day,
               'confirmed'::text as status,
               null::text as html_link,
               null::timestamptz as remote_updated_at
          from public.project_events pe
         where pe.project_id = p_project_id
           and pe.office_id = p_office
           and pe.deleted_at is null
        union all
        select cep.calendar_id,
               cep.event_id,
               ce.summary,
               ce.excerpt,
               ce.location,
               ce.starts_at,
               ce.ends_at,
               ce.all_day,
               ce.status,
               ce.html_link,
               ce.remote_updated_at
          from public.calendar_event_projects cep
          join public.calendar_events ce
            on ce.calendar_id = cep.calendar_id
           and ce.event_id = cep.event_id
           and ce.office_id = cep.office_id
         where cep.project_id = p_project_id
           and cep.office_id = p_office
           and not exists (
             select 1 from public.project_events pe2
              where pe2.external_calendar_id = cep.calendar_id
                and pe2.external_event_id = cep.event_id
                and pe2.deleted_at is null
           )
      ) e;

  else
    raise exception 'unknown export kind: %', p_kind using errcode = '22023';
  end if;

  return jsonb_build_object(
    'project', v_slug,
    'name', v_name,
    'zone', v_zone,
    'records', v_rows
  );
end
$function$;

-- The function is reached only through the public wrapper below, which the gateway calls with the service key.
revoke all on function app.project_records(uuid, uuid, text) from public;

create or replace function public.project_records(p_office uuid, p_project_id uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$ select app.project_records(p_office, p_project_id, p_kind) $$;

revoke all on function public.project_records(uuid, uuid, text) from public;
revoke all on function public.project_records(uuid, uuid, text) from anon, authenticated;
grant execute on function public.project_records(uuid, uuid, text) to service_role;

comment on function public.project_records(uuid, uuid, text) is
  'Per-category records of one project for a standard-format export (contacts, events, tasks). Office-scoped; null when the project is not in the office.';

commit;
