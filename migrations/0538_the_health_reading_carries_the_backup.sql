-- 0538 — The canonical health reading carries the backup and the progress
--
-- 0537 built `app.backup_health()` and `app.last_progress()`. This puts them
-- inside `app.office_health()`, which is the reading the dashboard and the
-- gateway actually ask for, so the two questions nobody could answer are
-- answered in the same place as everything else:
--
--   * is there a recent FINISHED backup, and has a restore been PROVEN?
--   * did useful work actually MOVE, as distinct from did the heartbeat fire?
--
-- ## An index first, because the reading was about to get slow
--
-- `last_progress()` takes three `max(occurred_at)` over
-- `job_state_transitions` filtered by `to_state`. Measured before writing
-- this: **1,227 ms each, on a sequential scan**, 78,535 rows removed by
-- filter — so embedding it would have added the better part of four seconds
-- to every health reading, on a table that grows by about six thousand rows a
-- day. The brief this run works from lists that failure by name: tables that
-- grow with no operational visibility.
--
-- The index makes each one an index-only scan on its first tuple. It is small
-- and it is the difference between a reading somebody consults and a reading
-- somebody stops consulting.
--
-- ## Why the function is spliced rather than retyped
--
-- Three sessions are working this repository in parallel against one
-- database, so the live `office_health` may have moved since it was last
-- read. CLAUDE.md's rule is that a function you are only PATCHING must be
-- spliced from its live definition — rewriting 0533's worth of jsonb from
-- memory is how four behaviours got lost in `app.pause_job`.
--
-- So this reads `pg_get_functiondef`, inserts two keys at one anchor, and
-- RAISES if the anchor is not there rather than applying a no-op that looks
-- like success. And it appends the semicolon `pg_get_functiondef` does not
-- emit — recorded twice in CLAUDE.md, at 0353 and again at 0355.

begin;

create index if not exists job_transitions_state_time_idx
  on public.job_state_transitions (to_state, occurred_at desc);

comment on index public.job_transitions_state_time_idx is
  'For "when did work last actually move" — app.last_progress() takes three '
  'max(occurred_at) by to_state and each was a 1.2-second sequential scan '
  'before this existed (0538).';

do $splice$
declare
  v_def  text;
  v_new  text;
  v_anchor text := '''held_for_budget'', app.held_for_budget(),';
  v_add    text :=
    '''backup'', app.backup_health(), ''progress'', app.last_progress(), ' ||
    '''held_for_budget'', app.held_for_budget(),';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'office_health';

  if v_def is null then
    raise exception 'app.office_health does not exist, so there is nothing to patch';
  end if;

  if position(v_anchor in v_def) = 0 then
    raise exception
      'app.office_health no longer contains the anchor this migration splices at. '
      'It has been changed by another workstream. Re-read it and re-aim the splice '
      'rather than letting a no-op look like a success.';
  end if;

  if position('app.backup_health()' in v_def) > 0 then
    raise notice 'app.office_health already carries the backup reading; nothing to do';
    return;
  end if;

  v_new := replace(v_def, v_anchor, v_add);

  -- pg_get_functiondef emits no trailing semicolon. Bitten at 0353 and again
  -- at 0355, where the error pointed at the line AFTER the real problem.
  execute v_new || ';';
end
$splice$;

commit;
