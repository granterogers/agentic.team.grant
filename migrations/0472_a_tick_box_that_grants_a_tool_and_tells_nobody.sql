/*
  0472 — the checkbox writes the ledger, and there is one writer for it

  `public.events` holds 42 `tool.granted` and 42 `tool.revoked` rows, every one
  of them written by `app.approve_tool` or `app.revoke_tool` — the request
  path, which an agent starts and Grant answers on the Governance page.

  The TEAM page's checkbox is the other way in, and it writes nothing.
  `app.hq_staff_tool_set` inserts into `staff_tools` or deletes from it and
  returns; so every capability Grant granted or took back with the control he
  actually uses is absent from the record, while the identical change made
  through a request is recorded in full. An audit trail with a second door in
  it is not an audit trail, and the missing half is precisely the half a person
  performed by hand.

  Two writers, same field, one of them silent — CLAUDE.md's own trap, and this
  is the third instance in this file's list. The fix is not a second event
  statement beside the first: it is that `app.revoke_tool` delegates, so the
  event is written wherever the change comes from and cannot drift again.

  `p_by` is added to `hq_staff_tool_set` so the ledger can say who: the
  checkbox is Grant, and `revoke_tool` passes through whoever it was told. The
  argument list changes, so both halves are dropped by exact signature first —
  `create or replace` would leave a second overload and make every call
  ambiguous. The public wrapper is SQL-language and therefore depends on the
  app function, so it goes first.

  The event fires only when something actually CHANGED. Ticking a box that was
  already ticked is not a grant, and a ledger that records it teaches the
  reader to skim.
*/

drop function if exists public.hq_staff_tool_set(text, text, boolean);
drop function if exists app.hq_staff_tool_set(text, text, boolean);

create function app.hq_staff_tool_set(
  p_slug text,
  p_tool text,
  p_granted boolean,
  p_by text default 'grant'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_enabled boolean;
  v_reason  text;
  v_changed boolean;
begin
  if not exists (select 1 from public.staff where slug = p_slug) then
    return jsonb_build_object('error', format('no one called %L', p_slug));
  end if;

  select enabled, disabled_reason into v_enabled, v_reason
    from public.tool_permissions where tool = p_tool;
  if not found then
    return jsonb_build_object('error', format('there is no tool called %L', p_tool));
  end if;

  -- Refused rather than accepted-and-ignored. A checkbox that ticks and then
  -- does nothing is worse than one that refuses and says why: the first one
  -- teaches you the permission is on.
  if p_granted and not v_enabled then
    return jsonb_build_object(
      'error', format('%s is switched off for everyone: %s', p_tool, coalesce(v_reason, 'no reason recorded'))
    );
  end if;

  if p_granted then
    insert into public.staff_tools (staff_slug, tool, granted_by, note)
    values (p_slug, p_tool, p_by, 'Granted from the team page.')
    on conflict (staff_slug, tool) do nothing;
  else
    delete from public.staff_tools where staff_slug = p_slug and tool = p_tool;
  end if;
  v_changed := found;

  /*
    The ledger, in the same words the request path uses.

    `tool.granted` and `tool.revoked` are the action types already on record —
    a third spelling for the same fact would make the two doors unjoinable,
    which is what 0311 was spent undoing in a different vocabulary.
  */
  if v_changed then
    perform public.append_event(
      extensions.gen_random_uuid(), 'user', p_by, 'approval',
      case when p_granted then 'tool.granted' else 'tool.revoked' end,
      true, null,
      jsonb_build_object('held', not p_granted),
      jsonb_build_object('held', p_granted),
      format('%s %s holds %s.', p_slug,
             case when p_granted then 'now' else 'no longer' end, p_tool),
      '[]'::jsonb, null, p_tool,
      case when p_granted then 'app.revoke_tool' else 'app.hq_staff_tool_set on again' end,
      null);
  end if;

  return jsonb_build_object('slug', p_slug, 'tool', p_tool, 'granted', p_granted,
                            'changed', v_changed);
end;
$function$;

create function public.hq_staff_tool_set(p_slug text, p_tool text, p_granted boolean)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_staff_tool_set(p_slug, p_tool, p_granted, 'grant') $$;

revoke all on function public.hq_staff_tool_set(text, text, boolean) from public;
grant execute on function public.hq_staff_tool_set(text, text, boolean) to service_role;
grant execute on function app.hq_staff_tool_set(text, text, boolean, text) to ai_team_app, service_role;

-- ---------------------------------------------------------------------------
-- One writer for taking a tool back
-- ---------------------------------------------------------------------------

/*
  Its own words are kept — "%s does not hold %s" is what the Governance page
  and `verify:capability` read back — and its body is now one call, so a future
  change to what revoking MEANS cannot land in one door and not the other.
*/
create or replace function app.revoke_tool(p_slug text, p_tool text, p_by text default 'grant')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_out jsonb;
begin
  v_out := app.hq_staff_tool_set(p_slug, p_tool, false, p_by);
  if v_out ? 'error' then
    return v_out;
  end if;
  if not coalesce((v_out->>'changed')::boolean, false) then
    return jsonb_build_object('error', format('%s does not hold %s', p_slug, p_tool));
  end if;
  return jsonb_build_object('revoked', p_tool, 'from', p_slug);
end;
$$;

comment on function app.hq_staff_tool_set(text, text, boolean, text) is
  'Grant or take back one tool from one person, and record it (0472). The only '
  'writer: app.revoke_tool calls this, because the team page wrote nothing to '
  'the ledger for months while the request path recorded every change.';
