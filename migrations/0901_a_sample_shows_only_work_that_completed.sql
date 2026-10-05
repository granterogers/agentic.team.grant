-- 0901. A sample office shows only work that completed.
--
-- 0900 fixed hand-off jobs failing in the public Sample (an empty command_id was cast to a uuid). The three jobs that failed
-- before it, with the office's own honest apology as their only output ("I could not get through what you asked me just
-- now... Say it again"), are real history and stay in the ledger: jobs are never deleted. But a showcase that a prospective
-- customer opens must not lead with the team's failed attempts at being set up, so the two readers a visitor reads through
-- leave them out FOR SAMPLE OFFICES ONLY:
--
--   app.studio_requests    (the Agentic Team tool): a sample office's failed or cancelled jobs are not listed;
--   app.sample_conversation (Chat): a SEEDED command whose job failed or was cancelled is not part of the thread, nor are the
--                           outputs of failed jobs under a seeded command. A visitor's OWN turn is untouched: if their
--                           question fails they must see the apology, because that is the product being honest to them.
--
-- A person's office is unchanged: a failed job there is something they should be able to see, which is the point of #211.
-- Both bodies are 0899's with these conditions added.

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
             -- 0899, 0901: a sample office shows only the team's own, completed work: not its housekeeping, and not an
             -- attempt that failed or was called off.
             and not exists (select 1 from public.offices so
                              where so.office_id = k.office_id and so.kind = 'sample'
                                and (k.state in ('failed', 'cancelled')
                                     or (k.requested_by = 'hq' and k.kind like 'office.%')))) j
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
        left join public.jobs cj on cj.job_id = c.job_id
       where c.office_id = p_office and c.project_id = p_project_id
         and (c.context ->> 'visitor' = v_visitor or c.context ->> 'visitor' is null)
         -- 0901: the Sample's own attempt that failed or was called off is history, not part of the demonstration.
         -- A visitor's own turn is always shown, so they see the apology if THEIR question fails.
         and not (c.context ->> 'visitor' is null and cj.state in ('failed', 'cancelled'))
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
        join cmds m on m.job_id = coalesce(j.root_job_id, j.job_id)
        left join public.staff s on s.staff_id = o.staff_id
       where j.office_id = p_office
         -- 0901: under a seeded command, a failed or called-off job's output is not shown either.
         and not (m.seeded and j.state in ('failed', 'cancelled'))
    ),
    recent as (
      select at, v from (select at, v from said union all select at, v from answered) both_sides
       order by at desc limit (select n from bounded)
    )
    select coalesce(jsonb_agg(r.v order by r.at), '[]'::jsonb) from recent r
  );
end
$function$;
