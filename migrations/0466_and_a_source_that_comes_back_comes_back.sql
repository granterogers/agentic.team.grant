-- 0465 marked, archived and un-marked. It did not un-ARCHIVE (#257).
--
-- Driving the function rather than reading it found this in one run: a source
-- that vanished for two passes and then reappeared had its absence marker
-- cleared and stayed `archived` for ever. So a file moved out of a folder and
-- moved back, or a listing that failed twice in a row during an incident, left
-- the office permanently unable to answer from material that is sitting right
-- there in the source.
--
-- #257's own words: *"New, changed, renamed and deleted items converge into
-- the central index."* Converging is symmetric or it is not converging.
--
-- ## Only what THIS mechanism archived
--
-- `missing_since is not null` is what separates "we hid this because it
-- vanished" from "Grant discarded it". A document he archived on purpose has
-- no absence marker, so it stays archived however many times it appears in a
-- listing -- which is the whole point of his decision being about UPSTREAM
-- deletion and not about the archive as a feature.
--
-- The marker is cleared in the same statement, so a restored document is not
-- re-archived by the pass that follows.

create or replace function app.reconcile_vanished(
  p_connector text,
  p_parent_ref text,
  p_seen text[],
  p_limit_fraction numeric default 0.5)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_held int;
  v_absent int;
  v_marked int := 0;
  v_archived int := 0;
  v_returned int := 0;
  v_restored int := 0;
begin
  if coalesce(btrim(p_connector), '') = '' or coalesce(btrim(p_parent_ref), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a connector and a parent are required');
  end if;

  select count(*) into v_held from public.documents
   where connector = p_connector and external_parent_ref = p_parent_ref;

  select count(*) into v_absent from public.documents
   where connector = p_connector and external_parent_ref = p_parent_ref
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
   where connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref = any (coalesce(p_seen, '{}'::text[]))
     and missing_since is not null
     and coalesce(state, '') = 'archived';
  get diagnostics v_restored = row_count;

  -- Anything else that came back simply stops being missing.
  update public.documents
     set missing_since = null
   where connector = p_connector and external_parent_ref = p_parent_ref
     and missing_since is not null
     and external_ref = any (coalesce(p_seen, '{}'::text[]));
  get diagnostics v_returned = row_count;

  -- Strike two: already missing at an earlier pass, and still missing.
  update public.documents
     set state = 'archived'
   where connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref is not null
     and not (external_ref = any (coalesce(p_seen, '{}'::text[])))
     and missing_since is not null
     and coalesce(state, '') <> 'archived';
  get diagnostics v_archived = row_count;

  -- Strike one: absent for the first time. Marked, never hidden.
  update public.documents
     set missing_since = app.now_utc()
   where connector = p_connector and external_parent_ref = p_parent_ref
     and external_ref is not null
     and not (external_ref = any (coalesce(p_seen, '{}'::text[])))
     and missing_since is null;
  get diagnostics v_marked = row_count;

  return jsonb_build_object(
    'ok', true, 'held', v_held, 'absent', v_absent,
    'marked', v_marked, 'archived', v_archived,
    'returned', v_returned, 'restored', v_restored);
end;
$fn$;
