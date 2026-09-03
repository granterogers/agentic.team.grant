-- 0011 — The canonical command envelope, as received
--
-- §5: every inbound instruction normalizes into ONE envelope before any
-- business logic runs, and *"channel adapters may only translate. They may
-- never decide."* This table is the landing point for that envelope, and its
-- shape encodes the rule: there is no column a channel adapter could use to
-- classify intent, choose an agent or create work.
--
-- `intent_class` is deliberately absent even though core-invariants.md §1 lists
-- it, because §5 assigns it to the ROUTER. A column an adapter can write is a
-- column an adapter will eventually decide. The router adds it downstream.

create table public.inbound_commands (
  command_id            uuid        primary key default gen_random_uuid(),

  origin_channel        text        not null,
  -- Channel-native locator, so a reply lands back in the right place without
  -- the core knowing channel semantics (core-invariants §1).
  origin_ref            text        not null,
  actor                 text        not null,

  instruction           text        not null,
  callback_action       text,
  -- §6 keys Undo on the original event_id. Validated as a uuid by the adapter
  -- before it ever reaches here, because a button payload is user input.
  compensates_event_id  uuid        references public.events (event_id),

  -- §6: "Persist source event IDs and process idempotently." The unique index
  -- below is what makes a redelivered update collide rather than enqueue the
  -- same instruction twice.
  dedupe_key            text        not null,

  received_at           timestamptz not null default app.now_utc(),
  -- Null until the router picks it up. Deliberately not a status enum: the
  -- adapter must not be able to express a state machine.
  processed_at          timestamptz,
  job_id                uuid        references public.jobs (job_id),

  constraint inbound_origin_channel_known
    check (origin_channel in ('slack', 'telegram', 'voice', 'teamhq')),
  constraint inbound_dedupe_key_shaped
    check (dedupe_key ~ '^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$'),
  -- A message carries an instruction; a button press carries an action. One or
  -- the other, never neither.
  constraint inbound_has_content
    check (length(trim(instruction)) > 0 or callback_action is not null),
  constraint inbound_callback_action_known
    check (
      callback_action is null or callback_action in (
        'useful', 'not_useful', 'undo', 'open_project', 'mute_24h', 'more_detail'
      )
    ),
  -- Only an undo compensates something.
  constraint inbound_compensates_only_for_undo
    check (compensates_event_id is null or callback_action = 'undo')
);

comment on table public.inbound_commands is
  'The canonical command envelope as received (§5). Has no column a channel '
  'adapter could use to classify intent or choose an agent — the rule is in the '
  'schema, not only in the prose.';

-- THE idempotency mechanism. §6 requires duplicate deliveries to be harmless by
-- construction, because Telegram''s retry contract is one sentence with no
-- ordering guarantee and duplicates can be genuinely concurrent. A unique index
-- is decided by the database; a guard in a handler is decided by a race.
create unique index inbound_commands_dedupe
  on public.inbound_commands (dedupe_key);

create index inbound_commands_unprocessed
  on public.inbound_commands (received_at)
  where processed_at is null;

alter table public.inbound_commands enable row level security;
alter table public.inbound_commands force  row level security;

create policy inbound_app_read on public.inbound_commands
  for select to ai_team_app using (true);
create policy inbound_app_insert on public.inbound_commands
  for insert to ai_team_app with check (true);
create policy inbound_app_update on public.inbound_commands
  for update to ai_team_app using (true) with check (true);

grant select, insert, update on public.inbound_commands to ai_team_app;

-- The Edge Function writes as service_role, which bypasses RLS. That is not
-- ideal and is recorded rather than hidden: Phase 2's remaining work gives the
-- function a least-privilege role once ai_team_app has a password. For now the
-- narrow surface is the endpoint itself, which can only insert this shape.
grant select, insert on public.inbound_commands to service_role;

-- PostgREST needs to see the table to expose it.
notify pgrst, 'reload schema';
