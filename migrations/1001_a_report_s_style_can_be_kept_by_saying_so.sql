-- 1001 - "Use this report's style for this project." said in a conversation (HQ-STYLE-018).
--
-- 0970 made the move: app.style_adopt_from_document copies the style a made report was set in into the project's own
-- profile, asking first when the project already has one. Its only door was a button on the document viewer. This lets a
-- person say it to the team, and it adds NO second way to save a style: the conversation resolves which report is
-- meant and then calls the very same function (src/style/adopt.ts is the worker's one caller of it).
--
-- WHAT IS ADDED.
--
--   app.style_source_candidates(office, slug, command)   which made reports a sentence like "this report" could mean:
--       the head of every made-report chain in the project, newest first, each marked with whether this conversation
--       produced it (in_thread) and whether a style was recorded with it (has_snapshot). Read-only. The thread is found
--       the way app.conversation_work finds it: the same channel, chat and person, the last day, and every job those
--       turns started. It chooses nothing: choosing, and asking when it is not unique, is the worker's decision and is
--       written down in src/agents/style-keep.ts.
--   tool_permissions 'style.save'   the registry row. delivered_by names what performs it (the job kind style.adopt,
--       and the conversation's own call of app.style_adopt_from_document), so the claim is checkable (0298), and it is
--       granted to every colleague who holds db.read, the way 0565 granted document.create.
--
-- NO VERBS, ON PURPOSE. The capability brief goes in front of every answer and has about forty characters of headroom under
-- the 4000 the capability suite asserts; one verb line here cost 89 and crossed it. With no verbs the tool is still named
-- in "You also hold" (about a dozen characters), which is all the model needs: the request itself is read and performed
-- in code before the model is asked, and the description below is what a person sees.
--
-- LEVEL 1. Saving a project's style is a change inside the office that the person can see and change back; it reaches
-- nothing outside. REPLACING a style the project already has is still a question: app.style_adopt_from_document refuses
-- without p_confirm and the conversation relays that as a question the person answers.
--
-- Rollback: drop the function and delete the style.save rows. Nothing else reads either.

create function app.style_source_candidates(p_office uuid, p_slug text, p_command uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare v_project uuid;
begin
  perform app.require_office(p_office);
  select project_id into v_project from public.projects
   where office_id = p_office and slug = nullif(btrim(coalesce(p_slug, '')), '') and status <> 'archived';
  if v_project is null then return '[]'::jsonb; end if;
  return coalesce((
    with recursive conversation as (
      select c.origin_channel, split_part(c.origin_ref, ':', 1) as chat, coalesce(c.subject, c.actor) as who
        from public.inbound_commands c
       where p_command is not null and c.command_id = p_command and c.office_id = p_office
    ),
    turns as (
      select c.job_id
        from public.inbound_commands c, conversation v
       where c.office_id = p_office and c.origin_channel = v.origin_channel
         and split_part(c.origin_ref, ':', 1) = v.chat
         and coalesce(c.subject, c.actor) = v.who
         and c.received_at >= app.now_utc() - interval '24 hours'
         and c.job_id is not null
    ),
    thread as (
      select j.job_id from public.jobs j where j.job_id in (select job_id from turns) and j.office_id = p_office
      union
      select k.job_id from public.jobs k join thread t on k.parent_job_id = t.job_id and k.office_id = p_office
    ),
    heads as (
      select d.document_id, d.title, d.created_at, d.state, d.produced_by_job
        from public.documents d
       where d.office_id = p_office and d.project_id = v_project and d.origin = 'made'
         and d.mime_type = 'application/pdf' and d.superseded_by is null and d.state in ('draft', 'approved')
    )
    select jsonb_agg(jsonb_build_object(
             'document_id', h.document_id,
             'title', h.title,
             'created_at', h.created_at,
             'state', h.state,
             'in_thread', h.produced_by_job is not null and h.produced_by_job in (select job_id from thread),
             'has_snapshot', exists (select 1 from public.document_provenance p
                                      where p.document_id = h.document_id and p.office_id = p_office
                                        and p.style_snapshot is not null))
           order by (h.produced_by_job is not null and h.produced_by_job in (select job_id from thread)) desc,
                    h.created_at desc, h.document_id desc)
      from (select * from heads order by created_at desc, document_id desc limit 12) h
  ), '[]'::jsonb);
end
$f$;
revoke all on function app.style_source_candidates(uuid, text, uuid) from public, anon, authenticated, service_role;

insert into public.tool_permissions (tool, level, description, enabled, delivered_by, in_reply, verbs)
values
  ('style.save', 1,
   'Keep the look of a report the team made as the style for the rest of that project''s reports. Say which report ("this one", or its name) and, if the project already has a style, the person is asked before it is replaced.',
   true,
   'job kind style.adopt (src/handlers/style-adopt.ts) and the conversation''s own call of app.style_adopt_from_document',
   true,
   null)
on conflict (tool) do update
  set description  = excluded.description,
      enabled      = excluded.enabled,
      delivered_by = excluded.delivered_by,
      in_reply     = excluded.in_reply,
      verbs        = excluded.verbs;

insert into public.staff_tools (office_id, staff_slug, tool)
select st.office_id, st.staff_slug, 'style.save'
  from public.staff_tools st
 where st.tool = 'db.read'
on conflict do nothing;
