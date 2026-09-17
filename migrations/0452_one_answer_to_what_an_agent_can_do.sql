-- Three more capabilities with no caller, decided one at a time (#272).
--
-- The mandate's rule is that each one is either a missing production caller, a
-- dead thing to remove, or something internal that should say so — and *"do
-- not mechanically connect functions merely to satisfy check:callers"*. So:
--
-- ## `what_i_can_do` — a SECOND answer to a question already answered
--
-- It returns an agent's tools and channel facts. Nothing calls it: not the
-- page, not a script, not the prompt builder. `capabilityBrief` in
-- `src/agents/capability.ts` is the live implementation — it reads
-- `tool_permissions` and builds EVERY prompt — so this was a duplicate
-- concept, and the dangerous kind: a page reading an independently computed
-- second list would eventually disagree with what the agents were told.
--
-- Dropped, both halves. The Governance page gains the tool NAMES instead,
-- from the same `staff_tools` join that already produces the count beside
-- them, so there is one source and two readers rather than two sources.
--
-- ## `public.hq_output_shapes` — a mouth with nothing to feed
--
-- `public.output_shapes` has six rows and one mention in the whole repository,
-- in a COMMENT. The wrapper exposes a registry nothing reads. The table and
-- the app function stay, because 0298's rule is that a listed gap can become
-- a proposal and a deleted one cannot; the PostgREST mouth goes, because a
-- door to a room nobody enters is not a feature.
--
-- ## `public.containers_stored_as_documents` — kept, and given its caller
--
-- This one is genuinely useful and was simply never wired: it names documents
-- that are really containers, which is data hygiene, and `npm run check:leaks`
-- is the sweep Grant already runs for exactly that. Wired there in the same
-- commit rather than dropped.
--
-- `app.channel_for` stays in the baseline with its reason recorded: it is the
-- per-discipline channel lookup for a feature nobody has built yet. Neither
-- dead nor reachable, and saying so is more honest than either.

CREATE OR REPLACE FUNCTION app.hq_governance(p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
               'offer', s.offer_kind,
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
$function$
;

drop function if exists public.what_i_can_do(text);
drop function if exists app.what_i_can_do(text);
drop function if exists public.hq_output_shapes();
