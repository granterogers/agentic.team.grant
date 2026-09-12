-- 0291 — the latest switch is the one that counts, and clearing clears
--
-- Issue #177. The issue asked which of two causes it was, and said to establish
-- that first because *"the two have opposite repairs, and this repository has
-- already spent a day fixing code that was correct."* It is **both**, plus a
-- third nobody was looking for.
--
-- ## What 0026 wrote
--
--     select project_id
--       from public.project_switches
--      where scope_kind = p_scope_kind and scope_ref = p_scope_ref
--      order by switched_at desc, switch_id desc
--      limit 1;
--
-- with a comment stating the contract exactly:
--
--   > *The latest switch for a scope. Returns null both when nothing was ever
--   > set and when the last switch was an explicit un-scoping — which are the
--   > same thing to a caller, and both mean ask.*
--
-- ## What 0164 left
--
--     select s.project_id
--       from public.project_switches s
--       join public.projects p on p.project_id = s.project_id
--      where s.scope_kind = p_scope_kind and s.scope_ref = p_scope_ref
--        and not p.is_fixture
--
-- 0164 added a fixture guard — *"a harness that switches a scope to its fixture
-- and dies before cleaning up must not leave Grant's chat pointed at it"*, which
-- is a good reason — and in rewriting the body from memory dropped **the order
-- by and the limit**, and turned the read into an inner join. The comment above
-- it still describes 0026's behaviour and has done since.
--
-- This is CLAUDE.md's rule in miniature: *patch a big SQL function from
-- `pg_get_functiondef`, never rewrite it from memory.* The function is nine
-- lines, which is exactly why it felt safe to retype.
--
-- ## Three consequences, and only one of them was being reported
--
-- 1. **Clearing a project context does nothing.** Un-scoping is a switch to
--    NULL — the table is append-only, so there is no other way to say it — and
--    an INNER JOIN drops that row. So the previous project is returned for
--    ever. Grant says "no, forget that project" and the office carries on
--    filing work against it. Proved against two real projects before this was
--    written; it is not theoretical.
--
-- 2. **"The latest wins" is not implemented.** A scalar `returns uuid` function
--    whose body yields several rows returns whichever one the planner produces
--    first. It happens to be insertion order today. Nothing makes it so.
--
-- 3. **The fixture guard reaches backwards.** Filtering in the WHERE clause
--    means a scope whose latest switch is to a fixture silently falls back to
--    an older switch, rather than declining. Quietly pointing a chat at a
--    project two switches ago is worse than pointing it at nothing.
--
-- Only (2) and its knock-on were visible in `verify:agents`, and even those
-- were reported for the wrong reason — the suite's subjects are `fixture-`
-- named, so the guard refused them and the checks never got far enough to see
-- any of this. **A red check that is red for the wrong reason hid two bugs.**
--
-- ## The repair
--
-- 0026's body, with 0164's guard applied to the LATEST row rather than to the
-- candidate set. Take the newest switch; if it names a fixture, that is no
-- scope. Both intents kept, neither able to undo the other.

begin;

create or replace function app.current_project(p_scope_kind project_scope_kind, p_scope_ref text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  /*
    The latest row, then the guard — in that order, and the order is the whole
    fix. Filtering first lets a fixture switch fall THROUGH to an older real
    one, which points a chat at a project from two switches ago while looking
    entirely reasonable. Filtering after means a fixture switch reads as no
    scope, which is what 0164 wanted and says so.

    A left join, because un-scoping is a switch to NULL — the table is
    append-only and there is no other way to say it — and an inner join drops
    exactly that row.
  */
  select case when latest.is_fixture then null else latest.project_id end
    from (
      select s.project_id, coalesce(p.is_fixture, false) as is_fixture
        from public.project_switches s
        left join public.projects p on p.project_id = s.project_id
       where s.scope_kind = p_scope_kind
         and s.scope_ref = p_scope_ref
       order by s.switched_at desc, s.switch_id desc
       limit 1
    ) latest
$$;

comment on function app.current_project is
  'The latest switch for a scope. Returns null both when nothing was ever set '
  'and when the last switch was an explicit un-scoping - which are the same '
  'thing to a caller, and both mean ask. A latest switch naming a FIXTURE '
  'project also reads as no scope (0164): a harness that dies before cleaning '
  'up must not leave a real chat pointed at its fixture, and must not silently '
  'fall back to an older switch either (0291).';

commit;
