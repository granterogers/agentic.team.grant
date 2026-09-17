begin;

-- ---------------------------------------------------------------------------
-- 0382 - rename, move, supersede and pin a document (#152)
--
-- Grant: *"A document opens, and that is all it does. You can read it and talk
-- about it. You cannot rename or retitle it, move it to another dashboard
-- project, mark it superseded by a newer one, or say THIS ONE IS THE IMPORTANT
-- ONE."* And the sentence that says where the gap is: *"`documents` supports
-- most of that and nothing reaches it - the same gap #106 closed for tasks."*
--
-- So this follows `hq_task_update` exactly: one write, the previous value
-- captured first, `app.undo_offer` given the reversal as an API action, and the
-- undo id returned in the result. One idiom for editing a row.
--
-- ## Where this deliberately departs from the issue
--
-- The issue says superseding should reuse `mirrors_document_id` rather than
-- invent a second link, because it is "the same shape pointing the other way".
-- It is the same shape and it is a different FACT, and putting both in one
-- column is the trap this repository has paid for repeatedly: 0169's
-- `mirrors_document_id` means "this is a copy we WROTE OUT to a connector,
-- mirroring that one", and #154's document filter reads it for exactly that
-- meaning three days ago. A column that means two things cannot be filtered on
-- either.
--
-- `superseded_by` is therefore its own column, and `state` - which already has
-- the value 'superseded' and is already filtered by the map and the gallery -
-- is what says that it happened. Two columns that each mean one thing.
--
-- ## Moving, and what it must not orphan
--
-- The issue: *"Moving a document out of a project must not orphan anything that
-- cites it."* Two things point at a document: another document mirroring it,
-- and `document_collections`. A collection belongs to a project, so a move
-- would leave a collection in project A holding a document in project B - a
-- membership nothing would ever show. The move refuses and names what holds it,
-- rather than succeeding into a state nobody can see.
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists pinned boolean not null default false,
  add column if not exists superseded_by uuid references public.documents(document_id);

comment on column public.documents.pinned is
  'Grant said this one is the important one (#152). A flag on the row, not a '
  'separate table - the issue asks for that explicitly and it is right: a '
  'pin is a property of the document, not a relationship.';

comment on column public.documents.superseded_by is
  'The document that replaced this one (#152). NOT mirrors_document_id, which '
  'means "this is a copy we wrote out to a connector" (0169) and is filtered '
  'on for that meaning - a column that means two things cannot be filtered on '
  'either.';

create or replace function app.hq_document_rename(p_document_id uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_was  text;
  v_new  text := btrim(coalesce(p_title, ''));
  v_undo uuid;
begin
  if v_new = '' then
    return jsonb_build_object('error', 'a document needs a title');
  end if;
  select d.title into v_was from public.documents d where d.document_id = p_document_id;
  if v_was is null then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  if v_was = v_new then
    return jsonb_build_object('title', v_was, 'unchanged', true);
  end if;

  update public.documents
     set title = v_new, updated_at = app.now_utc()
   where document_id = p_document_id;

  v_undo := app.undo_offer(
    'document.rename',
    format('Renamed %s', left(v_was, 60)),
    jsonb_build_object('action', 'document_rename',
                       'args', jsonb_build_object('p_document_id', p_document_id,
                                                  'p_title', v_was)));

  return jsonb_build_object('title', v_new, 'was', v_was, 'undo', v_undo);
end;
$$;

create or replace function app.hq_document_move(p_document_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_was_project uuid;
  v_was_name    text;
  v_to_name     text;
  v_title       text;
  v_holds       int;
  v_undo        uuid;
begin
  select d.project_id, d.title into v_was_project, v_title
    from public.documents d where d.document_id = p_document_id;
  if v_title is null then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  if v_was_project = p_project_id then
    return jsonb_build_object('moved', false, 'unchanged', true);
  end if;
  select p.name into v_to_name from public.projects p where p.project_id = p_project_id;
  if v_to_name is null then
    return jsonb_build_object('error', 'there is no project with that id');
  end if;
  select p.name into v_was_name from public.projects p where p.project_id = v_was_project;

  /*
    What would be orphaned, counted before anything moves.

    A collection belongs to a project, so moving a document out of one leaves a
    membership pointing across a boundary that nothing in the interface can
    draw. Refusing and naming the holder is better than a silent success that
    produces a row only a query can see.
  */
  select count(*) into v_holds
    from public.document_collections dc
    join public.collections c on c.collection_id = dc.collection_id
   where dc.document_id = p_document_id
     and c.project_id is distinct from p_project_id;
  if v_holds > 0 then
    return jsonb_build_object('error',
      format('%s is in %s collection(s) on %s. Take it out of those first, or it '
             || 'would belong to a collection in a project it is not in.',
             left(v_title, 40), v_holds, coalesce(v_was_name, 'the other project')));
  end if;

  update public.documents
     set project_id = p_project_id, updated_at = app.now_utc()
   where document_id = p_document_id;

  v_undo := app.undo_offer(
    'document.move',
    format('Moved %s to %s', left(v_title, 40), v_to_name),
    jsonb_build_object('action', 'document_move',
                       'args', jsonb_build_object('p_document_id', p_document_id,
                                                  'p_project_id', v_was_project)));

  return jsonb_build_object('moved', true, 'to', v_to_name,
                            'from', v_was_name, 'undo', v_undo);
end;
$$;

create or replace function app.hq_document_supersede(p_document_id uuid, p_by_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_title text;
  v_by    text;
  v_undo  uuid;
begin
  if p_document_id = p_by_document_id then
    return jsonb_build_object('error', 'a document cannot supersede itself');
  end if;
  select d.title into v_title from public.documents d where d.document_id = p_document_id;
  select d.title into v_by from public.documents d where d.document_id = p_by_document_id;
  if v_title is null or v_by is null then
    return jsonb_build_object('error', 'one of those documents does not exist');
  end if;

  update public.documents
     set state = 'superseded', superseded_by = p_by_document_id, updated_at = app.now_utc()
   where document_id = p_document_id;

  v_undo := app.undo_offer(
    'document.supersede',
    format('Marked %s superseded', left(v_title, 50)),
    jsonb_build_object('action', 'document_restore',
                       'args', jsonb_build_object('p_document_id', p_document_id)));

  return jsonb_build_object('superseded', true, 'by', v_by, 'undo', v_undo);
end;
$$;

create or replace function app.hq_document_restore(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.documents
     set state = 'live', superseded_by = null, updated_at = app.now_utc()
   where document_id = p_document_id;
  return jsonb_build_object('restored', true);
end;
$$;

create or replace function app.hq_document_pin(p_document_id uuid, p_pinned boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_title text;
begin
  select d.title into v_title from public.documents d where d.document_id = p_document_id;
  if v_title is null then
    return jsonb_build_object('error', 'there is no document with that id');
  end if;
  update public.documents
     set pinned = coalesce(p_pinned, false), updated_at = app.now_utc()
   where document_id = p_document_id;
  /*
    No undo on a pin, deliberately. It is its own inverse and it is one press
    away — offering a strip to take back a toggle is furniture, and #118's bar
    means something precisely because it does not appear for everything.
  */
  return jsonb_build_object('pinned', coalesce(p_pinned, false), 'title', v_title);
end;
$$;

create or replace function public.hq_document_rename(p_document_id uuid, p_title text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_document_rename(p_document_id, p_title) $$;
create or replace function public.hq_document_move(p_document_id uuid, p_project_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_document_move(p_document_id, p_project_id) $$;
create or replace function public.hq_document_supersede(p_document_id uuid, p_by_document_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_document_supersede(p_document_id, p_by_document_id) $$;
create or replace function public.hq_document_restore(p_document_id uuid)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_document_restore(p_document_id) $$;
create or replace function public.hq_document_pin(p_document_id uuid, p_pinned boolean)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_document_pin(p_document_id, p_pinned) $$;

revoke all on function public.hq_document_rename(uuid, text) from public;
revoke all on function public.hq_document_move(uuid, uuid) from public;
revoke all on function public.hq_document_supersede(uuid, uuid) from public;
revoke all on function public.hq_document_restore(uuid) from public;
revoke all on function public.hq_document_pin(uuid, boolean) from public;
grant execute on function public.hq_document_rename(uuid, text) to service_role;
grant execute on function public.hq_document_move(uuid, uuid) to service_role;
grant execute on function public.hq_document_supersede(uuid, uuid) to service_role;
grant execute on function public.hq_document_restore(uuid) to service_role;
grant execute on function public.hq_document_pin(uuid, boolean) to service_role;

commit;
