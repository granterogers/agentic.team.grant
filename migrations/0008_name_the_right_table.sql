-- 0008 — Make the append-only rejection name the table it actually guarded
--
-- `app.reject_ledger_mutation()` is shared by the triggers on `events` and on
-- `job_state_transitions`, but its message hard-coded `public.events`. So a
-- blocked write to the transition history reported:
--
--   events is append-only: UPDATE on public.events is never permitted
--
-- The trigger fired correctly and the write was refused — the guarantee was
-- never in doubt. But the message named the wrong table, which is the kind of
-- thing that sends someone reading a 3am log into the wrong file. It was caught
-- by reading the restore rehearsal's own output rather than by a test, because
-- the test asserted the message contained "append-only" and it did.
--
-- tg_table_schema and tg_table_name are available to any trigger function, so
-- there was never a reason to hard-code it.

create or replace function app.reject_ledger_mutation()
  returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception
    '%.% is append-only: % is never permitted (master spec §6)',
    tg_table_schema, tg_table_name, tg_op
    using errcode = '42501',
          hint = 'To reverse an action, INSERT a compensating row referencing '
                 'the original — never UPDATE or DELETE the history.';
end
$$;

comment on function app.reject_ledger_mutation() is
  'Blocks UPDATE, DELETE and TRUNCATE on append-only tables for every role, '
  'owner included — REVOKE cannot restrain the owner, and migrations run as the '
  'owner. Names the table it actually guarded, so the error is actionable.';
