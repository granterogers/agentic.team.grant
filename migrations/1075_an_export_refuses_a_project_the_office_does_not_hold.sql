-- 1075: a project export refuses a project the office does not hold.
--
-- app.project_export resolves the project inside the office. A project that belongs to another office, or that does
-- not exist, resolved to null, and every section that depended on it came back empty, which was correct. The team
-- section did not depend on it, though: with no project, the staff join matched nothing and `coalesce(ps.active, true)`
-- reported every agent as on the project. A package for a project the caller does not hold therefore said the whole
-- team was working on it. Nothing of another office's was returned; the answer was simply false.
--
-- The fix refuses instead. The live definition is spliced at apply time (pg_get_functiondef), changing only the lookup,
-- so nothing is retyped from memory. A control at the end refuses to apply if the refusal did not land.

do $$
declare
  def text;
  anchor constant text := 'where p.project_id = p_project_id and p.office_id = p_office;';
  refusal constant text :=
    'where p.project_id = p_project_id and p.office_id = p_office;' || E'\n' ||
    '  if v_pid is null then' || E'\n' ||
    '    raise exception ''no project of this office has that id'' using errcode = ''22023'';' || E'\n' ||
    '  end if;';
begin
  def := pg_get_functiondef('app.project_export(uuid, uuid)'::regprocedure);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the project lookup in app.project_export must appear exactly once; nothing was changed';
  end if;
  def := replace(def, anchor, refusal);
  execute def;

  -- The control: the refusal is in the live definition, and a foreign id now raises rather than answering.
  if position('no project of this office has that id' in pg_get_functiondef('app.project_export(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'app.project_export does not refuse a project the office does not hold after 1075';
  end if;
end $$;
