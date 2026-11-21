-- 1105 — the changes Activity did not show: project create, rename and archive; to-do removal; contact edit and removal
-- (D7, A11, 21 November 2026)
--
-- Activity reads public.events for actions, and only a few functions wrote there. These four kinds of change happen a few
-- times a day, so one trigger per table records them, rather than editing every function that makes the change. Nothing
-- else is recorded: task creation and the team's own work are not logged here.
--
-- The actor is recorded as the studio (actor_kind 'user', actor 'Team HQ'): the gateway does not yet pass the signed-in
-- person into the database, so the person is not known at this layer. Fixture data is never recorded.

begin;

create or replace function app.record_change_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_office  uuid;
  v_project uuid;
  v_type    text;
  v_sum     text;
  v_before  jsonb := null;
  v_after   jsonb := null;
begin
  if TG_TABLE_NAME = 'projects' then
    if NEW.is_fixture is true then return NEW; end if;
    v_office := NEW.office_id;
    v_project := NEW.project_id;
    if TG_OP = 'INSERT' then
      v_type := 'project.created';
      v_sum := format('Created the project %s', left(NEW.name, 80));
      v_after := jsonb_build_object('name', NEW.name);
    elsif OLD.name is distinct from NEW.name then
      v_type := 'project.renamed';
      v_sum := format('Renamed the project %s to %s', left(OLD.name, 60), left(NEW.name, 60));
      v_before := jsonb_build_object('name', OLD.name);
      v_after := jsonb_build_object('name', NEW.name);
    elsif NEW.status = 'archived' and OLD.status is distinct from 'archived' then
      v_type := 'project.archived';
      v_sum := format('Archived the project %s', left(NEW.name, 80));
      v_before := jsonb_build_object('status', OLD.status);
      v_after := jsonb_build_object('status', NEW.status);
    else
      return NEW;
    end if;

  elsif TG_TABLE_NAME = 'tasks' then
    if NEW.is_fixture is true then return NEW; end if;
    if NEW.state = 'cancelled' and OLD.state is distinct from 'cancelled' then
      v_office := NEW.office_id;
      v_project := NEW.project_id;
      v_type := 'task.removed';
      v_sum := format('Removed the to-do %s', left(NEW.title, 100));
      v_before := jsonb_build_object('state', OLD.state);
      v_after := jsonb_build_object('state', NEW.state);
    else
      return NEW;
    end if;

  elsif TG_TABLE_NAME = 'contacts' then
    if NEW.is_fixture is true then return NEW; end if;
    select p.office_id into v_office from public.projects p where p.project_id = NEW.project_id;
    v_project := NEW.project_id;
    if NEW.archived_at is not null and OLD.archived_at is null then
      v_type := 'contact.removed';
      v_sum := format('Removed the contact %s', left(NEW.name, 80));
    elsif (to_jsonb(OLD) - 'archived_at' - 'updated_at') is distinct from (to_jsonb(NEW) - 'archived_at' - 'updated_at') then
      v_type := 'contact.edited';
      v_sum := format('Edited the contact %s', left(NEW.name, 80));
    else
      return NEW;
    end if;
  else
    return NEW;
  end if;

  if v_office is null then return NEW; end if;

  insert into public.events
    (office_id, correlation_id, project_id, actor_kind, actor, trigger, action_type, reversible,
     rationale_summary, before_state, after_state)
  values
    (v_office, gen_random_uuid(), v_project, 'user', 'Team HQ', 'studio', v_type, false,
     left(v_sum, 200), v_before, v_after);
  return NEW;
end;
$f$;

create trigger projects_record_activity
  after insert or update of name, status on public.projects
  for each row execute function app.record_change_activity();

create trigger tasks_record_activity
  after update of state on public.tasks
  for each row execute function app.record_change_activity();

create trigger contacts_record_activity
  after update on public.contacts
  for each row execute function app.record_change_activity();

revoke all on function app.record_change_activity() from public, anon, authenticated;

commit;
