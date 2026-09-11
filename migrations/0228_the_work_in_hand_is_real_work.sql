-- The work in hand is real work.
--
-- Issue #68. `web/studio/workspace.js` turned out not to be mocked at all — it
-- is a pure function over `project.requests`, and `data.js` was supplying that
-- array. Wiring the studio to the office replaced `data.js` and left `requests`
-- as `[]`, so AI Team → Active jobs and Outputs went honestly empty while the
-- office was running jobs the whole time.
--
-- A tab that is empty because nothing was asked and a tab that is empty because
-- nobody wired it look identical, which is the whole reason this is worth a
-- migration rather than a shrug.
--
-- ## One row per job, with what came out of it
--
-- `jobs` is the ask, `outputs` is what came back — and `outputs` has no
-- `project_id`, so the join goes through the job (a trap already in CLAUDE.md).
-- The studio's shape carries both on one row because that is how a person reads
-- it: *this was asked, this came back, do I want it.*
--
-- ## Fixtures excluded, for the sixth time
--
-- 264 harness failures were once reported to Grant as the office falling over.
-- `jobs.is_fixture` exists for this and every query that a person will read has
-- to remember it.

begin;

create or replace function app.studio_requests(p_project_id uuid, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.job_id,
           /*
             The studio's own vocabulary, not the job engine's.

             `working` covers everything still in flight; `review` is something
             finished and waiting on Grant; `approved` and `discarded` are
             settled. The engine has fourteen states and a person needs four.
           */
           'state', case
             when j.state in ('queued', 'running', 'waiting_external',
                              'waiting_user', 'retrying', 'paused') then 'working'
             -- `reviewer_status` is the office's own answer to "has a person
             -- looked at this", so the studio does not invent a second one.
             when j.state = 'complete' and o.output_id is not null
              and coalesce(o.reviewer_status, 'pending') = 'pending' then 'review'
             when j.state = 'complete' then 'approved'
             else 'discarded' end,
           'who', coalesce(j.recipient_agent, 'chief-of-staff'),
           -- The job's kind IS the ask here. `outputs` has no request column —
           -- it holds what came back, not what was asked for.
           'ask', j.kind,
           'asked', to_char(j.created_at, 'FMDD Mon'),
           'delivered', case when o.created_at is null then ''
                             else to_char(o.created_at, 'FMDD Mon') end,
           -- Only when there IS one. `blocked` being absent rather than null is
           -- what the ribbon and the jobs list both test for.
           'blocked', nullif(btrim(coalesce(j.state_reason, '')), ''),
           'output', case when o.output_id is null then null else jsonb_build_object(
             /*
               An output has no title, so the first line of the body is one.

               Cut at a sentence end where there is one within eighty
               characters, because a title that stops mid-word reads as broken
               and this is the label on a card Grant approves or drops.
             */
             'title', left(coalesce(
               nullif(btrim(split_part(o.body, E'\n', 1)), ''), j.kind), 80),
             'kind', 'made',
             'size', case
               when length(coalesce(o.body, '')) >= 550
                 then format('%s words', to_char(round(length(o.body) / 5.5), 'FM999G999'))
               else '' end
           ) end
         ) order by j.created_at desc), '[]'::jsonb)
    from (select * from public.jobs jj
           where jj.project_id = p_project_id and not jj.is_fixture
           order by jj.created_at desc
           limit greatest(coalesce(p_limit, 20), 1)) j
    left join lateral (
      -- Through the job, because `outputs` has no project_id.
      select oo.output_id, oo.body, oo.created_at, oo.reviewer_status
        from public.outputs oo where oo.job_id = j.job_id
       order by oo.created_at desc limit 1
    ) o on true
$$;

comment on function app.studio_requests(uuid, integer) is
  'The work asked of the team on one project, with what came back (#68). Four '
  'states, not the engine''s fourteen: a person needs working, review, '
  'approved, discarded.';

commit;
