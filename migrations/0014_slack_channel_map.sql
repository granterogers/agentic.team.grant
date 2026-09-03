-- 0014 — Slack workspace, channel mapping, and the canonical-store claim
--
-- Gate 4 requires, among other things: *"channel mapping, project channel
-- creation ... that **Postgres remains canonical**, and that **Slack history
-- loss does not break the application**."*
--
-- Those last two are one requirement wearing two hats, and this migration is
-- where the claim is either true or a slogan. It is true only if nothing the
-- application needs is stored *solely* in Slack. So:
--
--   - The channel↔project mapping lives here, not in a channel topic. A topic
--     is editable by anyone in the channel and is lost with the channel.
--   - The instruction text lives in `inbound_commands` (0011), copied at
--     receipt. If Slack's history is wiped tomorrow, every instruction ever
--     given is still readable here.
--   - Slack's ids are recorded as *references back into Slack*, which is the
--     right direction of dependency: we can always find the channel for a
--     project, and losing the channel loses a delivery surface rather than
--     data.
--
-- The test for whether this holds is deliberately blunt: could the application
-- be rebuilt from Postgres alone, with an empty Slack workspace? Everything
-- below is shaped so the answer is yes.

begin;

create table public.slack_workspaces (
  team_id           text        primary key,
  team_name         text        not null,
  -- Our own bot user id. Needed to recognise our own messages coming back as
  -- events; without it the app answers itself.
  bot_user_id       text        not null,
  app_id            text,

  -- Installed, or uninstalled. Gate 4 asks for token revocation and
  -- reinstall to be proven, and both are state changes that must be visible
  -- rather than inferred from a failing call.
  installed         boolean     not null default true,
  installed_at      timestamptz not null default app.now_utc(),
  uninstalled_at    timestamptz,
  -- Why it stopped working, when it did. `tokens_revoked` and `app_uninstalled`
  -- are different events with different remedies.
  revocation_reason text,

  -- Measured, never assumed (§11): what the workspace's own limits actually
  -- are, recorded when observed rather than copied from documentation.
  observed_rate_limit_tier text,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),

  constraint slack_workspaces_uninstalled_iff_reason
    check ((installed = false) = (uninstalled_at is not null)),
  constraint slack_workspaces_revocation_reason_known
    check (
      revocation_reason is null
      or revocation_reason in ('tokens_revoked', 'app_uninstalled', 'manual', 'unknown')
    )
);

create trigger slack_workspaces_touch_updated_at
  before update on public.slack_workspaces
  for each row execute function app.touch_updated_at();

-- The mapping Gate 4 names.
--
-- A project may have several channels (a main channel and a build channel, say)
-- but a channel maps to at most one project, because an instruction arriving in
-- it has to resolve to exactly one project without a tiebreak.
create table public.slack_channel_map (
  channel_id        text        primary key,
  team_id           text        not null references public.slack_workspaces (team_id),

  -- Nullable: a channel can be known to us and belong to no project — the
  -- general channel, a DM. Null is not "unmapped pending setup", it is a
  -- legitimate answer, so the resolver must handle it rather than assume.
  project_id        uuid        references public.projects (project_id),

  -- Recorded at mapping time, kept for display, and NOT authoritative. Slack
  -- renames are common and we find out late; the id is the identity.
  channel_name      text        not null,

  purpose           text        not null default 'project',
  is_private        boolean     not null default false,
  -- Set when the app created the channel itself, which Gate 4 asks for
  -- separately from mapping an existing one.
  created_by_app    boolean     not null default false,

  -- Cleared when the app leaves or the channel is archived. A row is kept
  -- rather than deleted: the mapping is history that explains where past
  -- instructions came from, and deleting it would orphan them.
  active            boolean     not null default true,
  archived_at       timestamptz,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),

  constraint slack_channel_map_purpose_known
    check (purpose in ('project', 'general', 'alerts', 'dm', 'other')),
  constraint slack_channel_map_channel_id_shaped
    check (channel_id ~ '^[CDG][A-Z0-9]{6,}$'),
  constraint slack_channel_map_active_iff_not_archived
    check ((active = false) = (archived_at is not null)),
  -- A project-purpose channel has a project. Anything else is a mapping that
  -- says "project" while pointing nowhere, which the resolver cannot use.
  constraint slack_channel_map_project_purpose_has_project
    check (purpose <> 'project' or project_id is not null)
);

-- A project's channels are found by project, constantly.
create index slack_channel_map_by_project on public.slack_channel_map (project_id)
  where project_id is not null and active;

create trigger slack_channel_map_touch_updated_at
  before update on public.slack_channel_map
  for each row execute function app.touch_updated_at();

comment on table public.slack_channel_map is
  'The channel<->project mapping Gate 4 requires. Deliberately here and not in '
  'a channel topic: a topic is editable by anyone in the channel and is lost '
  'with the channel, which would make Slack canonical for something the '
  'application needs.';
comment on column public.slack_channel_map.channel_name is
  'For display only. Slack renames are common and we learn of them late, so the '
  'id is the identity and this is a cached label.';

-- ---------------------------------------------------------------------------
-- Slack-specific routing on an inbound command
-- ---------------------------------------------------------------------------

-- 0011's envelope is channel-agnostic by design, and adding Slack columns to it
-- would push channel semantics into the core (core-invariants §1). A side table
-- keyed on the command holds what only Slack means.
create table public.inbound_commands_slack (
  command_id        uuid        primary key
                      references public.inbound_commands (command_id) on delete cascade,
  team_id           text        not null,
  channel_id        text,
  -- The parent message's ts when the instruction arrived in a thread. Gate 4
  -- asks for threads specifically, and a reply must go back into the thread
  -- rather than into the channel.
  thread_ts         text,
  is_dm             boolean     not null default false,
  reaction          text,
  -- Resolved at receipt from slack_channel_map, and stored rather than joined
  -- at read time: the mapping can change, and a command must stay attributed to
  -- the project it was actually about when it was given.
  resolved_project_id uuid      references public.projects (project_id)
);

create index inbound_commands_slack_by_channel on public.inbound_commands_slack (channel_id);

comment on table public.inbound_commands_slack is
  'What only Slack means, kept out of the channel-agnostic envelope. '
  'resolved_project_id is stored rather than joined at read time because the '
  'mapping can change and a command must stay attributed to the project it was '
  'actually about.';

-- ---------------------------------------------------------------------------
-- Resolution
-- ---------------------------------------------------------------------------

-- Which project does this channel mean? Null is a real answer.
create or replace function app.project_for_slack_channel(p_channel_id text)
returns uuid
language sql
stable
as $$
  select project_id
  from public.slack_channel_map
  where channel_id = p_channel_id and active
  limit 1;
$$;

-- Where should a message about this project go?
--
-- Returns the channels rather than one channel: a caller that wants "the" one
-- can take the first, but a caller that wants to fan out should not have to
-- guess that only one exists.
create or replace function app.slack_channels_for_project(p_project_id uuid)
returns setof text
language sql
stable
as $$
  select channel_id
  from public.slack_channel_map
  where project_id = p_project_id and active
  order by purpose, created_at;
$$;

alter table public.slack_workspaces        enable row level security;
alter table public.slack_workspaces        force  row level security;
alter table public.slack_channel_map       enable row level security;
alter table public.slack_channel_map       force  row level security;
alter table public.inbound_commands_slack  enable row level security;
alter table public.inbound_commands_slack  force  row level security;

grant select, insert, update on public.slack_workspaces to ai_team_app;
grant select, insert, update on public.slack_channel_map to ai_team_app;
grant select, insert on public.inbound_commands_slack to ai_team_app;
grant execute on function app.project_for_slack_channel(text) to ai_team_app;
grant execute on function app.slack_channels_for_project(uuid) to ai_team_app;

create policy slack_workspaces_app_read on public.slack_workspaces
  for select to ai_team_app using (true);
create policy slack_workspaces_app_insert on public.slack_workspaces
  for insert to ai_team_app with check (true);
create policy slack_workspaces_app_update on public.slack_workspaces
  for update to ai_team_app using (true) with check (true);
create policy slack_channel_map_app_read on public.slack_channel_map
  for select to ai_team_app using (true);
create policy slack_channel_map_app_insert on public.slack_channel_map
  for insert to ai_team_app with check (true);
create policy slack_channel_map_app_update on public.slack_channel_map
  for update to ai_team_app using (true) with check (true);
create policy inbound_commands_slack_app_read on public.inbound_commands_slack
  for select to ai_team_app using (true);
create policy inbound_commands_slack_app_insert on public.inbound_commands_slack
  for insert to ai_team_app with check (true);

commit;
