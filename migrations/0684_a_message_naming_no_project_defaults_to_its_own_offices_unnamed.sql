-- 0684 - "no project named" means the office's own Unnamed project, not Grant's (multi-user P3, wave 6).
--
-- `inbound_commands.project_id` and `duty_said.project_id` were `not null default app.unnamed_project()` - the one reserved
-- project of the one deployment. For any other office that default is a foreign project, the composite key
-- (project_id, office_id) refuses the row, and the Telegram webhook (which treated a 409 as "the idempotency index doing its
-- job") acknowledged the update with 200 having stored nothing: a message lost without a word.
--
-- A column default cannot see the row's office, so the default goes and a BEFORE INSERT trigger - named to sort after the
-- compatibility bridge, so the office is settled first - fills the project from the row's own office. The column stays NOT
-- NULL, so a row that reaches the end with no project is still refused.

create function app.default_to_offices_unnamed_project()
returns trigger
language plpgsql
security definer
set search_path to ''
as $f$
begin
  if new.project_id is null and new.office_id is not null then
    new.project_id := app.unnamed_project(new.office_id);
  end if;
  return new;
end
$f$;
revoke all on function app.default_to_offices_unnamed_project() from public, anon, authenticated, service_role;

set local lock_timeout = '10s';
alter table public.inbound_commands alter column project_id drop default;
alter table public.duty_said alter column project_id drop default;

-- 'a0_project_default' sorts after 'a0_office_bridge' (o < p), so the bridge has already chosen the office.
create trigger a0_project_default before insert on public.inbound_commands
  for each row execute function app.default_to_offices_unnamed_project();
create trigger a0_project_default before insert on public.duty_said
  for each row execute function app.default_to_offices_unnamed_project();
