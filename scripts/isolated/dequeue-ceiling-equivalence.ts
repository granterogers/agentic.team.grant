/**
 * Proof: app.dequeue_job (migration 1030) claims EXACTLY the job the frozen predecessor claims, and asks the self-improvement ceiling
 * only when it could matter.
 *
 *   npx tsx scripts/isolated/dequeue-ceiling-equivalence.ts [replica-db=post]
 *
 * The frozen predecessor is scripts/isolated/reference/dequeue.pre-1030.sql (the live definition before 1030), installed as
 * proof_ref.dequeue_job. Every case runs in a rolled-back transaction on a queue this script sets up whole (everything live is
 * cancelled first, inside the transaction), once with each function, and compares the claimed job.
 *
 * The matrix: budget {open, spent} x queue {empty, ordinary, self-improvement, both with the self-improvement job first, both
 * with the ordinary job first} x kinds filter {none, ordinary only} x scope {none, a requester}, plus a disabled office, a delayed
 * job and a full concurrent limit. Controls: the comparison is not vacuous (some cases claim a job, some claim nothing, and the
 * budget changes the answer), a copy that ignores the ceiling disagrees, a copy that always holds the ceiling disagrees, and the
 * ceiling is evaluated NOT AT ALL on an empty or ordinary-only queue (the predecessor evaluated it every call) and never more than
 * once.
 *
 * Runs only against the marked local replica; never touches production; spends no model call.
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

const frozen = readFileSync('scripts/isolated/reference/dequeue.pre-1030.sql', 'utf8')
const bodyOf = (name: string): string => {
  const m = frozen.match(/CREATE OR REPLACE FUNCTION app\.dequeue_job[\s\S]*\$function\$;/)
  if (m === null) throw new Error('the frozen reference has no function')
  return m[0].replace('app.dequeue_job', name)
}

await db.execute('drop schema if exists proof_ref cascade')
await db.execute('create schema proof_ref')
await db.execute(bodyOf('proof_ref.dequeue_job'))
// The live (new) function as text, for the sabotage copies.
const live = (
  await rows(
    `select pg_get_functiondef('app.dequeue_job(text,boolean,boolean,text[],text)'::regprocedure) d`,
  )
)[0]?.d as string
const CEILING = '(select app.self_improvement_within_budget())'
check(
  live.includes(CEILING),
  'the live function asks the ceiling as a scalar subquery (1030 is applied on this replica)',
)
check(!live.includes('v_may_reflect'), 'and no longer holds the eager flag')
await db.execute(live.replace('app.dequeue_job', 'proof_ref.always_open').replace(CEILING, 'true'))
await db.execute(
  live.replace('app.dequeue_job', 'proof_ref.always_spent').replace(CEILING, 'false'),
)

const SI = (await rows(`select kind from public.self_improvement_kinds order by kind limit 1`))[0]
  ?.kind as string
const ORD = 'office.instruction'
const office = (
  await rows(`select office_id::text id from public.offices where kind = 'person' limit 1`)
)[0]?.id as string
// The replica's test office stands in for a disabled one (the case disables it inside its own rolled-back transaction).
const OFFICE_OFF = (
  await rows(`select office_id::text id from public.offices where kind = 'test' limit 1`)
)[0]?.id as string
const ids = {
  si: '00000000-0000-4000-8000-0000000000b1',
  ord: '00000000-0000-4000-8000-0000000000b2',
  siDelayed: '00000000-0000-4000-8000-0000000000b3',
  run1: '00000000-0000-4000-8000-0000000000c1',
  run2: '00000000-0000-4000-8000-0000000000c2',
  run3: '00000000-0000-4000-8000-0000000000c3',
  off: '00000000-0000-4000-8000-0000000000b4',
}

interface Case {
  name: string
  budget: 'open' | 'spent'
  queue: string[]
  kinds: string | null
  scope: string | null
  extra?: string
}

const jobSql = (
  id: string,
  kind: string,
  priority: number,
  created: string,
  who: string,
  state = 'queued',
  officeId = office,
): string =>
  `insert into public.jobs (job_id, correlation_id, state, idempotency_key, kind, requested_by, priority, pinned_config, attempt, max_attempts,
                            created_at, updated_at, office_id, synthetic, claim_gen, origin_kind, origin_class)
   values ('${id}', gen_random_uuid(), '${state}', 'dq-${id}', '${kind}', '${who}', ${String(priority)}, '{}'::jsonb, 0, 5,
           now() - interval '${created}', now(), '${officeId}', false, 1, 'inbound', 'trusted')`

const QUEUES: Record<string, string[]> = {
  empty: [],
  ordinary: [jobSql(ids.ord, ORD, 100, '5 minutes', 'telegram:grant')],
  'self-improvement': [jobSql(ids.si, SI, 100, '5 minutes', 'duty:self')],
  'self first': [
    jobSql(ids.si, SI, 1, '10 minutes', 'duty:self'),
    jobSql(ids.ord, ORD, 100, '5 minutes', 'telegram:grant'),
  ],
  'ordinary first': [
    jobSql(ids.si, SI, 100, '5 minutes', 'duty:self'),
    jobSql(ids.ord, ORD, 1, '10 minutes', 'telegram:grant'),
  ],
}

const cases: Case[] = []
for (const budget of ['open', 'spent'] as const)
  for (const [qn, queue] of Object.entries(QUEUES))
    for (const kinds of [null, ORD])
      for (const scope of [null, 'telegram:grant'])
        cases.push({
          name: `${budget} / ${qn} / kinds ${kinds ?? 'any'} / scope ${scope ?? 'none'}`,
          budget,
          queue,
          kinds,
          scope,
        })
cases.push(
  {
    name: 'spent / a delayed self-improvement job and nothing else',
    budget: 'spent',
    queue: [
      jobSql(ids.siDelayed, SI, 100, '5 minutes', 'duty:self'),
      `update public.jobs set not_before = now() + interval '1 hour' where job_id = '${ids.siDelayed}'`,
    ],
    kinds: null,
    scope: null,
  },
  {
    name: 'open / a delayed self-improvement job and an ordinary one',
    budget: 'open',
    queue: [
      jobSql(ids.siDelayed, SI, 1, '10 minutes', 'duty:self'),
      `update public.jobs set not_before = now() + interval '1 hour' where job_id = '${ids.siDelayed}'`,
      jobSql(ids.ord, ORD, 100, '5 minutes', 'telegram:grant'),
    ],
    kinds: null,
    scope: null,
  },
  {
    name: 'open / the concurrent limit is reached',
    budget: 'open',
    queue: [
      jobSql(ids.run1, ORD, 100, '9 minutes', 'x:1', 'running'),
      jobSql(ids.run2, ORD, 100, '8 minutes', 'x:2', 'running'),
      jobSql(ids.run3, ORD, 100, '7 minutes', 'x:3', 'running'),
      jobSql(ids.ord, ORD, 100, '5 minutes', 'telegram:grant'),
    ],
    kinds: null,
    scope: null,
  },
  {
    name: 'open / a disabled office holds the only job',
    budget: 'open',
    queue: [
      `update public.offices set state = 'disabled', disabled_at = now() where office_id = '${OFFICE_OFF}'`,
      jobSql(ids.off, ORD, 100, '5 minutes', 'telegram:grant', 'queued', OFFICE_OFF),
    ],
    kinds: null,
    scope: null,
  },
)

const setBudget = async (b: 'open' | 'spent'): Promise<void> => {
  if (b === 'open') return
  await db.execute(
    `insert into public.system_config (key, value, description) values ('jobs.self_improvement_tokens_per_day', '1'::jsonb, 'dequeue proof')
       on conflict (key) do update set value = excluded.value`,
  )
  // One usage row for a self-improvement job inside the window: spent (5) >= budget (1).
  await db.execute(`
    insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd,
                                        occurred_at, office_id, provenance)
    select u.provider, u.model_id, '${ids.si}'::uuid, gen_random_uuid(), u.outcome, 5, 0, 0, now() - interval '1 hour', u.office_id, u.provenance
      from public.inference_usage u limit 1`)
}

interface Result {
  claimed: string | null
  ceilingCalls: number
}

/** Run one case against one function, in a transaction that is always rolled back. */
const run = async (fn: string, c: Case): Promise<Result> => {
  await db.execute('begin')
  try {
    await db.execute('set local session_replication_role = replica')
    await db.execute(
      `update public.jobs set state = 'cancelled', finished_at = now(), leased_by = null, leased_until = null
        where state in ('queued', 'retrying', 'paused', 'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying')`,
    )
    // The ceiling's own rows must be the case's: take the usage window out of the picture, then set the budget.
    await db.execute(
      `delete from public.inference_usage where occurred_at > now() - interval '30 hours'`,
    )
    await db.execute(
      `delete from public.system_config where key = 'jobs.self_improvement_tokens_per_day'`,
    )
    // A usage row to copy the shape from must exist: keep one old row, then add the case's.
    const hasRow = Number((await rows(`select count(*) n from public.inference_usage`))[0]?.n) > 0
    if (!hasRow && c.budget === 'spent')
      throw new Error('no inference_usage row to copy the shape from')
    for (const s of c.queue) await db.execute(s)
    await setBudget(c.budget)
    await db.execute('reset session_replication_role')
    // The counter is cumulative across the connection's transactions, so the cost of the call is the DIFFERENCE around it.
    const callsNow = async (): Promise<number> =>
      Number(
        (
          await rows(
            `select coalesce(pg_stat_get_xact_function_calls('app.self_improvement_within_budget'::regproc), 0) n`,
          )
        )[0]?.n,
      )
    const callsBefore = await callsNow()
    const kinds = c.kinds === null ? 'null' : `array['${c.kinds}']`
    const scope = c.scope === null ? 'null' : `'${c.scope}'`
    const got = (
      await rows(
        `select job_id::text j from ${fn}('dq-proof-worker', true, true, ${kinds}::text[], ${scope})`,
      )
    )[0]?.j
    const calls = (await callsNow()) - callsBefore
    return { claimed: (got as string | undefined) ?? null, ceilingCalls: calls }
  } finally {
    await db.execute('rollback')
  }
}

// A case that needs a row to copy the shape from reads the first row of the table, so the table must not be empty.
const usageRows = Number((await rows(`select count(*) n from public.inference_usage`))[0]?.n)
check(usageRows > 0, `the replica holds usage rows to copy the shape from (${String(usageRows)})`)

let compared = 0
let claimedSome = 0
let claimedNone = 0
const byName = new Map<string, { frozen: Result; live: Result }>()
for (const c of cases) {
  const frozenRes = await run('proof_ref.dequeue_job', c)
  const liveRes = await run('app.dequeue_job', c)
  byName.set(c.name, { frozen: frozenRes, live: liveRes })
  compared += 1
  if (frozenRes.claimed === null) claimedNone += 1
  else claimedSome += 1
  if (frozenRes.claimed !== liveRes.claimed)
    check(
      false,
      `${c.name}: frozen claims ${String(frozenRes.claimed)}, new claims ${String(liveRes.claimed)}`,
    )
  if (liveRes.ceilingCalls > 1)
    check(
      false,
      `${c.name}: the new function evaluated the ceiling ${String(liveRes.ceilingCalls)} times`,
    )
  if (liveRes.ceilingCalls > frozenRes.ceilingCalls)
    check(false, `${c.name}: the new function asked the ceiling more often than the frozen one`)
}
check(
  failed === 0,
  `the claimed job is identical to the frozen predecessor in all ${String(compared)} cases`,
)

// ---- controls ----
check(
  claimedSome >= 10 && claimedNone >= 10,
  `control: ${String(claimedSome)} cases claim a job and ${String(claimedNone)} claim nothing (not vacuous)`,
)
const open = byName.get('open / self-improvement / kinds any / scope none')
const spent = byName.get('spent / self-improvement / kinds any / scope none')
check(
  open?.frozen.claimed === ids.si && spent?.frozen.claimed === null,
  'control: the budget changes the answer (a self-improvement job is claimed when open and held when spent)',
)
const bothSpent = byName.get('spent / self first / kinds any / scope none')
check(
  bothSpent?.live.claimed === ids.ord,
  'control: spent, the ordinary job is claimed past the held self-improvement job',
)

// The lazy evaluation: not at all when no self-improvement job is queued, once when one is.
const emptyRun = byName.get('open / empty / kinds any / scope none')
const ordRun = byName.get('open / ordinary / kinds any / scope none')
const siRun = byName.get('open / self-improvement / kinds any / scope none')
check(
  emptyRun?.frozen.ceilingCalls === 1 && emptyRun.live.ceilingCalls === 0,
  `control: an empty queue costs the ceiling once before and not at all now (${String(emptyRun?.frozen.ceilingCalls)} -> ${String(emptyRun?.live.ceilingCalls)})`,
)
check(
  ordRun?.frozen.ceilingCalls === 1 && ordRun.live.ceilingCalls === 0,
  `control: an ordinary-only queue costs the ceiling once before and not at all now (${String(ordRun?.frozen.ceilingCalls)} -> ${String(ordRun?.live.ceilingCalls)})`,
)
check(
  siRun?.live.ceilingCalls === 1,
  `control: a queued self-improvement job still asks the ceiling, once (${String(siRun?.live.ceilingCalls)})`,
)

// Sabotage copies must DISAGREE where the ceiling matters.
const openCase = cases.find((c) => c.name === 'open / self-improvement / kinds any / scope none')
const spentCase = cases.find((c) => c.name === 'spent / self-improvement / kinds any / scope none')
if (openCase === undefined || spentCase === undefined) throw new Error('missing cases')
const ignoresCeiling = await run('proof_ref.always_open', spentCase)
check(
  ignoresCeiling.claimed !== null,
  'control: a copy that ignores the ceiling claims the held job (so the proof could catch it)',
)
const alwaysHeld = await run('proof_ref.always_spent', openCase)
check(
  alwaysHeld.claimed === null,
  'control: a copy that always holds the ceiling starves the open case (so the proof could catch it)',
)

await db.execute('drop schema if exists proof_ref cascade')
console.log(
  failed === 0
    ? '\ndequeue ceiling equivalent: PASS'
    : `\ndequeue ceiling equivalent: ${String(failed)} FAIL`,
)
await db.end()
process.exit(failed === 0 ? 0 : 1)
