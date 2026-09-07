-- 0053 — a function body does not follow a rename
--
-- 0051 renamed `notebook_sources` to `documents`. Postgres rewrote every view
-- and every foreign key that depended on it, because those hold a parsed
-- reference to the table's oid. A `language sql` function body does not: it is
-- stored as text and resolved at call time, so `app.project_attention()` kept
-- naming a table that no longer existed and started raising 42P01.
--
-- It surfaced as a **502 from Team HQ**, three layers away from the rename,
-- which is the honest shape of this class of mistake: the migration applied
-- cleanly, `verify:sync` went green, and the thing that broke was a dashboard.
-- `verify:hq` caught it, one check out of twenty-four, because that check asks
-- the deployed API for a page rather than asking Postgres whether a function
-- exists.
--
-- Recreated verbatim apart from the table name and one addition: attention is
-- now measured over EVERY document, whatever connector fed it (ADR-0013), so a
-- project kept current through Notion is not reported as un-synced because it
-- has no notebook sources.

begin;

create or replace function app.project_attention()
returns table (
  project_id uuid,
  slug text,
  name text,
  open_blockers integer,
  overdue_blockers integer,
  live_jobs integer,
  failed_jobs_24h integer,
  stalled_jobs integer,
  hours_since_sync numeric,
  has_brief boolean,
  brief_is_stale boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.project_id, p.slug, p.name,
    (select count(*)::int from public.blockers b
      where b.project_id = p.project_id and b.state = 'open'),
    (select count(*)::int from public.blockers b
      where b.project_id = p.project_id and b.state = 'open'
        and b.real_deadline is not null and b.real_deadline <= app.now_utc()),
    (select count(*)::int from public.jobs j
      where j.project_id = p.project_id
        and j.state not in ('complete', 'cancelled', 'failed')),
    (select count(*)::int from public.jobs j
      where j.project_id = p.project_id and j.state = 'failed'
        and j.finished_at >= app.now_utc() - interval '24 hours'),
    (select count(*)::int from public.jobs j
      where j.project_id = p.project_id
        and j.state not in ('complete', 'cancelled', 'failed')
        and j.updated_at <= app.now_utc() - interval '1 hour'),
    (select round(extract(epoch from (app.now_utc() - max(d.fetched_at))) / 3600, 1)
      from public.documents d where d.project_id = p.project_id),
    exists (select 1 from public.project_briefs b where b.project_id = p.project_id),
    exists (
      select 1 from public.documents d
      where d.project_id = p.project_id
        and d.fetched_at > coalesce(
          (select max(b.generated_at) from public.project_briefs b
            where b.project_id = p.project_id),
          '-infinity'::timestamptz)
    )
  from public.projects p
  where p.status = 'active'
  order by p.name;
$$;

grant execute on function app.project_attention() to ai_team_app;

commit;
