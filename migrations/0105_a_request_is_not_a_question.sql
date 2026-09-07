-- 0105 — "Have a look at" is not a question
--
-- Spoken to the live endpoint: *"have a look at whether we should be worried
-- about the notebook allowance."* `voice_answer` matched on the word
-- "allowance", read out the current numbers, and did not put it to the team.
--
-- The numbers were right. The response was wrong: he asked for a judgement and
-- got a meter reading, and — worse — nothing was queued, so nobody was ever
-- going to form the judgement.
--
-- ## The rule
--
-- An utterance that ASKS FOR SOMETHING TO BE DONE is work, whatever nouns it
-- contains. The state matchers below run only after that question is settled,
-- so "what is the allowance" reads the meter and "have a look at the allowance"
-- reaches Emma.
--
-- ## Which way to err
--
-- Toward delegating. A question sent to the team comes back as an answer a few
-- minutes later; work mistaken for a question is never done at all and Grant
-- has been told something instead. The costs are not symmetric, so the
-- imperative list wins ties.

begin;

/**
 * True when what was said is a request for work rather than a question.
 *
 * Phrases, not a classifier. A model here would be a decision made by
 * something that cannot be reviewed in a diff, and the failure mode is silent:
 * every borderline utterance answered confidently and none of them done.
 */
create or replace function app.spoken_is_a_request(p_said text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.spoken_gist(p_said) ~
    ('\m('
     -- Asking for work outright.
     || 'have a look|take a look|look into|look at|dig into|find out|work out|'
     || 'figure out|work up|put together|draft|write|draw up|make me|build|'
     || 'research|investigate|check whether|see whether|see if|'
     -- Asking a person or the team.
     || 'ask |get \w+ to|bring \w+ in|tell \w+ to|have \w+ look|'
     -- Delegating judgement, which §22 names explicitly: "do what you think is
     -- best and let me know".
     || 'do what you think|your call|use your judgement|use your judgment|'
     || 'go ahead and|carry on and|sort out|deal with|handle'
     || ')\M')
$$;

comment on function app.spoken_is_a_request is
  'Whether an utterance asks for work rather than for a fact. Checked before '
  'the state matchers, and deliberately eager: work mistaken for a question is '
  'never done at all, while a question sent to the team comes back answered.';

grant execute on function app.spoken_is_a_request(text) to ai_team_app, service_role;

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

  -- Settled first, before any noun is looked at. This is the whole of 0105.
  if app.spoken_is_a_request(said) then
    return null;
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
