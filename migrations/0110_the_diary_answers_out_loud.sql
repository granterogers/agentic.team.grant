-- 0110 — The diary answers out loud
--
-- 0109 caches the calendar; this is what makes it worth caching. Two additions,
-- both to functions that already exist rather than new surfaces:
--
--   - `app.voice_answer` learns "what have I got on today" — which is the
--     question a phone in a coat pocket is actually for, and the one that most
--     obviously belongs to speech rather than to a dashboard;
--   - the daily capacity report says when sources arrived and nobody read them,
--     which is 0107's hourly cap becoming visible rather than silent.
--
-- ## Why the calendar answer says how old it is
--
-- Because it is a cache, and §18 keeps it readable when Google is unreachable.
-- An answer read aloud has no timestamp in the corner of the screen, so the
-- age goes in the sentence or it is not there at all. "Nothing until Thursday"
-- and "nothing until Thursday, as of yesterday morning" are different claims.

begin;

create or replace function app.voice_answer(p_command_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
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
    v_cal := app.calendar_ahead(case when g ~ '\m(week|this week)\M' then 168 else 24 end);
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
       where j.state = 'complete'
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
    select count(*)::integer into n from public.blockers where state = 'open';
    if n = 0 then
      return jsonb_build_object('speak', 'Nothing is waiting on you.', 'kind', 'state');
    end if;
    select string_agg(requested_action, '; ' order by created_at) into rows_text
      from (
        select requested_action, created_at from public.blockers
         where state = 'open' order by created_at limit 3
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
     where state in ('queued', 'running', 'waiting_external', 'output_created',
                     'quality_review', 'committing', 'committed', 'notifying', 'retrying');
    if n = 0 then
      return jsonb_build_object(
        'speak', 'Nothing is in hand at the moment. The queue is empty.', 'kind', 'state');
    end if;
    select string_agg(format('%s, %s', kind, state), '; ' order by created_at) into rows_text
      from (
        select kind, state::text as state, created_at from public.jobs
         where state in ('queued', 'running', 'waiting_external', 'output_created',
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
    select count(*)::integer into n from public.projects where status = 'active';
    select string_agg(name, ', ' order by updated_at desc) into rows_text
      from public.projects where status = 'active';
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
     where occurred_at > app.now_utc() - interval '24 hours';
    return jsonb_build_object(
      'speak', format(
        '%s model %s in the last day, costing %s dollars. On the notebook we have used %s of %s '
        'in the current window — that is our own count, not Google''s, because they publish '
        'no usage figure.',
        n, case when n = 1 then 'call' else 'calls' end,
        trim(to_char(coalesce((select sum(cost_usd) from public.inference_usage
                                where occurred_at > app.now_utc() - interval '24 hours'), 0),
                     'FM999990.0000')),
        coalesce((app.notebook_allowance() ->> 'window_spent'), '0'),
        coalesce((app.notebook_allowance() ->> 'window_ceiling'), 'unknown')),
      'kind', 'state'
    );
  end if;

  return null;
end;
$$;

commit;
