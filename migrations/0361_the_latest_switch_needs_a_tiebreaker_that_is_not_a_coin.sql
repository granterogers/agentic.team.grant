-- 0361 — "the latest switch wins" was decided by a random uuid.
--
-- Found by the pre-human backend acceptance programme (#224). verify:agents
-- reported 55/56 with
--
--     a switch to a FIXTURE reads as no scope, and does not fall back to an
--     older one — resolved=a49a4afd...
--
-- and the same suite had reported 56/56 three days earlier against the same
-- code. Neither run was wrong. The check is a COIN FLIP, and so is the
-- behaviour underneath it.
--
-- app.current_project orders by `switched_at desc, switch_id desc`. Both halves
-- of that tiebreak fail together:
--
--   * switched_at defaults to app.now_utc(), which is now() — the TRANSACTION
--     timestamp. Two switches recorded in one transaction carry the SAME
--     instant, to the microsecond.
--   * switch_id is gen_random_uuid(). Ordering by it descending is ordering by
--     noise. CLAUDE.md already records the neighbouring trap — min(uuid) does
--     not exist — and this is the same mistake wearing an ORDER BY.
--
-- So when two switches share a transaction, which one counts is random. In the
-- suite that means the fixture guard fires about half the time. In production
-- it means a chat can be pointed at the project from two switches ago while
-- looking entirely reasonable, which is the exact failure 0291's comment says
-- it exists to prevent — 0291 fixed the ORDER of the filter and left the order
-- of the ROWS undecided.
--
-- A monotonic identity column is the tiebreaker. It is assigned by the sequence
-- at INSERT, so it always reflects the order rows were written, including
-- inside one transaction where the clock cannot.
--
-- switched_at stays the primary key of the sort. seq only breaks ties, so
-- backfilled values on existing rows (assigned in whatever order the table is
-- scanned) cannot reorder anything that was already unambiguous.
--
-- Not switching now_utc() to clock_timestamp(): that would change the meaning
-- of every timestamp in the office to buy one tiebreak, and app.now_utc() is
-- STABLE for good reasons elsewhere.

alter table public.project_switches
  add column if not exists seq bigint generated always as identity;

comment on column public.project_switches.seq is
  'Monotonic write order. switched_at is now(), the transaction timestamp, so '
  'two switches in one transaction share an instant and switch_id is random - '
  'this is what decides which of them is the latest (0361).';

/*
  The reader, unchanged except for the tiebreaker. Everything else here is
  0291's and its reasoning is preserved verbatim, because the filter-after-limit
  ordering is a separate fix that is still correct and still load-bearing.
*/
create or replace function app.current_project(
  p_scope_kind public.project_scope_kind,
  p_scope_ref text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  /*
    The latest row, then the guard — in that order, and the order is the whole
    fix. Filtering first lets a fixture switch fall THROUGH to an older real
    one, which points a chat at a project from two switches ago while looking
    entirely reasonable. Filtering after means a fixture switch reads as no
    scope, which is what 0164 wanted and says so.

    A left join, because un-scoping is a switch to NULL — the table is
    append-only and there is no other way to say it — and an inner join drops
    exactly that row.

    0361: `seq desc`, not `switch_id desc`. The id is a random uuid, so ordering
    by it picked one of two same-transaction switches at random and "the latest
    switch wins" was true only on average.
  */
  select case when latest.is_fixture then null else latest.project_id end
    from (
      select s.project_id, coalesce(p.is_fixture, false) as is_fixture
        from public.project_switches s
        left join public.projects p on p.project_id = s.project_id
       where s.scope_kind = p_scope_kind
         and s.scope_ref = p_scope_ref
       order by s.switched_at desc, s.seq desc
       limit 1
    ) latest
$function$;

comment on function app.current_project is
  'The latest switch for a scope. Returns null both when nothing was ever set '
  'and when the last switch was an explicit un-scoping - which are the same '
  'answer to the caller: no scope. A switch naming a fixture also reads as no '
  'scope, and does not fall through to an older real one (0164, 0291). Ties '
  'inside one transaction are broken by seq, not by a random uuid (0361).';
