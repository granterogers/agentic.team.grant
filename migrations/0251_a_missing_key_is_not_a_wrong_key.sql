-- A missing key is not a wrong key (#81).
--
-- 0250 validated the shape of a saved layout and let a malformed panel
-- through. The check reads:
--
--     where jsonb_typeof(e -> 'x') <> 'number'
--
-- and `e -> 'x'` is SQL NULL when the key is ABSENT. `jsonb_typeof(NULL)` is
-- NULL, `NULL <> 'number'` is NULL, and a WHERE clause counts only rows that
-- are true — so `{"id": "x"}` with no coordinates at all passed, while
-- `{"id": "x", "x": "nope"}` was correctly refused. The wrong type was caught
-- and the missing key was not, which is exactly backwards: a panel with no
-- coordinates is the one that cannot be drawn.
--
-- Found over the real network rather than in SQL, because the direct test
-- happened to pass a wrong type and the API test happened to pass a missing
-- key. Three-valued logic is why `coalesce` belongs around every `jsonb_typeof`
-- in a validity test.
--
-- 0250 is applied and applied migrations are immutable, so this replaces the
-- function rather than editing it.

CREATE OR REPLACE FUNCTION app.hq_dashboard_layout_set(p_slug text, p_panels jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_project uuid;
  v_bad     int;
begin
  select project_id into v_project
    from public.projects
   where slug = p_slug and status = 'active';
  if v_project is null then
    return jsonb_build_object('error', format('no active dashboard project called %s', p_slug));
  end if;

  if jsonb_typeof(p_panels) <> 'array' then
    return jsonb_build_object('error', 'panels must be an array');
  end if;

  -- Nothing left on the board is a reset, not a layout.
  if jsonb_array_length(p_panels) = 0 then
    delete from public.dashboard_layouts
     where project_id = v_project and owner = 'grant';
    return jsonb_build_object('ok', true, 'panels', 0,
      'note', 'the board was emptied, so it is back to its default');
  end if;

  -- `coalesce(..., 'missing')`, so an absent key is a failure rather than a
  -- NULL that the WHERE clause quietly drops. This is the whole change.
  select count(*) into v_bad
    from jsonb_array_elements(p_panels) e
   where coalesce(jsonb_typeof(e), 'missing') <> 'object'
      or coalesce(jsonb_typeof(e -> 'id'), 'missing') <> 'string'
      or coalesce(jsonb_typeof(e -> 'x'), 'missing') <> 'number'
      or coalesce(jsonb_typeof(e -> 'y'), 'missing') <> 'number'
      or coalesce(jsonb_typeof(e -> 'w'), 'missing') <> 'number'
      or coalesce(jsonb_typeof(e -> 'h'), 'missing') <> 'number';
  if v_bad > 0 then
    return jsonb_build_object('error',
      format('%s panel(s) are not {id, x, y, w, h} -- nothing was saved', v_bad));
  end if;

  insert into public.dashboard_layouts (project_id, owner, panels, updated_at)
  values (v_project, 'grant', p_panels, now())
  on conflict (owner, project_id)
    do update set panels = excluded.panels, updated_at = now();

  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels));
end;
$function$;
