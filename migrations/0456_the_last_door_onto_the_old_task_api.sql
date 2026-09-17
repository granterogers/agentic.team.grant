-- `public.add_task`, whose signature 0454 guessed wrong (#272).
--
-- 0454's `drop function if exists` named six arguments; the real one takes
-- nine, so `if exists` matched nothing and said nothing — which is the same
-- shape as the delete keyed on a name nobody checked that CLAUDE.md records
-- about 0350's Telegram branch. `check:callers` caught it, which is the check
-- being worth having.
--
-- Read from `pg_get_function_identity_arguments` this time rather than
-- remembered.

drop function if exists public.add_task(
  uuid, text, text, text, text, date, boolean, integer, uuid);

-- And the function behind it, on the same evidence as 0455: with its only
-- mouth gone, `check:callers` names `app.add_task` as reached by nothing.
-- Four functions and four wrappers removed across 0454-0456, each one proved
-- dead by the check rather than by somebody's reading.
drop function if exists app.add_task(
  uuid, text, text, text, text, date, boolean, integer, uuid);
