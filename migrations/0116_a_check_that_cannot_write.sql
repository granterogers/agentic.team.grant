-- 0116 — A check that cannot write
--
-- 0115 ended with a consistency check: for every key the page offers, call
-- `hq_set_setting` and make sure it is not refused as unknown. The probe value
-- was `'~~probe~~'`, chosen as "guaranteed invalid for every type".
--
-- It is not invalid for a TEXT key. `db.project_ref`, `db.region`,
-- `calendar.calendar_id` and three backup keys accept any string, so the check
-- wrote `~~probe~~` into all six — pointing the tooling at a project that does
-- not exist. Repaired by hand within the minute, and the three backup keys
-- turned out never to have had a row at all, so the probe created them.
--
-- This is the rule this project has paid for three times now: **a test that
-- changes real configuration must restore it** — and the better version, which
-- is that a check should not be able to change anything in the first place.
--
-- So the check no longer calls the setter. It reads the setter's own source and
-- compares the two lists as text. That cannot write by construction, and it
-- also catches the case the old one could not: a key the SETTER allows and the
-- page does not offer, which is a permission no interface exposes.

begin;

do $$
declare
  src text;
  k text;
  missing text[] := '{}';
begin
  select pg_get_functiondef('app.hq_set_setting(text, text)'::regprocedure) into src;

  -- Every key the page offers must appear in the setter's allow-list.
  for k in select e ->> 'key' from jsonb_array_elements(app.hq_editable_settings()) e loop
    if position(quote_literal(k) in src) = 0 then
      missing := missing || k;
    end if;
  end loop;
  if array_length(missing, 1) > 0 then
    raise exception 'the page offers %, which hq_set_setting does not allow',
      array_to_string(missing, ', ');
  end if;

  -- And the reverse, which the old check could not see. `google.*` is the one
  -- deliberate asymmetry: the Google card writes those, not the generic form,
  -- because two boxes writing one key is two boxes that disagree.
  for k in
    select key from public.system_config
     where key not like 'google.%'
       and position(quote_literal(key) in src) > 0
       and key not in (select e ->> 'key' from jsonb_array_elements(app.hq_editable_settings()) e)
  loop
    raise exception 'hq_set_setting allows %, which no page offers', k;
  end loop;
end $$;

commit;
