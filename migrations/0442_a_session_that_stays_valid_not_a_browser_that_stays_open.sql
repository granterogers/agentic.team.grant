-- A browser the office can use, at zero pounds a month (#135, #16).
--
-- ## The distinction the assessment turned on
--
-- `docs/agent-runtime-assessment-2026-09-17.md` separates persistent STATE
-- from persistent COMPUTE, and the whole of #135's first half falls on the
-- free side of that line:
--
--   > *"A browser tab in every project does not need a browser that stays
--   > open; it needs a session that stays valid."*
--
-- A process holding RAM between requests costs money, always. A cookie jar in
-- the Vault costs nothing, and it is what actually makes the second visit
-- work. So this migration stores SESSIONS, and every run opens a fresh browser
-- somewhere ephemeral, presents the jar, does one bounded piece of work and
-- dies. Cloudflare Browser Rendering gives ten browser-minutes a day free.
--
-- ## Gather, and deliberately not act
--
-- Confirmed with Grant on 17 September 2026: the first tier GATHERS. It opens
-- a page behind a login, reads it, photographs it and writes down what it
-- found. It does not click, submit, buy, send or delete. That is enforced
-- here, in `browser_actions.verb`, and not left to a handler's good manners --
-- because the whole failure mode of browser automation is an agent that
-- decided the button looked harmless.
--
-- Acting will need its own migration, its own approval path through #15, and
-- its own verbs. A widened CHECK is a decision somebody has to make on
-- purpose.
--
-- ## The credential is a reference, never a value
--
-- Same rule as `mcp_providers.credential_ref` and the notebook's session jar:
-- `app.resolve_secret` is the only route to a credential, the column holds the
-- uuid it takes, and the runtime is handed the jar in a request body rather
-- than given standing access to the Vault -- the rule `src/files/store.ts`
-- states about the service key.
--
-- ## Stop is a column, because there is no socket to shout down
--
-- The runtime is somewhere else and the job may be mid-step. There is no
-- connection to interrupt, so Stop is a fact in the database that the runner
-- reads between steps. It goes on `public.jobs` rather than on anything to do
-- with browsing, because stopping a long job is a general need and #263's
-- step runner is the general place to honour it -- putting it on a browser
-- table would be the instance-versus-class mistake this repository has paid
-- for twice.
--
-- ## Ten minutes a day is a budget, so it is metered
--
-- A cap nobody counts against is a cap that is discovered by being exceeded.
-- Every action records its own milliseconds and `app.browser_budget` reports
-- what is left today. This is the fourth item of the assessment's ordering,
-- pulled forward, because shipping a metered capability without the meter is
-- how the free tier stops being free.

-- ---------------------------------------------------------------- Stop -----

alter table public.jobs
  add column if not exists stop_requested_at timestamptz,
  add column if not exists stop_requested_by text;

comment on column public.jobs.stop_requested_at is
  'Somebody asked for this job to stop. Read between steps by app.step_begin''s '
  'caller; never a guarantee that anything has stopped yet.';

create or replace function app.request_stop(p_job uuid, p_who text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_state text;
begin
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'there is no job by that id');
  end if;
  if v_state in ('complete', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'note',
      'that job already finished, so there is nothing to stop');
  end if;
  update public.jobs
     set stop_requested_at = coalesce(stop_requested_at, app.now_utc()),
         stop_requested_by = coalesce(stop_requested_by, nullif(trim(coalesce(p_who, '')), '')),
         updated_at = app.now_utc()
   where job_id = p_job;
  return jsonb_build_object('ok', true, 'state', v_state);
end;
$fn$;

create or replace function app.stop_requested(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.jobs where job_id = p_job and stop_requested_at is not null
  );
$fn$;

-- ------------------------------------------------------------ Sessions -----

create table if not exists public.browser_sessions (
  session_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(project_id) on delete cascade,
  /** The host this session is good for. One session, one site. */
  site text not null check (site ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  /*
    A session with no stated purpose is a session nobody can audit. Required,
    and required to be a sentence rather than a word, because "research" tells
    a person reading the Browser tab in three months exactly nothing.
  */
  purpose text not null check (length(trim(purpose)) >= 12),
  /** A REFERENCE to the cookie jar in the Vault. Never the jar itself. */
  credential_ref app.vault_secret_ref,
  established_at timestamptz not null default app.now_utc(),
  last_alive_at timestamptz,
  /** Set when a run finds the jar no longer signed in. */
  expired_at timestamptz,
  revoked_at timestamptz,
  established_by text not null default 'grant',
  created_at timestamptz not null default app.now_utc(),
  updated_at timestamptz not null default app.now_utc(),
  unique (project_id, site)
);

comment on table public.browser_sessions is
  'A session that stays valid, not a browser that stays open. The cookie jar '
  'lives in the Vault; this row says which project it belongs to, what it is '
  'for, and whether it still works.';

create index if not exists browser_sessions_live
  on public.browser_sessions (project_id)
  where revoked_at is null and expired_at is null;

-- ------------------------------------------------------------- Actions -----

create table if not exists public.browser_actions (
  action_id uuid primary key default gen_random_uuid(),
  session_id uuid references public.browser_sessions(session_id) on delete set null,
  job_id uuid references public.jobs(job_id),
  project_id uuid references public.projects(project_id) on delete cascade,
  /*
    GATHER ONLY. Opening, reading, photographing and downloading are the four
    things this tier may do. Clicking, typing, submitting and paying are not
    in this list and widening it is a separate, deliberate migration with an
    approval path behind it.
  */
  verb text not null check (verb in ('open', 'read', 'shot', 'download')),
  url text not null,
  ok boolean not null,
  /** Non-secret, always. A page title, a reason, a count. Never a cookie. */
  detail text not null default '',
  /** Where the screenshot landed in the build bucket, when there is one. */
  shot_path text,
  ms integer not null default 0 check (ms >= 0),
  at timestamptz not null default app.now_utc()
);

comment on table public.browser_actions is
  'Append-only. Every page the office opened, what it did there, how long it '
  'took and what it photographed. The legibility half of the Browser tab.';

create index if not exists browser_actions_recent
  on public.browser_actions (project_id, at desc);
create index if not exists browser_actions_today
  on public.browser_actions (at desc);

drop trigger if exists browser_actions_no_update on public.browser_actions;
drop trigger if exists browser_actions_no_delete on public.browser_actions;
drop trigger if exists browser_actions_no_truncate on public.browser_actions;
create trigger browser_actions_no_update before update on public.browser_actions
  for each row execute function app.reject_ledger_mutation();
create trigger browser_actions_no_delete before delete on public.browser_actions
  for each row execute function app.reject_ledger_mutation();
create trigger browser_actions_no_truncate before truncate on public.browser_actions
  for each statement execute function app.reject_ledger_mutation();

-- ------------------------------------------------------------- Writers -----

create or replace function app.browser_session_open(
  p_project uuid, p_site text, p_purpose text, p_ref app.vault_secret_ref, p_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_site text := lower(trim(coalesce(p_site, '')));
  v_id uuid;
begin
  if not exists (select 1 from public.projects where project_id = p_project) then
    return jsonb_build_object('error', 'there is no dashboard project by that id');
  end if;
  if v_site !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    return jsonb_build_object('error',
      format('%L does not look like a site. Give me a host, like example.com.', p_site));
  end if;
  if length(trim(coalesce(p_purpose, ''))) < 12 then
    return jsonb_build_object('error',
      'say what the session is for, in a sentence. A session with no stated '
      'purpose is a session nobody can audit.');
  end if;

  insert into public.browser_sessions
    (project_id, site, purpose, credential_ref, established_by)
  values (p_project, v_site, trim(p_purpose), p_ref, coalesce(nullif(trim(coalesce(p_by, '')), ''), 'grant'))
  on conflict (project_id, site) do update
     set purpose = excluded.purpose,
         credential_ref = coalesce(excluded.credential_ref, public.browser_sessions.credential_ref),
         established_at = app.now_utc(),
         expired_at = null,
         revoked_at = null,
         updated_at = app.now_utc()
  returning session_id into v_id;

  return jsonb_build_object('ok', true, 'session_id', v_id, 'site', v_site);
end;
$fn$;

create or replace function app.browser_session_revoke(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ref app.vault_secret_ref;
begin
  update public.browser_sessions
     set revoked_at = coalesce(revoked_at, app.now_utc()),
         credential_ref = null,
         updated_at = app.now_utc()
   where session_id = p_session
  returning credential_ref into v_ref;
  if not found then
    return jsonb_build_object('error', 'there is no session by that id');
  end if;
  /*
    The jar itself is removed by the caller that holds Vault access. Nulling
    the reference first is what 0350 learned the hard way: a dangling
    reference raises on every read, and a null one degrades alone.
  */
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function app.browser_note(
  p_session uuid, p_job uuid, p_verb text, p_url text, p_ok boolean,
  p_detail text, p_shot text, p_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_project uuid;
  v_id uuid;
begin
  select project_id into v_project from public.browser_sessions where session_id = p_session;
  if v_project is null then
    select project_id into v_project from public.jobs where job_id = p_job;
  end if;

  insert into public.browser_actions
    (session_id, job_id, project_id, verb, url, ok, detail, shot_path, ms)
  values (p_session, p_job, v_project, p_verb, left(coalesce(p_url, ''), 2000), coalesce(p_ok, false),
          left(coalesce(p_detail, ''), 600), p_shot, greatest(coalesce(p_ms, 0), 0))
  returning action_id into v_id;

  if p_session is not null and coalesce(p_ok, false) then
    update public.browser_sessions
       set last_alive_at = app.now_utc(), updated_at = app.now_utc()
     where session_id = p_session;
  end if;

  return jsonb_build_object('ok', true, 'action_id', v_id);
end;
$fn$;

create or replace function app.browser_session_expired(p_session uuid, p_why text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.browser_sessions
     set expired_at = coalesce(expired_at, app.now_utc()), updated_at = app.now_utc()
   where session_id = p_session;
  if not found then
    return jsonb_build_object('error', 'there is no session by that id');
  end if;
  return jsonb_build_object('ok', true, 'why', left(coalesce(p_why, ''), 400));
end;
$fn$;

-- ------------------------------------------------------------- Readers -----

/**
 * What is left of today's free browser minutes.
 *
 * The cap is a setting rather than a literal, because it is a vendor's number
 * and vendors change them -- the same reason §11 forbids hard-coding Google's
 * quota table.
 */
create or replace function app.browser_budget()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with cap as (
    select coalesce(
      (select nullif(value #>> '{}', '')::numeric from public.system_config
        where key = 'browser.daily_minutes'), 10)::numeric as minutes
  ), spent as (
    select coalesce(sum(a.ms), 0)::numeric / 60000 as minutes, count(*)::int as actions
      from public.browser_actions a
      left join public.jobs j on j.job_id = a.job_id
     where a.at >= date_trunc('day', app.now_utc())
       and not coalesce(j.is_fixture, false)
  )
  select jsonb_build_object(
    'cap_minutes', round(cap.minutes, 2),
    'used_minutes', round(spent.minutes, 2),
    'left_minutes', round(greatest(cap.minutes - spent.minutes, 0), 2),
    'actions_today', spent.actions,
    'exhausted', spent.minutes >= cap.minutes
  ) from cap, spent;
$fn$;

create or replace function app.browser_sessions_for(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(s.v order by s.ord), '[]'::jsonb) from (
    select row_number() over (order by b.established_at desc) as ord,
           jsonb_build_object(
             'session_id', b.session_id,
             'site', b.site,
             'purpose', b.purpose,
             'has_credential', b.credential_ref is not null,
             'established_at', b.established_at,
             'last_alive_at', b.last_alive_at,
             'state', case
               when b.revoked_at is not null then 'revoked'
               when b.expired_at is not null then 'signed_out'
               when b.credential_ref is null then 'needs_sign_in'
               else 'live' end,
             'actions', (select count(*)::int from public.browser_actions a
                          where a.session_id = b.session_id)
           ) as v
      from public.browser_sessions b
     where b.project_id = p_project
  ) s;
$fn$;

create or replace function app.browser_lately(p_project uuid, p_limit int default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(x.v order by x.ord), '[]'::jsonb) from (
    select row_number() over (order by a.at desc) as ord,
           jsonb_build_object(
             'at', a.at, 'verb', a.verb, 'url', a.url, 'ok', a.ok,
             'detail', a.detail, 'shot_path', a.shot_path, 'ms', a.ms,
             'site', b.site
           ) as v
      from public.browser_actions a
      left join public.browser_sessions b on b.session_id = a.session_id
     where (p_project is null or a.project_id = p_project)
     order by a.at desc
     limit greatest(coalesce(p_limit, 30), 1)
  ) x;
$fn$;
