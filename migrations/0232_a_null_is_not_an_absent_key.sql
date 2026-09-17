-- A null is not an absent key.
--
-- Issue #68. 0230 fixed what `blocked` MEANS and the ribbon still read
-- **68 BLOCKED**, because the studio tests
--
--     r.blocked !== undefined
--
-- and JSON `null` is not `undefined`. Every unblocked job was arriving with
-- `"blocked": null`, which is a present key, so every one of them counted.
--
-- Two correct-looking halves and the bug in the seam between them — the third
-- time today, after the noticing pass that nobody read and the skill table that
-- was tested separately from its function.
--
-- `jsonb_strip_nulls` at the boundary rather than a change on the page. The
-- page's test is the right one: "is there a blocker" should be answered by
-- whether the key exists, and a payload that says `null` for every absent thing
-- is a payload that cannot express absence. Stripping also drops `note`, `due`
-- and `output` when they are empty, which every reader of those already
-- handles — they test for null OR undefined.

begin;

create or replace function app.studio_requests(p_project_id uuid, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
             'title', left(coalesce(
               nullif(btrim(split_part(o.body, E'\n', 1)), ''), j.kind), 80),
             'kind', 'made',
             'size', case
               when length(coalesce(o.body, '')) >= 550
                 then format('%s words', to_char(round(length(o.body) / 5.5), 'FM999G999'))
               else '' end
           ) end
         )) order by j.created_at desc), '[]'::jsonb)
    from (select * from public.jobs jj
           where jj.project_id = p_project_id and not jj.is_fixture
           order by jj.created_at desc
           limit greatest(coalesce(p_limit, 20), 1)) j
    left join lateral (
      select oo.output_id, oo.body, oo.created_at, oo.reviewer_status
        from public.outputs oo where oo.job_id = j.job_id
       order by oo.created_at desc limit 1
    ) o on true
$$;

commit;
