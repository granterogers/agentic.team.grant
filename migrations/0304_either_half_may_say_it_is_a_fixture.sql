begin;

/**
 * Either half may say it is a fixture. Neither may say it is not.
 *
 * 0303, ten minutes old, replaced `not i.is_fixture` with
 * `not coalesce(j.is_fixture, i.is_fixture)` — read the JOB, whose flag is
 * generated and current, and fall back to the ledger's frozen copy only where
 * there is no job. It removed five probe rows from Grant's Governance page,
 * which was the point, and it quietly ADDED two:
 *
 *     needed                 impediment flag   job flag   requested_by
 *     verify-tool-mtwjh76u   true              FALSE      impediment-proof-…
 *
 * The impediment was marked a fixture at insert. The job it hangs off is named
 * `impediment-proof-…`, which matches none of the generated column's patterns,
 * so the job says real — and `coalesce` prefers the job and lets it through.
 * Two rows that had been correctly excluded for weeks appeared on a governance
 * surface because of a migration written to clear that surface.
 *
 * ## The rule, stated properly this time
 *
 * The two flags are not a value and its fallback. They are two independent
 * witnesses, and **each can only testify in one direction**:
 *
 *   * `job_impediments.is_fixture` is copied at insert and frozen by §6. It can
 *     say "this was harness traffic" truthfully for ever. It cannot be trusted
 *     to say "this is real", because the attribution may have been corrected
 *     afterwards — which is exactly what 0303 did.
 *   * `jobs.is_fixture` is GENERATED and always current. It can say "this is
 *     harness traffic" truthfully. It cannot be trusted to say "this is real"
 *     either, because a suite can name a job anything and mark the impediment
 *     itself — `verify:impediments` does, deliberately, so it can test a reader
 *     that filters fixtures without its own rows being counted.
 *
 * So: fixture if EITHER says fixture. `or`, not `coalesce`. A flag that only
 * ever adds exclusions cannot make a real wall disappear, and that is the
 * asymmetry that makes this safe — the failure mode of getting it wrong in
 * this direction is under-reporting a probe, not hiding a genuine one.
 *
 * The general shape, which is what to remember: **when two sources disagree
 * and one of them is append-only, ask which direction each is capable of
 * lying in.** They are rarely symmetric, and `coalesce` assumes they are.
 */

create or replace function app.impediments_tally(
  p_days int default 30, p_min int default 2, p_include_fixtures boolean default false)
returns table (
  kind impediment_kind, needed text, staff_slug text, times int,
  first_seen timestamptz, last_seen timestamptz, projects int, for_instance text)
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
    left join public.jobs j on j.job_id = i.job_id
   where (
           coalesce(p_include_fixtures, false)
           -- Either witness may exclude; neither may include. See the header.
           or not (coalesce(j.is_fixture, false) or i.is_fixture)
         )
     and i.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   group by i.kind, i.needed, i.staff_slug
  having count(*) >= greatest(coalesce(p_min, 2), 1)
   order by count(*) desc, max(i.created_at) desc
$$;

comment on function app.impediments_tally is
  'What the office tried and could not do (#49), read by the Governance tab '
  '(#54). A row is harness traffic if EITHER the job says so (generated, always '
  'current) or the ledger copy says so (frozen at insert by §6, correctable '
  'never). Each witness can only exclude, never include — 0304, after 0303 used '
  'coalesce and let two probe rows back onto the page it was written to clear.';

commit;
