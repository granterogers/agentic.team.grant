-- Upstream deletions finally reconcile, under ADR-0040 (#257).
--
-- `countRemoved` in src/projects/sync.ts has counted vanished sources since it
-- was written and deliberately never acted on them. Its comment gives three
-- reasons, and they are good ones:
--
--   1. a source missing from ONE listing is not proof of deletion -- a partial
--      listing during a provider incident would otherwise empty the cache;
--   2. something may cite it: a brief records source_fingerprints, and removing
--      the text they refer to makes past briefs unauditable;
--   3. deleting is not reversible and keeping is.
--
-- It then says a real policy needs Grant's decision. He made it on 2026-09-17
-- (ADR-0040): archive and hide, keep provenance, make restoration possible.
--
-- That answers (2) and (3) outright -- an archived document keeps its row, its
-- content, its fingerprint and its relations, and 0464 takes it out of
-- ordinary retrieval rather than out of existence. It does NOT answer (1), so
-- this migration answers it with two mechanisms rather than optimism.
--
-- ## Two strikes
--
-- `documents.missing_since` is stamped the first time a source is not in a
-- listing, and cleared the moment it comes back. Only a document that was
-- already missing at a previous pass is archived. One bad listing marks; it
-- never hides. The notebook sync runs hourly, so a genuine deletion is
-- reconciled within about two hours, and an incident that resolves inside that
-- window costs nothing at all.
--
-- ## A blast radius
--
-- Even two consecutive empty listings should not be able to archive an entire
-- project's knowledge. A pass that would archive more than half of what a
-- parent holds does nothing and says so, because the likeliest cause of
-- "everything vanished" is an auth failure or a changed API, not Grant
-- deleting forty files between two hourly passes. The refusal is reported, not
-- swallowed: a sync that silently declines to reconcile is the same defect as
-- one that silently empties the cache.

alter table public.documents
  add column if not exists missing_since timestamptz;

comment on column public.documents.missing_since is
  'When this document was first absent from its source listing (#257, ADR-0040). '
  'Cleared when it reappears. Two consecutive absences archive it; one never does, '
  'because a partial listing during a provider incident is indistinguishable from '
  'a deletion at the moment it happens.';

create index if not exists documents_missing_since
  on public.documents (missing_since)
  where missing_since is not null;

/*
  Reconcile one parent's listing.

  Takes what WAS seen rather than what was missed, because the caller knows the
  first for certain and would have to derive the second -- and a derived list
  that is wrong archives real material.
*/
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

  /*
    The blast radius, checked BEFORE anything is written.

    Refusing after marking half the project would leave the marks behind for
    the next pass to act on, which is the failure this guard exists to stop
    arriving one hour late.
  */
  if v_held > 0 and v_absent::numeric / v_held::numeric > p_limit_fraction then
    return jsonb_build_object(
      'ok', false, 'refused', true, 'held', v_held, 'absent', v_absent,
      'error', format(
        '%s of %s sources are missing from this listing, which is more than the %s%% this may act on. '
        'That is likelier to be a failed listing than a deletion, so nothing was changed.',
        v_absent, v_held, round(p_limit_fraction * 100)));
  end if;

  -- Anything that came back stops being missing, whatever it was before.
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
    'marked', v_marked, 'archived', v_archived, 'returned', v_returned);
end;
$fn$;

comment on function app.reconcile_vanished(text, text, text[], numeric) is
  'Converge an upstream listing into the index (#257, ADR-0040): mark on the first '
  'absence, archive on the second, un-mark on return, and refuse a pass that would '
  'archive more than a fraction of what the parent holds.';

create or replace function public.reconcile_vanished(
  p_connector text, p_parent_ref text, p_seen text[], p_limit_fraction numeric default 0.5)
returns jsonb language sql security definer set search_path to ''
as $w$ select app.reconcile_vanished(p_connector, p_parent_ref, p_seen, p_limit_fraction) $w$;

/*
  Restoring one, which is the half ADR-0040 insists on.

  Archiving is only honest as a policy if coming back is an ordinary action
  rather than a migration. `hq_document_restore` already exists and takes a
  target state; this clears the absence marker with it, so a restored document
  is not re-archived by the very next pass.
*/
create or replace function app.unarchive_document(p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_title text; v_was text;
begin
  select title, state into v_title, v_was
    from public.documents where document_id = p_document;
  if v_title is null then
    return jsonb_build_object('ok', false, 'error', 'no such document');
  end if;
  update public.documents
     set state = 'approved', missing_since = null
   where document_id = p_document;
  return jsonb_build_object('ok', true, 'title', v_title, 'was', v_was);
end;
$fn$;
