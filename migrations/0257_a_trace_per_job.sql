-- A trace per job (#115).
--
-- `outputs.body` holds what was produced and the reasoning is gone. There is no
-- way to ask why Emma chose that source, no way to replay a bad answer, and no
-- way for an agent to notice it has answered this before. 251 jobs finished in
-- the last 24 hours and not one of them can be explained after the fact.
--
-- Three later pieces read from this and cannot be built without it: the
-- evaluation harness (#116), measured model routing (#127) and replay (#133).
--
-- ## Written as the job runs, not at the end
--
-- A job that dies mid-way is exactly the one worth reading, so a step is
-- committed when it happens rather than accumulated and flushed. That costs a
-- round trip per step and buys the only traces anybody will ever actually need.
--
-- ## The one rule
--
-- A trace records what was REACHED, never a credential. `src/text/secrets.ts`
-- redacts on the way in; the CHECK below is the backstop for every caller that
-- is not that one. Both, because a guard in one caller is a guard in one
-- caller -- and the constraint is deliberately the same vocabulary as
-- `connection_health_carries_no_credential` from 0062, which is the pattern
-- this repository already trusts.
--
-- ## Text is referenced, not stored
--
-- The longest document in the office is 180,000 characters. A trace that stored
-- retrieved prose would eat the free tier in a fortnight, so a retrieval step
-- stores document ids and a count. The rule is in the column comment because
-- the temptation to store "just the relevant bit" is real and recurring.
--
-- ## Retention is decided now, not at 400 MB
--
-- The tier is 500 MB and holds 31 MB. This will be the highest-volume table in
-- the database. Steps older than 30 days are dropped and the rollup on the job
-- is kept, by a duty rather than by a note in a document.

CREATE TABLE IF NOT EXISTS public.job_traces (
  job_id      uuid        not null references public.jobs(job_id) on delete cascade,
  step        int         not null,
  at          timestamptz not null default app.now_utc(),
  kind        text        not null,
  -- What happened, shaped by `kind`. jsonb because a model call, a tool call
  -- and a retrieval have nothing in common except that they happened.
  detail      jsonb       not null default '{}'::jsonb,
  tokens_in   int,
  tokens_out  int,
  cost_pence  numeric(10, 4),
  ms          int,
  primary key (job_id, step),

  constraint job_traces_kind_known check (kind in
    ('prompt', 'model', 'tool', 'retrieval', 'decision', 'degradation', 'note')),

  /*
    The backstop. Same shapes as 0062's constraint on `connection_health`, plus
    the four that list never knew about -- a Notion token, a GitHub PAT, a
    Google OAuth refresh token and an Authorization header.

    A trace that would carry one of these does not get written. That is a job
    failure rather than a silent leak, which is the correct trade: a missing
    trace is an inconvenience and a stored credential is not.
  */
  constraint job_traces_carries_no_credential check (
    (kind || detail::text) !~
      '(xox[abeprs]-|sbp_[A-Za-z0-9]{16}|ntn_[A-Za-z0-9]{16}|secret_[A-Za-z0-9]{16}|sk-[A-Za-z0-9_-]{12}|AIza[A-Za-z0-9_-]{20}|gh[posur]_[A-Za-z0-9]{20}|github_pat_|eyJ[A-Za-z0-9_-]{10}\.[A-Za-z0-9_-]{10}|(Bearer|Basic|Token) [A-Za-z0-9._~+/=-]{8})'
  )
);

COMMENT ON COLUMN public.job_traces.detail IS
  'What happened, shaped by kind. NEVER retrieved prose -- a retrieval step '
  'stores document ids and a count, because the longest document in the office '
  'is 180,000 characters and this is the highest-volume table in the database.';

CREATE INDEX IF NOT EXISTS job_traces_at_idx ON public.job_traces (at);

ALTER TABLE public.job_traces ENABLE ROW LEVEL SECURITY;

-- The rollup, on the job, so the two questions everybody asks -- what did this
-- cost and how long did it take -- need no join and survive the retention pass.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS trace_steps  int,
  ADD COLUMN IF NOT EXISTS trace_tokens int,
  ADD COLUMN IF NOT EXISTS trace_pence  numeric(10, 4),
  ADD COLUMN IF NOT EXISTS trace_ms     int;

/*
  Add one step.

  `step` is allocated here rather than by the caller: two handlers writing to
  one job would otherwise race for the same ordinal and one would lose its step
  to the primary key. The rollup is maintained in the same statement, so a
  crashed job's rollup is still true for the part that ran.
*/
CREATE OR REPLACE FUNCTION app.job_trace_add(
  p_job_id     uuid,
  p_kind       text,
  p_detail     jsonb default '{}'::jsonb,
  p_tokens_in  int   default null,
  p_tokens_out int   default null,
  p_cost_pence numeric default null,
  p_ms         int   default null
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_step int;
begin
  select coalesce(max(step), 0) + 1 into v_step
    from public.job_traces where job_id = p_job_id;

  insert into public.job_traces
    (job_id, step, kind, detail, tokens_in, tokens_out, cost_pence, ms)
  values
    (p_job_id, v_step, p_kind, coalesce(p_detail, '{}'::jsonb),
     p_tokens_in, p_tokens_out, p_cost_pence, p_ms);

  update public.jobs
     set trace_steps  = v_step,
         trace_tokens = coalesce(trace_tokens, 0)
                        + coalesce(p_tokens_in, 0) + coalesce(p_tokens_out, 0),
         trace_pence  = coalesce(trace_pence, 0) + coalesce(p_cost_pence, 0),
         trace_ms     = coalesce(trace_ms, 0) + coalesce(p_ms, 0)
   where job_id = p_job_id;

  return v_step;
end;
$function$;

-- Reading one back, for a person or for #133's replay.
CREATE OR REPLACE FUNCTION app.job_trace(p_job_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'job_id', p_job_id,
    'kind', (select j.kind from public.jobs j where j.job_id = p_job_id),
    'state', (select j.state from public.jobs j where j.job_id = p_job_id),
    'steps', (select coalesce(j.trace_steps, 0) from public.jobs j where j.job_id = p_job_id),
    'tokens', (select j.trace_tokens from public.jobs j where j.job_id = p_job_id),
    'pence', (select j.trace_pence from public.jobs j where j.job_id = p_job_id),
    'ms', (select j.trace_ms from public.jobs j where j.job_id = p_job_id),
    'trace', coalesce((
      select jsonb_agg(jsonb_build_object(
               'step', t.step, 'at', t.at, 'kind', t.kind, 'detail', t.detail,
               'tokens_in', t.tokens_in, 'tokens_out', t.tokens_out,
               'pence', t.cost_pence, 'ms', t.ms
             ) order by t.step)
        from public.job_traces t where t.job_id = p_job_id), '[]'::jsonb)
  )
$function$;

/*
  Retention: the steps go, the rollup stays.

  Thirty days, and a cap on how many rows one pass may delete -- an unbounded
  delete on the largest table in the database is how a free-tier instance
  becomes unresponsive at 3am. It runs hourly, so a backlog clears in hours and
  nothing ever holds a long lock.
*/
CREATE OR REPLACE FUNCTION app.job_trace_prune(p_days int default 30, p_limit int default 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_gone int;
begin
  with old as (
    select job_id, step from public.job_traces
     where at < app.now_utc() - make_interval(days => p_days)
     order by at
     limit p_limit
  )
  delete from public.job_traces t
   using old
   where t.job_id = old.job_id and t.step = old.step;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'removed', v_gone,
    'more', v_gone >= p_limit,
    'note', case when v_gone = 0 then 'nothing older than the window'
                 else format('%s step(s) older than %s days dropped; the rollups stay', v_gone, p_days) end);
end;
$function$;

GRANT EXECUTE ON FUNCTION app.job_trace_add(uuid, text, jsonb, int, int, numeric, int)
  TO ai_team_app, service_role;
GRANT EXECUTE ON FUNCTION app.job_trace(uuid) TO ai_team_app, service_role;
GRANT EXECUTE ON FUNCTION app.job_trace_prune(int, int) TO ai_team_app, service_role;

-- PostgREST only exposes `public`.
CREATE OR REPLACE FUNCTION public.hq_job_trace(p_job_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$ select app.job_trace(p_job_id::uuid) $function$;

REVOKE ALL ON FUNCTION public.hq_job_trace(text) FROM public;
GRANT EXECUTE ON FUNCTION public.hq_job_trace(text) TO service_role;
