-- 0031 — feedback capture, and notification learning that proposes rather
-- than acts
--
-- ## The decision this file is mostly about
--
-- Notification learning is the feature that most wants to be automatic. The
-- system can see that Grant ignores every `routine` Slack notification about
-- project X, and raising his minimum severity is obviously right. So why not
-- just do it?
--
-- Because the failure is invisible and the recovery is impossible. If the
-- inference is wrong - he was on holiday, the notifications were badly worded,
-- he read them in Telegram instead - the system stops telling him things and
-- NOTHING SURFACES THAT. There is no error, no blocker, no degraded cycle. The
-- next important message about project X is silently downgraded, and the only
-- evidence is an absence, which is the one kind of evidence a person cannot
-- notice.
--
-- §21's honesty posture and §12's structured-preference rule both point the
-- same way: an inference about what somebody wants is not the same as being
-- told, and the system must not confuse the two. `preference_instructions`
-- (0013) exists precisely to record what Grant SAID. A learned proposal is not
-- that, and must not be written there.
--
-- So learning produces `preference_proposals`, which are inert. Something has
-- to accept one before anything changes, and the acceptance is what gets
-- recorded as an instruction. The system may notice; it may not decide.
--
-- The asymmetry is worth stating: a proposal Grant never sees costs one
-- unhelpful notification a day. An auto-applied wrong proposal costs a missed
-- blocker, silently, for as long as it stands.

begin;

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------

create type public.feedback_signal as enum (
  'positive',
  'negative',
  -- Grant said what it should have been. The most valuable kind, and the
  -- reason `body` is not optional for it.
  'correction'
);

create type public.feedback_subject as enum (
  'output',
  'notification',
  'briefing',
  'job',
  'staff'
);

create table public.feedback (
  feedback_id   uuid        primary key default gen_random_uuid(),

  subject_kind  public.feedback_subject not null,
  -- The row it is about. Not a foreign key: feedback outlives the thing it is
  -- about (a briefing may be purged; the fact that it was wrong should not
  -- be), and one column cannot reference five tables anyway.
  subject_ref   uuid,

  signal        public.feedback_signal not null,
  body          text,

  -- Where it came from, so a 👎 reaction and a typed sentence are
  -- distinguishable. A reaction is a weak signal; a sentence is not.
  origin_channel text       not null,
  given_by      text        not null default 'grant',
  created_at    timestamptz not null default app.now_utc(),

  -- A correction that does not say what the right answer was is a thumbs-down
  -- wearing a hat.
  constraint feedback_correction_says_what
    check (signal <> 'correction' or length(trim(coalesce(body, ''))) >= 10),
  constraint feedback_channel_known
    check (origin_channel in ('slack', 'telegram', 'voice', 'teamhq', 'email'))
);

create index feedback_by_subject on public.feedback (subject_kind, subject_ref);
create index feedback_recent on public.feedback (created_at desc);

comment on table public.feedback is
  'What Grant thought of something. `origin_channel` matters: a reaction is a '
  'weak signal and a typed sentence is not, and treating them alike is how a '
  'stray emoji becomes a policy.';

revoke update, delete, truncate on public.feedback from ai_team_app;
create trigger feedback_reject_update
  before update on public.feedback
  for each row execute function app.reject_ledger_mutation();
create trigger feedback_reject_truncate
  before truncate on public.feedback
  for each statement execute function app.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Notification outcomes — the raw material for learning
-- ---------------------------------------------------------------------------

create type public.notification_outcome as enum (
  'delivered',   -- sent, nothing observed since
  'seen',        -- opened or read
  'acted',       -- produced a response
  'dismissed',   -- explicitly waved away
  'suppressed'   -- preferences stopped it going out at all
);

create table public.notification_events (
  notification_id uuid      primary key default gen_random_uuid(),

  channel       text        not null,
  severity      public.notify_severity not null,
  project_id    uuid        references public.projects (project_id),
  subject_kind  public.feedback_subject not null,
  subject_ref   uuid,

  outcome       public.notification_outcome not null default 'delivered',
  sent_at       timestamptz not null default app.now_utc(),
  -- Set when the outcome moves past `delivered`. Null while nothing has
  -- happened, which is itself the signal learning cares about most.
  resolved_at   timestamptz,

  constraint notification_events_channel_known
    check (channel in ('slack', 'telegram', 'voice', 'teamhq')),
  constraint notification_events_resolved_iff_moved
    check ((outcome in ('delivered', 'suppressed')) = (resolved_at is null))
);

create index notification_events_learning
  on public.notification_events (channel, severity, project_id, sent_at desc);

comment on table public.notification_events is
  'One row per notification, with what happened to it. `delivered` with a null '
  'resolved_at - nothing happened - is the observation learning weighs most, '
  'and the one an outcome-only table would have thrown away.';

-- ---------------------------------------------------------------------------
-- Proposals — inert by construction
-- ---------------------------------------------------------------------------

create type public.proposal_state as enum ('open', 'accepted', 'declined', 'stale');

create table public.preference_proposals (
  proposal_id   uuid        primary key default gen_random_uuid(),

  -- What it wants changed, in the shape `notification_preferences` uses, so
  -- accepting one is a mechanical application rather than a re-interpretation.
  change        jsonb       not null,
  -- Why, in plain words Grant can disagree with. Required: a proposal he
  -- cannot evaluate is a proposal he can only rubber-stamp.
  rationale     text        not null,
  -- The counts behind it, so the rationale can be checked rather than trusted.
  evidence      jsonb       not null,

  channel       text,
  project_id    uuid        references public.projects (project_id),

  state         public.proposal_state not null default 'open',
  proposed_at   timestamptz not null default app.now_utc(),
  settled_at    timestamptz,
  -- Set when accepted: the instruction row that actually changed something.
  -- The proposal never changes anything itself.
  instruction_id uuid       references public.preference_instructions (instruction_id),

  constraint preference_proposals_rationale_substantive
    check (length(trim(rationale)) >= 20),
  constraint preference_proposals_evidence_present
    check (evidence <> '{}'::jsonb),
  constraint preference_proposals_settled_iff_timestamped
    check ((state = 'open') = (settled_at is null)),
  -- An accepted proposal points at the instruction that carried it out. This
  -- is the constraint that makes "the proposal did not change anything by
  -- itself" checkable rather than merely intended.
  constraint preference_proposals_accepted_names_instruction
    check ((state = 'accepted') = (instruction_id is not null))
);

create index preference_proposals_open
  on public.preference_proposals (proposed_at desc) where state = 'open';

comment on table public.preference_proposals is
  'Inert. A proposal changes nothing; accepting one writes a '
  'preference_instructions row, and the FK makes that traceable. The system may '
  'notice what Grant ignores; it may not decide to stop telling him.';

-- The app role may propose and may read. It may NOT accept - acceptance is the
-- moment a preference actually changes, and §21 reserves that.
revoke update, delete, truncate on public.preference_proposals from ai_team_app;

/**
 * Look for a pattern worth proposing.
 *
 * Returns candidate proposals; writes nothing. Deliberately conservative:
 *
 *   * a minimum sample, because three ignored notifications is a week, not a
 *     preference;
 *   * `blocker` severity is never proposed away, matching
 *     `notification_preferences.blockers_always`. A learned rule that stops
 *     blockers reaching Grant is the one outcome from which there is no
 *     recovery;
 *   * ignored means `delivered` with nothing since - not `dismissed`, which is
 *     an interaction and therefore evidence he wanted to see it enough to wave
 *     it away.
 */
create or replace function app.notification_patterns(
  p_min_sample integer default 10,
  p_ignored_ratio numeric default 0.8
)
returns table (
  channel text,
  severity public.notify_severity,
  project_id uuid,
  sent integer,
  ignored integer,
  ignored_ratio numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    n.channel, n.severity, n.project_id,
    count(*)::int,
    count(*) filter (where n.outcome = 'delivered' and n.resolved_at is null)::int,
    round(
      count(*) filter (where n.outcome = 'delivered' and n.resolved_at is null)::numeric
      / nullif(count(*), 0), 2)
  from public.notification_events n
  where n.sent_at >= app.now_utc() - interval '30 days'
    -- Never propose away a blocker. `blockers_always` defaults true for a
    -- reason, and a learned rule must not be able to argue with it.
    and n.severity <> 'blocker'
  group by n.channel, n.severity, n.project_id
  having count(*) >= p_min_sample
     and count(*) filter (where n.outcome = 'delivered' and n.resolved_at is null)::numeric
         / nullif(count(*), 0) >= p_ignored_ratio;
$$;

comment on function app.notification_patterns is
  'Candidate patterns only - writes nothing. Never returns `blocker` severity: '
  'a learned rule that stops blockers reaching Grant is the one outcome with no '
  'recovery.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.feedback              enable row level security;
alter table public.feedback              force  row level security;
alter table public.notification_events   enable row level security;
alter table public.notification_events   force  row level security;
alter table public.preference_proposals  enable row level security;
alter table public.preference_proposals  force  row level security;

grant select, insert on public.feedback to ai_team_app;
grant select, insert, update on public.notification_events to ai_team_app;
grant select, insert on public.preference_proposals to ai_team_app;
grant execute on function app.notification_patterns(integer, numeric) to ai_team_app;

create policy feedback_app_read on public.feedback for select to ai_team_app using (true);
create policy feedback_app_insert on public.feedback for insert to ai_team_app with check (true);
create policy notification_events_app_read on public.notification_events
  for select to ai_team_app using (true);
create policy notification_events_app_insert on public.notification_events
  for insert to ai_team_app with check (true);
create policy notification_events_app_update on public.notification_events
  for update to ai_team_app using (true) with check (true);
create policy preference_proposals_app_read on public.preference_proposals
  for select to ai_team_app using (true);
create policy preference_proposals_app_insert on public.preference_proposals
  for insert to ai_team_app with check (true);

commit;
