-- 0102 — The team can be spoken to
--
-- §22's scenario A: *"Grant opens Team HQ on iPhone, presses **Talk to Team**,
-- asks 'what was Research going on about?' → Chief of Staff explains from real
-- state → 'bring Finance in' → Finance responds → 'do what you think is best
-- and let me know' → work continues autonomously."*
--
-- And §22 B: *"the semantically equivalent instruction through Voice must use
-- the same canonical command layer, same project state, same orchestration,
-- same tools, same persistence and same quality controls."*
--
-- Grant, asked whether §12's "optional premium" or §22's completion criterion
-- wins: **"Voice is required."**
--
-- ## The problem this function exists to solve
--
-- §5 is a hard boundary: *"Channel adapters may only translate. They may never
-- decide."* Every other surface obeys it the easy way — a message becomes an
-- `inbound_commands` row, `enqueue_inbound` makes a job, a worker decides, and
-- the answer comes back minutes later. Minutes is fine in a chat.
--
-- It is not fine in a conversation. Speech needs an answer in about two
-- seconds, and there is no always-on worker to give one (ADR-0001, and the
-- scheduled worker runs every five minutes).
--
-- The tempting shortcut is to let the voice endpoint answer for itself: load
-- some state, call a model, speak. That is an adapter deciding, and it is the
-- exact thing §5 forbids — it would also be a second implementation of
-- routing, retrieval and the quality gate, and the first one to drift would be
-- the one nobody was watching.
--
-- So the decision lives HERE, in the canonical layer, and the adapter only
-- asks. `app.voice_answer` looks at what was said and returns either:
--
--   - a spoken reply assembled from real rows, when the question is about
--     state this database already knows; or
--   - null, meaning "this is work" — at which point the adapter does what
--     Telegram does: `enqueue_inbound`, and the answer arrives later on the
--     surface the team normally uses.
--
-- ## Why the reply is assembled and not generated
--
-- Same reason `narrate.ts` renders `#the-floor` clause by clause from the row
-- rather than asking a model to summarise it: an unconfident reading smoothed
-- into a confident one is worse than no reading. Spoken, it is worse still —
-- there is no scrollback, and a number said out loud with no provenance is a
-- number Grant will repeat to somebody.
--
-- Every sentence below therefore comes from a count or a stored body, and the
-- one estimate it can mention says whose estimate it is.
--
-- ## What it deliberately cannot answer
--
-- Anything not in the shapes below. Null is not a failure: it is the honest
-- boundary between "I can tell you that from what I have" and "that is work,
-- and work goes through the team". A model here would answer everything, and
-- most of those answers would be invented.

begin;

/**
 * What was said, normalised for matching. Lower case, punctuation gone,
 * whitespace collapsed — because speech recognition punctuates unpredictably
 * and "What was research going on about?" and "what was Research going on
 * about" are the same question.
 */
create or replace function app.spoken_gist(p_said text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(lower(coalesce(p_said, '')), '[^a-z0-9 ]+', ' ', 'g'),
           '\s+', ' ', 'g')
$$;

/**
 * The staff member a question is about, or null.
 *
 * Matched on first name AND on the discipline word, because Grant says both —
 * "what was Research going on about" and "what did Emma find" are the same
 * question, and §9's roster is the only place that mapping should live.
 */
create or replace function app.spoken_about_whom(p_said text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with gist as (select app.spoken_gist(p_said) as g)
  select s.slug
    from public.staff s, gist
   where s.active
     and s.slug not like 'fixture-%'
     and (
       gist.g ~ ('\m' || lower(s.name) || '\M')
       -- The discipline from the slug: 'research-director' matches "research".
       or gist.g ~ ('\m' || lower(split_part(s.slug, '-', 1)) || '\M')
     )
   -- A named person beats a discipline, so "what did Emma in research say"
   -- resolves to Emma once rather than ambiguously.
   order by case when gist.g ~ ('\m' || lower(s.name) || '\M') then 0 else 1 end
   limit 1
$$;

/**
 * A spoken answer from real state, or null when this is work rather than a
 * question.
 *
 * Takes the command id rather than the text, so it reads the same row the
 * adapter persisted — there is one canonical record of what was said, and this
 * function cannot be handed something different from what was stored.
 */
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

  -- --------------------------------------------------------------------
  -- "what was Research going on about" / "what did Emma find"
  -- --------------------------------------------------------------------
  --
  -- The output BODY, not a summary of it. It was already reviewed by Quality
  -- before it committed (§10), so it is the sentence the team stands behind;
  -- re-describing it here would put an unreviewed sentence in its place.
  if g ~ '\m(what|who|how)\M' and g ~ '\m(said|say|find|found|going on|about|doing|been up to|conclude|concluded|reported|report)\M' then
    who := app.spoken_about_whom(said);
    if who is not null then
      select left(o.body, 900), s.name into rows_text, said
        from public.outputs o
        join public.staff s on s.staff_id = o.staff_id
        join public.jobs j on j.job_id = o.job_id
       where s.slug = who and j.state = 'complete'
       order by o.created_at desc
       limit 1;

      if rows_text is null then
        select s.name into said from public.staff s where s.slug = who;
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

  -- --------------------------------------------------------------------
  -- "what is waiting on me" / "what do you need from me"
  -- --------------------------------------------------------------------
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

  -- --------------------------------------------------------------------
  -- "what is everyone doing" / "what is going on right now"
  -- --------------------------------------------------------------------
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

  -- --------------------------------------------------------------------
  -- "what projects have we got"
  -- --------------------------------------------------------------------
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

  -- --------------------------------------------------------------------
  -- "what have we spent"
  -- --------------------------------------------------------------------
  if g ~ '\m(spent|spend|cost|costing|budget|allowance)\M' then
    select count(*)::integer into n from public.inference_usage
     where occurred_at > app.now_utc() - interval '24 hours';
    return jsonb_build_object(
      'speak', format(
        '%s model %s in the last day, costing $%s. On the notebook we have used %s of %s '
        'in the current window — that is our own count, not Google''s, because they publish '
        'no usage figure.',
        n, case when n = 1 then 'call' else 'calls' end,
        to_char(coalesce((select sum(cost_usd) from public.inference_usage
                           where occurred_at > app.now_utc() - interval '24 hours'), 0),
                'FM999999.0000'),
        coalesce((app.notebook_allowance() ->> 'window_spent'), '0'),
        coalesce((app.notebook_allowance() ->> 'window_ceiling'), 'unknown')),
      'kind', 'state'
    );
  end if;

  -- Not a question this database can answer from its own rows. Null, and the
  -- adapter puts it to the team — which is the right outcome for an
  -- instruction and an honest one for a question nobody here can answer.
  return null;
end;
$$;

comment on function app.voice_answer is
  'A spoken answer assembled from real rows, or null meaning "this is work". '
  'Lives in the canonical layer because §5 forbids a channel adapter from '
  'deciding anything, and answering is a decision.';

grant execute on function app.spoken_gist(text) to ai_team_app, service_role;
grant execute on function app.spoken_about_whom(text) to ai_team_app, service_role;
grant execute on function app.voice_answer(uuid) to ai_team_app, service_role;

create or replace function public.voice_answer(p_command_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.voice_answer(p_command_id) $$;

revoke all on function public.voice_answer(uuid) from public;
grant execute on function public.voice_answer(uuid) to service_role;

commit;
