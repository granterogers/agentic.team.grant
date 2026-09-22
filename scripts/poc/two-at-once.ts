/**
 * #316's concurrency half: two near-simultaneous equivalent messages must not
 * both pass a check-before-create and fan out independently.
 *
 * A unique index cannot be raced, so this is a proof rather than a hope — but
 * "cannot be raced" is a claim about the index, and CLAUDE.md records what a
 * comment asserting a property is worth without a check behind it. These are
 * genuinely concurrent HTTP calls, in separate transactions.
 *
 * Contained: the parent is a `verify-` actor so `jobs.is_fixture` is generated
 * true, and everything is cancelled in teardown.
 */

import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'

const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}

const run = Date.now().toString(36)
const AT_ONCE = 8

const project = String(
  (
    await one(`select project_id::text as v from public.projects
                where status = 'active' and not is_fixture
                  and project_id <> app.unnamed_project() order by updated_at desc limit 1`)
  ).v ?? '',
)
const parent = String(
  (
    await one(`
      insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                               requested_by, priority, state)
      values (extensions.gen_random_uuid(), ${lit(project)}::uuid,
              ${lit(`verify-race-${run}`)}, 'office.instruction',
              ${lit(`teamhq:verify-race-${run}`)}, 10, 'queued')
      returning job_id::text as v`)
  ).v ?? '',
)

console.log(`\n#316 — ${String(AT_ONCE)} equivalent requests at once (run ${run})\n`)

const REQUEST = 'Write me a PDF report on where the Legacy Coaching Course is'
const began = Date.now()
const answers = await Promise.all(
  Array.from({ length: AT_ONCE }, async () => {
    const r = await one(
      `select app.enqueue_child_once(${lit(parent)}::uuid, 'artifact.report', ${lit(REQUEST)}) as v`,
    )
    const v = r.v
    return (typeof v === 'string' ? JSON.parse(v) : v) as { job_id?: string; created?: boolean }
  }),
)
const spread = Date.now() - began

const created = answers.filter((a) => a.created === true).length
const reused = answers.filter((a) => a.created === false).length
const ids = new Set(answers.map((a) => String(a.job_id)))

const actual = Number(
  (
    await one(`select count(*)::int as v from public.jobs
                where parent_job_id = ${lit(parent)}::uuid`)
  ).v ?? 0,
)

/*
  DID THE CALLS ACTUALLY OVERLAP?

  The first version of this printed a verdict without asking. On one run it
  said the race got through — two children — and the cause was that the
  DEPLOYED worker had picked the first child up and COMPLETED it in three
  seconds, which frees the obligation key by design (#315's restart property).
  The eight calls had spanned nine seconds, so they were never concurrent and
  the earlier "one child" result was luck in the other direction.

  A measure that cannot establish its own condition must say so rather than
  print a number. CLAUDE.md records the same correction three times.
*/
const settledEarly = Number(
  (
    await one(`select count(*)::int as v from public.jobs
                where parent_job_id = ${lit(parent)}::uuid
                  and state in ('complete', 'cancelled', 'failed')`)
  ).v ?? 0,
)

console.log(`  call spread  : ${String(spread)}ms across ${String(AT_ONCE)} calls`)
console.log(`  said created : ${String(created)}`)
console.log(`  said reused  : ${String(reused)}`)
console.log(`  distinct ids : ${String(ids.size)}`)
console.log(`  CHILDREN IN THE DATABASE: ${String(actual)}`)
console.log(`  finished early: ${String(settledEarly)}`)

const clean = created === 1 && actual === 1 && ids.size === 1
console.log(
  `\n  ${
    clean
      ? 'ONE piece of work, and every caller was told the truth'
      : settledEarly > 0
        ? `INCONCLUSIVE — ${String(settledEarly)} child(ren) finished mid-run, which frees the ` +
          'obligation key by design, so a second creation is correct rather than a race'
        : '>>> THE RACE GOT THROUGH'
  }\n`,
)

/*
  AND GENUINELY SIMULTANEOUS, because eight HTTP calls are not.

  The spread above is seconds, so the calls are serialised by the executor —
  honest about the function's behaviour across eight transactions, and no
  evidence at all about two arriving at the same instant. This second measure
  puts all eight in ONE statement, where they truly cannot be ordered by
  latency: the first insert holds the key and the rest meet it uncommitted.

  The cross-transaction guarantee is the partial unique index itself, which is
  a property of Postgres rather than of this code. What this office controls
  is that the violation is CAUGHT and answered with the live job, and that is
  what these two measures between them establish.
*/
const together = await one(`
  select count(*) filter (where (r ->> 'created')::boolean) as made,
         count(*) filter (where not (r ->> 'created')::boolean) as reused
    from (
      select app.enqueue_child_once(${lit(parent)}::uuid, 'office.pursue',
             'one statement, eight callers') as r
        from generate_series(1, 8)
    ) x`)
console.log(
  `\n  eight in ONE statement: ${String(together.made)} created, ${String(together.reused)} reused` +
    ` — ${Number(together.made) === 1 ? 'the violation is caught and answered' : '>>> NOT SERIALISED'}\n`,
)

await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'race probe teardown'
   where (job_id = ${lit(parent)}::uuid or parent_job_id = ${lit(parent)}::uuid)
     and state not in ('complete', 'cancelled', 'failed')`)
