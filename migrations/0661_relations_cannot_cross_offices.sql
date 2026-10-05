-- 0661 - polymorphic relations cannot cross offices (multi-user P2).
--
-- public.relations names its two endpoints as (kind, id) with no foreign key, so a composite key cannot reach them and
-- an endpoint can be anything. The smallest structural check is a trigger that resolves each endpoint to the table its
-- kind names, requires it to exist, and requires its owner to be the owner of the relation's own project. An endpoint of
-- kind agent names the shared roster (staff are not owned) and is not checked for an office. Nothing about the caller
-- is consulted: a service-role writer passes through the same trigger.

create function app.relation_endpoint_office(p_kind text, p_id uuid)
returns uuid
language sql
stable
set search_path to ''
as $f$
  select case p_kind
    when 'document'   then (select d.office_id from public.documents d where d.document_id = p_id)
    when 'task'       then (select t.office_id from public.tasks t where t.task_id = p_id)
    when 'job'        then (select j.office_id from public.jobs j where j.job_id = p_id)
    when 'contact'    then (select pr.office_id from public.contacts c join public.projects pr on pr.project_id = c.project_id where c.contact_id = p_id)
    when 'collection' then (select pr.office_id from public.collections c join public.projects pr on pr.project_id = c.project_id where c.collection_id = p_id)
    when 'source'     then (select pr.office_id from public.project_attachments a join public.projects pr on pr.project_id = a.project_id where a.attachment_id = p_id)
  end
$f$;

create function app.relations_stay_in_one_office()
returns trigger
language plpgsql
set search_path to ''
as $f$
declare
  v_own uuid;
  v_end uuid;
begin
  select pr.office_id into v_own from public.projects pr where pr.project_id = new.project_id;
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    if v_own is distinct from (select pr.office_id from public.projects pr where pr.project_id = old.project_id) then
      raise exception 'relations: a relation cannot move to another office' using errcode = '23514';
    end if;
  end if;
  if new.from_kind <> 'agent' then
    v_end := app.relation_endpoint_office(new.from_kind, new.from_id);
    if v_end is distinct from v_own then
      raise exception 'relations: the from endpoint (%) is not a row of this office', new.from_kind using errcode = '23514';
    end if;
  end if;
  if new.to_kind <> 'agent' then
    v_end := app.relation_endpoint_office(new.to_kind, new.to_id);
    if v_end is distinct from v_own then
      raise exception 'relations: the to endpoint (%) is not a row of this office', new.to_kind using errcode = '23514';
    end if;
  end if;
  return new;
end
$f$;

revoke all on function app.relation_endpoint_office(text, uuid), app.relations_stay_in_one_office() from public, anon, authenticated, service_role;

do $m$
declare
  v_bad bigint;
begin
  -- the rows that exist must already satisfy it, or this stops and says how many do not
  select count(*) into v_bad from public.relations r
   where (r.from_kind <> 'agent' and app.relation_endpoint_office(r.from_kind, r.from_id) is distinct from (select pr.office_id from public.projects pr where pr.project_id = r.project_id))
      or (r.to_kind <> 'agent' and app.relation_endpoint_office(r.to_kind, r.to_id) is distinct from (select pr.office_id from public.projects pr where pr.project_id = r.project_id));
  if v_bad > 0 then raise exception '0661: % existing relation(s) cross offices or name a row that does not exist', v_bad; end if;
end $m$;

create trigger a3_relation_endpoints before insert or update of project_id, from_kind, from_id, to_kind, to_id on public.relations
  for each row execute function app.relations_stay_in_one_office();

-- ROLLBACK (not part of the migration): drop trigger a3_relation_endpoints on public.relations;
-- drop function app.relations_stay_in_one_office(), app.relation_endpoint_office(text, uuid);
