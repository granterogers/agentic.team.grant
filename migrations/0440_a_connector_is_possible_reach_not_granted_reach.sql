-- Registering an outside provider, and governing what it offers (#265).
--
-- ## What direction the office's MCP actually goes
--
-- The office is an MCP **server**: `supabase/functions/mcp`, 22 rows in
-- `mcp_clients`, OAuth clients and auth codes. Things connect TO it.
--
-- #265 asks for the other direction, and it does not exist at all: the office
-- as a CLIENT, registering somebody else's endpoint and discovering what that
-- endpoint offers. Worth saying plainly, because "working MCP read/write
-- support" reads as though half of this were done.
--
-- ## The invariant, which is most of the design
--
--   > *"A provider may advertise `mail.read`, `mail.send`, `contacts.delete`.
--   > The office may discover all three. That does NOT grant any agent
--   > authority to use them."*
--
-- So discovery writes `mcp_discovered_tools` and NOTHING ELSE. Nothing in that
-- table is reachable by any agent. A discovered tool becomes usable only when
-- somebody OFFERS it, which writes a `tool_permissions` row that is
-- **disabled** and carries the reach the discovery classified — and enabling
-- it is the existing approval path (#15, ADR-0018), unchanged.
--
-- Two tables and one deliberate gap between them. The gap is the feature.
--
-- ## No second plugin runtime
--
-- #169 and #170 both warn against one and this obeys them: a discovered tool
-- is represented in `tool_permissions`, the table `capabilityBrief` and
-- `app.staff_may_use` already read. There is no second registry, no second
-- executor and no second permission system. When a discovered tool is
-- eventually CALLED it will be called by a handler like any other.

create table if not exists public.mcp_providers (
  provider_id uuid primary key default gen_random_uuid(),
  /** What Grant calls it. Also the prefix every discovered tool takes. */
  name text not null unique check (name ~ '^[a-z][a-z0-9_-]{1,30}$'),
  display_name text not null default '',
  endpoint text not null check (endpoint ~ '^https://'),
  /** `none`, `bearer` or `oauth`. The credential itself lives in the Vault. */
  auth_kind text not null default 'none' check (auth_kind in ('none', 'bearer', 'oauth')),
  /*
    A REFERENCE, never a value. `app.resolve_secret` is the only way to a
    credential and this column holds the uuid it takes -- §15, and the same
    shape `slack_app_credentials` uses.
  */
  credential_ref uuid,
  /** What the server said it was, when it said anything. */
  server_name text,
  server_version text,
  protocol_version text,
  enabled boolean not null default true,
  revoked_at timestamptz,
  last_probe_at timestamptz,
  last_probe_ok boolean,
  last_probe_detail text,
  notes text not null default '',
  created_at timestamptz not null default app.now_utc(),
  updated_at timestamptz not null default app.now_utc()
);

comment on table public.mcp_providers is
  'An outside MCP endpoint the office may ASK what it offers (#265). The '
  'office is also an MCP server -- `mcp_clients` is that direction -- and this '
  'is the opposite one, which did not exist. Registering a provider grants '
  'nothing: see `mcp_discovered_tools`.';

create table if not exists public.mcp_discovered_tools (
  discovered_id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.mcp_providers(provider_id) on delete cascade,
  /** The provider's own name for it, verbatim. */
  external_name text not null check (btrim(external_name) <> ''),
  description text not null default '',
  /** Whatever schema it advertised, kept as it came. */
  input_schema jsonb not null default '{}'::jsonb,
  /*
    What the office THINKS it does, from the name, the description and the
    schema. A guess, and labelled one: `reach_certainty` says whether a person
    has confirmed it.

    Erring towards `destructive` on purpose. A read misclassified as
    destructive costs an approval; a delete misclassified as a read costs the
    thing it deleted.
  */
  reach text not null check (reach in ('read', 'write', 'destructive', 'unknown')),
  reach_certainty text not null default 'guessed'
    check (reach_certainty in ('guessed', 'confirmed')),
  why_that_reach text not null default '',
  first_seen_at timestamptz not null default app.now_utc(),
  last_seen_at timestamptz not null default app.now_utc(),
  /** Gone from the provider's list. Kept, because a disappearance is news. */
  vanished_at timestamptz,
  /** The `tool_permissions.tool` it was offered as, if it ever was. */
  offered_as text references public.tool_permissions(tool),
  constraint mcp_discovered_one_per_provider unique (provider_id, external_name)
);

comment on table public.mcp_discovered_tools is
  'What a provider says it can do (#265). NOTHING here is reachable by any '
  'agent: discovery is not permission. `offered_as` is set only when somebody '
  'deliberately offers one, and even then the `tool_permissions` row it makes '
  'is disabled.';

/*
  Guess what a tool does, from what it calls itself.

  Deliberately a table of words rather than a model call: it runs per
  discovered tool, it must be reproducible, and a person has to be able to
  argue with it. `reach_certainty` is the honesty: this is a guess until
  somebody says otherwise.

  Ordered destructive first, because the first match wins and the expensive
  mistake is in the other direction.
*/
create or replace function app.guess_reach(p_name text, p_description text)
returns jsonb
language sql
immutable
as $function$
  with said as (select lower(coalesce(p_name, '') || ' ' || coalesce(p_description, '')) as t)
  select case
    when (select t from said) ~
         '\m(delete|destroy|remove|purge|drop|wipe|revoke|cancel|uninstall|terminate)\M'
      then jsonb_build_object('reach', 'destructive',
             'why', 'the name or description says it removes something')
    when (select t from said) ~
         '\m(send|post|create|update|write|add|set|put|patch|upload|publish|invite|pay|charge|order)\M'
      then jsonb_build_object('reach', 'write',
             'why', 'the name or description says it changes something outside')
    when (select t from said) ~
         '\m(get|list|read|search|find|fetch|query|show|describe|lookup|count)\M'
      then jsonb_build_object('reach', 'read',
             'why', 'the name or description says it only looks')
    else jsonb_build_object('reach', 'unknown',
           'why', 'nothing in the name or description says what it does')
  end;
$function$;

/** Register a provider. Grants nothing and discovers nothing. */
create or replace function app.register_mcp_provider(
  p_name text, p_endpoint text, p_display_name text default '',
  p_auth_kind text default 'none', p_credential_ref uuid default null,
  p_notes text default '')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_id uuid;
begin
  if p_name !~ '^[a-z][a-z0-9_-]{1,30}$' then
    return jsonb_build_object('error',
      'a provider name is lower case letters, digits, dashes and underscores');
  end if;
  if p_endpoint !~ '^https://' then
    -- Plain HTTP would put a bearer token on the wire. Refused rather than
    -- warned about.
    return jsonb_build_object('error', 'an endpoint must be https');
  end if;
  if exists (select 1 from public.mcp_providers where name = p_name) then
    return jsonb_build_object('error', format('%L is already registered', p_name));
  end if;

  insert into public.mcp_providers
    (name, endpoint, display_name, auth_kind, credential_ref, notes)
  values (p_name, p_endpoint, coalesce(nullif(btrim(p_display_name), ''), p_name),
          p_auth_kind, p_credential_ref, coalesce(p_notes, ''))
  returning provider_id into v_id;

  return jsonb_build_object('ok', true, 'provider', v_id,
    'note', 'registered. Nothing is granted: ask it what it offers, then offer what you want.');
end;
$function$;

/*
  Write down what a provider said it offers.

  Idempotent per tool, so a second discovery updates rather than duplicates,
  and a tool that STOPPED being offered is marked vanished rather than deleted
  -- a capability disappearing is news, and a row that is gone cannot tell
  anybody.
*/
create or replace function app.record_mcp_tools(p_provider uuid, p_tools jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_tool jsonb; v_guess jsonb; v_seen text[] := array[]::text[];
  v_new integer := 0; v_gone integer := 0;
begin
  if not exists (select 1 from public.mcp_providers where provider_id = p_provider) then
    return jsonb_build_object('error', 'no such provider');
  end if;

  for v_tool in select * from jsonb_array_elements(coalesce(p_tools, '[]'::jsonb)) loop
    if coalesce(btrim(v_tool ->> 'name'), '') = '' then continue; end if;
    v_seen := v_seen || (v_tool ->> 'name');
    v_guess := app.guess_reach(v_tool ->> 'name', v_tool ->> 'description');

    insert into public.mcp_discovered_tools
      (provider_id, external_name, description, input_schema, reach, why_that_reach)
    values (p_provider, v_tool ->> 'name',
            left(coalesce(v_tool ->> 'description', ''), 2000),
            coalesce(v_tool -> 'inputSchema', '{}'::jsonb),
            v_guess ->> 'reach', v_guess ->> 'why')
    on conflict (provider_id, external_name) do update
      set description = excluded.description,
          input_schema = excluded.input_schema,
          last_seen_at = app.now_utc(),
          vanished_at = null,
          /*
            A CONFIRMED reach is a person's judgement and survives a
            rediscovery. Overwriting it would make the confirmation worthless
            the next time the provider rewords a description.
          */
          reach = case when public.mcp_discovered_tools.reach_certainty = 'confirmed'
                       then public.mcp_discovered_tools.reach else excluded.reach end,
          why_that_reach = case when public.mcp_discovered_tools.reach_certainty = 'confirmed'
                                then public.mcp_discovered_tools.why_that_reach
                                else excluded.why_that_reach end;
    if found then v_new := v_new + 1; end if;
  end loop;

  update public.mcp_discovered_tools
     set vanished_at = app.now_utc()
   where provider_id = p_provider and vanished_at is null
     and not (external_name = any (v_seen));
  get diagnostics v_gone = row_count;

  update public.mcp_providers
     set last_probe_at = app.now_utc(), last_probe_ok = true,
         last_probe_detail = format('%s tool(s)', coalesce(array_length(v_seen, 1), 0)),
         updated_at = app.now_utc()
   where provider_id = p_provider;

  return jsonb_build_object('ok', true,
    'seen', coalesce(array_length(v_seen, 1), 0), 'vanished', v_gone);
end;
$function$;

/*
  Offer one discovered tool to the office, DISABLED.

  The only bridge between discovery and permission, and it is one-way: it
  creates a `tool_permissions` row that nobody may use, at the level its reach
  implies, with `delivered_by` naming the provider. Enabling it is the existing
  approval path and this function cannot do it -- which is the invariant, in
  code rather than in a comment.
*/
create or replace function app.offer_mcp_tool(p_discovered uuid, p_as text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare d public.mcp_discovered_tools%rowtype; v_provider public.mcp_providers%rowtype;
        v_tool text; v_level integer;
begin
  select * into d from public.mcp_discovered_tools where discovered_id = p_discovered;
  if not found then
    return jsonb_build_object('error', 'no such discovered tool');
  end if;
  if d.vanished_at is not null then
    return jsonb_build_object('error',
      'that tool is no longer offered by the provider; rediscover before offering it');
  end if;
  if d.offered_as is not null then
    return jsonb_build_object('ok', true, 'already', true, 'tool', d.offered_as);
  end if;
  select * into v_provider from public.mcp_providers where provider_id = d.provider_id;
  if not v_provider.enabled or v_provider.revoked_at is not null then
    return jsonb_build_object('error', 'that provider is disconnected');
  end if;

  v_tool := coalesce(nullif(btrim(coalesce(p_as, '')), ''),
                     format('%s.%s', v_provider.name,
                            lower(regexp_replace(d.external_name, '[^a-zA-Z0-9]+', '_', 'g'))));
  /*
    The level follows the REACH, and `unknown` is treated as a write.

    Not as a read: a tool nobody can classify is a tool nobody has read the
    documentation for, and the cheap direction is an approval nobody needed.
  */
  v_level := case d.reach
               when 'read' then 0
               when 'write' then 2
               when 'destructive' then 3
               else 2
             end;

  insert into public.tool_permissions
    (tool, level, description, enabled, disabled_reason, delivered_by)
  values (v_tool, v_level,
          left(format('%s, offered by %s. %s', d.external_name, v_provider.name,
                      coalesce(nullif(d.description, ''), 'no description given')), 900),
          false,
          format('discovered from %s and not yet approved. Reach %L (%s).',
                 v_provider.name, d.reach, d.reach_certainty),
          format('mcp:%s', v_provider.name))
  on conflict (tool) do nothing;

  update public.mcp_discovered_tools set offered_as = v_tool where discovered_id = p_discovered;

  return jsonb_build_object('ok', true, 'tool', v_tool, 'level', v_level,
    'enabled', false,
    'note', 'offered and DISABLED. Approving it is the ordinary approval path.');
end;
$function$;

/*
  Disconnect a provider.

  Disables every tool it delivered rather than deleting them: a disabled row
  with a reason is a record of what was once reachable, and 0298's rule is that
  a listed gap can become a proposal while a deleted one cannot.
*/
create or replace function app.revoke_mcp_provider(p_provider uuid, p_why text default '')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_name text; v_off integer;
begin
  select name into v_name from public.mcp_providers where provider_id = p_provider;
  if v_name is null then
    return jsonb_build_object('error', 'no such provider');
  end if;

  update public.tool_permissions
     set enabled = false,
         disabled_reason = left(format('%s was disconnected. %s', v_name, coalesce(p_why, '')), 900)
   where delivered_by = format('mcp:%s', v_name) and enabled;
  get diagnostics v_off = row_count;

  update public.mcp_providers
     set enabled = false, revoked_at = app.now_utc(), updated_at = app.now_utc(),
         notes = left(coalesce(notes, '') || format(E'\ndisconnected: %s', coalesce(p_why, '')), 2000)
   where provider_id = p_provider;

  return jsonb_build_object('ok', true, 'provider', v_name, 'tools_disabled', v_off);
end;
$function$;

/** Every provider, what it offers, and what of that is actually usable. */
create or replace function app.mcp_inventory()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(v order by name), '[]'::jsonb)
    from (
      select p.name,
             jsonb_build_object(
               'name', p.name, 'display_name', p.display_name, 'endpoint', p.endpoint,
               'auth', p.auth_kind, 'enabled', p.enabled, 'revoked_at', p.revoked_at,
               'server', p.server_name, 'protocol', p.protocol_version,
               'last_probe_at', p.last_probe_at, 'last_probe_ok', p.last_probe_ok,
               'last_probe_detail', p.last_probe_detail,
               'discovered', (select count(*) from public.mcp_discovered_tools d
                               where d.provider_id = p.provider_id and d.vanished_at is null),
               'vanished', (select count(*) from public.mcp_discovered_tools d
                             where d.provider_id = p.provider_id and d.vanished_at is not null),
               'offered', (select count(*) from public.mcp_discovered_tools d
                            where d.provider_id = p.provider_id and d.offered_as is not null),
               /*
                 The number that matters, and the reason it is separate from
                 `offered`: a provider can advertise forty tools, the office
                 can offer six, and NONE of them be usable until Grant
                 approves. Showing only "offered" would read as reach.
               */
               'usable', (select count(*) from public.tool_permissions t
                           where t.delivered_by = format('mcp:%s', p.name) and t.enabled),
               'tools', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'name', d.external_name, 'reach', d.reach,
                                  'certainty', d.reach_certainty, 'why', d.why_that_reach,
                                  'offered_as', d.offered_as,
                                  'usable', exists (select 1 from public.tool_permissions t
                                                     where t.tool = d.offered_as and t.enabled),
                                  'gone', d.vanished_at is not null)
                                order by d.external_name), '[]'::jsonb)
                           from public.mcp_discovered_tools d
                          where d.provider_id = p.provider_id)) as v
        from public.mcp_providers p
    ) q;
$function$;

create or replace function public.mcp_inventory()
returns jsonb language sql security definer set search_path to ''
as $function$ select app.mcp_inventory() $function$;
