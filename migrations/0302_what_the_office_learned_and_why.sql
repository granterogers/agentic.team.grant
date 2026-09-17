-- 0302 — what the office learned, and why it changed
--
-- Issue #54, *"the thing that makes the rest trustworthy rather than
-- unnerving"*:
--
--   > *behaviour changes for reasons that exist only in a table. An agent will
--   > answer differently this week than last, and the only explanation will be
--   > a row nobody surfaced. That is worse than no learning: it removes Grant's
--   > ability to tell a system that is getting better from one that is
--   > drifting.*
--
-- Four questions, one payload — what has it learned, what does it want, what
-- did it notice, and what can each agent actually do.
--
-- ## The retraction, which is the one that makes it governance
--
--   > *A lesson that cannot be retracted is a rule he never agreed to.*
--
-- `lessons` is append-only by §6 and already has a `retraction` row kind with
-- thirty-five of them on record — so retracting is INSERTING a row that
-- supersedes, and `lessons_live` stops returning the original. What was missing
-- is a function to do it: today the only way is hand-written SQL, which is not
-- a thing Grant has.
--
-- ## The failed attempts are the most useful list on the page
--
-- #54 says so directly, and it is right: a roster of what each agent CAN do is
-- reassuring and mostly guessable. What it has tried and could not do is the
-- part nobody can guess, and it is already recorded — `job_impediments`, typed
-- by #47, counted by `impediments_tally`.
--
-- ## Reads only
--
-- Nothing here decides anything. The page approves and declines through
-- `app.decide_proposal` (0295) and retracts through the function below; this
-- assembles what to show.

begin;

/**
 * Withdraw a lesson.
 *
 * A retraction is a ROW, not a delete — `lessons` is append-only by §6, and
 * the history is the point: "we stopped believing this on Tuesday, and here is
 * why" is a different and more useful record than the lesson never having
 * existed.
 *
 * `lessons_live` excludes anything superseded, so the retraction takes effect
 * immediately for every reader without any of them knowing this exists.
 */
create or replace function app.retract_lesson(
  p_lesson_id uuid,
  p_why       text default null,
  p_by        text default 'grant'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  l    public.lessons%rowtype;
  v_id uuid;
begin
  select * into l from public.lessons where lesson_id = p_lesson_id;
  if not found then
    return jsonb_build_object('error', 'there is no such lesson');
  end if;
  if l.row_kind <> 'lesson' then
    return jsonb_build_object('error', 'that is a retraction, not a lesson');
  end if;
  if exists (select 1 from public.lessons where supersedes = p_lesson_id) then
    -- Not an error. Two open tabs produce this, and the honest answer is that
    -- it is already gone rather than a failure.
    return jsonb_build_object('ok', false, 'already', true);
  end if;

  insert into public.lessons
    (row_kind, scope, project_id, staff_slug, job_kind, body, learned_by,
     confidence, supersedes)
  values ('retraction', l.scope, l.project_id, l.staff_slug, l.job_kind,
          coalesce(nullif(btrim(coalesce(p_why, '')), ''),
                   format('Retracted by %s.', p_by)),
          p_by, l.confidence, p_lesson_id)
  returning lesson_id into v_id;

  return jsonb_build_object('ok', true, 'retraction', v_id, 'retracted', p_lesson_id);
end;
$$;

create or replace function public.retract_lesson(
  p_lesson_id uuid, p_why text default null, p_by text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.retract_lesson(p_lesson_id, p_why, p_by) $$;

-- ---------------------------------------------------------------------------
-- The page's payload
-- ---------------------------------------------------------------------------

/**
 * Everything Grant needs to govern the team, in one call.
 *
 * One call rather than four, for the reason 0120 gave about the tool
 * catalogue: a page that fetches per section feels broken while being correct.
 */
create or replace function app.hq_governance(p_limit int default 40)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'at', app.now_utc(),

    /*
      What it learned. Scoped, traceable to the job that learned it, and
      retractable — #54's first box, all four parts, because a lesson you
      cannot place is one you cannot judge.
    */
    'lessons', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.lesson_id,
               'body', l.body,
               'scope', l.scope::text,
               'where', coalesce(p.name, l.staff_slug, l.job_kind, 'everywhere'),
               'who', l.learned_by,
               'job', l.from_job,
               'seen', l.observations,
               'at', l.created_at
             ) order by l.created_at desc), '[]'::jsonb)
        from (select * from public.lessons_live order by created_at desc
               limit greatest(coalesce(p_limit, 40), 1)) l
        left join public.projects p on p.project_id = l.project_id
    ),

    /*
      What it wants (#49). Open first, then recently settled — a decline that
      vanishes from the page is a decline Grant cannot remember making, and
      the whole value of the row is that it is durable.
    */
    'proposals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.proposal_id,
               'who', r.staff_slug,
               'title', r.title,
               'remedy', r.remedy,
               'argument', r.argument,
               'cost', nullif(r.cost_note, ''),
               'state', r.state,
               'times', r.times_seen,
               'decided', r.decided_at,
               'note', r.decided_note
             ) order by (r.state = 'open') desc, r.times_seen desc, r.last_seen desc),
             '[]'::jsonb)
        from (
          select * from public.proposals
           where state = 'open'
              or decided_at > app.now_utc() - interval '30 days'
           order by (state = 'open') desc, times_seen desc
           limit greatest(coalesce(p_limit, 40), 1)
        ) r
    ),

    /*
      What it noticed (#52), and what became of it. `dismissals` matters as
      much as the suggestion: a thing offered four times and dismissed four
      times is the office failing to take a hint.
    */
    'noticed', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.suggestion_id,
               'kind', s.kind,
               'body', s.body,
               'because', s.because,
               'weight', s.weight,
               'state', s.state,
               'dismissed', s.dismissals,
               'project', p.name,
               'at', s.raised_at
             ) order by (s.state = 'open') desc, s.weight desc, s.raised_at desc),
             '[]'::jsonb)
        from (select * from public.suggestions
               order by (state = 'open') desc, weight desc, raised_at desc
               limit greatest(coalesce(p_limit, 40), 1)) s
        left join public.projects p on p.project_id = s.project_id
    ),

    /*
      What each agent can actually do — and, #54's own judgement, the most
      useful list on the page: what it has TRIED and could not do.

      Not the whole capability index per agent: that is eight copies of a
      mostly identical structure and would be the largest payload the studio
      fetches. The remit, the count of tools held, and the walls hit.
    */
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', s.slug,
               'name', s.name,
               'remit', s.title,
               'expertise', coalesce(s.expertise, array[]::text[]),
               'tools', (select count(*)::int from public.staff_tools t
                          where t.staff_slug = s.slug),
               'tried_and_could_not', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'kind', i.kind, 'needed', i.needed, 'times', i.times)
                        order by i.times desc), '[]'::jsonb)
                   from app.impediments_tally(90, 1, false) i
                  where i.staff_slug = s.slug
               )
             ) order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name),
             '[]'::jsonb)
        from public.staff s where s.active and s.slug not like 'fixture-%'
    )
  )
$$;

create or replace function public.hq_governance(p_limit int default 40)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_governance(p_limit) $$;

grant execute on function app.retract_lesson(uuid, text, text) to ai_team_app;
grant execute on function public.retract_lesson(uuid, text, text) to ai_team_app;
grant execute on function app.hq_governance(int) to ai_team_app;
grant execute on function public.hq_governance(int) to ai_team_app;

commit;
