-- 1023 - a project's arrangement row carries a revision, and a save may say which revision it was made from (#442).
--
-- THE DEFECT THIS CLOSES. `dashboard_layout_set` upserted one row per (person, project, surface), last writer wins. The page
-- (ADR-0068) therefore merged notes before and after every save so that two devices could not erase each other's Post-its,
-- but two devices could still interleave a read, a merge and a write inside a few milliseconds, and the loser was repaired only
-- by a later check. A revision on the row turns that window into a refusal the loser can see and reconcile.
--
-- WHAT IS ADDED (additive; every existing caller keeps working):
--   1. public.dashboard_layouts.rev: a revision taken from ONE sequence, assigned by a trigger on every insert and update, so it
--      is correct for every writer (the gateway function, undo, anything added later), and it never repeats: a plain counter
--      per row would restart at 1 when a reset deleted the row and a stale device that remembered "1" would match a different
--      row (the ABA case). A row that does not exist has revision 0.
--   2. app.hq_dashboard_layout_set gains an optional p_expected_rev. Null is the old behaviour exactly (last writer wins). A
--      number is compare-and-swap: the save happens only if the stored revision is that number, otherwise nothing is written
--      and the answer is { conflict: true, rev, panels, now } so the caller can merge and try again. Saves of one
--      (person, project, surface) are serialised by an advisory transaction lock, because a row that does not exist yet cannot
--      be locked with FOR UPDATE and two first saves would otherwise both succeed.
--   3. public.hq_dashboard_layout_get(p_office, p_slug, p_surface): one project's arrangement and its revision, so the page no
--      longer has to read the whole studio payload to learn either. It also returns `now`, the database clock in milliseconds,
--      so a device with a wrong clock can stamp its notes in server time.
--
-- WHAT IS NOT CHANGED: the table's key (owner, project, surface), its CHECKs (an empty layout is still a reset, never stored),
-- the office check, the reset function, the studio payload, and the per-person scope (owner is app.office_actor(p_office)).
--
-- ROLLBACK (leaves the arrangement rows themselves untouched): see the end of this file.

begin;

create sequence if not exists public.dashboard_layouts_rev_seq as bigint;

alter table public.dashboard_layouts add column if not exists rev bigint;
update public.dashboard_layouts set rev = nextval('public.dashboard_layouts_rev_seq') where rev is null;
alter table public.dashboard_layouts alter column rev set not null;
alter table public.dashboard_layouts alter column rev set default nextval('public.dashboard_layouts_rev_seq');

comment on column public.dashboard_layouts.rev is
  'A revision from one sequence, assigned by dashboard_layouts_rev on every insert and update, so it never repeats. '
  'A save can name the revision it was made from (hq_dashboard_layout_set p_expected_rev) and is refused if the row has moved on. '
  'A row that does not exist is revision 0.';

create or replace function app.dashboard_layouts_rev() returns trigger
language plpgsql
security definer
set search_path to ''
as $f$
begin
  new.rev := nextval('public.dashboard_layouts_rev_seq');
  return new;
end
$f$;
revoke all on function app.dashboard_layouts_rev() from public, anon, authenticated, service_role;

drop trigger if exists dashboard_layouts_rev on public.dashboard_layouts;
create trigger dashboard_layouts_rev before insert or update on public.dashboard_layouts
  for each row execute function app.dashboard_layouts_rev();

-- The writer. The old signature is dropped by its exact argument list first: `create or replace` with a changed argument list
-- would leave two overloads and make a four-argument call ambiguous (and the public wrapper is the half that drops a parameter).
drop function if exists public.hq_dashboard_layout_set(uuid, text, jsonb, text);
drop function if exists app.hq_dashboard_layout_set(uuid, text, jsonb, text);

create function app.hq_dashboard_layout_set(
  p_office uuid, p_slug text, p_panels jsonb, p_surface text default 'studio', p_expected_rev bigint default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_project uuid;
  v_owner text;
  v_rev bigint;
  v_panels jsonb;
  v_now bigint := (extract(epoch from app.now_utc()) * 1000)::bigint;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects where slug = p_slug and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  if coalesce(p_surface, '') not in ('studio', 'basecamp') then
    return jsonb_build_object('error', format('%L is not a surface', p_surface));
  end if;
  v_owner := app.office_actor(p_office);

  if p_expected_rev is not null then
    -- Serialise the saves of this one arrangement, whether or not its row exists yet.
    perform pg_advisory_xact_lock(hashtextextended(v_owner || '/' || v_project::text || '/' || p_surface, 0));
    select l.rev, l.panels into v_rev, v_panels from public.dashboard_layouts l
     where l.owner = v_owner and l.project_id = v_project and l.surface = p_surface;
    if not found then
      v_rev := 0;
    end if;
    if v_rev <> p_expected_rev then
      return jsonb_build_object('conflict', true, 'rev', v_rev, 'panels', v_panels, 'now', v_now);
    end if;
  end if;

  -- ADR-0021: an empty layout is a RESET, never a stored value. `[]` cannot be told apart from a layout that failed to load,
  -- so the row goes and the default comes back -- enforced here rather than only in the page.
  if p_panels is null or jsonb_typeof(p_panels) <> 'array' or jsonb_array_length(p_panels) = 0 then
    delete from public.dashboard_layouts
     where project_id = v_project and owner = v_owner and surface = p_surface;
    return jsonb_build_object('ok', true, 'reset', true, 'rev', 0, 'now', v_now);
  end if;
  insert into public.dashboard_layouts (owner, project_id, surface, panels, updated_at)
  values (v_owner, v_project, p_surface, p_panels, app.now_utc())
  on conflict (owner, project_id, surface)
    do update set panels = excluded.panels, updated_at = excluded.updated_at
  returning rev into v_rev;
  return jsonb_build_object('ok', true, 'panels', jsonb_array_length(p_panels), 'rev', v_rev, 'now', v_now);
end;
$function$;

create function public.hq_dashboard_layout_set(
  p_office uuid, p_slug text, p_panels jsonb, p_surface text default 'studio', p_expected_rev bigint default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_dashboard_layout_set(p_office, p_slug, p_panels, p_surface, p_expected_rev) $f$;

revoke all on function app.hq_dashboard_layout_set(uuid, text, jsonb, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.hq_dashboard_layout_set(uuid, text, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public.hq_dashboard_layout_set(uuid, text, jsonb, text, bigint) to service_role;

-- The reader: one arrangement and its revision. Absent is { panels: null, rev: 0 }.
create function app.hq_dashboard_layout_get(p_office uuid, p_slug text, p_surface text default 'basecamp')
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_project uuid;
  v_row record;
  v_now bigint := (extract(epoch from app.now_utc()) * 1000)::bigint;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects where slug = p_slug and office_id = p_office;
  if v_project is null then
    return jsonb_build_object('error', format('no project called %L', p_slug));
  end if;
  if coalesce(p_surface, '') not in ('studio', 'basecamp') then
    return jsonb_build_object('error', format('%L is not a surface', p_surface));
  end if;
  select l.panels, l.rev into v_row from public.dashboard_layouts l
   where l.owner = app.office_actor(p_office) and l.project_id = v_project and l.surface = p_surface;
  if not found then
    return jsonb_build_object('panels', null, 'rev', 0, 'now', v_now);
  end if;
  return jsonb_build_object('panels', v_row.panels, 'rev', v_row.rev, 'now', v_now);
end;
$function$;

create function public.hq_dashboard_layout_get(p_office uuid, p_slug text, p_surface text default 'basecamp')
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_dashboard_layout_get(p_office, p_slug, p_surface) $f$;

revoke all on function app.hq_dashboard_layout_get(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.hq_dashboard_layout_get(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_dashboard_layout_get(uuid, text, text) to service_role;

commit;

-- ROLLBACK, in this order (nothing here deletes an arrangement):
--   drop function public.hq_dashboard_layout_get(uuid, text, text);
--   drop function app.hq_dashboard_layout_get(uuid, text, text);
--   drop function public.hq_dashboard_layout_set(uuid, text, jsonb, text, bigint);
--   drop function app.hq_dashboard_layout_set(uuid, text, jsonb, text, bigint);
--   then re-create the four-argument pair from migration 0711 (app) and 0582 (public wrapper), exactly as they were;
--   drop trigger dashboard_layouts_rev on public.dashboard_layouts;  drop function app.dashboard_layouts_rev();
--   alter table public.dashboard_layouts drop column rev;  drop sequence public.dashboard_layouts_rev_seq;
-- Roll the gateway and page back FIRST: a page that sends p_expected_rev to a database without it gets an error from PostgREST.
