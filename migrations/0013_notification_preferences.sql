-- 0013 — notification preferences, and the instructions that produced them
--
-- §12 on Telegram: *"Natural-language instructions ('leave me alone today',
-- 'only important things') become **structured persistent preferences**."*
--
-- Both emphasised words are requirements, and each rules out an obvious
-- shortcut:
--
--   *structured* — the preference cannot be the sentence. If "leave me alone
--   today" is stored as text, every notification decision has to re-read
--   English, and two instructions cannot be reconciled. It is stored as the
--   effect: a quiet window with an end time, a minimum severity, a scope.
--
--   *persistent* — it outlives the conversation, the process and the channel.
--   So it is a table, not session state, and a mute survives a redeploy.
--
-- The instruction itself is kept too, in a separate table, for a reason that is
-- not sentiment: when a preference produces surprising behaviour three weeks
-- later, "why am I not being told about this?" is only answerable if the
-- sentence that caused it, and the interpretation applied to it, are both on
-- record. That also makes a misparse discoverable rather than mysterious.

begin;

-- What a notification has to clear to be delivered. Ordered by severity, so
-- `>=` comparisons in SQL are meaningful — an enum's ordering is its
-- declaration order.
create type public.notify_severity as enum (
  'trivial',      -- ambient activity
  'routine',      -- ordinary progress
  'important',    -- worth interrupting a task for
  'urgent',       -- worth interrupting the day for
  'blocker'       -- Grant is the only one who can unblock this
);

comment on type public.notify_severity is
  'Ordered by severity: enum comparison operators follow declaration order, so '
  'min_severity filtering is a single >= in SQL rather than a CASE ladder.';

-- One row per scope. `scope` is 'global' or a project — a preference that
-- applies everywhere and one that applies to a single project are the same
-- shape, so they are the same table, and the resolver takes the more specific.
create table public.notification_preferences (
  preference_id     uuid        primary key default gen_random_uuid(),

  -- Who this is for. One person today; a column now costs nothing and avoids a
  -- migration that would have to rewrite every row later.
  subject           text        not null default 'grant',

  project_id        uuid        references public.projects (project_id),

  -- The effects. All nullable: a preference sets what it sets, and the resolver
  -- layers them, so "only important things" does not have to also decide
  -- whether Grant is muted.
  min_severity      public.notify_severity,

  -- A quiet window with an end. §12's example is "leave me alone *today*", and
  -- an open-ended mute is a different and more dangerous thing than a bounded
  -- one — an accidental permanent mute silences blockers forever.
  quiet_until       timestamptz,

  -- Channels this preference silences. Empty means it silences none.
  muted_channels    text[]      not null default '{}'::text[],

  -- The escape hatch that keeps a mute safe. §12 gives Grant blockers because
  -- he is the only one who can clear them; a mute that hides those converts a
  -- preference into a deadlock. Default true, and a mute cannot set it false
  -- without saying so explicitly.
  blockers_always   boolean     not null default true,

  -- Free-text digest cadence would drift, so it is constrained.
  digest_mode       text,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),

  constraint notification_preferences_digest_mode_known
    check (digest_mode is null or digest_mode in ('immediate', 'hourly', 'daily', 'off')),
  constraint notification_preferences_muted_channels_known
    check (muted_channels <@ array['slack', 'telegram', 'voice', 'teamhq']::text[]),
  -- A preference that sets nothing is a row with no meaning, and would resolve
  -- to "no change" while looking like a stored intention.
  constraint notification_preferences_does_something
    check (
      min_severity is not null
      or quiet_until is not null
      or array_length(muted_channels, 1) >= 1
      or digest_mode is not null
      or blockers_always = false
    )
);

-- One live preference per scope. A partial unique index rather than a primary
-- key on (subject, project_id) because null project_id is the global scope, and
-- nulls do not collide in a unique constraint — two global rows would both be
-- accepted and the resolver would pick arbitrarily.
create unique index notification_preferences_one_global
  on public.notification_preferences (subject)
  where project_id is null;
create unique index notification_preferences_one_per_project
  on public.notification_preferences (subject, project_id)
  where project_id is not null;

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function app.touch_updated_at();

-- The audit trail: what was said, and what it was taken to mean.
create table public.preference_instructions (
  instruction_id    uuid        primary key default gen_random_uuid(),

  subject           text        not null default 'grant',
  origin_channel    text        not null,
  -- The command that carried it, so the instruction ties back to the canonical
  -- envelope rather than floating free.
  command_id        uuid        references public.inbound_commands (command_id),

  -- Verbatim. This is Grant's own words about his own notifications, so there
  -- is nothing to redact, and paraphrasing it would defeat the purpose.
  instruction       text        not null,

  -- The structured result, as applied. Stored as jsonb rather than as columns
  -- mirroring the preferences table: this records what the parse produced at
  -- the time, and must not change shape when the preferences table does.
  interpreted_as    jsonb       not null,

  -- Which parser produced it. 'rules' is the deterministic path; anything else
  -- names the model, so a suspicious interpretation can be attributed.
  interpreted_by    text        not null,

  -- Null means understood. Set means the instruction was not actionable, and
  -- the text says what was not understood — which is what Grant gets told,
  -- rather than silence.
  not_understood    text,

  applied_at        timestamptz not null default app.now_utc(),

  constraint preference_instructions_origin_known
    check (origin_channel in ('slack', 'telegram', 'voice', 'teamhq')),
  constraint preference_instructions_verbatim
    check (length(trim(instruction)) > 0),
  -- An instruction that was not understood cannot also claim an interpretation.
  constraint preference_instructions_understood_xor_not
    check ((not_understood is null) = (interpreted_as <> '{}'::jsonb))
);

create index preference_instructions_recent
  on public.preference_instructions (subject, applied_at desc);

comment on table public.preference_instructions is
  'What Grant said, and what it was taken to mean. Kept so that "why was I not '
  'told about this?" is answerable three weeks later, and so a misparse is '
  'discoverable rather than mysterious.';

-- ---------------------------------------------------------------------------
-- Resolving a preference to a decision
-- ---------------------------------------------------------------------------

-- Would this notification be delivered right now?
--
-- In SQL rather than in TypeScript because more than one caller needs it — the
-- Edge Function runtime and the worker loop — and §11's lesson about a guard
-- applied in one of two call paths applies equally to a filter. A second
-- implementation would drift.
create or replace function app.notification_allowed(
  p_subject     text,
  p_channel     text,
  p_severity    public.notify_severity,
  p_project_id  uuid default null
) returns boolean
language plpgsql
stable
as $$
declare
  v_pref record;
begin
  -- The more specific scope wins, which is why the project row is ordered
  -- first rather than merged: layering two partial preferences would need a
  -- precedence rule per column, and there is no sensible rule for min_severity.
  select * into v_pref
  from public.notification_preferences
  where subject = p_subject
    and (project_id = p_project_id or project_id is null)
  order by (project_id is not null) desc
  limit 1;

  -- No preference is not the same as a restrictive one.
  if v_pref is null then
    return true;
  end if;

  -- The escape hatch, checked before every restriction. §12 gives Grant
  -- blockers because he is the only one who can clear them, so a preference
  -- must not be able to hide them by accident — only by saying so.
  if p_severity = 'blocker' and v_pref.blockers_always then
    return true;
  end if;

  if v_pref.quiet_until is not null and v_pref.quiet_until > app.now_utc() then
    return false;
  end if;

  if p_channel = any (v_pref.muted_channels) then
    return false;
  end if;

  if v_pref.min_severity is not null and p_severity < v_pref.min_severity then
    return false;
  end if;

  return true;
end;
$$;

comment on function app.notification_allowed(text, text, public.notify_severity, uuid) is
  'The single definition of "may this be delivered". In SQL because both the '
  'Edge Function runtime and the worker loop need it, and a second '
  'implementation would drift (§11 on guards in one of two call paths).';

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
alter table public.preference_instructions enable row level security;
alter table public.preference_instructions force row level security;

grant select, insert, update on public.notification_preferences to ai_team_app;
grant select, insert on public.preference_instructions to ai_team_app;
grant execute on function
  app.notification_allowed(text, text, public.notify_severity, uuid) to ai_team_app;

create policy notification_preferences_app_read on public.notification_preferences
  for select to ai_team_app using (true);
create policy notification_preferences_app_insert on public.notification_preferences
  for insert to ai_team_app with check (true);
create policy notification_preferences_app_update on public.notification_preferences
  for update to ai_team_app using (true) with check (true);
create policy preference_instructions_app_read on public.preference_instructions
  for select to ai_team_app using (true);
create policy preference_instructions_app_append on public.preference_instructions
  for insert to ai_team_app with check (true);

-- The instruction log is append-only for the same reason the ledger is: it is
-- the record of what was said, and a record that can be edited is not one.
revoke update, delete, truncate on public.preference_instructions from ai_team_app;

create trigger preference_instructions_reject_update
  before update on public.preference_instructions
  for each row execute function app.reject_ledger_mutation();

commit;
