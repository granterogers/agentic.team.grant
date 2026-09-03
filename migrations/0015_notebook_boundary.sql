-- 0015 — the Notebook boundary
--
-- §7 calls Notebook a *high-risk adapter* and gives the rules that follow from
-- that. Three of them are structural, which means they can be got wrong in
-- schema and are worth enforcing here rather than remembering:
--
--   "**Never** make operational state depend on Notebook. Postgres remains
--    authoritative for jobs, events, staff state, configuration, decisions,
--    recovery, usage, approvals and history."
--
--   "**Never blindly retry an ambiguous Notebook write.** After a timeout or
--    uncertain write, **reconcile actual Notebook state first**."
--
--   "If Notebook is unavailable: continue operational work, **store pending
--    Notebook synchronization**, and reconcile on return. **Never lose
--    completed research because Notebook is down.**"
--
-- Nothing in this migration is referenced by `jobs`, `events`, `blockers`,
-- `system_config` or `inbound_commands`. That absence is the first rule being
-- kept: a foreign key pointing the other way would make an operational table
-- depend on a Notebook table, and the dependency would be invisible until
-- Notebook broke.
--
-- The direction is one-way by construction: Notebook tables reference
-- operational ones, never the reverse.

begin;

-- §7 requires runtime capability discovery reporting at least these five.
-- An enum rather than text because a sixth state invented at a call site is
-- how "degraded" quietly becomes "probably fine".
create type public.notebook_capability_state as enum (
  'available',             -- an official, supported API answered
  'available_unofficial',  -- the private RPC path answered; no stability promise
  'degraded',              -- answered, but not everything works
  'unavailable',           -- reachable and refusing, or unreachable
  'auth_required'          -- we have no usable credential
);

comment on type public.notebook_capability_state is
  '§7 runtime capability discovery. available_unofficial is the expected steady '
  'state for the consumer product: the private RPC path works and carries no '
  'stability promise, and calling that "available" would hide the risk the '
  'whole adapter boundary exists to contain.';

-- Every probe, kept rather than overwritten.
--
-- A single current-state row would answer "is Notebook up?" but not "when did
-- it break, and what did it say?" — and §7's whole posture is that this
-- dependency will break in undocumented ways. The history is the diagnosis.
create table public.notebook_capability_probes (
  probe_id          uuid        primary key default gen_random_uuid(),

  state             public.notebook_capability_state not null,
  -- Which capabilities were individually confirmed. Empty under auth_required.
  capabilities      text[]      not null default '{}'::text[],

  -- The library and version actually used, because a breaking change in an
  -- unofficial client is the failure mode §7 names and version is the first
  -- thing anyone will ask.
  adapter           text        not null,
  adapter_version   text,

  -- §11: read the tier, never hard-code quota. Null until a probe can read it.
  detected_tier     integer,
  notebook_limit    integer,
  source_limit      integer,

  -- Non-secret. A probe records what failed, never a credential.
  detail            text,
  latency_ms        integer,

  probed_at         timestamptz not null default app.now_utc(),

  constraint notebook_capability_probes_auth_required_has_no_capabilities
    check (state <> 'auth_required' or array_length(capabilities, 1) is null),
  -- A tier claim requires a probe that could actually read it, which
  -- auth_required by definition could not.
  constraint notebook_capability_probes_tier_needs_auth
    check (detected_tier is null or state <> 'auth_required'),
  constraint notebook_capability_probes_latency_sane
    check (latency_ms is null or latency_ms >= 0)
);

create index notebook_capability_probes_recent
  on public.notebook_capability_probes (probed_at desc);

-- The current view, derived rather than stored, so it cannot disagree with the
-- history it summarises.
create or replace view public.notebook_capability as
  select state, capabilities, adapter, adapter_version, detected_tier,
         notebook_limit, source_limit, detail, latency_ms, probed_at
  from public.notebook_capability_probes
  order by probed_at desc
  limit 1;

comment on view public.notebook_capability is
  'Current capability, derived from the newest probe rather than stored '
  'separately — a stored current-state row can disagree with its own history.';

-- ---------------------------------------------------------------------------
-- The pending-sync queue
-- ---------------------------------------------------------------------------

create type public.notebook_sync_state as enum (
  'pending',       -- waiting for Notebook to come back
  'in_flight',     -- a write was started
  'uncertain',     -- the write timed out or its result was unreadable
  'reconciling',   -- we are checking what actually happened
  'applied',       -- confirmed present in Notebook
  'abandoned'      -- deliberately given up on, with a reason
);

comment on type public.notebook_sync_state is
  'The `uncertain` state is the one that earns this table. §7: never blindly '
  'retry an ambiguous write — reconcile actual state first. Without a state '
  'for "we do not know whether this landed", the only options are retry (which '
  'may duplicate) and drop (which loses work).';

-- Work destined for Notebook, held in Postgres.
--
-- §7: "Never lose completed research because Notebook is down." So the payload
-- lives here in full, not a reference to something that has to be regenerated.
create table public.notebook_sync_queue (
  sync_id           uuid        primary key default gen_random_uuid(),

  project_id        uuid        references public.projects (project_id),
  -- Which job produced this. Nullable, and the FK points *from* here *to*
  -- jobs: operational state must never depend on Notebook state.
  job_id            uuid        references public.jobs (job_id),

  operation         text        not null,

  -- The whole payload. If Notebook is down for a week, the research is here.
  payload           jsonb       not null,

  -- §7: "Fingerprint sources and AI-generated writes; prevent duplicate
  -- processing." Content-addressed, so the same content queued twice collides
  -- rather than being written twice — including across a crash, which a
  -- de-duplicating check in application code would not survive.
  fingerprint       text        not null,

  state             public.notebook_sync_state not null default 'pending',

  attempt           integer     not null default 0,
  -- What Notebook called the thing, once we know. Null while pending, and
  -- non-null is what makes `applied` believable.
  remote_ref        text,

  -- Set when a write's outcome could not be determined. §7 requires
  -- reconciliation before any retry, and this is the field that forces it.
  uncertain_since   timestamptz,
  reconciled_at     timestamptz,
  last_error        text,
  abandoned_reason  text,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),

  constraint notebook_sync_queue_operation_known
    check (operation in (
      'add_source', 'add_note', 'create_notebook', 'delete_source',
      'generate_artifact', 'update_note'
    )),
  constraint notebook_sync_queue_fingerprint_sha256
    check (fingerprint ~ '^[0-9a-f]{64}$'),
  constraint notebook_sync_queue_attempt_non_negative
    check (attempt >= 0),
  -- An applied row names what it became. Without this, `applied` is a claim
  -- with no evidence, and the queue's whole purpose is to be believable about
  -- what did and did not land.
  constraint notebook_sync_queue_applied_has_remote_ref
    check (state <> 'applied' or remote_ref is not null),
  constraint notebook_sync_queue_uncertain_is_timestamped
    check ((state = 'uncertain') = (uncertain_since is not null)),
  constraint notebook_sync_queue_abandoned_has_reason
    check ((state = 'abandoned') = (abandoned_reason is not null))
);

-- The same content must not be queued twice while it is still live. Partial,
-- so a re-queue after abandonment is allowed — that is a decision to try again,
-- not a duplicate.
create unique index notebook_sync_queue_one_live_per_fingerprint
  on public.notebook_sync_queue (fingerprint)
  where state in ('pending', 'in_flight', 'uncertain', 'reconciling');

create index notebook_sync_queue_pending on public.notebook_sync_queue (created_at)
  where state = 'pending';
-- The queue anyone should look at first: writes whose fate is unknown.
create index notebook_sync_queue_uncertain on public.notebook_sync_queue (uncertain_since)
  where state = 'uncertain';

create trigger notebook_sync_queue_touch_updated_at
  before update on public.notebook_sync_queue
  for each row execute function app.touch_updated_at();

-- §7 forbids a blind retry of an ambiguous write, so the database refuses one.
--
-- A rule in a comment is a rule that gets bypassed at 3am by whoever is fixing
-- the outage. `uncertain -> in_flight` is exactly the blind retry, and it is
-- rejected; the path out is `uncertain -> reconciling -> …`, which is a
-- decision someone had to make.
create or replace function app.enforce_notebook_sync_transition()
returns trigger
language plpgsql
as $$
begin
  if old.state = new.state then
    return new;
  end if;

  if old.state = 'uncertain' and new.state = 'in_flight' then
    raise exception
      'refusing to retry an ambiguous Notebook write without reconciling first '
      '(sync_id %, uncertain since %). §7: reconcile actual Notebook state, '
      'then move to reconciling. Undocumented operations may not be cleanly '
      'idempotent.', old.sync_id, old.uncertain_since
      using errcode = 'check_violation';
  end if;

  -- A terminal row does not come back to life. Re-queue by inserting, which
  -- the partial unique index permits once the old row is abandoned.
  if old.state in ('applied', 'abandoned') then
    raise exception
      'Notebook sync % is already %; insert a new row rather than reviving it',
      old.sync_id, old.state
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger notebook_sync_queue_enforce_transition
  before update of state on public.notebook_sync_queue
  for each row execute function app.enforce_notebook_sync_transition();

-- ---------------------------------------------------------------------------
-- The cached source text
-- ---------------------------------------------------------------------------

-- §7's quota design: *"Pull each source's text once via fulltext/guide
-- retrieval; cache in Postgres, fingerprinted. Agents reason over cached text
-- on the normal inference provider — zero Notebook quota."*
--
-- This table is what makes "zero Notebook quota" true rather than aspirational.
create table public.notebook_sources (
  source_id         uuid        primary key default gen_random_uuid(),

  project_id        uuid        references public.projects (project_id),
  -- Notebook's own identifiers, as references *into* Notebook.
  remote_notebook_id text       not null,
  remote_source_id  text        not null,

  title             text,
  source_type       text,

  -- The cached text, and its fingerprint. Null content with a fingerprint is
  -- not a state this allows: a fingerprint of nothing would silently satisfy a
  -- freshness check.
  content           text,
  content_fingerprint text,
  content_chars     integer,

  fetched_at        timestamptz,
  -- What Notebook last said about it, to notice a change without refetching.
  remote_updated_at timestamptz,

  created_at        timestamptz not null default app.now_utc(),
  updated_at        timestamptz not null default app.now_utc(),

  constraint notebook_sources_fingerprint_sha256
    check (content_fingerprint is null or content_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint notebook_sources_content_and_fingerprint_together
    check ((content is null) = (content_fingerprint is null)),
  constraint notebook_sources_fetched_iff_content
    check ((content is null) = (fetched_at is null))
);

create unique index notebook_sources_one_per_remote
  on public.notebook_sources (remote_notebook_id, remote_source_id);
create index notebook_sources_by_project on public.notebook_sources (project_id)
  where project_id is not null;

create trigger notebook_sources_touch_updated_at
  before update on public.notebook_sources
  for each row execute function app.touch_updated_at();

comment on table public.notebook_sources is
  '§7 quota design: pull each source once, cache here, and let agents reason '
  'over the cached text on the normal inference provider at zero Notebook '
  'quota. This table is what makes that true rather than aspirational.';

alter table public.notebook_capability_probes enable row level security;
alter table public.notebook_capability_probes force  row level security;
alter table public.notebook_sync_queue        enable row level security;
alter table public.notebook_sync_queue        force  row level security;
alter table public.notebook_sources           enable row level security;
alter table public.notebook_sources           force  row level security;

grant select, insert on public.notebook_capability_probes to ai_team_app;
grant select on public.notebook_capability to ai_team_app;
grant select, insert, update on public.notebook_sync_queue to ai_team_app;
grant select, insert, update on public.notebook_sources to ai_team_app;
grant execute on function app.enforce_notebook_sync_transition() to ai_team_app;

create policy notebook_capability_probes_app_read on public.notebook_capability_probes
  for select to ai_team_app using (true);
create policy notebook_capability_probes_app_append on public.notebook_capability_probes
  for insert to ai_team_app with check (true);
create policy notebook_sync_queue_app_read on public.notebook_sync_queue
  for select to ai_team_app using (true);
create policy notebook_sync_queue_app_insert on public.notebook_sync_queue
  for insert to ai_team_app with check (true);
create policy notebook_sync_queue_app_update on public.notebook_sync_queue
  for update to ai_team_app using (true) with check (true);
create policy notebook_sources_app_read on public.notebook_sources
  for select to ai_team_app using (true);
create policy notebook_sources_app_insert on public.notebook_sources
  for insert to ai_team_app with check (true);
create policy notebook_sources_app_update on public.notebook_sources
  for update to ai_team_app using (true) with check (true);

-- The kill-switch §17 requires. Notebook must be independently disableable, and
-- the switch must not be self-adjustable: a system that can re-enable a
-- dependency it has decided is broken has no kill-switch.
insert into public.system_config (key, value, description, self_adjustable)
values (
  'notebook.enabled',
  'false'::jsonb,
  'Whether the Notebook adapter may be used at all. False until Gate 2 passes: '
  'the credential does not exist yet, and an adapter that cannot authenticate '
  'must be off rather than failing on every call.',
  false
)
on conflict (key) do nothing;

commit;
