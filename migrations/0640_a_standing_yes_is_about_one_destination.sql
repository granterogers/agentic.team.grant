-- 0640 - a standing yes can be about ONE destination, and four duties get tools to be asked about.
--
-- Grant's decisions on #389 (final policy closure):
--   * Vikunja: create/update automatic, DELETE needs approval;
--   * a deliberately connected Notion database carries standing import/update authority for THAT database only;
--   * Slack channels follow an explicit project creation, anything unprompted asks;
--   * every Slack token rotation needs an exact approval, never a standing one.
--
-- None of the four was behind the authorization mechanism at all (they were held only by containment, which tests
-- where work came from, not whether anyone permitted it). This migration gives the mechanism what it needs and
-- nothing parallel to it:
--
--   1. `standing_authorizations.scope_ref` - what a standing yes is ABOUT. A tool flagged `scoped` can only hold a
--      standing row that names a destination (a trigger refuses the tool-wide row), so "the team may write anywhere
--      in Notion" cannot be created by any route. `app.may_act` ignores scoped rows entirely; only
--      `app.authorize_effect`, which is told the destination being written to, can honour one - so a standing yes
--      for one database is not a yes for another.
--   2. Four registry tools: `task.board.write` (level 2, scoped), `task.board.delete` (level 3), `slack.channel`
--      (level 2), `slack.rotate` (level 3). Level 3 cannot hold a standing row (an existing trigger), which is what
--      makes "create/update authority implies delete" and "a standing rotation" structurally impossible.
--   3. `app.record_destination_authority` - the one writer of a scoped standing row. It mints only for a person:
--      a named principal the office admitted as a person, or a job that is a person's own turn (decided from the
--      job's origin in the database, never from a payload).
--
-- Rebuilt from the LIVE definitions of `may_act`, `authorize_effect` and `grant_standing`, and refuses to apply if
-- the text it replaces is not there. The old `authorize_effect` and `grant_standing` signatures are dropped by
-- exact signature, because `create or replace` with a changed argument list makes an ambiguous second overload.

alter table public.tool_permissions add column if not exists scoped boolean not null default false;
comment on column public.tool_permissions.scoped is
  'A scoped tool is authorised per DESTINATION: a standing authorization for it must name one (scope_ref), and one '
  'database''s authorization is not another''s (0640). Unscoped tools behave exactly as before.';

alter table public.standing_authorizations add column if not exists scope_ref text;
comment on column public.standing_authorizations.scope_ref is
  'The destination a standing yes is about (for example notion:<database id>). Null for a tool-wide row, which a '
  'scoped tool may not hold (0640).';

drop index if exists public.standing_live_globally;
drop index if exists public.standing_live_per_project;
create unique index standing_live_globally on public.standing_authorizations (tool, coalesce(scope_ref, ''))
  where revoked_at is null and project_id is null;
create unique index standing_live_per_project on public.standing_authorizations (project_id, tool, coalesce(scope_ref, ''))
  where revoked_at is null and project_id is not null;

create or replace function app.standing_never_covers_level_three()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
declare v_level smallint; v_scoped boolean;
begin
  select level, scoped into v_level, v_scoped from public.tool_permissions where tool = new.tool;
  if v_level is null then
    raise exception 'no such tool: %', new.tool;
  end if;
  if v_level >= 3 then
    raise exception
      'a standing authorization may not cover %, which is a level-3 action — those always ask',
      new.tool;
  end if;
  if v_scoped and coalesce(btrim(new.scope_ref), '') = '' then
    raise exception 'a standing authorization for % must name the destination it is about', new.tool;
  end if;
  if not v_scoped and new.scope_ref is not null then
    raise exception '% is not authorised per destination, so a standing authorization cannot name one', new.tool;
  end if;
  return new;
end;
$f$;

-- ---- the tools ----------------------------------------------------------------------------------------------
insert into public.tool_permissions (tool, level, description, enabled, delivered_by, scoped, in_reply) values
  ('task.board.write', 2,
   'Create or update a task on the connected task board (Vikunja). Authorised per board: connecting it is the yes.',
   true, 'job kind tasks.sync', true, false),
  ('task.board.delete', 3,
   'Delete a task on the connected task board. Always asks, one task at a time, and never holds a standing yes.',
   true, 'job kind tasks.sync, one exact approval per task', false, false),
  ('slack.channel', 2,
   'Create or rename the Slack channel of a project. An explicit project creation by a person authorises its own normal channel; anything unprompted asks.',
   true, 'job kinds office.provision_channels and office.rename_channels', false, false),
  ('slack.rotate', 3,
   'Rotate the Slack configuration token pair. Every rotation needs an exact approval and never holds a standing yes.',
   true, 'job kind office.slack_rotate, one exact approval per rotation', false, false)
on conflict (tool) do update
  set level = excluded.level, description = excluded.description, enabled = true, disabled_reason = null,
      delivered_by = excluded.delivered_by, scoped = excluded.scoped, in_reply = excluded.in_reply;

update public.tool_permissions set scoped = true where tool = 'notion.write';

-- ---- may_act: a scoped standing row is invisible here ---------------------------------------------------------
do $m$
declare
  v_def text;
  v_old constant text := E'     where tool = p_tool\n       and revoked_at is null\n       and (expires_at is null or expires_at > app.now_utc())';
  v_new constant text := E'     where tool = p_tool\n       and scope_ref is null\n       and revoked_at is null\n       and (expires_at is null or expires_at > app.now_utc())';
begin
  v_def := pg_get_functiondef('app.may_act(uuid,text,uuid)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception '0640: the standing lookup is not where it was expected in app.may_act';
  end if;
  execute replace(v_def, v_old, v_new);
end $m$;

-- ---- grant_standing: a scope, and a refusal that is an answer rather than an exception -----------------------
drop function app.grant_standing(text, uuid, text, text, timestamptz);
create function app.grant_standing(p_tool text, p_project uuid, p_reason text, p_by text,
                                   p_until timestamptz default null, p_scope text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
declare v_id uuid; v_refusal text; v_scope text := nullif(btrim(coalesce(p_scope, '')), '');
begin
  -- 0618: a test principal grants a standing authorization only in a fixture project, and nobody unknown at all.
  v_refusal := app.authority_refusal(p_by, null, p_project);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'error', v_refusal);
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false,
      'error', 'a standing authorization needs a reason — it is what makes it reviewable later');
  end if;

  -- Replace rather than collide. Saying it again with a better reason is the common case, and the unique index
  -- would otherwise refuse it. The scope is part of what is replaced: a different destination is a different row.
  update public.standing_authorizations
     set revoked_at = app.now_utc(), revoked_reason = 'replaced by a newer standing authorization'
   where tool = p_tool and revoked_at is null
     and project_id is not distinct from p_project
     and scope_ref is not distinct from v_scope;

  begin
    insert into public.standing_authorizations (project_id, tool, reason, granted_by, expires_at, scope_ref)
    values (p_project, p_tool, btrim(p_reason), p_by, p_until, v_scope)
    returning authorization_id into v_id;
  exception when raise_exception then
    -- The trigger's refusal (a level-3 tool, a scoped tool with no destination) is an ANSWER: the question that
    -- offered it is still answered, and the outcome says why nothing was granted.
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'authorization', v_id, 'tool', p_tool, 'destination', v_scope,
    'scope', case when p_project is null then 'everywhere' else 'this project' end);
end;
$f$;

-- ---- who counts as a person, said once -------------------------------------------------------------------------
-- Null unless the provenance IS a person: a named principal the office admitted as a person (not a test member, not
-- the office key, not a stranger), or a job that is a person's own turn - decided from the job's origin in the
-- database (a production door wrote it, nobody forwarded the words, no duty or office root made it), never from a
-- payload. Every provenance-minting function below asks this one, so two doors cannot come to disagree about it.
create function app.person_provenance(p_by text, p_job uuid)
returns text language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $f$
declare v_req text;
begin
  if btrim(coalesce(p_by, '')) <> '' then
    if app.principal_kind(p_by) <> 'person' then return null; end if;
    return btrim(p_by);
  end if;
  if p_job is null then return null; end if;
  select requested_by into v_req from public.jobs where job_id = p_job;
  if v_req is null or v_req like 'duty:%' or app.job_forwarded(p_job) or app.job_origin(p_job) <> 'trusted' then
    return null;
  end if;
  -- `requested_by` is <channel>:<subject>; the subject must itself be a person the office admitted, so the label of
  -- a channel is never taken for one.
  v_req := nullif(split_part(v_req, ':', 2), '');
  if v_req is null or app.principal_kind(v_req) <> 'person' then return null; end if;
  return v_req;
end;
$f$;

-- ---- the one writer of a destination-scoped yes ---------------------------------------------------------------
create function app.record_destination_authority(p_tool text, p_project uuid, p_scope text, p_by text,
                                                 p_job uuid, p_why text, p_exclusive boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
declare
  v_who text;
  v_scoped boolean;
begin
  select scoped into v_scoped from public.tool_permissions where tool = p_tool and enabled;
  if v_scoped is not true then
    return jsonb_build_object('ok', false, 'error', format('%s is not authorised per destination', p_tool));
  end if;
  if coalesce(btrim(p_scope), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a destination is needed');
  end if;

  v_who := app.person_provenance(p_by, p_job);
  if v_who is null then
    return jsonb_build_object('ok', false, 'error', 'only a person connecting something authorises it');
  end if;

  if p_exclusive then
    update public.standing_authorizations
       set revoked_at = app.now_utc(), revoked_reason = 'the destination changed'
     where tool = p_tool and revoked_at is null and scope_ref is distinct from p_scope
       and project_id is not distinct from p_project;
  end if;

  return app.grant_standing(
    p_tool, p_project,
    format('%s - connected by %s', coalesce(nullif(btrim(p_why), ''), p_scope), v_who),
    v_who, null, p_scope);
end;
$f$;

-- ---- authorize_effect: told the destination, it can honour a scoped standing yes -----------------------------
do $m$
declare
  v_def text;
  v_anchor constant text := E'  if (v -> ''standing'') is not null and v -> ''standing'' <> ''null''::jsonb then\n    return v;\n  end if;';
  v_yes constant text := E'  if v_verdict = ''ask'' and v_answer = ''yes'' then';
begin
  v_def := pg_get_functiondef('app.authorize_effect(uuid,text,uuid,text,text,text,uuid,text)'::regprocedure);
  if position(v_anchor in v_def) = 0 then
    raise exception '0640: the standing check is not where it was expected in app.authorize_effect';
  end if;
  v_def := replace(v_def, 'p_legacy_fingerprint text DEFAULT NULL::text)',
                          'p_legacy_fingerprint text DEFAULT NULL::text, p_scope text DEFAULT NULL::text)');
  v_def := replace(v_def, 'v_real    boolean;', E'v_real    boolean;\n  v_scoped  record;');
  if position(v_yes in v_def) = 0 then
    raise exception '0640: the recorded-yes check is not where it was expected in app.authorize_effect';
  end if;
  -- A tool authorised per destination does not proceed on the dial alone, however permissive the dial: the dial speaks
  -- for a CLASS of work and this authority is about one destination. Somebody asking (a person's own turn), his exact
  -- yes and a standing yes naming this destination still do.
  v_def := replace(v_def, v_yes,
$d$  if v_verdict = 'proceed'
     and coalesce((v ->> 'asked_for')::boolean, false) is not true
     and exists (select 1 from public.tool_permissions tp where tp.tool = p_tool and tp.scoped) then
    v_verdict := 'ask';
    v := v || jsonb_build_object(
      'verdict', 'ask', 'standing', null, 'reason', 'destination_scoped',
      'because', format('%s is authorised one destination at a time, so the setting alone does not cover it.', p_tool));
  end if;

$d$ || v_yes);
  v_def := replace(v_def, v_anchor,
$r$  /*
    A standing yes that is about ONE destination (0640). Honoured only when the caller says which destination it is
    writing to and the row names that same one, and never for an outside audience: a connection is the person's
    consent to the office writing into the thing he connected, not to telling somebody outside.
  */
  if v_verdict = 'ask' and p_scope is not null and p_audience is distinct from 'outside' then
    select authorization_id, project_id, reason, granted_at, expires_at into v_scoped
      from public.standing_authorizations
     where tool = p_tool and scope_ref = p_scope and revoked_at is null
       and (expires_at is null or expires_at > app.now_utc())
       and (project_id is null or project_id = p_project)
     order by (project_id is not null) desc
     limit 1;
    if found then
      return v || jsonb_build_object(
        'verdict', 'proceed',
        'standing', jsonb_build_object(
          'id', v_scoped.authorization_id, 'scope', 'this destination', 'destination', p_scope,
          'reason', v_scoped.reason, 'since', v_scoped.granted_at, 'until', v_scoped.expires_at),
        'because', format('You connected %s, so writing to it does not stop to ask: %s', p_scope, v_scoped.reason));
    end if;
  end if;

$r$ || v_anchor);
  drop function app.authorize_effect(uuid, text, uuid, text, text, text, uuid, text);
  execute v_def;
end $m$;
