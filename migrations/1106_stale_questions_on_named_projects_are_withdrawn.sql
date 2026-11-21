-- 1106 — old open questions on named projects are withdrawn (Activity clean-up, 21 November 2026)
--
-- Activity said "7 things need you", but Settings › Requests showed one. The seven were open questions raised in September
-- and October: NotebookLM generation requests, one-sentence summaries, and Slack channel offers. The owner confirmed they
-- are old and asked for them to be cleared.
--
-- Scope: open questions on NAMED projects that were asked more than 30 days ago. Questions on the catch-all project
-- (Conversations) are not touched. Each is withdrawn, not answered, and says so, using the same state 1078 uses.

with stale as (
  select b.blocker_id
    from public.blockers b
    join public.projects p on p.project_id = b.project_id
   where b.state = 'open'
     and p.slug <> 'unnamed'
     and b.created_at < app.now_utc() - interval '30 days'
)
update public.blockers b
   set state = 'withdrawn',
       resolved_at = app.now_utc(),
       resolution = 'withdrawn 21 November 2026: an old question the owner cleared (1106). Nothing was done for it.'
  from stale s
 where b.blocker_id = s.blocker_id
   and b.state = 'open';
