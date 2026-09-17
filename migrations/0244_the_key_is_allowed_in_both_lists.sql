-- The key has to be in BOTH lists (#94).
--
-- 0241 added `calendar.sync_tasks` to the boolean branch of `hq_set_setting`
-- and stopped there. There are two other lists it also has to be in:
--
--   1. the GUARD at the top of `hq_set_setting` — `if p_key not in (...)`,
--      which decides whether the key may be written at all;
--   2. the `settable` array in `hq_studio_settings`, which is how the page
--      knows whether to draw the control as usable.
--
-- So the switch appeared on the Behaviour tab reporting `settable: false`, and
-- the page drew it as not-settable. That is the design working exactly as
-- intended: 0223's comment says the page reads settability "from the same
-- place the API enforces it, so a button that cannot work is never drawn". It
-- refused to offer me a control I had half-wired.
--
-- Same shape as the bug `verify:skills` missed, where the table and the
-- function were each correct and the fault lived only in the gap between them.
--
-- Both lists are patched from the live definitions rather than rewritten, and
-- both patches assert the text they expect was actually there.

do $$
declare
  v_def text;
begin
  -- 1. The guard.
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.hq_set_setting(text,text)'::regprocedure;

  if position('''calendar.enabled'', ''calendar.calendar_id''' in v_def) = 0 then
    raise exception 'the guard did not look as expected — read it before replacing';
  end if;

  v_def := replace(v_def,
    '''calendar.enabled'', ''calendar.calendar_id''',
    '''calendar.enabled'', ''calendar.calendar_id'', ''calendar.sync_tasks''');
  execute v_def;

  -- 2. The list the page reads to decide what to offer.
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.hq_studio_settings()'::regprocedure;

  if position('''calendar.enabled'', ''calendar.calendar_id''' in v_def) = 0 then
    raise exception 'the settable array did not look as expected — read it before replacing';
  end if;

  v_def := replace(v_def,
    '''calendar.enabled'', ''calendar.calendar_id''',
    '''calendar.enabled'', ''calendar.calendar_id'', ''calendar.sync_tasks''');
  execute v_def;
end
$$;
