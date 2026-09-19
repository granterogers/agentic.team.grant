/*
  A third append-only table that makes a project permanent, found the same way
  as the second.

  Clearing a stranded `fixture-send-%` by hand, after cancelling and unlinking
  every job on it, `app.project_delete` came back with

      cannot be deleted: update or delete on table "projects" violates foreign
      key constraint "events_project_id_fkey" on table "events"

  0360's handler did its job — a sentence, and the project archived rather than
  a stack trace — so this is not a defect in the function. It is a gap in what
  `app.project_debris()` calls REMOVABLE, which 0510 has just closed for
  `decisions` and which the report below would open again the first time a
  debris project carried an event.

  `public.events` is the office's ledger of what it DID, 2,641 rows, append-only
  by master spec section 6, and its foreign key is NO ACTION — so unlike
  `decisions` it cannot even attempt a cascade. Either way the project is
  history and ADR-0022 archives history.

  No row is misreported today: zero removable debris projects currently carry an
  event, which is precisely why this is worth doing now rather than the morning
  a sweep exits 1 on something nobody can clear.

  The three tables are named rather than derived. A derivation over pg_catalog
  inside a STABLE function would look cleverer and would silently change what a
  sweep may touch the next time anybody adds a trigger, and this function
  decides whether a delete is attempted against Grant's data.
*/

drop function if exists app.project_debris();

create function app.project_debris()
returns table(slug text, status text, docs integer, jobs integer,
              decisions integer, removable boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.slug, p.status,
         (select count(*) from public.documents d where d.project_id = p.project_id)::int,
         (select count(*) from public.jobs j where j.project_id = p.project_id)::int,
         (select count(*) from public.decisions x where x.project_id = p.project_id)::int,
         not exists (select 1 from public.documents d where d.project_id = p.project_id)
           and not exists (select 1 from public.jobs j where j.project_id = p.project_id)
           /*
             0510. A decision pins a project the way a job does: the reference
             can only be cleared by an UPDATE, and `public.decisions` refuses
             one.
           */
           and not exists (select 1 from public.decisions x where x.project_id = p.project_id)
           /*
             0511. And an event, for the same reason with a different mechanism:
             `events_project_id_fkey` is NO ACTION, so the delete is refused
             outright rather than attempting a cascade the ledger will reject.
           */
           and not exists (select 1 from public.events e where e.project_id = p.project_id)
    from public.projects p
   where not p.is_fixture
     and p.status = 'archived'
     /*
       The shapes a harness leaves. Deliberately a list rather than "anything
       archived": `ai-learning-two` and `ai-learning-superseded-2026-09-07` are
       real history and must never be swept.
     */
     and (p.slug like 'newsroom-%' or p.slug like 'gate4-probe-%'
          or p.slug like 'clash-%' or p.slug like 'untitled-notebook-%'
          or p.slug like 'dbg-%' or p.slug like 'probe-%')
   order by p.slug
$function$;

grant execute on function app.project_debris() to ai_team_app, service_role;

/*
  Drive it, and prove the new clause can actually exclude something rather than
  being a line that reads well. A real archived probe project, one event
  against it, must stop being removable — then rolled back, because
  `public.events` is append-only and this is a probe.
*/
do $drive$
declare
  v_slug text := 'probe-0511-' || substr(md5(random()::text), 1, 8);
  v_id   uuid;
  v_before boolean;
  v_after  boolean;
begin
  insert into public.projects (slug, name, status)
  values (v_slug, 'Probe 0511', 'archived')
  returning project_id into v_id;

  select d.removable into v_before from app.project_debris() d where d.slug = v_slug;
  if v_before is distinct from true then
    raise exception '0511: the control project is not removable to begin with, so the '
                    'test proves nothing (got %)', v_before;
  end if;

  insert into public.events (project_id, correlation_id, actor_kind, actor, trigger, action_type,
                             rationale_summary, reversible)
  values (v_id, extensions.gen_random_uuid(), 'system', 'migration', 'migration', 'migration.probe',
          'Written by 0511 to prove an event pins a project.', false);

  select d.removable into v_after from app.project_debris() d where d.slug = v_slug;
  if v_after is distinct from false then
    raise exception '0511: a project holding an event is still called removable (got %)', v_after;
  end if;
  raise notice '0511: removable % -> % once an event exists', v_before, v_after;

  raise exception 'probe done, undoing';
exception when others then
  if sqlerrm <> 'probe done, undoing' then raise; end if;
end
$drive$;
