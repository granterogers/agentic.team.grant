-- 0274 — a failure the office recognises
--
-- Issue #132. There is one `notebook.collect_artifact` failure in the current
-- window. It will be retried, it will fail the same way, and nothing about the
-- next attempt will be different. **The office cannot recognise a failure it
-- has already seen.**
--
-- ## What this is not
--
-- **Not a circuit breaker.** Recognising a repeat and refusing to try again are
-- different features, and the second silently stops doing work Grant expects. A
-- breaker is a separate decision with its own ADR. This recognises; nothing
-- here declines to run anything.
--
-- **Not the queue problem.** The nine jobs in #112 were never taken rather than
-- failing, and this would not have caught them. Worth saying, because it is
-- tempting to file both under "the office should notice" and they need
-- different mechanisms.
--
-- ## Provably free of payload
--
-- #132: *"The signature carries no payload. A failure on a document is (kind,
-- error class, document_id) — never the document, never the prompt."*
--
-- The strongest way to guarantee that is not a rule, a redactor or a CHECK on
-- free text. It is to build a table **with nowhere to put a payload**:
--
--   * `job_kind` is a dotted kind, format-checked.
--   * `error_class` is one of nine words, checked against a fixed list.
--   * `subject` is a uuid or a short slug, format-checked, and null is allowed
--     because most failures are not about a particular thing.
--
-- There is no text column an error message could be written into, so no future
-- edit can put one there without changing the schema in front of a reviewer.
-- That is a different quality of guarantee from "we remember not to", and this
-- repository has the scars to prefer it — `src/text/secrets.ts` exists because
-- two redactors disagreed.
--
-- ## Why the class is a fixed list rather than the error's first line
--
-- A signature is only useful if the same failure produces the same row. An
-- error message carries ids, timestamps and quoted input, so "the first eighty
-- characters" makes eleven rows for eleven attempts at the same problem —
-- exactly the flat log this replaces. Nine words is coarse and stable, and
-- coarse-and-stable is what a count needs.

begin;

create table public.failure_signatures (
  -- The three parts ARE the identity, so they are the key. A surrogate id would
  -- allow two rows for one signature, which is the thing being fixed.
  job_kind      text        not null,
  error_class   text        not null,
  -- The thing being acted on, when there is one. A document id, a notebook id.
  -- Empty string rather than null, because null is not equal to null and a
  -- primary key containing one would let the same signature insert twice.
  subject       text        not null default '',

  seen          int         not null default 1,
  first_seen    timestamptz not null default app.now_utc(),
  last_seen     timestamptz not null default app.now_utc(),
  -- The most recent job, so somebody can go and read its trace (#115). An id,
  -- not a copy of anything it contained.
  last_job_id   uuid        references public.jobs (job_id),

  primary key (job_kind, error_class, subject),

  constraint failure_signatures_kind_format
    check (job_kind ~ '^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)*$'),
  /*
    Nine words. Coarse on purpose: a class that splits finely makes a count
    that never reaches two, and a count that never reaches two is the flat log
    this is replacing.
  */
  constraint failure_signatures_class_known
    check (error_class in (
      'timeout',        -- it did not answer in time
      'not_found',      -- the thing being acted on is gone
      'refused',        -- the far end said no, and meant it
      'quota',          -- an allowance is spent
      'auth',           -- the credential was rejected
      'no_credential',  -- there was no credential to try
      'bad_shape',      -- what came back was not what was expected
      'unreachable',    -- the network, DNS, a dead host
      'unknown'         -- classified as nothing; still counted
    )),
  /*
    A uuid, or a short lowercase handle. Not free text — this is the one column
    a payload could creep into, and the pattern is what stops it. 64 characters
    is longer than any id we use and far shorter than a sentence worth leaking.
  */
  constraint failure_signatures_subject_is_an_id
    check (subject = '' or subject ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  constraint failure_signatures_counted
    check (seen >= 1),
  constraint failure_signatures_ordered
    check (last_seen >= first_seen)
);

comment on table public.failure_signatures is
  '#132. A repeated failure is one row with a count rather than eleven rows. '
  'There is deliberately NO text column: the table has nowhere to put an error '
  'message, a prompt or a document, so it cannot leak one.';

create index failure_signatures_recurring
  on public.failure_signatures (seen desc, last_seen desc) where seen > 1;

/**
 * Classify a failure into one of the nine words.
 *
 * In SQL rather than in the worker, because the worker is not the only thing
 * that records a failure — the edge function runs the same pass, and a second
 * copy of this list is how two runtimes come to disagree about what a timeout
 * is. Same reasoning as `src/text/secrets.ts` being one redactor.
 *
 * Order matters: the specific patterns are tried before the general ones, so a
 * "quota exceeded, request refused" is quota rather than refused.
 */
create or replace function app.classify_failure(p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message is null or btrim(p_message) = '' then 'unknown'
    when p_message ~* '(quota|allowance|rate.?limit|too many requests|429)' then 'quota'
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

comment on function app.classify_failure is
  '#132. Nine coarse words, because a signature is only useful if the same '
  'failure produces the same row -- and an error message carries ids and '
  'timestamps, so its first line makes eleven rows for one problem.';

/**
 * Record that a failure happened, and say whether we have seen it before.
 *
 * Returns the signature and its count, so the caller can put "this is the
 * eleventh time" in the job's trace without a second query.
 *
 * The MESSAGE goes in and never comes out: it is classified and discarded. That
 * is the payload discipline, enforced by the table having nowhere to keep it.
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
  -- A subject that is not an id is dropped rather than refused. The signature
  -- is still worth recording without it, and failing the record because the
  -- caller passed something odd would mean a failure goes uncounted at exactly
  -- the moment it matters.
  if v_subject <> '' and v_subject !~ '^[A-Za-z0-9_.:-]{1,64}$' then
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
    -- The sentence a trace or a notice can use, built here so the two agree.
    'note', case when v_seen = 1 then format('first %s failure for %s', v_class, p_job_kind)
                 else format('%s has failed with %s %s times since %s',
                             p_job_kind, v_class, v_seen, to_char(v_first, 'FMDD Mon')) end);
end;
$$;

create or replace function public.failure_seen(
  p_job_kind text, p_message text, p_subject text default null, p_job_id uuid default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.failure_seen(p_job_kind, p_message, p_subject, p_job_id) $$;

/** What keeps going wrong the same way. For the noticing pass and for a check. */
create or replace function app.recurring_failures(p_least int default 3, p_days int default 14)
returns table (job_kind text, error_class text, subject text, seen int,
               first_seen timestamptz, last_seen timestamptz, last_job_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select f.job_kind, f.error_class, f.subject, f.seen, f.first_seen, f.last_seen, f.last_job_id
    from public.failure_signatures f
   where f.seen >= greatest(coalesce(p_least, 3), 2)
     and f.last_seen > app.now_utc() - make_interval(days => coalesce(p_days, 14))
   order by f.seen desc, f.last_seen desc
$$;

alter table public.failure_signatures enable row level security;
alter table public.failure_signatures force  row level security;
grant select on public.failure_signatures to ai_team_app;
create policy failure_signatures_app_read on public.failure_signatures
  for select to ai_team_app using (true);
grant execute on function app.failure_seen(text, text, text, uuid) to ai_team_app;
grant execute on function app.classify_failure(text) to ai_team_app;
grant execute on function app.recurring_failures(int, int) to ai_team_app;

commit;
