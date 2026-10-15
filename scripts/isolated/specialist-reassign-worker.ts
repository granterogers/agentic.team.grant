/**
 * COS-006 / REG-018 — the WORKER reassigns a specialist's hand-off that fails for good (migration 1075 wired into
 * `runJob`).
 *
 *   npx tsx scripts/isolated/specialist-reassign-worker.ts <replica-db>
 *
 * The real `dequeue` and `runJob` run a specialist hand-off whose handler throws, with one attempt allowed, so the
 * failure is terminal rather than retried. The worker's own failure path then calls `app.reassign_failed_specialist`.
 *
 * Asserts:
 *   1. The hand-off ends `failed` (terminal: one attempt, a throwing handler).
 *   2. Exactly one replacement exists under the same parent, addressed to the Chief of Staff, with the same instruction.
 *   3. A second run of the same failure does not add another replacement.
 */
import {
  dequeue,
  type Handler,
  type HandlerOutput,
  type Reviewer,
  runJob,
} from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const scope = `verify:reassign-worker-${run}`
const KIND = 'office.instruction'
const review: Reviewer = async () => ({ status: 'approved' as const, notes: 'isolated proof' })

const throws: Handler = {
  reach: 'internal',
  kind: KIND,
  handle: async (): Promise<HandlerOutput> => {
    throw new Error('provider said 503')
  },
}

// The parent this hand-off hangs from, then the hand-off itself: one attempt, addressed to a specialist.
const parent = String(
  (
    await one(`insert into public.jobs (office_id, kind, requested_by, idempotency_key, correlation_id, announce)
      values (app.test_office(), 'research.summarise', ${lit(scope)}, ${lit(`rw-parent-${run}`)}, gen_random_uuid(), false)
      returning job_id::text as id`)
  ).id,
)
const instruction = `Draft the venue comparison ${run}`
const child = String(
  (
    await one(`insert into public.jobs (office_id, parent_job_id, kind, requested_by, idempotency_key, correlation_id,
        announce, max_attempts, pinned_config)
      select office_id, ${lit(parent)}::uuid, ${lit(KIND)}, ${lit(scope)}, ${lit(`rw-child-${run}`)}, correlation_id,
        false, 1,
        jsonb_build_object('instruction', ${lit(instruction)}, 'addressed_to', 'research-director',
                           'origin_channel', 'telegram', 'command_id', '', 'handed_off_by', 'chief-of-staff')
        from public.jobs where job_id = ${lit(parent)}::uuid
      returning job_id::text as id`)
  ).id,
)

const w = await dequeue(db, `rw-${run}`, true, true, [KIND], scope)
if (w === null || w.jobId !== child) {
  check(
    'the hand-off was dequeued',
    false,
    `got ${String((w as { jobId?: string } | null)?.jobId ?? 'nothing')}`,
  )
} else {
  await runJob(db, w as never, [throws], review)
}

const state = String(
  (await one(`select state::text as s from public.jobs where job_id = ${lit(child)}::uuid`)).s,
)
check(
  'the hand-off ends failed (one attempt, throwing handler)',
  state === 'failed',
  `state=${state}`,
)

const replacements = async () =>
  Number(
    (
      await one(`select count(*)::int as n from public.jobs
                  where parent_job_id = ${lit(parent)}::uuid
                    and pinned_config ->> 'addressed_to' = 'chief-of-staff'
                    and pinned_config ->> 'reassigned_from' = 'research-director'`)
    ).n,
  )
const n1 = await replacements()
const sameInstruction = Number(
  (
    await one(`select count(*)::int as n from public.jobs
                where parent_job_id = ${lit(parent)}::uuid
                  and pinned_config ->> 'addressed_to' = 'chief-of-staff'
                  and pinned_config ->> 'instruction' = ${lit(instruction)}`)
  ).n,
)
check(
  'the worker handed the failed work to the Chief of Staff, once, with the same instruction',
  n1 === 1 && sameInstruction === 1,
  `replacements=${String(n1)} with the same instruction=${String(sameInstruction)}`,
)

// A second terminal failure of the same hand-off (a re-run of the same job) must not add another.
await db.execute(
  `update public.jobs set state = 'failed', state_reason = 'proof: second failure' where job_id = ${lit(child)}::uuid`,
)
await db.execute(`select app.reassign_failed_specialist(${lit(child)}::uuid) as r`)
const n2 = await replacements()
check('a repeat failure does not add a second replacement', n2 === 1, `replacements=${String(n2)}`)

// Clear the queued work this proof made, so a later proof's dequeue cannot claim it (#184).
await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared' where requested_by = ${lit(scope)} and state in ('queued', 'retrying')`,
)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
