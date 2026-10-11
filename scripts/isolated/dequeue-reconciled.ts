/**
 * Proof: the reconciled app.dequeue_job (efficiency 1030's lazy ceiling carried onto the V1 migration 1044's fair-share body) keeps every
 * property of 1044 and gains only the lazy ceiling; applying efficiency's own 1030 after 1044 would lose the fairness.
 *
 *   npx tsx scripts/isolated/dequeue-reconciled.ts <a CLONE of the replica, never base/pre/post>
 *
 * Three functions are installed in a scratch schema and compared on the same queues:
 *   d1044 : the live app.dequeue_job on the replica (the candidate as integrated; must carry the fair-share term)
 *   rec   : docs/audit/deferred-migrations/dequeue_job-efficiency-1030-reconciled-with-1044.sql (the file under proof)
 *   old   : scripts/isolated/reference/dequeue.efficiency-1030.sql (efficiency's 1030 as written: the CONTROL that shows the conflict is real)
 *
 * Every queue runs in a rolled-back transaction, except the concurrency case, which commits to the clone (hence the refusal to run on a
 * shared replica). No production contact, no model call, nothing outward.
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const name = process.argv[2] ?? ''
if (name === '' || ['base', 'pre', 'post'].includes(name))
  throw new Error(
    'REFUSED: this proof commits to its database; give it a clone, never base, pre or post',
  )
const db = await isolated(name)
const db2 = await isolated(name)
const rows = async (sql: string, d = db): Promise<Record<string, unknown>[]> =>
  (await d.execute(sql)).rows as Record<string, unknown>[]
let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

// ---------------------------------------------------------------- the three functions
const FN = /create or replace function app\.dequeue_job[\s\S]*?\$function\$;/i
const body = (file: string, as: string): string => {
  const m = readFileSync(file, 'utf8').match(FN)
  if (m === null) throw new Error(`no function in ${file}`)
  return m[0].replace(/app\.dequeue_job/i, as)
}
// 1078 moved the claim into app.dequeue_job_core (six arguments) and left app.dequeue_job as a one-line wrapper that says p_can_engine = false.
// What this proof compares is the CLAIM, so the live claim is the core with the engine gate held open and the five-argument header it had in 1044.
const live = String(
  (
    await rows(
      `select pg_get_functiondef('app.dequeue_job_core(text,boolean,boolean,text[],text,boolean)'::regprocedure) d`,
    )
  )[0]?.d,
)
  .replace(
    'app.dequeue_job_core(p_worker text, p_can_transcribe boolean, p_can_subprocess boolean, p_kinds text[], p_requested_by text, p_can_engine boolean)',
    'app.dequeue_job(p_worker text, p_can_transcribe boolean DEFAULT true, p_can_subprocess boolean DEFAULT true, p_kinds text[] DEFAULT NULL::text[], p_requested_by text DEFAULT NULL::text)',
  )
  .replaceAll('p_can_engine', 'true')
check(
  live.includes('v_share') && live.includes('v_may_reflect'),
  'the live function is 1044 as integrated: it has the fair-share term and the eager ceiling flag',
)
const RECFILE =
  'docs/audit/deferred-migrations/dequeue_job-efficiency-1030-reconciled-with-1044.sql'
const rec = body(RECFILE, 'proof_ref.rec')
await db.execute('drop schema if exists proof_ref cascade')
await db.execute('create schema proof_ref')
await db.execute(live.replace('app.dequeue_job', 'proof_ref.d1044'))
await db.execute(rec)
await db.execute(body('scripts/isolated/reference/dequeue.efficiency-1030.sql', 'proof_ref.old'))
check(
  rec.includes('v_share') &&
    !rec.includes('v_may_reflect') &&
    rec.includes('(select app.self_improvement_within_budget())'),
  'the reconciled file has the fair-share term, no eager flag, and the lazy ceiling',
)

// ---------------------------------------------------------------- stage
const run = Date.now().toString(36)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const mkOffice = async (tag: string): Promise<string> => {
  const email = `rec-${tag}-${run}@example.invalid`
  await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
  return String(
    (
      await rows(
        `select (app.provision_person_office(${lit(`Reconcile ${tag}`)}, ${lit(email)}, ${lit(`rec-${tag.toLowerCase()}-${run}`)})->>'office_id') id`,
      )
    )[0]?.id,
  )
}
const A = await mkOffice('A')
const B = await mkOffice('B')
const OFF = String(
  (await rows(`select office_id::text id from public.offices where kind = 'test' limit 1`))[0]?.id,
)
const SI = String(
  (await rows(`select kind from public.self_improvement_kinds order by kind limit 1`))[0]?.kind,
)
const ORD = 'office.instruction'
const BG = 'office.notice'
let n = 0
const jid = (): string => {
  n += 1
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}
const jobSql = (
  id: string,
  office: string,
  kind: string,
  priority: number,
  ageMin: number,
  state = 'queued',
  by = 'telegram:grant',
): string =>
  `insert into public.jobs (job_id, correlation_id, state, idempotency_key, kind, requested_by, priority, pinned_config, attempt, max_attempts,
                           created_at, updated_at, office_id, synthetic, claim_gen, origin_kind, origin_class, recipient_agent)
   values ('${id}', gen_random_uuid(), '${state}', 'rec-${run}-${id}', '${kind}', '${by}', ${String(priority)}, '{}'::jsonb, 0, 5,
           now() - interval '${String(ageMin)} minutes', now(), '${office}', false, 1, 'inbound', 'trusted', 'research-director')`

const spend = async (officeId: string, pence: number): Promise<void> => {
  const id = jid()
  await db.execute(
    `insert into public.jobs (job_id, correlation_id, state, idempotency_key, kind, requested_by, priority, pinned_config, attempt, max_attempts,
                              created_at, updated_at, finished_at, office_id, synthetic, claim_gen, origin_kind, origin_class, recipient_agent, trace_pence)
     values ('${id}', gen_random_uuid(), 'complete', 'rec-${run}-${id}', '${BG}', 'duty:spend', 100, '{}'::jsonb, 1, 5,
             now(), now(), app.now_utc(), '${officeId}', false, 1, 'inbound', 'trusted', 'research-director', ${String(pence)})`,
  )
}

const setBudgetSpent = async (siJob: string, officeId: string): Promise<void> => {
  await db.execute(
    `insert into public.system_config (key, value, description) values ('jobs.self_improvement_tokens_per_day', '1'::jsonb, 'dequeue proof')
       on conflict (key) do update set value = excluded.value`,
  )
  await db.execute(
    `insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd, occurred_at, office_id, provenance)
     values ('openrouter', 'proof/model', '${siJob}', gen_random_uuid(), 'ok', 5, 0, 0, now() - interval '1 hour', '${officeId}', 'calculated')`,
  )
}

interface Case {
  name: string
  budget?: 'spent'
  queue: (ids: Record<string, string>) => string[]
  kinds?: string
  scope?: string
  /** names of the ids the case expects each function to claim, or null for nothing */
  expect?: { d1044: string | null; rec: string | null; old: string | null }
}
interface Result {
  claimed: string | null
  ceilingCalls: number
}

const stageSql = `update public.jobs set state = 'cancelled', finished_at = now(), leased_by = null, leased_until = null
                    where state in ('queued', 'retrying', 'paused', 'running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying')`
const runCase = async (fn: string, c: Case, ids: Record<string, string>): Promise<Result> => {
  await db.execute('begin')
  try {
    await db.execute("set local track_functions = 'all'")
    await db.execute('set local session_replication_role = replica')
    await db.execute(stageSql)
    await db.execute(
      `delete from public.inference_usage where occurred_at > now() - interval '30 hours'`,
    )
    await db.execute(
      `delete from public.system_config where key = 'jobs.self_improvement_tokens_per_day'`,
    )
    await db.execute(
      `update public.system_config set value = jsonb_set(value, '{max_concurrent_jobs}', '3') where key = 'jobs.capacity'`,
    )
    for (const s of c.queue(ids)) await db.execute(s)
    if (c.budget === 'spent') await setBudgetSpent(ids.si ?? '', A)
    await db.execute('reset session_replication_role')
    const calls = async (): Promise<number> =>
      Number(
        (
          await rows(
            `select coalesce(pg_stat_get_xact_function_calls('app.self_improvement_within_budget'::regproc), 0) n`,
          )
        )[0]?.n,
      )
    const before = await calls()
    const kinds = c.kinds === undefined ? 'null' : `array['${c.kinds}']`
    const scope = c.scope === undefined ? 'null' : `'${c.scope}'`
    const got = (
      await rows(
        `select job_id::text j from ${fn}('dq-proof-worker', true, true, ${kinds}::text[], ${scope})`,
      )
    )[0]?.j
    return { claimed: (got as string | undefined) ?? null, ceilingCalls: (await calls()) - before }
  } finally {
    await db.execute('rollback')
  }
}
const nameOf = (ids: Record<string, string>, id: string | null): string | null =>
  id === null ? null : (Object.entries(ids).find(([, v]) => v === id)?.[0] ?? id)

// ---------------------------------------------------------------- the cases
const cases: Case[] = []
const mk = (c: Case): void => {
  cases.push(c)
}
// The single-office matrix of efficiency's proof: budget x queue x kinds x scope. Here the ONLY question is whether rec claims what d1044 claims.
for (const budget of [undefined, 'spent'] as const)
  for (const [qn, q] of Object.entries({
    empty: (): string[] => [],
    ordinary: (i: Record<string, string>): string[] => [jobSql(i.ord ?? '', A, ORD, 100, 5)],
    'self-improvement': (i: Record<string, string>): string[] => [
      jobSql(i.si ?? '', A, SI, 100, 5, 'queued', 'duty:self'),
    ],
    'self first': (i: Record<string, string>): string[] => [
      jobSql(i.si ?? '', A, SI, 1, 10, 'queued', 'duty:self'),
      jobSql(i.ord ?? '', A, ORD, 100, 5),
    ],
    'ordinary first': (i: Record<string, string>): string[] => [
      jobSql(i.si ?? '', A, SI, 100, 5, 'queued', 'duty:self'),
      jobSql(i.ord ?? '', A, ORD, 1, 10),
    ],
  }))
    for (const kinds of [undefined, ORD])
      for (const scope of [undefined, 'telegram:grant'])
        mk({
          name: `${budget ?? 'open'} / ${qn} / kinds ${kinds ?? 'any'} / scope ${scope ?? 'none'}`,
          ...(budget === undefined ? {} : { budget }),
          queue: q,
          ...(kinds === undefined ? {} : { kinds }),
          ...(scope === undefined ? {} : { scope }),
        })
// Failure, recovery and boundary shapes.
mk({
  name: 'a job in retrying is not claimed',
  queue: (i) => [jobSql(i.ord ?? '', A, ORD, 100, 5, 'retrying')],
  expect: { d1044: null, rec: null, old: null },
})
mk({
  name: 'a job whose attempts are spent is not claimed',
  queue: (i) => [
    jobSql(i.ord ?? '', A, ORD, 100, 5),
    `update public.jobs set attempt = max_attempts where job_id = '${i.ord ?? ''}'`,
  ],
  expect: { d1044: null, rec: null, old: null },
})
mk({
  name: 'a delayed job is not claimed',
  queue: (i) => [
    jobSql(i.ord ?? '', A, ORD, 100, 5),
    `update public.jobs set not_before = now() + interval '1 hour' where job_id = '${i.ord ?? ''}'`,
  ],
  expect: { d1044: null, rec: null, old: null },
})
mk({
  name: 'the concurrent limit is reached',
  queue: (i) => [
    jobSql(i.r1 ?? '', A, ORD, 100, 9, 'running', 'x:1'),
    jobSql(i.r2 ?? '', A, ORD, 100, 8, 'running', 'x:2'),
    jobSql(i.r3 ?? '', A, ORD, 100, 7, 'running', 'x:3'),
    jobSql(i.ord ?? '', A, ORD, 100, 5),
  ],
  expect: { d1044: null, rec: null, old: null },
})
mk({
  name: 'a disabled office holds the only job',
  queue: (i) => [
    `update public.offices set state = 'disabled', disabled_at = now() where office_id = '${OFF}'`,
    jobSql(i.off ?? '', OFF, ORD, 100, 5),
  ],
  expect: { d1044: null, rec: null, old: null },
})
// Fairness: what 1044 is for and efficiency's 1030, applied after it, would lose.
mk({
  name: 'FAIR 1: office A holds a slot and has the older job, office B has one waiting -> B goes first',
  queue: (i) => [
    jobSql(i.a0 ?? '', A, ORD, 100, 30, 'running', 'x:a'),
    jobSql(i.a1 ?? '', A, ORD, 100, 20),
    jobSql(i.b1 ?? '', B, ORD, 100, 5),
  ],
  expect: { d1044: 'b1', rec: 'b1', old: 'a1' },
})
mk({
  name: 'FAIR 2: a lone office still uses its slots (no office to be fair to)',
  queue: (i) => [
    jobSql(i.a0 ?? '', A, ORD, 100, 30, 'running', 'x:a'),
    jobSql(i.a1 ?? '', A, ORD, 100, 20),
  ],
  expect: { d1044: 'a1', rec: 'a1', old: 'a1' },
})
mk({
  name: 'FAIR 3: priority outranks the share (A is over its share but its job is more urgent)',
  queue: (i) => [
    jobSql(i.a0 ?? '', A, ORD, 100, 30, 'running', 'x:a'),
    jobSql(i.a1 ?? '', A, ORD, 1, 20),
    jobSql(i.b1 ?? '', B, ORD, 100, 5),
  ],
  expect: { d1044: 'a1', rec: 'a1', old: 'a1' },
})
mk({
  name: 'FAIR 4: a burst of five from A does not run ahead of the one from B',
  queue: (i) => [
    jobSql(i.a0 ?? '', A, ORD, 100, 40, 'running', 'x:a0'),
    jobSql(i.a00 ?? '', A, ORD, 100, 39, 'running', 'x:a00'),
    ...['a1', 'a2', 'a3', 'a4', 'a5'].map((k, x) => jobSql(i[k] ?? '', A, ORD, 100, 30 - x)),
    jobSql(i.b1 ?? '', B, ORD, 100, 1),
  ],
  expect: { d1044: 'b1', rec: 'b1', old: 'a1' },
})

const IDS = ['ord', 'si', 'off', 'r1', 'r2', 'r3', 'a0', 'a00', 'a1', 'a2', 'a3', 'a4', 'a5', 'b1']
const freshIds = (): Record<string, string> => {
  const m: Record<string, string> = {}
  for (const k of IDS) m[k] = jid()
  return m
}

let compared = 0
let claimedSome = 0
let claimedNone = 0
const byName = new Map<
  string,
  { d1044: Result; rec: Result; old: Result; ids: Record<string, string> }
>()
for (const c of cases) {
  const i = freshIds()
  const d1044 = await runCase('proof_ref.d1044', c, i)
  const recRes = await runCase('proof_ref.rec', c, i)
  const old = await runCase('proof_ref.old', c, i)
  byName.set(c.name, { d1044, rec: recRes, old, ids: i })
  compared += 1
  if (d1044.claimed === null) claimedNone += 1
  else claimedSome += 1
  if (d1044.claimed !== recRes.claimed)
    check(
      false,
      `${c.name}: 1044 claims ${String(nameOf(i, d1044.claimed))}, reconciled claims ${String(nameOf(i, recRes.claimed))}`,
    )
  if (recRes.ceilingCalls > 1)
    check(
      false,
      `${c.name}: the reconciled function asked the ceiling ${String(recRes.ceilingCalls)} times`,
    )
  if (c.expect !== undefined) {
    const want = (k: string | null): string | null => (k === null ? null : (i[k] ?? null))
    if (d1044.claimed !== want(c.expect.d1044))
      check(
        false,
        `${c.name}: 1044 should claim ${String(c.expect.d1044)}, claimed ${String(nameOf(i, d1044.claimed))}`,
      )
    if (recRes.claimed !== want(c.expect.rec))
      check(
        false,
        `${c.name}: reconciled should claim ${String(c.expect.rec)}, claimed ${String(nameOf(i, recRes.claimed))}`,
      )
    if (old.claimed !== want(c.expect.old))
      check(
        false,
        `${c.name}: efficiency 1030 as written should claim ${String(c.expect.old)}, claimed ${String(nameOf(i, old.claimed))}`,
      )
  }
}
check(
  failed === 0,
  `the reconciled function claims exactly what 1044 claims, and every stated expectation holds, in all ${String(compared)} cases`,
)
check(
  claimedSome >= 15 && claimedNone >= 15,
  `control: ${String(claimedSome)} cases claim a job and ${String(claimedNone)} claim nothing (not vacuous)`,
)

// The conflict is real: efficiency's 1030 as written disagrees with 1044 on the fairness cases and would lose the protection.
const f1 = byName.get(
  'FAIR 1: office A holds a slot and has the older job, office B has one waiting -> B goes first',
)
const f4 = byName.get('FAIR 4: a burst of five from A does not run ahead of the one from B')
check(
  f1?.old.claimed === f1?.ids.a1 &&
    f1?.rec.claimed === f1?.ids.b1 &&
    f4?.old.claimed === f4?.ids.a1 &&
    f4?.rec.claimed === f4?.ids.b1,
  "CONFLICT PROVEN: efficiency's 1030 as written lets the burst office go first (loses 1044's fairness); the reconciled function does not",
)

// The lazy ceiling: not at all when no self-improvement job is queued, once when one is, and 1044 asked it every call.
const empty = byName.get('open / empty / kinds any / scope none')
const ordq = byName.get('open / ordinary / kinds any / scope none')
const siq = byName.get('open / self-improvement / kinds any / scope none')
const spentSelf = byName.get('spent / self first / kinds any / scope none')
const openSelf = byName.get('open / self-improvement / kinds any / scope none')
check(
  empty?.d1044.ceilingCalls === 1 && empty.rec.ceilingCalls === 0,
  `an empty queue asks the ceiling once under 1044 and not at all reconciled (${String(empty?.d1044.ceilingCalls)} -> ${String(empty?.rec.ceilingCalls)})`,
)
check(
  ordq?.d1044.ceilingCalls === 1 && ordq.rec.ceilingCalls === 0,
  `an ordinary-only queue: ${String(ordq?.d1044.ceilingCalls)} -> ${String(ordq?.rec.ceilingCalls)}`,
)
check(
  siq?.rec.ceilingCalls === 1,
  `a queued self-improvement job still asks the ceiling, once (${String(siq?.rec.ceilingCalls)})`,
)
check(
  spentSelf?.rec.claimed === spentSelf?.ids.ord && openSelf?.rec.claimed === openSelf?.ids.si,
  'the ceiling still holds a self-improvement job when spent and the ordinary job is claimed past it; open, it is claimed',
)

// ---------------------------------------------------------------- the lease, the retry count, the guards
await db.execute('begin')
try {
  await db.execute('set local session_replication_role = replica')
  await db.execute(stageSql)
  const id = jid()
  await db.execute(jobSql(id, A, ORD, 100, 5))
  await db.execute('reset session_replication_role')
  const got = (
    await rows(`select job_id::text j, attempt from proof_ref.rec('lease-proof-worker')`)
  )[0]
  const j = (
    await rows(
      `select state::text s, leased_by, round(extract(epoch from (leased_until - now())))::int secs, attempt, claim_gen from public.jobs where job_id = '${id}'`,
    )
  )[0]
  check(
    got?.j === id &&
      j?.s === 'running' &&
      j?.leased_by === 'lease-proof-worker' &&
      Number(j?.secs) >= 280 &&
      Number(j?.secs) <= 305 &&
      Number(j?.attempt) === 1 &&
      Number(j?.claim_gen) === 2,
    `a claim leases the job to the worker for about five minutes, counts the attempt and bumps the generation (${JSON.stringify(j)})`,
  )
  for (const w of ['', '   ']) {
    await db.execute('savepoint w')
    let code = ''
    try {
      await rows(`select * from proof_ref.rec(${lit(w)})`)
    } catch (e) {
      code = String((e as { code?: string }).code ?? (e as Error).message)
    }
    await db.execute('rollback to savepoint w')
    check(
      code.includes('22023'),
      `a blank worker identity is refused with 22023 (${JSON.stringify(w)} -> ${code.slice(0, 40)})`,
    )
  }
} finally {
  await db.execute('rollback')
}

// ---------------------------------------------------------------- one office cannot spend another's budget or take another's work
await db.execute('begin')
try {
  await db.execute('set local session_replication_role = replica')
  await db.execute(stageSql)
  await db.execute(
    `update public.system_config set value = to_jsonb(60) where key = 'budget.pence_per_agent_per_day'`,
  )
  await db.execute(
    `update public.system_config set value = to_jsonb(200) where key = 'budget.pence_for_the_office_per_day'`,
  )
  await spend(B, 70)
  const aJob = jid()
  const bJob = jid()
  await db.execute(jobSql(aJob, A, BG, 100, 20))
  await db.execute(jobSql(bJob, B, BG, 100, 10))
  await db.execute('reset session_replication_role')
  await db.execute('select app.defer_over_budget()')
  const parked = async (id: string): Promise<boolean> =>
    (
      await rows(
        `select (not_before is not null and not_before > app.now_utc()) p from public.jobs where job_id = '${id}'`,
      )
    )[0]?.p === true
  check(!(await parked(aJob)), "B's spending does not park A's work for the same agent")
  check(await parked(bJob), 'POSITIVE CONTROL: the office that spent its ceiling is held')
  const got = (
    await rows(`select job_id::text j, office_id::text o from proof_ref.rec('budget-proof-worker')`)
  )[0]
  check(
    got?.j === aJob && got?.o === A,
    "the reconciled dequeue claims A's job and never B's held one",
  )
} finally {
  await db.execute('rollback')
}

// ---------------------------------------------------------------- real concurrency: two connections, one lock
{
  await db.execute(stageSql)
  const j1 = jid()
  const j2 = jid()
  await db.execute('set session_replication_role = replica')
  await db.execute(jobSql(j1, A, ORD, 100, 20))
  await db.execute(jobSql(j2, A, ORD, 100, 10))
  await db.execute('reset session_replication_role')
  await db.execute('begin')
  const first = String((await rows(`select job_id::text j from proof_ref.rec('conc-1')`))[0]?.j)
  await db2.execute('begin')
  let second: string | null = null
  const pending = rows(`select job_id::text j from proof_ref.rec('conc-2')`, db2).then((r) => {
    second = String(r[0]?.j)
  })
  await new Promise((r) => setTimeout(r, 700))
  check(
    second === null,
    'the second caller waits on the dequeue lock while the first holds its claim open',
  )
  await db.execute('commit')
  await pending
  await db2.execute('commit')
  check(
    first === j1 && second === j2 && first !== second,
    `after the first commits the second claims the OTHER job (${String(first === j1)} ${String(second === j2)})`,
  )
  await db.execute(stageSql)
}

// ---------------------------------------------------------------- sabotage: each landed, each caught
{
  const FAIR =
    /\(coalesce\(\(select b\.n from busy b where b\.office_id = j\.office_id\), 0\) >= v_share\) asc,/
  const sabotaged = rec.replace(/proof_ref\.rec/, 'proof_ref.sab_nofair').replace(FAIR, '')
  check(
    sabotaged !== rec.replace(/proof_ref\.rec/, 'proof_ref.sab_nofair'),
    'SABOTAGE LANDED: the fair-share ORDER BY term was removed from the copy',
  )
  await db.execute(sabotaged)
  const c1 = cases.find((c) => c.name.startsWith('FAIR 1')) as Case
  const i1 = f1?.ids ?? {}
  const r1 = await runCase('proof_ref.sab_nofair', c1, i1)
  check(
    r1.claimed === i1.a1,
    'the proof catches a copy without the fairness term (it claims A first)',
  )
  const CEIL = '(select app.self_improvement_within_budget())'
  const open = rec.replace(/proof_ref\.rec/, 'proof_ref.sab_open').replace(CEIL, 'true')
  check(open.includes('or true'), 'SABOTAGE LANDED: the ceiling was replaced by true in the copy')
  await db.execute(open)
  const spentCase = cases.find(
    (c) => c.name === 'spent / self-improvement / kinds any / scope none',
  ) as Case
  const rOpen = await runCase(
    'proof_ref.sab_open',
    spentCase,
    byName.get(spentCase.name)?.ids ?? {},
  )
  check(
    rOpen.claimed !== null,
    'the proof catches a copy that ignores the ceiling (it claims the held job)',
  )
}

await db.execute('drop schema if exists proof_ref cascade')
console.log(
  failed === 0 ? '\ndequeue reconciled: PASS' : `\ndequeue reconciled: ${String(failed)} FAIL`,
)
await db.end()
await db2.end()
process.exit(failed === 0 ? 0 : 1)
