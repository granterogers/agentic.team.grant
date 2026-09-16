begin;

-- ---------------------------------------------------------------------------
-- 0384 - superseded is 'archived' with a pointer, because those are the words
-- the column actually has (#152)
--
-- 0382 wrote `state = 'superseded'` and `documents_state_check` refused it:
-- the allowed values are draft, review, approved and archived. `verify:documents`
-- found it on its first run, which is what it is for.
--
-- Two ways to fix it and only one of them is right. Widening the constraint
-- would give this product two words for "no longer current", and 0311 was
-- spent undoing exactly that in a different vocabulary. So superseding uses
-- the word already there - archived - and `superseded_by` is what says WHY it
-- was archived. A document can be archived for other reasons and have no
-- pointer; it cannot have a pointer and be current.
--
-- ## And restoring has to know what it was
--
-- A draft that gets superseded and then restored must come back a draft, not
-- an approved document - restoring is meant to be exactly the inverse. The
-- previous state travels in the undo payload, which is the only place that
-- still knows it by the time anybody presses the button.
--
-- 0378's plane also filtered `state <> 'superseded'`, a value no row can hold:
-- dead code that looked like a rule. It reads the same word as everything
-- else now.
-- ---------------------------------------------------------------------------

create or replace function app.hq_document_supersede(p_document_id uuid, p_by_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_title text;
  v_by    text;
  v_was   text;
  v_undo  uuid;
begin
  if p_document_id = p_by_document_id then
    return jsonb_build_object('error', 'a document cannot supersede itself');
  end if;
  select d.title, d.state into v_title, v_was
    from public.documents d where d.document_id = p_document_id;
  select d.title into v_by from public.documents d where d.document_id = p_by_document_id;
  if v_title is null or v_by is null then
    return jsonb_build_object('error', 'one of those documents does not exist');
  end if;

  update public.documents
     set state = 'archived', superseded_by = p_by_document_id, updated_at = app.now_utc()
   where document_id = p_document_id;

  v_undo := app.undo_offer(
    'document.supersede',
    format('Marked %s superseded', left(v_title, 50)),
    jsonb_build_object('action', 'document_restore',
                       'args', jsonb_build_object('p_document_id', p_document_id,
                                                  'p_state', coalesce(v_was, 'approved'))));

  return jsonb_build_object('superseded', true, 'by', v_by, 'was', v_was, 'undo', v_undo);
end;
$$;

drop function if exists app.hq_document_restore(uuid);
drop function if exists public.hq_document_restore(uuid);

create or replace function app.hq_document_restore(p_document_id uuid, p_state text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_state text := coalesce(nullif(btrim(coalesce(p_state, '')), ''), 'approved');
begin
  -- Never write a word the column does not have. The default is the one a
  -- document reaches by being approved, which is where a current document
  -- normally sits; anything else must come from the undo payload, which is the
  -- only thing that remembers.
  if v_state not in ('draft', 'review', 'approved', 'archived') then
    v_state := 'approved';
  end if;
  update public.documents
     set state = v_state, superseded_by = null, updated_at = app.now_utc()
   where document_id = p_document_id;
  return jsonb_build_object('restored', true, 'state', v_state);
end;
$$;

create or replace function public.hq_document_restore(p_document_id uuid, p_state text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_document_restore(p_document_id, p_state) $$;

revoke all on function public.hq_document_restore(uuid, text) from public;
grant execute on function public.hq_document_restore(uuid, text) to service_role;

-- And the plane, which filtered on a word no row can hold.
do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.studio_plane(uuid)'::regprocedure;
  if position('''superseded''' in v_def) = 0 then
    raise exception 'the plane no longer filters on that word - read it before replacing';
  end if;
  execute replace(v_def, 'coalesce(d.state, ''live'') <> ''superseded''',
                         'coalesce(d.state, ''approved'') <> ''archived''');
end
$$;

commit;
