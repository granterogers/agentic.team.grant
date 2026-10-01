-- 0647 - who may operate the DEPLOYMENT, as a fact the database holds (multi-user P1.3, #400).
--
-- Until now the gateway's only distinction among people was "a person may do everything": a signed-in
-- member with kind = 'person' reached set_setting, the Google/Slack credential forms, connector registration,
-- hiring and the routing table as readily as they reached their own tasks. With one person that was the same
-- thing as "the operator". With a second person it is a second human reaching the first one's deployment.
--
-- This adds the distinction and nothing else. It is NOT an organisation, a role system or a permission matrix:
-- one table naming the owner keys that operate the deployment, and one function that answers the question.
-- Operator authority is not office ownership - it says who may change what is SHARED (settings, credentials,
-- the roster, connectors), never whose project a row is.
--
-- Seeded from what exists: every person member at the moment this runs. Today that is one human. No address
-- is written here and none is read back out; the gateway asks by owner key, which it learned from the same
-- verified session it already resolves.
--
-- The function requires the owner key to ALSO be a current person member. A row planted here for a harness
-- member does not make a test principal an operator, which is the principal-kind confusion the Sample and
-- test offices must never be able to use.

create table if not exists public.deployment_operators (
  owner_key text primary key check (btrim(owner_key) <> ''),
  added_at  timestamptz not null default now(),
  note      text not null default ''
);

comment on table public.deployment_operators is
  'The owner keys that operate this deployment: they may change what is shared by every office (settings, credentials, the roster, connectors, routing). Not an ownership relation. The gateway asks public.deployment_operator(owner_key).';

alter table public.deployment_operators enable row level security;
revoke all on table public.deployment_operators from anon, authenticated;
grant select on table public.deployment_operators to service_role;

insert into public.deployment_operators (owner_key, note)
select m.owner_key, 'seeded from the person members that existed when 0647 ran'
  from public.office_members m
 where m.kind = 'person' and btrim(m.owner_key) <> ''
on conflict (owner_key) do nothing;

create or replace function public.deployment_operator(p_owner_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select exists (
    select 1
      from public.deployment_operators d
      join public.office_members m on m.owner_key = d.owner_key and m.kind = 'person'
     where d.owner_key = nullif(btrim(coalesce(p_owner_key, '')), '')
  )
$f$;

revoke all on function public.deployment_operator(text) from public, anon, authenticated;
grant execute on function public.deployment_operator(text) to service_role;

comment on function public.deployment_operator(text) is
  'True when the owner key is a current PERSON member named in deployment_operators. A harness member is never an operator, whatever row exists.';

-- ROLLBACK (not part of the migration): roll the gateway (hq-api) back to the version that does not ask
-- public.deployment_operator FIRST - a gateway that asks a missing function refuses every operator action -
-- and then: drop function public.deployment_operator(text); drop table public.deployment_operators;
