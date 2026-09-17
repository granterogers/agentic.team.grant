-- Blocked means blocked.
--
-- Issue #68. 0228 set a job's `blocked` field from `state_reason`, and
-- `state_reason` is written on every dequeue — "dequeued by worker-edge". So the
-- ribbon on Grant's biggest project read **68 BLOCKED**, in amber, when nothing
-- was blocked at all.
--
-- Found by looking at the render, which is the only way it could have been:
-- the payload was well-formed, the count was arithmetically correct, and every
-- check passed. §14A's loop exists for exactly this.
--
-- The three states that actually mean something is being waited on are
-- `waiting_external`, `waiting_user` and `paused`, and the stated reason lives
-- in `blockers` — which the morning briefing already joins for the same purpose
-- rather than reading `state_reason`. Two readers, one definition now.

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
           /*
             Blocked means blocked, not "has a state_reason".

             `state_reason` is set on every dequeue — "dequeued by worker-edge"
             — so keying on its presence reported all sixty-eight jobs on Grant's
             biggest project as blocked, in the ribbon, in amber. The states that
             actually mean somebody or something is being waited on are the three
             below; `blockers` is where a stated reason lives, and it is joined
             rather than guessed.

             Absent rather than null on purpose: the ribbon and the jobs list
             both test `blocked !== undefined`.
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
  'states, not the engine''s fourteen. Blocked is the three waiting states and '
  'a joined blocker, never the presence of a state_reason (0230).';

commit;
