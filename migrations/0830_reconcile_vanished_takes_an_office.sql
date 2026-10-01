-- 0830 - the vanished-source reconciler takes an office (multi-user P3, inline SQL engine).
--
-- Before: app.reconcile_vanished(connector, parent_ref, seen[], limit) matched documents on (connector, parent_ref)
-- alone. The notebook sync passes the REMOTE NOTEBOOK ID as the parent, and a notebook can be shared: two offices may
-- each hold different sources from the same remote notebook. A sync of that notebook in office A saw only A's
-- sources, concluded every source of office B under the same parent was "absent", marked it missing on the first pass
-- and ARCHIVED it on the second - taking another office's documents out of its answers. The blast-radius check
-- counted B's rows as A's too, so it could also refuse (or fail to refuse) on the wrong population.
--
-- Now the reconciler takes `p_office uuid` FIRST and every read and write of `documents` carries
-- `office_id = p_office`. The held and absent counts are the office's own, and a document of another office under the
-- same parent is neither marked, archived, restored nor counted.
--
-- The old four-argument signature is KEPT for the moment, deliberately: a Drive function (0503), the public wrapper
-- (0465) and verify:knowledge still call it, and they belong to other clusters. It is the lead's to drop once its last
-- caller has moved; `src/projects/sync.ts`, the notebook sync, no longer calls it.

CREATE FUNCTION app.reconcile_vanished(p_office uuid, p_connector text, p_parent_ref text, p_seen text[], p_limit_fraction numeric DEFAULT 0.5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_held int;
  v_absent int;
  v_marked int := 0;
  v_archived int := 0;
  v_returned int := 0;
  v_restored int := 0;
begin
  perform app.require_office(p_office);
  if coalesce(btrim(p_connector), '') = '' or coalesce(btrim(p_parent_ref), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a connector and a parent are required');
  end if;

  select count(*) into v_held from public.documents
   where office_id = p_office
     and connector = p_connector and external_parent_ref = p_parent_ref;

  select count(*) into v_absent from public.documents
   where office_id = p_office
     and connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref is not null
     and not (external_ref = any (coalesce(p_seen, '{}'::text[])));

  -- The blast radius, checked BEFORE anything is written, so a refusal cannot
  -- leave half the marks behind for the next pass to act on.
  if v_held > 0 and v_absent::numeric / v_held::numeric > p_limit_fraction then
    return jsonb_build_object(
      'ok', false, 'refused', true, 'held', v_held, 'absent', v_absent,
      'error', format(
        '%s of %s sources are missing from this listing, which is more than the %s%% this may act on. '
        'That is likelier to be a failed listing than a deletion, so nothing was changed.',
        v_absent, v_held, round(p_limit_fraction * 100)));
  end if;

  /*
    Back from the dead: seen again, and archived by THIS mechanism.

    Counted separately from an ordinary return, because "a file came back" and
    "a file we had hidden came back and is answerable again" are different
    events and the second is the one worth a sentence.
  */
  update public.documents
     set state = 'approved', missing_since = null
   where office_id = p_office
     and connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref = any (coalesce(p_seen, '{}'::text[]))
     and missing_since is not null
     and coalesce(state, '') = 'archived';
  get diagnostics v_restored = row_count;

  -- Anything else that came back simply stops being missing.
  update public.documents
     set missing_since = null
   where office_id = p_office
     and connector = p_connector and external_parent_ref = p_parent_ref
     and missing_since is not null
     and external_ref = any (coalesce(p_seen, '{}'::text[]));
  get diagnostics v_returned = row_count;

  -- Strike two: already missing at an earlier pass, and still missing.
  update public.documents
     set state = 'archived'
   where office_id = p_office
     and connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref is not null
     and not (external_ref = any (coalesce(p_seen, '{}'::text[])))
     and missing_since is not null
     and coalesce(state, '') <> 'archived';
  get diagnostics v_archived = row_count;

  -- Strike one: absent for the first time. Marked, never hidden.
  update public.documents
     set missing_since = app.now_utc()
   where office_id = p_office
     and connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref is not null
     and not (external_ref = any (coalesce(p_seen, '{}'::text[])))
     and missing_since is null;
  get diagnostics v_marked = row_count;

  return jsonb_build_object(
    'ok', true, 'held', v_held, 'absent', v_absent,
    'marked', v_marked, 'archived', v_archived,
    'returned', v_returned, 'restored', v_restored);
end;
$function$;

-- app functions are reached by the worker, never by a browser role or the service key.
revoke all on function app.reconcile_vanished(uuid, text, text, text[], numeric) from public, anon, authenticated, service_role;

comment on function app.reconcile_vanished(uuid, text, text, text[], numeric) is
  'Reconcile one parent''s cached sources against a fresh listing, INSIDE one office (0830). Two strikes before a source is archived; refuses a pass that would hide more than p_limit_fraction of what the office holds.';
