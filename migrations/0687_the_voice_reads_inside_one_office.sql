-- 0687 - the voice reads and answers inside one office (multi-user P3, wave 9).
--
-- The realtime session is minted with a briefing of the office's live state (voice_state) and answers "what is going on in
-- project X" from voice_lookup; a spoken question is answered from the command's own office (voice_answer). None of them had
-- an office: they described the whole deployment. Now the realtime door resolves the office from the caller's VERIFIED
-- LOGIN (speaker.office), voice_state / voice_lookup take it first with no default, and voice_answer - which is handed a
-- command the voice function has just written - reads the office off that command and keeps every query inside it.


create function app.voice_state(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return jsonb_build_object(
    'as_of', app.now_utc(),
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', p.name,
               'purpose', left(coalesce(p.purpose, p.description, ''), 200),
               -- 0169: originals. Claire told Grant a project had 33 documents
               -- when it had 12 things, because the office had imported its own
               -- output back in.
               'documents', (select count(*) from public.documents d
                              where d.office_id = p_office and d.project_id = p.project_id
                                and d.mirrors_document_id is null),
               'connected_to', (select coalesce(string_agg(distinct a.connector, ', '), 'nothing')
                                  from public.project_attachments a
                                 where a.project_id = p.project_id and a.enabled),
               'last_output', (select max(o.created_at)
                                 from public.outputs o
                                 join public.jobs j on j.job_id = o.job_id and j.office_id = p_office
                                where j.project_id = p.project_id))
             order by p.name), '[]'::jsonb)
        from public.projects p
       where p.office_id = p_office and p.status = 'active' and not p.is_fixture
    ),
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'title', s.title)
             order by s.name), '[]'::jsonb)
        from public.staff s where s.active
    ),
    'today', app.office_health(p_office, 24),
    'waiting_on_grant', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', left(n.requested_action, 160),
               'why', left(coalesce(n.why_needed, ''), 160),
               'project', pr.name,
               'work_goes_on', n.work_can_continue,
               'since', n.created_at) order by n.created_at), '[]'::jsonb)
        from app.needs_me_in(p_office) n
        left join public.projects pr on pr.project_id = n.project_id and pr.office_id = p_office
    ),
    'latest', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'who', coalesce(s.name, 'the office'),
               'project', pr.name,
               'headline', left(o.body, 220),
               'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
        from (select ob.* from public.outputs ob
                join public.jobs jb on jb.job_id = ob.job_id
               where jb.office_id = p_office and not jb.is_fixture
               order by ob.created_at desc limit 6) o
        left join public.staff s on s.staff_id = o.staff_id
        left join public.jobs j on j.job_id = o.job_id and j.office_id = p_office
        left join public.projects pr on pr.project_id = j.project_id and pr.office_id = p_office
    )
  );
end
$function$;

create function app.voice_lookup(p_office uuid, p_about text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_staff   text;
  v_said    text := coalesce(trim(p_about), '');
begin
  perform app.require_office(p_office);
  select s.slug into v_staff
    from public.staff s
   where s.active
     and (v_said ~* ('\m' || s.name || '\M') or v_said ~* ('\m' || s.slug || '\M'))
   order by length(s.name) desc
   limit 1;

  if v_staff is not null then
    return jsonb_build_object(
      'about', 'person',
      'who', (select jsonb_build_object('name', s.name, 'title', s.title,
                       'style', s.communication_style)
                from public.staff s where s.slug = v_staff),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'project', pr.name,
                 'headline', left(o.body, 400),
                 'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
          from (select o2.* from public.outputs o2
                  join public.staff s2 on s2.staff_id = o2.staff_id
                 where s2.slug = v_staff
                 order by o2.created_at desc limit 5) o
          left join public.jobs j on j.job_id = o.job_id and j.office_id = p_office
          left join public.projects pr on pr.project_id = j.project_id and pr.office_id = p_office
      ),
      'duties', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'what', r.description, 'every_minutes', r.period_minutes,
                 'on', r.enabled) order by r.slug), '[]'::jsonb)
          from public.responsibilities r
          join public.staff s on s.staff_id = r.staff_id
         where r.office_id = p_office and s.slug = v_staff
      )
    );
  end if;

  select r.project_id into v_project
    from app.resolve_project_by_name(p_office, v_said) r
   where r.confidence >= 0.55
   order by r.confidence desc
   limit 1;

  if v_project is not null then
    return jsonb_build_object(
      'about', 'project',
      'project', (
        select jsonb_build_object(
          'name', p.name, 'purpose', coalesce(p.purpose, p.description),
          'status', p.status,
          'connected_to', (select coalesce(jsonb_agg(jsonb_build_object(
                             'connector', a.connector, 'what', a.display_name,
                             'holds', a.artifact_kind) order by a.connector), '[]'::jsonb)
                             from public.project_attachments a
                            where a.project_id = p.project_id and a.enabled))
          from public.projects p where p.project_id = v_project and p.office_id = p_office
      ),
      'material', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'title', d.title, 'size', d.content_chars)
               order by d.content_chars desc), '[]'::jsonb)
          from (select * from public.documents
                 where office_id = p_office and project_id = v_project
                   and mirrors_document_id is null
                 order by content_chars desc limit 12) d
      ),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'who', coalesce(s.name, 'the office'),
                 'headline', left(o.body, 400),
                 'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
          from (select o2.* from public.outputs o2
                  join public.jobs j2 on j2.job_id = o2.job_id and j2.office_id = p_office
                 where j2.project_id = v_project
                 order by o2.created_at desc limit 5) o
          left join public.staff s on s.staff_id = o.staff_id
      ),
      'in_flight', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'kind', j.kind, 'status', j.state, 'since', j.created_at)
               order by j.created_at desc), '[]'::jsonb)
          from public.jobs j
         where j.office_id = p_office and j.project_id = v_project
           and j.state not in ('complete', 'failed', 'cancelled')
      )
    );
  end if;

  return jsonb_build_object('about', 'everything', 'state', app.voice_state(p_office));
end;
$function$;

create or replace function app.voice_answer(p_command_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  c record;
  g text;
  who text;
  said text;
  n integer;
  rows_text text;
  v_cal jsonb;
  v_age text;
begin
  select * into c from public.inbound_commands where command_id = p_command_id;
  if not found then
    return jsonb_build_object('error', 'no such command');
  end if;

  -- Everything below is read inside the office the COMMAND belongs to (it was written by the voice function a moment ago).
  perform app.require_office(c.office_id);
  said := coalesce(c.transcript, c.instruction, '');
  g := app.spoken_gist(said);
  if g = '' then
    return null;
  end if;

  if app.spoken_is_a_request(said) then
    return null;
  end if;

  -- --------------------------------------------------------------------
  -- "what have I got on today" / "am I free this afternoon"
  -- --------------------------------------------------------------------
  if g ~ '\m(calendar|diary|schedule|meetings?|agenda|got on|free|busy today|this week)\M' then
    v_cal := app.calendar_ahead(c.office_id, case when g ~ '\m(week|this week)\M' then 168 else 24 end);
    if (v_cal ->> 'enabled')::boolean is not true then
      return jsonb_build_object(
        'speak', 'The calendar is not connected yet. Settings, then Google, and there are '
                 'four steps.',
        'kind', 'state');
    end if;
    if (v_cal ->> 'as_of') is null then
      return jsonb_build_object(
        'speak', 'The calendar is connected but nothing has been read from it yet.',
        'kind', 'state');
    end if;
    -- The age, in the sentence. See the note above.
    v_age := case
      when (v_cal ->> 'as_of')::timestamptz > app.now_utc() - interval '90 minutes'
        then ''
      else format(' This is as of %s.',
                  to_char((v_cal ->> 'as_of')::timestamptz, 'FMDay FMHH12:MIam'))
    end;
    n := jsonb_array_length(v_cal -> 'events');
    if n = 0 then
      return jsonb_build_object(
        'speak', format('Nothing in the diary%s.%s',
                        case when g ~ '\mweek\M' then ' this week' else ' today' end, v_age),
        'kind', 'state');
    end if;
    select string_agg(
             format('%s%s',
                    coalesce(e ->> 'summary', 'an untitled entry'),
                    case when (e ->> 'all_day')::boolean then ' (all day)'
                         else to_char((e ->> 'starts_at')::timestamptz, ' at FMHH12:MIam') end),
             '; ' order by (e ->> 'starts_at')::timestamptz)
      into rows_text
      from jsonb_array_elements(v_cal -> 'events') e;
    return jsonb_build_object(
      'speak', format('%s %s: %s.%s', n,
                      case when n = 1 then 'thing' else 'things' end, rows_text, v_age),
      'kind', 'state');
  end if;

  if g ~ '\m(what|who|how)\M' and g ~ '\m(said|say|find|found|going on|about|doing|been up to|conclude|concluded|reported|report)\M' then
    who := app.spoken_about_whom(said);
    if who is not null then
      select left(o.body, 900) into rows_text
        from public.outputs o
        join public.jobs j on j.job_id = o.job_id
       where j.office_id = c.office_id and j.state = 'complete'
         and app.staff_behind_job(o.job_id) = who
       order by o.created_at desc
       limit 1;

      select s.name into said from public.staff s where s.slug = who;
      if rows_text is null then
        return jsonb_build_object(
          'speak', format('%s has not finished anything yet, so there is nothing to report.', said),
          'kind', 'state'
        );
      end if;
      return jsonb_build_object(
        'speak', format('%s, most recently: %s', said, rows_text),
        'kind', 'state'
      );
    end if;
  end if;

  if g ~ '\m(waiting|blocked|blocking|need from me|needs me|decide|decisions)\M' then
    select count(*)::integer into n from public.blockers where office_id = c.office_id and state = 'open';
    if n = 0 then
      return jsonb_build_object('speak', 'Nothing is waiting on you.', 'kind', 'state');
    end if;
    select string_agg(requested_action, '; ' order by created_at) into rows_text
      from (
        select requested_action, created_at from public.blockers
         where office_id = c.office_id and state = 'open' order by created_at limit 3
      ) b;
    return jsonb_build_object(
      'speak', format(
        '%s %s waiting on you. %s%s',
        n, case when n = 1 then 'thing is' else 'things are' end, rows_text,
        case when n > 3 then format(' And %s more.', n - 3) else '' end),
      'kind', 'state'
    );
  end if;

  if g ~ '\m(everyone|anyone|right now|in flight|in hand|working on|going on)\M'
     and g !~ '\m(said|find|found|conclude)\M' then
    select count(*)::integer into n from public.jobs
     where office_id = c.office_id and state in ('queued', 'running', 'waiting_external', 'output_created',
                     'quality_review', 'committing', 'committed', 'notifying', 'retrying');
    if n = 0 then
      return jsonb_build_object(
        'speak', 'Nothing is in hand at the moment. The queue is empty.', 'kind', 'state');
    end if;
    select string_agg(format('%s, %s', kind, state), '; ' order by created_at) into rows_text
      from (
        select kind, state::text as state, created_at from public.jobs
         where office_id = c.office_id and state in ('queued', 'running', 'waiting_external', 'output_created',
                         'quality_review', 'committing', 'committed', 'notifying', 'retrying')
         order by created_at limit 4
      ) j;
    return jsonb_build_object(
      'speak', format('%s %s in hand. %s', n,
                      case when n = 1 then 'thing is' else 'things are' end, rows_text),
      'kind', 'state'
    );
  end if;

  if g ~ '\m(projects?)\M' and g ~ '\m(what|which|how many|list|got|have)\M' then
    select count(*)::integer into n from public.projects where office_id = c.office_id and status = 'active';
    select string_agg(name, ', ' order by updated_at desc) into rows_text
      from public.projects where office_id = c.office_id and status = 'active';
    return jsonb_build_object(
      'speak', case
        when n = 0 then 'There are no active projects.'
        else format('%s active %s: %s.', n,
                    case when n = 1 then 'project' else 'projects' end, rows_text)
      end,
      'kind', 'state'
    );
  end if;

  if g ~ '\m(spent|spend|cost|costing|budget|allowance)\M' then
    select count(*)::integer into n from public.inference_usage
     where office_id = c.office_id and occurred_at > app.now_utc() - interval '24 hours';
    return jsonb_build_object(
      'speak', format(
        '%s model %s in the last day, costing %s dollars. On the notebook we have used %s of %s '
        'in the current window — that is our own count, not Google''s, because they publish '
        'no usage figure.',
        n, case when n = 1 then 'call' else 'calls' end,
        trim(to_char(coalesce((select sum(cost_usd) from public.inference_usage
                                where office_id = c.office_id and occurred_at > app.now_utc() - interval '24 hours'), 0),
                     'FM999990.0000')),
        coalesce((app.notebook_allowance(c.office_id) ->> 'window_spent'), '0'),
        coalesce((app.notebook_allowance(c.office_id) ->> 'window_ceiling'), 'unknown')),
      'kind', 'state'
    );
  end if;

  return null;
end;
$function$;

revoke all on function app.voice_state(uuid) from public, anon, authenticated, service_role;
revoke all on function app.voice_lookup(uuid, text) from public, anon, authenticated, service_role;

create function public.voice_state(p_office uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.voice_state(p_office) $f$;
create function public.voice_lookup(p_office uuid, p_about text) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.voice_lookup(p_office, p_about) $f$;
revoke all on function public.voice_state(uuid) from public, anon, authenticated;
grant execute on function public.voice_state(uuid) to service_role;
revoke all on function public.voice_lookup(uuid, text) from public, anon, authenticated;
grant execute on function public.voice_lookup(uuid, text) to service_role;

drop function public.voice_state();
drop function public.voice_lookup(text);
drop function app.voice_state();
drop function app.voice_lookup(text);
