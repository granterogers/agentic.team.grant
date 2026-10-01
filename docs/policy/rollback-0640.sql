-- Rollback of 0640: standing authorizations are tool-wide again; the four tools are disabled (never deleted - a listed
-- gap can become a proposal, a deleted one cannot), and destination-scoped rows are removed with the column.
begin;
do $m$
declare v_def text;
begin
  -- may_act: scoped rows are no longer a thing it has to ignore.
  v_def := pg_get_functiondef('app.may_act(uuid,text,uuid)'::regprocedure);
  if position(E'       and scope_ref is null\n' in v_def) = 0 then
    raise exception 'rollback 0640: 0640 is not applied to app.may_act';
  end if;
  execute replace(v_def, E'       and scope_ref is null\n', '');

  -- authorize_effect: back to eight arguments, without the scoped block.
  v_def := pg_get_functiondef('app.authorize_effect(uuid,text,uuid,text,text,text,uuid,text,text)'::regprocedure);
  v_def := replace(v_def, 'p_legacy_fingerprint text DEFAULT NULL::text, p_scope text DEFAULT NULL::text)',
                          'p_legacy_fingerprint text DEFAULT NULL::text)');
  v_def := replace(v_def, E'v_real    boolean;\n  v_scoped  record;', 'v_real    boolean;');
  if position('A standing yes that is about ONE destination' in v_def) = 0 then
    raise exception 'rollback 0640: 0640 is not applied to app.authorize_effect';
  end if;
  v_def := regexp_replace(v_def, E'  /\\*\n    A standing yes that is about ONE destination.*?\n  end if;\n\n(  if \\(v -> ''standing'')', E'\\1', 's');
  v_def := regexp_replace(v_def, E'  if v_verdict = ''proceed''\n     and coalesce\\(\\(v ->> ''asked_for''\\)::boolean, false\\) is not true\n.*?\n  end if;\n\n(  if v_verdict = ''ask'' and v_answer = ''yes'' then)', E'\\1', 's');
  drop function app.authorize_effect(uuid, text, uuid, text, text, text, uuid, text, text);
  execute v_def;
end $m$;

delete from public.standing_authorizations where scope_ref is not null;
drop function app.record_destination_authority(text, uuid, text, text, uuid, text, boolean);
drop function app.person_provenance(text, uuid);
drop function app.grant_standing(text, uuid, text, text, timestamptz, text);
create function app.grant_standing(p_tool text, p_project uuid, p_reason text, p_by text, p_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
declare v_id uuid; v_refusal text;
begin
  v_refusal := app.authority_refusal(p_by, null, p_project);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'a standing authorization needs a reason — it is what makes it reviewable later');
  end if;
  update public.standing_authorizations
     set revoked_at = app.now_utc(), revoked_reason = 'replaced by a newer standing authorization'
   where tool = p_tool and revoked_at is null
     and project_id is not distinct from p_project;
  insert into public.standing_authorizations (project_id, tool, reason, granted_by, expires_at)
  values (p_project, p_tool, btrim(p_reason), p_by, p_until)
  returning authorization_id into v_id;
  return jsonb_build_object('ok', true, 'authorization', v_id, 'tool', p_tool,
    'scope', case when p_project is null then 'everywhere' else 'this project' end);
end;
$f$;

create or replace function app.standing_never_covers_level_three()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
declare v_level smallint;
begin
  select level into v_level from public.tool_permissions where tool = new.tool;
  if v_level is null then raise exception 'no such tool: %', new.tool; end if;
  if v_level >= 3 then
    raise exception 'a standing authorization may not cover %, which is a level-3 action — those always ask', new.tool;
  end if;
  return new;
end;
$f$;

drop index if exists public.standing_live_globally;
drop index if exists public.standing_live_per_project;
create unique index standing_live_globally on public.standing_authorizations (tool)
  where revoked_at is null and project_id is null;
create unique index standing_live_per_project on public.standing_authorizations (project_id, tool)
  where revoked_at is null and project_id is not null;
alter table public.standing_authorizations drop column scope_ref;

update public.tool_permissions
   set enabled = false, disabled_reason = 'rolled back with 0640: nothing performs this any more'
 where tool in ('task.board.write', 'task.board.delete', 'slack.channel', 'slack.rotate');
alter table public.tool_permissions drop column scoped;
commit;
