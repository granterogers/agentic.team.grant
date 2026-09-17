-- A switch for putting tasks in the diary (#94, ADR-0020).
--
-- `calendar.sync_tasks`, defaulting to FALSE. Writing into a person's real
-- calendar is not something to begin because a feature shipped, so the office
-- can do it and will not until Grant says so.
--
-- The target calendar is `calendar.calendar_id`, which already exists, already
-- defaults to 'primary', and is already what the reader is pointed at. A
-- second key for the write side is how the two end up pointed at different
-- calendars and events appear somewhere nobody is looking. Its own description
-- already reads *"Which calendar to read and write"*, so this is the use it was
-- designed for rather than a reuse.
--
-- (The column is `description`, not `note` — checked after guessing wrong once.)
--
-- `hq_set_setting` has an allow-list and this key is added to it, in the
-- boolean branch -- 'false' as a STRING is truthy in every language that will
-- read it, which is exactly the bug that turns an integration on.

insert into public.system_config (key, value, description, self_adjustable)
values (
  'calendar.sync_tasks',
  to_jsonb(false),
  'Whether dated, open tasks are written into Google Calendar as all-day events (ADR-0020). Off by default. One way only: the diary never changes a task.',
  false
)
on conflict (key) do nothing;

-- The allow-list, patched from the live definition rather than rewritten. The
-- last time a function of this size was reconstructed from memory it failed on
-- a column that does not exist.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.hq_set_setting(text,text)'::regprocedure;

  -- Two edits: the key becomes settable, and it is treated as a boolean.
  v_def := replace(v_def,
    '''calendar.enabled'', ''notebook.enabled'', ''knowledge.read_new_sources''',
    '''calendar.enabled'', ''calendar.sync_tasks'', ''notebook.enabled'', ''knowledge.read_new_sources''');

  if position('calendar.sync_tasks' in v_def) = 0 then
    raise exception 'the allow-list did not contain the expected boolean branch — look before replacing';
  end if;

  execute v_def;
end
$$;
