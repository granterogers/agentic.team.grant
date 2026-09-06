-- 0057 — resolving the subject is the table's job, not each writer's
--
-- 0056 added `inbound_commands.subject` and left it to be filled in by whoever
-- writes the row. That was two edge functions today and every future channel
-- forever, each having to remember a lookup — and a column that depends on
-- every writer remembering is a column that is right until the third writer.
--
-- It is also not possible over PostgREST without a wrapper: only `public` is
-- exposed, and the resolver lives in `app`. So the choice was a public wrapper
-- plus a second round trip per inbound message in each function, or a trigger.
--
-- A trigger, then. It fires for every writer, it costs no round trip, and a new
-- channel gets subject resolution by existing rather than by remembering.
--
-- It does not overwrite a subject the writer supplied. A caller that knows
-- better than the identity table — a future OAuth flow that authenticated the
-- person directly — should not have its answer silently replaced by a lookup.

begin;

create or replace function app.resolve_inbound_subject()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.subject is null then
    new.subject := app.subject_for(new.origin_channel, new.actor);
  end if;
  return new;
end;
$$;

comment on function app.resolve_inbound_subject is
  'Fills inbound_commands.subject from the identity table (§31). A trigger '
  'rather than a rule each writer follows, because a column that depends on '
  'every writer remembering is right until the third writer.';

create trigger inbound_commands_resolve_subject
  before insert on public.inbound_commands
  for each row execute function app.resolve_inbound_subject();

commit;
