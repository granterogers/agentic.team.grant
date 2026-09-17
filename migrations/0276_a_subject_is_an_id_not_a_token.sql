-- 0276 — a subject is an id, not a token
--
-- Two findings from `verify:failures`, both from attacking 0274 rather than
-- reading it.
--
-- ## 1. A Slack-token-shaped string was accepted as a subject
--
-- 0274's whole claim is that `failure_signatures` is provably free of payload,
-- and the argument is structural: there is no text column an error message
-- could be written into. True — and `subject` was the one way in, guarded by
--
--     subject ~ '^[A-Za-z0-9_.:-]{1,64}$'
--
-- which a Slack bot token satisfies completely. 55 characters, every one of
-- them in that class. The check pushed one at it and it was stored.
--
-- Two changes, both narrowing:
--
--   * A subject is a UUID or a **short lowercase handle**, at most 40
--     characters. Every real subject in this office is one of those — a
--     document id, a notebook id, an attachment id, a connector name. A token
--     is neither: they carry uppercase, and they are long.
--   * And it is held against the credential shapes from 0062 and 0257 as well,
--     because "no uppercase and under forty" is a rule about shape and the
--     credential list is a rule about content, and a guard that only checks one
--     of those is the guard that eventually lets something through.
--
-- Belt and braces on purpose. This column exists to hold an id; the cost of
-- being wrong is a credential in a table Grant will paste into an issue.
--
-- ## 2. "the notebook usage limit is spent" classified as unknown
--
-- The quota pattern knew `quota`, `allowance` and `rate limit` and not the
-- words the notebook adapter actually uses. A classifier that misses the
-- office's own vocabulary makes two signatures for one problem, which is the
-- flat log this replaces.

begin;

alter table public.failure_signatures drop constraint failure_signatures_subject_is_an_id;

alter table public.failure_signatures add constraint failure_signatures_subject_is_an_id check (
  subject = ''
  or (
    -- A uuid, or a short lowercase handle. Not a token: those carry uppercase
    -- and they are long.
    (subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or subject ~ '^[a-z0-9][a-z0-9_.:-]{0,39}$')
    -- And not a credential shape, whatever else it looks like. Same list as
    -- `job_traces_carries_no_credential` (0257), which took it from
    -- `connection_health_carries_no_credential` (0062).
    and subject !~
      '(xox[abeprs]-|sbp_[A-Za-z0-9]{16}|ntn_[A-Za-z0-9]{16}|secret_[A-Za-z0-9]{16}|sk-[A-Za-z0-9_-]{12}|AIza[A-Za-z0-9_-]{20}|gh[posur]_[A-Za-z0-9]{20}|github_pat_|eyJ[A-Za-z0-9_-]{10}\.[A-Za-z0-9_-]{10})'
  )
);

/**
 * Record a failure. Narrowed to match the constraint above.
 *
 * A subject that is not an id is still DROPPED rather than refused. Failing the
 * record because the caller passed something odd would mean a failure goes
 * uncounted at exactly the moment it matters — and the caller passing something
 * odd is the case this is defending against, so refusing would turn a leak
 * attempt into an outage.
 */
create or replace function app.failure_seen(
  p_job_kind text,
  p_message  text,
  p_subject  text default null,
  p_job_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class text := app.classify_failure(p_message);
  v_subject text := coalesce(btrim(p_subject), '');
  v_seen int;
  v_first timestamptz;
begin
  if v_subject <> ''
     and not (
       (v_subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or v_subject ~ '^[a-z0-9][a-z0-9_.:-]{0,39}$')
       and v_subject !~
         '(xox[abeprs]-|sbp_[A-Za-z0-9]{16}|ntn_[A-Za-z0-9]{16}|secret_[A-Za-z0-9]{16}|sk-[A-Za-z0-9_-]{12}|AIza[A-Za-z0-9_-]{20}|gh[posur]_[A-Za-z0-9]{20}|github_pat_|eyJ[A-Za-z0-9_-]{10}\.[A-Za-z0-9_-]{10})'
     )
  then
    v_subject := '';
  end if;

  insert into public.failure_signatures
    (job_kind, error_class, subject, seen, first_seen, last_seen, last_job_id)
  values (p_job_kind, v_class, v_subject, 1, app.now_utc(), app.now_utc(), p_job_id)
  on conflict (job_kind, error_class, subject) do update
    set seen = public.failure_signatures.seen + 1,
        last_seen = app.now_utc(),
        last_job_id = coalesce(excluded.last_job_id, public.failure_signatures.last_job_id)
  returning seen, first_seen into v_seen, v_first;

  return jsonb_build_object(
    'class', v_class, 'subject', v_subject, 'seen', v_seen,
    'first_seen', v_first,
    'note', case when v_seen = 1 then format('first %s failure for %s', v_class, p_job_kind)
                 else format('%s has failed with %s %s times since %s',
                             p_job_kind, v_class, v_seen, to_char(v_first, 'FMDD Mon')) end);
end;
$$;

/**
 * Classify a failure, now knowing the office's own words for a spent allowance.
 *
 * `usage limit` and `limit is spent` are what `src/notebook/actions.ts` says
 * when Google refuses a source, and the classifier had never heard of either.
 */
create or replace function app.classify_failure(p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message is null or btrim(p_message) = '' then 'unknown'
    when p_message ~* '(quota|allowance|rate.?limit|usage limit|limit is spent|too many requests|429)'
      then 'quota'
    when p_message ~* '(no .{0,20}credential|not configured|missing token|no token|no api key)'
      then 'no_credential'
    when p_message ~* '(unauthori[sz]ed|forbidden|invalid.{0,10}(token|key|credential)|401|403)'
      then 'auth'
    when p_message ~* '(timed? ?out|timeout|deadline exceeded|abort)' then 'timeout'
    when p_message ~* '(not found|no such|does not exist|404|is no longer)' then 'not_found'
    when p_message ~* '(unexpected shape|could not parse|invalid json|malformed|is missing )'
      then 'bad_shape'
    when p_message ~* '(econnrefused|enotfound|network|dns|fetch failed|socket|502|503|504)'
      then 'unreachable'
    when p_message ~* '(refused|rejected|declined|denied|not permitted|violates)' then 'refused'
    else 'unknown'
  end
$$;

commit;
