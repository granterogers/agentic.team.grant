/**
 * Does the thread resolver rewrite Grant's words out of reach of the
 * deterministic recognisers?
 *
 * `instruction = resolved.instruction` at instruction.ts:2057, so everything
 * downstream — `personalTaskChange`, the task readers, the teaching reader —
 * sees the REWRITE, not what he said. Every one of those recognisers was
 * written and tested against his words.
 *
 * Contained: the thread is a harness actor, everything is rolled back, and
 * no job is ever enqueued.
 */

import { personalTaskChange } from '../../src/agents/mine.ts'
import { resolveAgainstThread } from '../../src/agents/thread.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { buildPass } from '../../src/office/pass.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}

await buildPass(db, 'poc-resolver', {
  max: 1,
  canTranscribe: false,
  canSubprocess: false,
})

/*
  A REAL router. `buildPass` does not expose one, and the first version of
  this probe passed `router` — which is `undefined`, not null, so
  `resolveAgainstThread` went past its own null guard, threw inside, was
  caught, and returned the instruction untouched every single time. It
  reported "(unchanged)" three times and very nearly stood as a refutation
  of the defect it was written to find.
*/
const orKey = String(
  (
    await one(`select coalesce(app.resolve_secret(secret_ref), '') as v
                 from public.providers
                where provider = 'openrouter' and secret_ref is not null limit 1`)
  ).v ?? '',
)
const router = new ProviderRouter(db, orKey)

const run = Date.now().toString(36)
const THREAD = `poc-res-${run}`

/* Two turns of history, then the fragment. */
const HISTORY = [
  'Remind me on Friday to ring the caterers',
  'Changed — "Ring the caterers" is now due Friday.',
]
const FRAGMENTS = ['Make that urgent', 'Actually make that Monday', 'Call it Ring the venue']

/*
  The first turn needs a JOB and an OUTPUT, or `app.recent_exchange` returns
  nothing and the resolver declines for lack of history — which is how the
  first version of this probe reported "(unchanged)" three times and very
  nearly recorded a refutation of its own hypothesis.
*/
const firstJob = String(
  (
    await one(`
      insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                               requested_by, state, announce, finished_at)
      values (extensions.gen_random_uuid(), null, ${lit(`poc-res-${run}`)},
              'office.instruction', ${lit(`teamhq:verify-res-${run}`)}, 'complete', false,
              app.now_utc())
      returning job_id::text as v`)
  ).v ?? '',
)
await db.execute(`
  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, job_id)
  values ('teamhq', ${lit(`${THREAD}:1`)}, ${lit(`verify-res-${run}`)},
          ${lit(HISTORY[0] ?? '')}, ${lit(`teamhq:poc:${THREAD}_one`)},
          ${lit(firstJob)}::uuid)`)
await db.execute(`
  insert into public.outputs (job_id, body, deterministic, evidence, confidence)
  values (${lit(firstJob)}::uuid, ${lit(HISTORY[1] ?? '')}, true, 'verified', 'high')`)

for (const fragment of FRAGMENTS) {
  const cmd = String(
    (
      await one(`
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key)
        values ('teamhq', ${lit(`${THREAD}:${fragment.slice(0, 6)}`)},
                ${lit(`verify-res-${run}`)}, ${lit(fragment)},
                ${lit(
                  `teamhq:poc:${THREAD}_${fragment
                    .replace(/[^a-z]/gi, '')
                    .toLowerCase()
                    .slice(0, 10)}`,
                )})
        returning command_id::text as v`)
    ).v ?? '',
  )
  const history = (await db.execute(`select app.recent_exchange(${lit(cmd)}::uuid, 90, 12) as t`))
    .rows[0] as { t?: unknown[] } | undefined
  console.log(`\n"${fragment}"`)
  console.log(`  history it saw   : ${String((history?.t ?? []).length)} turn(s)`)
  const resolved = await resolveAgainstThread(db, router, cmd, fragment)
  const before = personalTaskChange(fragment)
  const after = personalTaskChange(resolved.instruction)
  console.log(
    `  resolved to      : ${resolved.changed ? `"${resolved.instruction}"` : '(unchanged)'}`,
  )
  console.log(`  his words        : ${before === null ? 'DECLINED' : JSON.stringify(before)}`)
  console.log(`  what it sees     : ${after === null ? 'DECLINED' : JSON.stringify(after)}`)
  console.log(`  ${before !== null && after === null ? '>>> THE REWRITE LOST IT' : 'survived'}`)
}

await db.execute(`delete from public.inbound_commands where origin_ref like ${lit(`${THREAD}:%`)}`)
await db.execute(`delete from public.outputs where job_id = ${lit(firstJob)}::uuid`)
await db.execute(`
  update public.jobs set state = 'cancelled', state_reason = 'poc teardown'
   where job_id = ${lit(firstJob)}::uuid`)
