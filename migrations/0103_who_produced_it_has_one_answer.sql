-- 0103 — "Who produced this" has one answer, and it is not `outputs.staff_id`
--
-- 0102's voice answer joined `outputs.staff_id` to find what a named person had
-- most recently concluded, and reported that Emma had never finished anything.
-- Emma has been convened for 110 jobs.
--
-- `outputs.staff_id` is null on all 586 rows. It has never been written. Slack
-- has always shown the right face because it reads somewhere else entirely:
-- `routing_decisions.roster[1]`, walked up the parent chain so a follow-up job
-- is still the same person continuing the same work (`src/channels/notify.ts`).
--
-- So there were two candidate answers to "who produced this" — one correct and
-- in use, one a null column that looked authoritative. This picks the one that
-- is true and makes the voice read exactly what Slack reads, because §31's
-- whole point is that the surface must not change the answer.
--
-- `outputs.staff_id` is left in place and left null. Dropping it is a bigger
-- change than this migration should make, and writing it would create the
-- second source of truth this migration exists to avoid. It is recorded in
-- `docs/known-problems.md` instead.

begin;

/**
 * The staff member behind a job, by the same rule Slack presents.
 *
 * Extracted rather than copied. The query already existed in TypeScript and
 * now has a second caller in SQL; two hand-written copies of "walk up the
 * lineage to the nearest routing decision" would be two things to keep in
 * step, and the one that drifted would be the one nobody was watching.
 */
create or replace function app.staff_behind_job(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with recursive lineage as (
    select job_id, parent_job_id, 0 as depth
      from public.jobs where job_id = p_job_id
    union all
    select j.job_id, j.parent_job_id, l.depth + 1
      from public.jobs j join lineage l on j.job_id = l.parent_job_id
     where l.depth < 8
  )
  select st.slug
    from lineage l
    join public.routing_decisions r on r.job_id = l.job_id
    join public.staff st on st.slug = r.roster[1]
   order by l.depth asc, r.decided_at desc
   limit 1
$$;

comment on function app.staff_behind_job is
  'Who a job belongs to, from routing_decisions.roster walked up the parent '
  'chain - the same rule src/channels/notify.ts uses to choose a face in '
  'Slack. NOT outputs.staff_id, which has never been written.';

grant execute on function app.staff_behind_job(uuid) to ai_team_app, service_role;

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

  if g ~ '\m(what|who|how)\M' and g ~ '\m(said|say|find|found|going on|about|doing|been up to|conclude|concluded|reported|report)\M' then
    who := app.spoken_about_whom(said);
    if who is not null then
      -- Attribution through `staff_behind_job`, which is what Slack reads.
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

  if g ~ '\m(everyone|anyone|right now|in flight|in hand|working on|busy|going on)\M'
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
        -- FM999990.0000, not FM999999.0000: the latter drops the leading zero
        -- and says "costing $.0000", which read aloud is not a number.
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
