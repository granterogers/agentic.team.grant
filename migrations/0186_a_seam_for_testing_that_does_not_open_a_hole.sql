-- A seam for testing that does not open a hole.
--
-- Issue #47. `app.impediments_tally()` excludes fixtures, which is the whole
-- point of it: harness traffic must never become a proposal to Grant. But that
-- left the verification suite with an ugly choice, and both options were bad:
--
--   * Test the tally with FIXTURE rows — impossible, they are excluded.
--   * Test it with REAL rows — which means every run of `verify:impediments`
--     leaves two permanent, uncountable-away entries in the tally. They are
--     append-only, so they can never be removed, and the office would
--     eventually propose that Grant buy a connector called
--     `verify-tool-mtwjh76u`.
--
-- The second is how a test suite manufactures the exact failure it exists to
-- prevent, one run at a time.
--
-- So the filter becomes a parameter on the INNER function, and the PUBLIC
-- wrapper — the only thing PostgREST exposes, and the only thing a client can
-- reach — never passes it. Production cannot include fixtures because the path
-- that reaches production has no way to ask for them.
--
-- `verify:impediments` asserts both halves: that the wrapper does not pass the
-- flag, and that calling the wrapper cannot produce a fixture row. A seam
-- nobody checks is a hole.

begin;

drop function if exists app.impediments_tally(integer, integer);
drop function if exists public.impediments_tally(integer, integer);

create or replace function app.impediments_tally(
  p_days             integer default 30,
  p_min              integer default 2,
  -- Never true on any path a client can reach. See the header, and the wrapper.
  p_include_fixtures boolean default false
)
returns table (
  kind         public.impediment_kind,
  needed       text,
  staff_slug   text,
  times        integer,
  first_seen   timestamptz,
  last_seen    timestamptz,
  projects     integer,
  for_instance text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.kind,
         i.needed,
         i.staff_slug,
         count(*)::int                        as times,
         min(i.created_at)                    as first_seen,
         max(i.created_at)                    as last_seen,
         count(distinct i.project_id)::int    as projects,
         (array_agg(i.detail order by i.created_at desc)
            filter (where btrim(i.detail) <> ''))[1] as for_instance
    from public.job_impediments i
   where (coalesce(p_include_fixtures, false) or not i.is_fixture)
     and i.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   group by i.kind, i.needed, i.staff_slug
  having count(*) >= greatest(coalesce(p_min, 2), 1)
   order by count(*) desc, max(i.created_at) desc
$$;

comment on function app.impediments_tally(integer, integer, boolean) is
  'Limitations that have RECURRED — the only honest basis for a proposal (#49). '
  'p_include_fixtures exists so the verification suite can exercise grouping '
  'without leaving permanent real rows behind; the public wrapper never passes '
  'it, so no client can ask for harness traffic.';

/*
  The wrapper. Two arguments, deliberately.

  `create or replace` does not replace a function whose argument list changed —
  it creates a second overload and calls become ambiguous. Both were dropped
  above, by exact signature, for that reason. The public one is also the half
  that silently drops a new parameter, which here is the feature.
*/
create or replace function public.impediments_tally(
  p_days integer default 30, p_min integer default 2
)
returns table (
  kind public.impediment_kind, needed text, staff_slug text, times integer,
  first_seen timestamptz, last_seen timestamptz, projects integer, for_instance text
)
language sql stable security definer set search_path = ''
as $$ select * from app.impediments_tally(p_days, p_min, false) $$;

comment on function public.impediments_tally(integer, integer) is
  'What the office keeps being unable to do. Fixtures are excluded and there is '
  'no argument that would include them.';

commit;
