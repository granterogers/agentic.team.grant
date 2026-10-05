-- 0904. A sample shows its own seeded work, and not a scheduled run.
--
-- Found walking the Sample as a visitor after the showcase turns were made (5 October 2026): the Chat showed the seeded
-- conversations, and the Agentic Team tool showed NONE of the same work. Cause: 0899 asks `app.harness_job` of each job, and
-- migration 0598 calls a voice session the page did not mint harness traffic (`voice:turn:<session>` where the session is not
-- `s` plus up to ten characters). The owner's seeded turns are made through the real voice door with a session label of their own
-- (`showcase-<key>`), so each was harness by that rule and hidden. They are not harness: they are the Sample's own work.
--
-- So in a SAMPLE office the harness rule is not applied to a root with no visitor on it. A visitor's turn is still hidden (it has
-- a visitor, and harness_job's own visitor clause). A person's office is unchanged.
--
-- Two more changes in the same reader, for a demonstration that should show work and not plumbing:
--   * a sample's own scheduled runs (requested_by `duty:...`) are not listed: the Automations tab shows the instruction and its
--     schedule, and the first run (which came back as a failed parent with two contradictory children) is not the showpiece;
--   * a job may carry `pinned_config.showcase_hidden = true`, for work with no command to flag.
-- Body: 0903's, with the where clause changed as described.

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
           -- 0899: the canonical question, asked of the twenty rows only. 0904: but a SAMPLE's own seeded work is shown even
           -- though 0598 calls its voice session harness (the owner's seeded turns carry a session label the page did not
           -- mint). Never a visitor's turn: that is hidden by the visitor clause in harness_job, and the exception below is
           -- only for roots with no visitor on them.
           where (not app.harness_job(k.job_id)
                  or (exists (select 1 from public.offices so
                               where so.office_id = k.office_id and so.kind = 'sample')
                      and not exists (select 1 from public.inbound_commands vc
                                       where vc.job_id = coalesce(k.root_job_id, k.job_id)
                                         and vc.context ->> 'visitor' is not null)))
             -- 0899, 0901: a sample office shows only the team's own, completed work: not its housekeeping, not an attempt
             -- that failed or was called off, and (0904) not its own scheduled runs, which in a demonstration are plumbing.
             and not exists (select 1 from public.offices so
                              where so.office_id = k.office_id and so.kind = 'sample'
                                and (k.state in ('failed', 'cancelled')
                                     or (k.requested_by = 'hq' and k.kind like 'office.%')
                                     or k.requested_by like 'duty:%'))
             -- 0903: nor a job rooted at a command the operator left out of the demonstration.
             -- (only the Sample's own seeded turns can be left out; a flag on a visitor's turn is ignored, as in the chat.)
             and not exists (select 1 from public.inbound_commands hc
                              where hc.job_id = coalesce(k.root_job_id, k.job_id)
                                and hc.context ->> 'visitor' is null
                                and coalesce(hc.context ->> 'showcase_hidden', '') = 'true')
             -- 0904: or a job the operator marked itself (work with no command to flag, such as a scheduled run).
             and coalesce(k.pinned_config ->> 'showcase_hidden', '') <> 'true') j
    left join lateral (
      select * from public.outputs oo
       where oo.job_id = j.job_id
       order by oo.created_at desc limit 1
    ) o on true
$function$;
