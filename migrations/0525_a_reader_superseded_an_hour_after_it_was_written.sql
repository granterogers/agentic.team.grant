/*
  Dropping a reader nothing reaches (#72, #283).

  `app.harness_delivery_attempts` was written in 0523 to list the harness sends
  that had reached a real destination. An hour later, in the same run, 0524
  added `app.harness_escapes` — which answers the same question better, because
  it also knows WHEN the guard started and can therefore separate what escaped
  since from what predates it. `check:leaks` reads the second one.

  So the first has been reachable by nothing but its own migration's drive
  block ever since, which is exactly the shape #72 exists to catch:

      check:callers FAILED — 1 capability nobody can reach:
        app.harness_delivery_attempts

  It went unnoticed because `check:callers` is in the readiness gate and the
  gate had not been run since. The check was right and nothing had read it.

  Dropped rather than left, and the distinction matters: CLAUDE.md says to
  DISABLE a registry row rather than delete it, because a listed gap can become
  a proposal and a deleted one cannot. That is about a capability the office
  might one day acquire. This is a query superseded by a better query, and
  leaving a second way to ask one question is the two-readers-that-will-
  disagree defect 0310 was spent undoing.

  The wrapper goes first, which is the order CLAUDE.md gives: PostgREST is the
  only thing that can reach a public wrapper, so dropping it proves nothing
  else did.
*/

drop function if exists public.harness_delivery_attempts(interval);
drop function if exists app.harness_delivery_attempts(interval);

do $check$
declare
  v_left int;
begin
  select count(*) into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'harness_delivery_attempts';
  if v_left <> 0 then
    raise exception 'harness_delivery_attempts still exists in % place(s)', v_left;
  end if;

  -- And the reader that replaced it still answers, so this is a removal and
  -- not a loss. A drop that quietly took the surviving half with it would be
  -- the worst outcome here.
  if (select jsonb_typeof(app.harness_escapes())) <> 'object' then
    raise exception 'app.harness_escapes no longer answers — the replacement is gone too';
  end if;
end
$check$;
