-- 0773 - the project router resolves only inside the office (multi-user P3, cluster g-context).
--
-- "Which project is this about?" is the decision every message begins with. app.resolve_project took a scope and some
-- words and searched every project there is: an identifier in the words, a Slack channel, the scope's last switch, a
-- name. Each of those steps is now asked of ONE office (references_in, project_for_slack_channel, current_project and
-- resolve_project_by_name already take it), so a name that belongs to another office's project resolves to nothing.
--
-- An explicit project the caller "already resolved" is checked rather than trusted: another office's project id and
-- a nonexistent one both come back null, which the callers already read as ASK.
--
-- Dropped here: the old resolve_project, the old references_in and project_for_slack_channel (their only caller was the
-- old resolve_project), the old add_project_alias (app and public; the office-explicit one exists since 0711) and the
-- public door public.resolve_project_by_name(text), which resolved a name across every office.
--
-- Left in place on purpose until its last caller moves (the lead drops it): app.resolve_project_by_name(text, boolean).
-- app.voice_lookup, in the voice door, still calls it; schema app is not executable by any browser role. When the lead
-- gives voice_lookup an office, it calls app.resolve_project_by_name(p_office, text, boolean), which already exists.

create function app.resolve_project(p_office uuid, p_scope_kind project_scope_kind, p_scope_ref text, p_explicit uuid DEFAULT NULL::uuid, p_said text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mapped uuid;
  v_named  uuid;
  v_count  integer;
begin
  perform app.require_office(p_office);
  -- 1. What the caller already resolved - when it is a project of THIS office. Another office's project and a
  --    project that does not exist are the same answer: nothing, which the callers read as ASK.
  if p_explicit is not null then
    return app.office_project(p_office, p_explicit);
  end if;

  -- 2. An identifier for something we are attached to, appearing in the words
  --    themselves. Above the channel map on purpose: a notebook id pasted into
  --    a project's own channel is somebody talking about that notebook, and
  --    the channel is the weaker signal because it is ambient. The id was
  --    typed. Declines when two projects match, like every other step here.
  if p_said is not null then
    select count(*), (array_agg(r.project_id))[1]
      into v_count, v_named
      from (select distinct project_id from app.references_in(p_office, p_said)) r;
    if v_count = 1 then
      return v_named;
    end if;
  end if;

  -- 3. A permanent channel mapping. Outranks a switch made IN that channel:
  --    the map is deliberate configuration, and a passing "let's look at X"
  --    must not silently repoint the team's project channel.
  if p_scope_kind = 'slack_channel' then
    v_mapped := app.project_for_slack_channel(p_office, p_scope_ref);
    if v_mapped is not null then
      return v_mapped;
    end if;
  end if;

  -- 4. The scope's current switch.
  v_mapped := app.current_project(p_office, p_scope_kind, p_scope_ref);
  if v_mapped is not null then
    return v_mapped;
  end if;

  -- 5. A NAME in what was said, and only when it is unambiguous. Below the
  --    switch, unlike an identifier above it: a name is a phrase and a phrase
  --    can be in passing.
  if p_said is not null then
    select count(*), (array_agg(r.project_id))[1]
      into v_count, v_named
      from app.resolve_project_by_name(p_office, p_said) r
     where r.confidence >= 0.90;
    if v_count = 1 then
      return v_named;
    end if;
  end if;

  -- 6. Null, meaning ASK. Deliberately not "the most recently touched
  --    project", which is how work lands in the wrong place while looking
  --    entirely reasonable.
  return null;
end;
$function$;

revoke all on function app.resolve_project(uuid, project_scope_kind, text, uuid, text) from public, anon, authenticated, service_role;


drop function app.resolve_project(project_scope_kind, text, uuid, text);
drop function app.references_in(text);
drop function app.project_for_slack_channel(text);
drop function app.add_project_alias(uuid, text, text, numeric);
drop function public.add_project_alias(uuid, text, text, numeric);
drop function public.resolve_project_by_name(text);
