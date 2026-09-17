-- What Grant approved is what runs (#263, #131).
--
-- #263's approval requirement is one sentence and it is a safety property, not
-- a nicety:
--
--   > *"Do not let the resumed worker regenerate a materially different action
--   > after Grant approved the earlier one. Approval should bind to the exact
--   > plan or its version/hash."*
--
-- Today a job can pause `awaiting_approval` and resume, and nothing compares
-- what it is about to do against what was approved. The model is re-prompted
-- on resume; a different draft, a different recipient or a different file is
-- entirely possible, and it would go out carrying an approval that was given
-- for something else. That is the worst failure this repository can have,
-- because the audit trail says it was approved.
--
-- ## A hash, not a copy
--
-- The pause records a FINGERPRINT of the action. On resume the step recomputes
-- its action and hands the fingerprint back; if they differ the job parks for
-- a person rather than proceeding, and says both.
--
-- A hash rather than the action itself for two reasons. The action can be
-- large — a drafted document is the common case — and `job_pauses` is a
-- control table, not a store. And a fingerprint cannot be partially compared:
-- there is no temptation to decide that a changed recipient is close enough.
--
-- ## Why the step computes it, not this function
--
-- Only the step knows which parts of its action are MATERIAL. A timestamp in a
-- draft changes on every regeneration and means nothing; the recipient means
-- everything. A generic serialiser would either hash the timestamp and refuse
-- every resume, or strip fields by guessing. The step states what it is
-- promising to do, and this stores the promise.

alter table public.job_pauses
  add column if not exists binds_to text
    check (binds_to is null or binds_to ~ '^[0-9a-f]{64}$');

comment on column public.job_pauses.binds_to is
  'A sha256 of the action this pause is waiting to have approved. Null when '
  'the pause binds to nothing — a rate limit is not an approval. Compared on '
  'resume: a different action parks rather than proceeding.';

/*
  An approval pause must bind to something.

  Any other reason may, and usually does not. Without this an
  `awaiting_approval` pause with no fingerprint would resume unchecked, which
  is the defect this migration exists to close wearing a null.
*/
alter table public.job_pauses
  drop constraint if exists job_pauses_approval_binds;
alter table public.job_pauses
  add constraint job_pauses_approval_binds
  check (reason <> 'awaiting_approval' or binds_to is not null);

/*
  `pause_job` gains the fingerprint. Dropped by exact signature first, because
  `create or replace` does not replace a function whose argument list changed —
  it creates a second overload and every call becomes ambiguous.
*/
drop function if exists app.pause_job(uuid, text, text, text, boolean, timestamptz, timestamptz);

create or replace function app.pause_job(
  p_job uuid, p_reason text, p_detail text, p_resume_when text,
  p_resumable boolean default true,
  p_until timestamptz default null,
  p_expires_at timestamptz default null,
  p_binds_to text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_state text;
begin
  /*
    0436's body, unchanged, with one guard and one column added.

    Rewritten from memory the first time and four behaviours went missing:
    `waiting_on` took the reason instead of the sentence a person reads,
    `state_reason` lost its prefix, the already-paused early return went, and
    the job kept its LEASE — which would have left a paused job looking
    claimed until the lease expired. Taken from the live definition this time,
    which is the rule CLAUDE.md states and which I did not follow.
  */
  select state::text into v_state from public.jobs where job_id = p_job;
  if v_state is null then
    return jsonb_build_object('error', 'no such job');
  end if;
  if v_state = 'paused' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_reason = 'awaiting_approval' and coalesce(p_binds_to, '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error',
      'an approval has to bind to the exact action it approves — pass the '
      'fingerprint of what the job is promising to do');
  end if;

  insert into public.job_pauses
    (job_id, reason, detail, resume_when, resumable, expires_at, binds_to)
  values (p_job, p_reason, p_detail, p_resume_when, coalesce(p_resumable, true),
          p_expires_at, p_binds_to);

  update public.jobs
     set state = 'paused',
         state_reason = left(p_reason || ': ' || p_detail, 500),
         waiting_on = left(p_resume_when, 500),
         not_before = coalesce(p_until, not_before),
         leased_by = null,
         leased_until = null
   where job_id = p_job;

  return jsonb_build_object('ok', true, 'was', v_state);
end;
$fn$;

/**
 * Is this the action that was approved?
 *
 * Answers rather than raises, because the caller is a step that has to decide
 * between carrying on and parking, and both are ordinary outcomes.
 *
 * `matched` false with no open approval pause means nothing was ever approved,
 * which is a different sentence from "something else was approved" — and the
 * office needs both, because one is a bug in the handler and the other is the
 * invariant doing its job.
 */
create or replace function app.approval_binds(p_job uuid, p_fingerprint text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_bound text;
  v_at timestamptz;
begin
  select p.binds_to, p.at into v_bound, v_at
    from public.job_pauses p
   where p.job_id = p_job and p.reason = 'awaiting_approval'
   order by p.at desc
   limit 1;

  if v_bound is null then
    return jsonb_build_object('matched', false, 'approved_anything', false,
      'why', 'nothing was ever approved for this job');
  end if;
  if v_bound = p_fingerprint then
    return jsonb_build_object('matched', true, 'approved_at', v_at);
  end if;
  return jsonb_build_object('matched', false, 'approved_anything', true, 'approved_at', v_at,
    'why', 'what this job is about to do is not what was approved — the action '
           'changed while it was waiting, so it needs looking at rather than sending');
end;
$fn$;
