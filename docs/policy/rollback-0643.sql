-- Rollback of 0643: hq_create_project loses p_by; the provenance table goes. A project made while 0643 was live keeps its
-- channel if it already has one; one that has not been provisioned yet is then provisioned through the unprompted path
-- (which asks).
begin;
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.hq_create_project(text,text,text,text,boolean,text)'::regprocedure);
  if position('record_channel_authority' in v_def) = 0 then raise exception 'rollback 0643: 0643 is not applied'; end if;
  v_def := replace(v_def, 'p_force boolean DEFAULT false, p_by text DEFAULT NULL::text)', 'p_force boolean DEFAULT false)');
  v_def := replace(v_def, E'  v_refusal text;\nbegin\n  -- A test member makes only a test project; nobody unknown at all (0614''s rule on this door).\n  if btrim(coalesce(p_by, '''')) <> '''' then\n    v_refusal := app.authority_refusal(btrim(p_by), null, null);\n    if v_refusal is not null and app.principal_kind(p_by) <> ''harness'' then\n      return jsonb_build_object(''error'', v_refusal);\n    end if;\n  end if;', E'begin');
  v_def := replace(v_def, E'  -- He made this project, so its normal channel is part of what he asked for - recorded, durably, with who.\n  perform app.record_channel_authority(v_id, p_by, null);\n', '');
  drop function app.hq_create_project(text, text, text, text, boolean, text);
  execute v_def;
end $m$;
drop function public.hq_create_project(text, text, text, text, boolean, text);
create function public.hq_create_project(p_name text, p_connector text, p_ref text, p_display text default null, p_force boolean default false)
returns jsonb language sql security definer set search_path to 'public', 'pg_catalog' as $f$
  select app.hq_create_project(p_name, p_connector, p_ref, p_display, p_force)
$f$;
drop function app.consume_channel_authority(uuid, uuid);
drop function app.channel_authority(uuid);
drop function app.record_channel_authority(uuid, text, uuid);
drop table public.slack_channel_authority;
commit;
