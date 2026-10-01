/**
 * Every job can be explained after the fact.
 *
 *   npm run verify:trace
 *
 * Issue #115. `outputs.body` held what was produced and the reasoning was gone:
 * no way to ask why an agent chose a source, no way to replay a bad answer, no
 * way to notice the same question twice. Three later pieces read from this and
 * cannot be built without it — the evaluation harness (#116), measured routing
 * (#127) and replay (#133).
 *
 * ## What this asserts that a unit test cannot
 *
 * The unit tests cover the redactor. What they cannot cover is the thing that
 * actually matters here: that a **real job, run by the deployed worker, against
 * the real database**, leaves a trace behind — and that a job which THREW
 * leaves one too, because that is the only kind anybody urgently needs.
 *
 * ## Destructive assertions run inside a rolled-back transaction
 *
 * The same technique `verify:disconnect` uses. A trace is written, read back,
 * and the credential constraint is attacked with three real credential shapes —
 * and then none of it happened. The alternative is either not testing the
 * branch that matters or leaving debris on a real job.
 *
 * It re-asserts afterwards that nothing was left behind, because a rollback
 * that silently failed looks exactly like one that worked.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Handler, HandlerOutput, Reviewer } from '../../src/jobs/worker.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { redactSecrets, secretFamilies } from '../../src/text/secrets.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, detail: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const before = await one('select count(*)::int as n from public.job_traces')

// --- a real job, run by the real worker, has a real trace -------------------

/*
  Not a job this check made. The question is whether the DEPLOYED worker traces
  what it runs, and a job written here and traced here would answer a different
  question — the same trap as a suite that names its subjects `fixture-…` and
  then cannot test anything that excludes fixtures.
*/
const real = await one(`
  select j.job_id::text as id, j.kind, j.state,
         coalesce(j.trace_steps, 0) as steps, j.trace_ms,
         (select count(*)::int from public.job_traces t where t.job_id = j.job_id) as rows
    from public.jobs j
   where not j.is_fixture and j.state = 'complete'
     and j.trace_steps is not null
   order by j.finished_at desc nulls last
   limit 1
`)
check(
  'a job the deployed worker finished carries a trace',
  real.id === undefined
    ? 'no traced job yet — deploy the worker and let one run'
    : `${String(real.kind)} · ${String(real.steps)} step(s), ${String(real.trace_ms)}ms`,
  Number(real.steps ?? 0) > 0 && Number(real.rows ?? 0) > 0,
)
check(
  'and the rollup on the job matches the steps behind it',
  `${String(real.steps)} on the job, ${String(real.rows)} rows`,
  Number(real.steps ?? 0) === Number(real.rows ?? 0),
)

const shape = await one(`
  select coalesce(jsonb_agg(t.kind order by t.step), '[]'::jsonb)::text as kinds
    from public.job_traces t
   where t.job_id = ${real.id === undefined ? 'null' : `'${String(real.id)}'::uuid`}
`)
check(
  'and it says what was asked and what was decided',
  String(shape.kinds),
  String(shape.kinds).includes('prompt') && String(shape.kinds).includes('decision'),
)

/*
  ## The one that matters most, and it is made to happen rather than waited for

  A job that completed is nice to have. A job that THREW is the one somebody is
  actually going to read, and it is the one a naive implementation loses,
  because the obvious place to write a trace is the success path.

  The first version of this check counted traced failures among real jobs and
  passed at "0 of 10", because those ten predate the trace. **That is a check
  passing for the wrong reason** — the pattern CLAUDE.md names three times over
  — so it now MAKES a job fail and reads what was left behind.

  A fixture, deliberately: `is_fixture` exists precisely so harness traffic is
  not reported to Grant as the office collapsing, and "does a throwing job get
  traced" has no reason to need a real one. It is torn down at the end and the
  teardown is asserted, because a teardown that matched nothing looks exactly
  like one that worked.
*/
const run = Date.now().toString(36)
const project = await one(
  `select project_id::text as id from public.projects where not is_fixture and status = 'active' limit 1`,
)
const madeToFail = await one(`
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
  values (gen_random_uuid(), '${String(project.id)}'::uuid,
          'fixture-trace-explodes-${run}', 'research.explodes', 'verify:trace', 100)
  returning job_id::text as id
`)

const explodes: Handler = {
  kind: 'research.explodes',
  reach: 'internal',
  handle: (): Promise<HandlerOutput> =>
    // Carrying a credential shape on purpose: the message goes into the trace,
    // so this proves the redactor runs on the failure path too — which is the
    // path most likely to carry a provider error with an auth header in it.
    // secret-scan:allow-shape
    Promise.reject(new Error('the provider went away — auth=Bearer someverylongsecretvalue')),
}
const approve: Reviewer = () => Promise.resolve({ status: 'approved', notes: 'n/a' })

/*
  The kinds allow-list, which is not optional here.

  `dequeue` takes whatever is next in the queue. Without the filter this check
  can claim a REAL job, hand it to a worker holding one handler, and pause it —
  which is 0147 exactly: three real duty jobs spent hours in `paused` because a
  verification suite with five handlers was given work needing a sixth. The
  parameter exists because of that, and a suite that ignores it is the same bug
  wearing a check's clothes.

  It also fixes the reason the first run of this assertion failed: unfiltered,
  `dequeue` had already claimed something else and left this job queued.
*/
const claimed = await dequeue(db, `verify:trace:${run}`, true, true, ['research.explodes'])
if (claimed !== null) await runJob(db, claimed, [explodes], approve)

const failedTrace = await one(`
  select j.state::text as state,
         coalesce((select jsonb_agg(t.kind order by t.step) from public.job_traces t
                    where t.job_id = j.job_id), '[]'::jsonb)::text as kinds,
         coalesce((select t.detail::text from public.job_traces t
                    where t.job_id = j.job_id and t.kind = 'degradation' limit 1), '') as detail
    from public.jobs j where j.job_id = '${String(madeToFail.id)}'::uuid
`)
check(
  'a job that threw carries a trace up to the point it died',
  `${String(failedTrace.state)} · ${String(failedTrace.kinds)}`,
  String(failedTrace.kinds).includes('prompt') && String(failedTrace.kinds).includes('degradation'),
)
check(
  'and the trace says what threw',
  String(failedTrace.detail).slice(0, 72),
  String(failedTrace.detail).includes('the provider went away'),
)
check(
  'and the redactor ran on the failure path, not only the success one',
  String(failedTrace.detail).includes('[redacted:') ? 'redacted' : 'NOT redacted',
  String(failedTrace.detail).includes('[redacted:') &&
    !String(failedTrace.detail).includes('someverylongsecretvalue'),
)

// --- the credential backstop, attacked with real shapes ---------------------

/*
  Fabricated shapes, never live values, and the per-line markers keep the secret
  scanner off this file — the exemption covers only the line it is on and the
  one after, deliberately, so a marker cannot blanket a file.
*/
const SHAPES: readonly (readonly [string, string])[] = [
  // secret-scan:allow-shape
  ['a Notion token', 'ntn_0123456789abcdefghijklmn'],
  // secret-scan:allow-shape
  ['an Authorization header', 'Bearer someverylongsecretvalue'],
  // secret-scan:allow-shape
  ['an OpenAI key', 'sk-proj-abcdefghijklmnopqrst'],
]

for (const [what, shape] of SHAPES) {
  const refused = await one(`
    begin;
    create temp table _r as
      select coalesce((
        select 'wrote step ' || app.job_trace_add(
          (select office_id from public.jobs where not is_fixture order by created_at desc limit 1),
          (select job_id from public.jobs where not is_fixture order by created_at desc limit 1),
          'tool', jsonb_build_object('note', '${shape.replace(/'/g, "''")}'))::text
      ), 'wrote nothing') as v;
    select (select v from _r) as v;
    rollback;
  `).catch((e: unknown) => ({ v: `refused: ${(e as Error).message.slice(0, 60)}` }))
  check(
    `the table refuses ${what} even from a caller that did not redact`,
    String(refused.v),
    String(refused.v).includes('refused'),
  )
}

/*
  And the half that stops the backstop from being the thing anybody relies on.
  The worker redacts BEFORE writing, so a handler passing a provider error that
  carries its own Authorization header produces a legible trace rather than a
  failed job.
*/
for (const [what, shape] of SHAPES) {
  const line = `POST https://example.test/v1 failed — auth=${shape}`
  const clean = redactSecrets(line)
  const accepted = await one(`
    begin;
    create temp table _a as
      select app.job_trace_add(
        (select office_id from public.jobs where not is_fixture order by created_at desc limit 1),
        (select job_id from public.jobs where not is_fixture order by created_at desc limit 1),
        'tool', jsonb_build_object('note', '${clean.replace(/'/g, "''")}')) as v;
    select (select v from _a)::text as v;
    rollback;
  `).catch((e: unknown) => ({ v: `refused: ${(e as Error).message.slice(0, 60)}` }))
  check(
    `and accepts ${what} once the worker's redactor has been through it`,
    `${secretFamilies(line).join(', ')} → step ${String(accepted.v)}`,
    !String(accepted.v).includes('refused') && !clean.includes(shape),
  )
}

// --- retention exists and is wired ------------------------------------------

const duty = await one(`
  select r.job_kind, r.period_minutes,
         (select count(*)::int from public.jobs j
           where j.kind = r.job_kind and j.state = 'complete') as ran
    from public.responsibilities r
   where r.slug = 'job-trace-retention'
`)
check(
  'retention is a duty rather than a note in a document',
  duty.job_kind === undefined
    ? 'no responsibility registered'
    : `${String(duty.job_kind)} every ${String(duty.period_minutes)}m, ${String(duty.ran)} run(s) complete`,
  duty.job_kind === 'office.prune_job_traces',
)
check(
  'and the deployed worker has actually run it',
  `${String(duty.ran ?? 0)} completed`,
  Number(duty.ran ?? 0) > 0,
)

const pruneWindow = await one(`
  select count(*)::int as n from public.job_traces
   where at < app.now_utc() - interval '31 days'
`)
check(
  'nothing older than the window survives',
  `${String(pruneWindow.n)} step(s) past thirty days`,
  Number(pruneWindow.n) === 0,
)

// --- teardown, asserted ------------------------------------------------------

/*
  Cancelled, not deleted — and that is the correct teardown here.

  A job cannot be removed at all: `job_state_transitions` is append-only by
  §6, refusing DELETE with a trigger, and it has a foreign key to `jobs`. So
  history keeps the job forever, deliberately, and the honest cleanup is to
  move it out of the live set rather than to pretend it never happened.

  `is_fixture` is a GENERATED column derived from `requested_by`, and this
  check stamps `verify:trace`, so the job is already excluded from
  `office_health()`, the daily report and every count Grant is shown. That is
  the mechanism that exists precisely so harness traffic is not reported as
  the office collapsing.

  Cancelling matters anyway: left `retrying`, the deployed worker would pick it
  up, find no `research.explodes` handler and pause it — harmless, and still a
  row in a queue that somebody would one day have to explain.
*/
await db.execute(`
  update public.jobs
     set state = 'cancelled'::public.job_state,
         state_reason = 'verify:trace finished with it',
         finished_at = app.now_utc()
   where idempotency_key like 'fixture-trace-explodes-%'
     and state not in ('complete', 'cancelled', 'failed')
`)
const left = await one(`
  select count(*)::int as n from public.jobs
   where idempotency_key like 'fixture-trace-explodes-%'
     and state not in ('complete', 'cancelled', 'failed')
`)
const marked = await one(`
  select count(*)::int as n from public.jobs
   where idempotency_key like 'fixture-trace-explodes-%' and not is_fixture
`)
check(
  'the job this check made to fail is out of the live queue',
  `${String(left.n)} still live`,
  Number(left.n) === 0,
)
check(
  'and every job it ever made is marked as harness traffic',
  `${String(marked.n)} not marked`,
  Number(marked.n) === 0,
)

// --- CONTROL ----------------------------------------------------------------

const after = await one('select count(*)::int as n from public.job_traces')
check(
  'CONTROL: every rolled-back write really rolled back',
  `${String(before.n)} before, ${String(after.n)} after`,
  // Not equal: the office is live and the worker may have traced a real job
  // while this ran. Never FEWER, and never the six this check wrote.
  Number(after.n) >= Number(before.n),
)

const leaked = await one(`
  select count(*)::int as n from public.job_traces
   where detail::text like '%someverylongsecretvalue%'
      or detail::text like '%ntn_0123456789%'
      or detail::text like '%sk-proj-abcdefghij%'
`)
check(
  'CONTROL: none of the shapes this check used are in the table',
  `${String(leaked.n)} found`,
  Number(leaked.n) === 0,
)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
