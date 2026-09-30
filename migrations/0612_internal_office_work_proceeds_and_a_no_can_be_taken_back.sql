/*
  0612 - internal office work proceeds at the default dial; a remembered No can be seen

  Grant's decision, 30 September 2026: at `suggest`, genuinely internal level-1
  writes proceed without asking. Ordinary internal office work may proceed;
  consequential and outward effects still cross authorization.

  WHAT THIS CHANGES, exactly (inspected against production, not assumed):

    autonomy_policy   suggest x level 1     ask -> proceed
    tool_permissions  drive.ingest          level 1 -> 2

  The first is the decision. Level 1 holds nine tools; the enabled ones are
  document.create, draft.create, preference.update, task.create, task.extract,
  web.read and drive.ingest. Six are the office writing its own records. The
  seventh, drive.ingest, brings material IN from somebody else's system, and its
  question ("a file appearing is not an instruction, so I would rather ask than
  guess") is deliberate: it is not internal work merely because it lands in our
  tables. Left at level 1 it would silently stop asking, so it moves to level 2,
  where the matrix still answers ask at `suggest`. Nothing else changes for it:
  the only dial setting in production is the global `suggest`, and at `observe`
  level 1 and 2 both refuse, so the move is visible only at `act_with_review`,
  which no project uses.

  NOT changed, and pinned by scripts/isolated/authority.ts: every level-2 and
  level-3 cell; the outside-audience floor in app.authorize_effect (an outside
  audience can never proceed on its own, at any level); and the disabled level-1
  tools (note.create, gmail.draft), which are refused before the dial is read.

  A CONSEQUENCE worth saying out loud: with this cell changed, `suggest` and
  `act_with_review` resolve identically. The dial still has four settings and
  three different behaviours. What `act_with_review` should add (for example,
  letting a reviewed calendar write proceed) is a further decision for Grant, not
  made here.

  ALSO: app.active_refusals(), the Nos that are still being remembered, and the
  same list in app.hq_governance so the page can show each one with the press
  that takes it back (app.withdraw_refusal, 0611). Derived from the questions
  themselves; nothing is stored twice.
*/

update public.autonomy_policy
   set verdict = 'proceed',
       note = 'Internal office work happens without asking; anything that leaves the building still asks.'
 where autonomy = 'suggest' and action_level = 1;

update public.tool_permissions
   set level = 2
 where tool = 'drive.ingest' and level = 1;

create or replace function app.active_refusals(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with days as (
    select coalesce((select (value #>> '{}')::integer from public.system_config
                      where key = 'approval.refusal_days'), 30) as d),
  latest as (
    select distinct on (coalesce(b.action_fingerprint, 'tool:' || b.standing_tool || ':' || coalesce(b.project_id::text, '')))
           b.*
      from public.blockers b
     where b.state = 'resolved' and b.answered_option is not null
       and (b.action_fingerprint is not null or b.standing_tool is not null)
     order by coalesce(b.action_fingerprint, 'tool:' || b.standing_tool || ':' || coalesce(b.project_id::text, '')),
              b.resolved_at desc)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.blocker_id,
           'what', l.requested_action,
           'project', (select p.name from public.projects p where p.project_id = l.project_id),
           'declined_at', l.resolved_at,
           'until', l.resolved_at + make_interval(days => (select d from days)),
           'by', l.answered_by)
         order by l.resolved_at desc), '[]'::jsonb)
    from (select * from latest l0
           where l0.answered_option = l0.decline_option
             and l0.refusal_withdrawn_at is null
             and l0.resolved_at > app.now_utc() - make_interval(days => (select d from days))
             and not (l0.job_id is not null and app.harness_job(l0.job_id))
           order by l0.resolved_at desc
           limit p_limit) l
$$;

revoke all on function app.active_refusals(integer) from public;
grant execute on function app.active_refusals(integer) to ai_team_app, service_role;

-- ---- app.hq_governance, spliced from the live definition ----
CREATE OR REPLACE FUNCTION app.hq_governance(p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'at', app.now_utc(),

    -- 0612: the Nos the office is remembering, each with the press that takes it back.
    'refusals', app.active_refusals(),

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
        from (select * from public.lessons_live where not is_fixture order by created_at desc
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
           where not app.harness_proposal(staff_slug, needed) and (state = 'open'
              or decided_at > app.now_utc() - interval '30 days')
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
               'offer', s.offer_kind,
               'project', p.name,
               'at', s.raised_at
             ) order by (s.state = 'open') desc, s.weight desc, s.raised_at desc),
             '[]'::jsonb)
        from (select * from public.suggestions g
               where not app.harness_suggestion(g.offer_args)
               order by (g.state = 'open') desc, g.weight desc, g.raised_at desc
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
    /*
      What it is ASKING FOR (#272, and ADR-0018's missing half).

      `tool_requests` has held rows since ADR-0018 and `public.hq_approve_tool`
      and `public.hq_decline_tool` have existed beside it the whole time. Both
      were in `check:callers`' baseline, which is to say the office could ask
      Grant for a capability and Grant had nowhere to answer -- the approvals
      on record were all made by a script. CLAUDE.md's standing complaint, word
      for word: a capability that exists only as a script an agent runs is a
      capability Grant does not have.

      Open first, then whatever settled in the last thirty days, because a
      decline has to be durable to be worth anything (#49) and one that
      vanishes is one he cannot remember making. `because` is JSONB holding
      counts, not a sentence -- the page renders it as chips, never as text.
    */
    'requests', (
      select coalesce(jsonb_agg(q.v order by q.ord, q.at desc), '[]'::jsonb)
        from (
          select case r.state when 'open' then 0 else 1 end as ord,
                 r.raised_at as at,
                 jsonb_build_object(
                   'id', r.request_id,
                   'tool', r.tool,
                   'who', r.asked_by,
                   'who_name', coalesce(s.name, r.asked_by),
                   'what_for', r.what_for,
                   'because', coalesce(r.because, '{}'::jsonb),
                   'state', r.state,
                   'declines', coalesce(r.declines, 0),
                   'at', r.raised_at,
                   'settled', r.settled_at,
                   'reason', nullif(r.decline_reason, '')) as v
            from public.tool_requests r
            left join public.staff s on s.slug = r.asked_by
           where r.state = 'open'
              or r.settled_at > app.now_utc() - interval '30 days'
           order by 1, 2 desc
           limit p_limit
        ) q
    ),

    /*
      Work whose only exit is a person noticing (#272, #211).

      Folded into this payload rather than given its own section: it is the
      same screen and the same question — what is the office unable to finish
      — so a second request would be a second round trip for one number.
    */
    'stranded', app.hq_stranded_work(),

    /*
      How the office is scoring against Grant's own judgement (#272).

      `eval_latest` has existed since the evaluator did and nothing has ever
      shown it, so the one number that says whether the office is getting
      better or worse lived where only a script could see it.
    */
    'scoring', app.eval_latest(),

    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', s.slug,
               'name', s.name,
               'remit', s.title,
               'expertise', coalesce(s.expertise, array[]::text[]),
               'tools', (select count(*)::int from public.staff_tools t
                          where t.staff_slug = s.slug),
               /*
                 The tool NAMES, from the same join the count above uses.

                 Not from app.what_i_can_do, which computed the same thing a
                 second time and which 0452 drops: capabilityBrief in
                 TypeScript is the live answer to "what can this agent do"
                 because it builds every prompt, and a page reading an
                 independent second implementation is two lists that will
                 disagree. One source, two readers.
               */
               'can', (select coalesce(jsonb_agg(t.tool order by t.tool), '[]'::jsonb)
                         from public.staff_tools t where t.staff_slug = s.slug),
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
$function$;
