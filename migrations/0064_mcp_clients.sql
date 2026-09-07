-- 0064 — one token per MCP client, revocable on its own
--
-- ADR-0014 proposes exposing what the team knows over MCP, so Claude and
-- ChatGPT can both read it without either being built for specially. This is
-- the access model, and it is deliberately not the HQ model.
--
-- Team HQ has one bearer token because it has one reader on several devices.
-- MCP has several readers — a Claude session, a ChatGPT session, whatever
-- comes next — and they are not interchangeable: withdrawing ChatGPT's access
-- must not lock out Claude, and knowing which client made a call is the
-- difference between an audit trail and a shrug.
--
-- So: a row per client, a hashed token per row, and every call recorded
-- against the client that made it. §11 requires every inference attempt to be
-- measured, and a general-purpose model reading the corpus through a tool is
-- exactly that — the fact that we are not paying for it does not make it
-- unmeasured.
--
-- ## Why the hash and not the token
--
-- The vault would work and is where every other credential lives. It is the
-- wrong choice here for one reason: authentication needs to answer "is this
-- the token for some client" on every call, and with values in the vault that
-- is a decrypt-and-compare across every row. A SHA-256 of the token is a
-- primary key lookup, and it is the standard shape for a credential that is
-- shown once and never needed again in plaintext — nothing in this system ever
-- needs to *read* an MCP token back, only to recognise one.

begin;

create table public.mcp_clients (
  client_id       text        primary key,
  display_name    text        not null,
  -- SHA-256, hex. Never the token.
  token_sha256    text        not null unique,
  -- Read-only for now (ADR-0014). Kept as a column rather than assumed, so
  -- granting a write scope later is a row and a code path, not a migration
  -- plus a rethink of what the column would have meant.
  scopes          text[]      not null default array['read'],
  enabled         boolean     not null default true,
  disabled_reason text,
  created_at      timestamptz not null default app.now_utc(),
  last_seen_at    timestamptz,
  calls           bigint      not null default 0,

  constraint mcp_clients_disabled_has_reason
    check (enabled or disabled_reason is not null),
  constraint mcp_clients_token_is_a_hash
    check (token_sha256 ~ '^[0-9a-f]{64}$'),
  constraint mcp_clients_scopes_known
    check (scopes <@ array['read', 'write']),
  -- The table is read by the authentication path on every call. A token
  -- accidentally stored in a display name would be a token in a log line.
  constraint mcp_clients_carries_no_token
    check ((client_id || display_name || coalesce(disabled_reason, ''))
             !~ '(xox[a-z]-|sbp_|ntn_|sk-[A-Za-z0-9]|mcp_[A-Za-z0-9]{8})')
);

comment on table public.mcp_clients is
  'One row per MCP client (ADR-0014). Separate tokens because withdrawing '
  'ChatGPT must not lock out Claude, and because a call recorded against '
  '"someone" is not an audit trail.';

create table public.mcp_calls (
  call_id     bigserial   primary key,
  client_id   text        not null references public.mcp_clients (client_id),
  tool        text        not null,
  -- The arguments, minus anything that could carry a secret. Recorded because
  -- "a model read the corpus" and "a model read the corpus looking for the
  -- word 'password'" are different events.
  arguments   jsonb       not null default '{}'::jsonb,
  outcome     text        not null,
  rows_returned integer   not null default 0,
  duration_ms integer,
  called_at   timestamptz not null default app.now_utc(),

  constraint mcp_calls_outcome_known
    check (outcome in ('ok', 'refused', 'error'))
);

create index mcp_calls_by_client on public.mcp_calls (client_id, called_at desc);

comment on table public.mcp_calls is
  '§11: every inference attempt is measured. A general-purpose model reading '
  'this corpus through a tool is one, and not paying for it does not make it '
  'unmeasured.';

-- Authenticate. Returns the client, or nothing.
create or replace function app.mcp_client_for(p_token_sha256 text)
returns table (client_id text, display_name text, scopes text[])
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select c.client_id, c.display_name, c.scopes
    from public.mcp_clients c
   where c.token_sha256 = p_token_sha256
     and c.enabled
$$;

comment on function app.mcp_client_for is
  'Recognise a token by its hash. No row is the only failure mode - a disabled '
  'client and an unknown one are deliberately indistinguishable to the caller.';

create or replace function app.mcp_record_call(
  p_client_id text,
  p_tool text,
  p_arguments jsonb,
  p_outcome text,
  p_rows integer default 0,
  p_duration_ms integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.mcp_calls (client_id, tool, arguments, outcome, rows_returned, duration_ms)
  values (p_client_id, p_tool, coalesce(p_arguments, '{}'::jsonb), p_outcome,
          coalesce(p_rows, 0), p_duration_ms);

  update public.mcp_clients
     set last_seen_at = app.now_utc(), calls = calls + 1
   where client_id = p_client_id;
end;
$$;

revoke all on function app.mcp_client_for(text) from public;
revoke all on function app.mcp_record_call(text, text, jsonb, text, integer, integer) from public;
grant execute on function app.mcp_client_for(text) to ai_team_app, service_role;
grant execute on function app.mcp_record_call(text, text, jsonb, text, integer, integer)
  to ai_team_app, service_role;

grant select, insert, update on public.mcp_clients to ai_team_app;
grant select, insert on public.mcp_calls to ai_team_app;
alter table public.mcp_clients enable row level security;
alter table public.mcp_clients force  row level security;
alter table public.mcp_calls   enable row level security;
alter table public.mcp_calls   force  row level security;
create policy mcp_clients_app on public.mcp_clients for all to ai_team_app
  using (true) with check (true);
create policy mcp_calls_app on public.mcp_calls for all to ai_team_app
  using (true) with check (true);

commit;
