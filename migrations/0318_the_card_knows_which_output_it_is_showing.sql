begin;

/**
 * The card knows which output it is showing.
 *
 * `studio_requests` emitted the output's title, kind, size and body and NOT its
 * id — the row's `id` is the JOB's, which is the right key for "which request
 * is this" and the wrong one for "import this one thing". #28's import step
 * needs `import_output(output_id, …)` and the page had no id to give it.
 *
 * `imported` comes with it, because the alternative is the page deciding from
 * the reviewer status — and an output can be approved without ever having been
 * imported, which is exactly the state a half-built gate leaves behind.
 */

CREATE OR REPLACE FUNCTION app.studio_requests(p_project_id uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
             reason from `blockers.requested_action` — the same column
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
    from (select * from public.jobs jj
           where jj.project_id = p_project_id and not jj.is_fixture
           order by jj.created_at desc
           limit greatest(coalesce(p_limit, 20), 1)) j
    left join lateral (
      select * from public.outputs oo
       where oo.job_id = j.job_id
       order by oo.created_at desc limit 1
    ) o on true
$function$;

commit;
