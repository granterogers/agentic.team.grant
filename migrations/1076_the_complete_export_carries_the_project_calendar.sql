-- 1076: the complete project export carries the project's calendar events.
--
-- app.project_export packages a project as one document, and the brief requires calendar events in it. The per-category
-- read `app.project_records(office, project, 'events')` (migration 1070) already returns them with the field names the
-- iCalendar serialiser reads; this adds that read to the package as an `events` section, so the complete export and the
-- ICS export cannot disagree about which events a project has.
--
-- The live definition is spliced at apply time (pg_get_functiondef), changing only the one place the section is added,
-- so nothing is retyped from memory. A control refuses to apply unless the anchor appears exactly once, and a second
-- control confirms the section is in the live definition afterwards.
--
-- The refusal of a project the office does not hold (migration 1075) is not touched: the anchor sits after the lookup.

do $$
declare
  def text;
  anchor constant text := '''automations'', app.project_automations(p_office, v_pid),';
  section constant text :=
    '''events'', app.project_records(p_office, v_pid, ''events'')->''records'',' || E'\n    ' || anchor;
begin
  def := pg_get_functiondef('app.project_export(uuid, uuid)'::regprocedure);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the automations line in app.project_export must appear exactly once; nothing was changed';
  end if;
  def := replace(def, anchor, section);
  execute def;

  if position('''events'', app.project_records(p_office, v_pid, ''events'')->''records''' in pg_get_functiondef('app.project_export(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'app.project_export does not carry the events section after 1076';
  end if;
end $$;
