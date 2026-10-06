-- 0899. What a Sample visitor sees is the Sample's own work and their own thread, and nobody else's.
--
-- Two readers were found, walking the public Sample as a visitor (5 October 2026).
--
-- 1. app.studio_requests - the list behind the Agentic Team tool's "What the team has made" and "Running work" - filtered
--    only `not is_fixture`. That flag is generated from `requested_by`, and a visitor's turn is deliberately a REAL-looking
--    request (0897: it is harness work by `app.harness_job`, not by its name). So the first visitor's question and its
--    answer ("The launch budget file lists a total of £88,000 [1]. Asked: your message") showed to every visitor after. The
--    canonical predicate is `app.harness_job`; this reader had never been taught it, which is 0355's rule arriving at one
--    more reader. It is asked AFTER the row limit: the limit is twenty, so the function runs at most twenty times, and a
--    project with thousands of harness jobs costs what it cost before.
--
--    The same list also showed three "I could not give <project> a Slack channel: no_such_project" lines, one on each Sample
--    project. Those are the sample office's own housekeeping (the channel sweep, fixed for new rows by 0898); the jobs can
--    never be deleted and are not the team's work. A sample's housekeeping - jobs requested by the system with an office.*
--    kind - is not shown as work the team made. Scoped to sample offices on purpose: a real office's channel announcement
--    stays where it is.
--
-- 2. app.sample_conversation (0897) returned only the visitor's own thread. A prospective customer who opens Chat on a
--    project saw "Nothing has been said here yet", so the one place the product shows Claire handing work to a specialist
--    and the specialist answering had nothing to show. It now also returns the Sample's own seeded conversation: commands in
--    that project that carry NO visitor, i.e. the ones made while the office was open for seeding. Another visitor's thread
--    is still never returned (the visitor clause is unchanged), and this is a read.
--
-- Both bodies are spliced from the live definition / 0897 with the stated change only.

create or replace function app.studio_requests(p_project_id uuid, p_limit integer default 20)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', j.job_id,
           'state', case
             when j.state in ('queued', 'running', 'waiting_external',
                              'waiting_user', 'retrying', 'paused') then 'working'
             when j.state = 'complete' and o.output_id is not null
              and coalesce(o.reviewer_status, 'pending') = 'pending' then 'review'
             when j.state = 'complete' then 'approved'
             else 'discarded' end,
           'who', coalesce(j.recipient_agent, 'chief-of-staff'),
           'ask', j.kind,
           'asked', to_char(j.created_at, 'FMDD Mon'),
           'delivered', case when o.created_at is null then ''
                             else to_char(o.created_at, 'FMDD Mon') end,
           -- #153. The instants behind both, so a request made this morning
           -- does not still read as this morning tomorrow.
           'askedAt', j.created_at,
           'deliveredAt', o.created_at,
           /*
             Blocked means blocked (0230), and absent means absent (0232).

             The three states that mean something is being waited on, with the
             reason from `blockers.requested_action` - the same column
             `needs_me` reads. Null here is stripped by the wrapper above, so
             the key is simply not there when nothing is wrong.
           */
           'blocked', case
             when j.state in ('waiting_external', 'waiting_user', 'paused')
               then coalesce(
                 (select bl.requested_action from public.blockers bl
                   where bl.job_id = j.job_id and bl.resolved_at is null
                   order by bl.created_at desc limit 1),
                 nullif(btrim(coalesce(j.state_reason, '')), ''),
                 'waiting')
             else null end,
           'output', case when o.output_id is null then null else jsonb_build_object(
             -- The output's own id, so IMPORT TO PROJECT has something to call
             -- `import_output` with (#28, 0317). The row's `id` is the JOB's,
             -- which is the wrong key for a thing that becomes one document.
             'id', o.output_id,
             'imported', exists (
               select 1 from public.documents d
                where d.project_id = j.project_id
                  and d.connector = 'upload'
                  and d.external_ref = format('output:%s', o.output_id)
                  and d.state = 'approved'),
             'title', left(coalesce(
               nullif(btrim(split_part(o.body, E'\n', 1)), ''), j.kind), 80),
             'kind', 'made',
             'size', case
               when length(coalesce(o.body, '')) >= 550
                 then format('%s words', to_char(round(length(o.body) / 5.5), 'FM999G999'))
               else '' end,
             'body', o.body) end
         )) order by j.created_at desc), '[]'::jsonb)
    from (select * from (select * from public.jobs jj
                          where jj.project_id = p_project_id and not jj.is_fixture
                          order by jj.created_at desc
                          limit greatest(coalesce(p_limit, 20), 1)) k
           -- 0899: the canonical question, asked of the twenty rows only.
           where not app.harness_job(k.job_id)
             -- 0899: a sample office's own housekeeping is not work the team made.
             and not (k.requested_by = 'hq' and k.kind like 'office.%'
                      and exists (select 1 from public.offices so
                                   where so.office_id = k.office_id and so.kind = 'sample'))) j
    left join lateral (
      select * from public.outputs oo
       where oo.job_id = j.job_id
       order by oo.created_at desc limit 1
    ) o on true
$function$;

create or replace function app.sample_conversation(p_office uuid, p_project_id uuid, p_visitor text, p_limit integer default 50)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_visitor text := btrim(coalesce(p_visitor, ''));
  v_owner   text;
begin
  perform app.require_office(p_office);
  if not exists (select 1 from public.offices o where o.office_id = p_office and o.kind = 'sample')
     or v_visitor !~ '^[a-z0-9]{20,64}$'
     or not exists (select 1 from public.projects pj where pj.project_id = p_project_id and pj.office_id = p_office) then
    return '[]'::jsonb;
  end if;
  -- The Sample's owner as the thread names them: the persona, without the "(Sample Office)" the office is called.
  select btrim(regexp_replace(o.name, '\(Sample Office\)\s*$', '')) into v_owner
    from public.offices o where o.office_id = p_office;
  return (
    with bounded as (select greatest(1, least(coalesce(p_limit, 50), 100)) as n),
    cmds as (
      -- Mine (this visitor's own turns) and the Sample's own (made while it was open: no visitor on them).
      -- Another visitor's turn has a different visitor and is neither.
      select c.command_id, c.job_id, c.received_at, c.instruction,
             (c.context ->> 'visitor' is null) as seeded
        from public.inbound_commands c
       where c.office_id = p_office and c.project_id = p_project_id
         and (c.context ->> 'visitor' = v_visitor or c.context ->> 'visitor' is null)
    ),
    said as (
      select m.received_at as at,
             jsonb_build_object('message_id', m.command_id, 'kind', 'said', 'at', m.received_at,
                                'from', app.office_actor(p_office),
                                'name', case when m.seeded then coalesce(nullif(v_owner, ''), 'The owner') else 'You' end,
                                'body', m.instruction, 'surface', 'teamhq') as v
        from cmds m
    ),
    answered as (
      select o.created_at as at,
             jsonb_build_object('message_id', o.output_id, 'kind', 'answered', 'at', o.created_at,
                                'from', coalesce(s.slug, 'the-office'), 'name', coalesce(s.name, 'The team'),
                                'body', o.body, 'confidence', o.confidence::text, 'evidence', o.evidence::text,
                                'deterministic', o.deterministic, 'job', o.job_id) as v
        from public.outputs o
        join public.jobs j on j.job_id = o.job_id
        left join public.staff s on s.staff_id = o.staff_id
       where j.office_id = p_office
         and coalesce(j.root_job_id, j.job_id) in (select m.job_id from cmds m where m.job_id is not null)
    ),
    recent as (
      select at, v from (select at, v from said union all select at, v from answered) both_sides
       order by at desc limit (select n from bounded)
    )
    select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
  );
end
$function$;
