begin;

-- ---------------------------------------------------------------------------
-- 0400 - appearance belongs to the person, not to the browser (#124, ADR-0021)
--
-- #124 asks for a density control and ends with the requirement that makes it
-- more than a token swap:
--
--   > "And it belongs in the office. ADR-0021. It is a preference he composed
--   >  and would be annoyed to lose on the other device."
--
-- There was nowhere to put it. `web/studio/appearance.js` keeps the WHOLE
-- object - scheme, palette, texture and the uploaded texture data - in one
-- localStorage key, and ADR-0021 is explicit that this is the wrong side of
-- the line:
--
--   > "The office - anything the person composed and would be annoyed to lose:
--   >  an arrangement, a saved view, a written note, A PREFERENCE ABOUT HOW THE
--   >  WORK IS SHOWN."
--   > "Any new customisable surface should add a column or a table, not a key
--   >  in localStorage."
--
-- ## All four, not just the new one
--
-- Density alone would leave one settings pane with two persistence mechanisms
-- - the new preference following him and the three beside it not - which is
-- the two-vocabularies trap 0311 was spent undoing. His dark concrete does not
-- follow him today either, and that is the same defect rather than a separate
-- one.
--
-- ## Keyed by owner, like every other thing ADR-0021 moved
--
-- `dashboard_layouts` is `(project_id, owner, panels)` with owner = 'grant'.
-- This is the same shape without the project, because appearance is not about
-- one project. The owner column is carried now for the reason that one is:
-- the day there is a second person it is needed, and the cost of carrying it
-- is one word per query.
--
-- ## Bounded, because one of the values is an image
--
-- `own` holds an uploaded texture as a data URI. #83 settled the size
-- discipline - a mark goes in resized, about fifteen kilobytes - and a row
-- nobody bounded is how a 500 MB free tier disappears. 96 KB is generous
-- against that and refuses a photograph pasted straight off a camera, with a
-- sentence rather than silently.
-- ---------------------------------------------------------------------------

create table if not exists public.appearance_settings (
  owner      text primary key,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default app.now_utc(),
  constraint appearance_is_an_object check (jsonb_typeof(settings) = 'object'),
  constraint appearance_is_bounded check (length(settings::text) <= 98304)
);

comment on table public.appearance_settings is
  'How the studio looks, per person (#124, ADR-0021). One jsonb rather than a '
  'column each: the page already treats it as one object and a column per '
  'value would need a migration every time a palette is added. localStorage '
  'is the cache in front of this, never the record.';

create or replace function app.hq_appearance(p_owner text default 'grant')
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce((select a.settings from public.appearance_settings a
                    where a.owner = coalesce(nullif(btrim(p_owner), ''), 'grant')),
                  '{}'::jsonb)
$$;

comment on function app.hq_appearance(text) is
  'What this person chose, or an empty object (#124, 0400). Empty means '
  'nothing has been chosen, NOT that the defaults are these - the defaults '
  'live in the page, where they can be seen beside the thing they affect.';

create or replace function app.hq_appearance_set(
  p_settings jsonb,
  p_owner    text default 'grant'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_owner text := coalesce(nullif(btrim(p_owner), ''), 'grant');
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return jsonb_build_object('error', 'appearance must be an object');
  end if;
  /*
    Checked here as well as by the constraint, so the answer is a sentence the
    page can show rather than a 23514 the adapter turns into "upstream failed".
    An uploaded texture is the only value that can approach this.
  */
  if length(p_settings::text) > 98304 then
    return jsonb_build_object('error',
      'that is too large to keep - an uploaded texture should be resized first');
  end if;

  insert into public.appearance_settings (owner, settings, updated_at)
  values (v_owner, p_settings, app.now_utc())
  on conflict (owner) do update
    set settings = excluded.settings, updated_at = excluded.updated_at;

  return jsonb_build_object('saved', true, 'settings', p_settings);
end;
$$;

comment on function app.hq_appearance_set(jsonb, text) is
  'Remember how the studio should look (#124, 0400). The whole object at once, '
  'because that is how the page holds it and a partial write would need the '
  'caller to know which keys exist.';

create or replace function public.hq_appearance_set(p_settings jsonb, p_owner text default 'grant')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_appearance_set(p_settings, p_owner) $$;

revoke all on function public.hq_appearance_set(jsonb, text) from public;
grant execute on function public.hq_appearance_set(jsonb, text) to service_role;

/*
  And into the payload the studio already fetches, beside contactLabels.

  Patched from the live definition: `hq_studio` is a wrapper of two lines
  today, and transcribing even that is how a caller gets dropped.
*/
do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.hq_studio()'::regprocedure;
  if position('''contactLabels'', app.contact_labels(''grant'')' in v_def) = 0 then
    raise exception 'hq_studio is not shaped as expected - read it before patching';
  end if;
  if position('hq_appearance' in v_def) > 0 then
    raise exception 'it already carries the appearance';
  end if;
  v_def := replace(v_def,
    '''contactLabels'', app.contact_labels(''grant'')',
    '''contactLabels'', app.contact_labels(''grant''),' || E'\n' ||
    '                            ''appearance'', app.hq_appearance(''grant'')');
  execute v_def;
end
$$;

commit;
