-- The home screen is an arrangement too (#219).
--
-- Grant, 14 September: *"The homepage should use the same modular dashboard
-- philosophy as project pages: drag modules, reorder modules, resize modules,
-- collapse modules, persist layout. Do not hard-code one rigid arrangement."*
--
-- 0250 gave every dashboard project one of these and recorded why it is not in
-- `localStorage`: *"he uses more than one device and the whole point of
-- arranging it is that it stays arranged."* The same sentence applies to the
-- screen he lands on, which is the one he will see from the most devices.
--
-- ## Its own table, rather than a nullable project on the existing one
--
-- The obvious move is to let `dashboard_layouts.project_id` be null and mean
-- "the whole workspace". It is also the move CLAUDE.md warns about twice:
-- NULL is not equal to NULL in a unique index, so `primary key (owner,
-- project_id)` would stop constraining anything for exactly the rows this
-- change adds, and `on conflict` would quietly write a second home layout
-- every time one was saved. A partial unique index can be made to work and
-- the sentinel would still be a sentinel -- 0177's argument.
--
-- One row per person, keyed on the person, with no nullable column in the key.
-- The two tables answer two different questions and neither has to pretend.

CREATE TABLE IF NOT EXISTS public.workspace_layouts (
  owner       text        not null primary key default 'grant',
  panels      jsonb       not null,
  updated_at  timestamptz not null default now(),
  -- The same rule as 0250's: a stored empty array is indistinguishable from a
  -- layout that failed to load, and removing the last panel means "put the
  -- default back", not "show me nothing".
  constraint workspace_layouts_panels_is_array
    check (jsonb_typeof(panels) = 'array' and jsonb_array_length(panels) > 0)
);

ALTER TABLE public.workspace_layouts ENABLE ROW LEVEL SECURITY;

-- Set the home arrangement.
--
-- The shape check is 0250's, deliberately identical: a layout that half-saved
-- would be worse than one that did not, and two validators that drift is the
-- thing this repository has paid for repeatedly.
CREATE OR REPLACE FUNCTION app.hq_workspace_layout_set(p_panels jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_bad int;
begin
  if jsonb_typeof(p_panels) <> 'array' then
    return jsonb_build_object('error', 'panels must be an array');
  end if;

  if jsonb_array_length(p_panels) = 0 then
    delete from public.workspace_layouts where owner = 'grant';
    return jsonb_build_object('ok', true, 'panels', 0,
      'note', 'the home screen was emptied, so it is back to its default');
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_panels) e
   where jsonb_typeof(e) <> 'object'
      or jsonb_typeof(e -> 'id') <> 'string'
      or jsonb_typeof(e -> 'x') <> 'number'
      or jsonb_typeof(e -> 'y') <> 'number'
      or jsonb_typeof(e -> 'w') <> 'number'
      or jsonb_typeof(e -> 'h') <> 'number';
  if v_bad > 0 then
    return jsonb_build_object('error',
      format('%s panel(s) are not {id, x, y, w, h} -- nothing was saved', v_bad));
  end if;

  insert into public.workspace_layouts (owner, panels, updated_at)
  values ('grant', p_panels, now())
  on conflict (owner)
    do update set panels = excluded.panels, updated_at = now();

  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels));
end;
$function$;

-- Put it back to the default: forget the row, do not store an empty one.
CREATE OR REPLACE FUNCTION app.hq_workspace_layout_reset()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  with gone as (delete from public.workspace_layouts where owner = 'grant' returning 1)
  select jsonb_build_object('ok', true, 'removed', (select count(*) from gone));
$function$;

-- What the home screen should draw, or null for "you have not arranged it".
CREATE OR REPLACE FUNCTION app.hq_workspace_layout()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'panels', (select panels from public.workspace_layouts where owner = 'grant'),
    'at',     (select updated_at from public.workspace_layouts where owner = 'grant')
  );
$function$;

-- PostgREST only exposes `public`, so every app.* RPC needs a wrapper. Bitten
-- often enough that it is in CLAUDE.md.
CREATE OR REPLACE FUNCTION public.hq_workspace_layout_set(p_panels jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_workspace_layout_set(p_panels) $function$;

CREATE OR REPLACE FUNCTION public.hq_workspace_layout_reset()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_workspace_layout_reset() $function$;

CREATE OR REPLACE FUNCTION public.hq_workspace_layout()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.hq_workspace_layout() $function$;
