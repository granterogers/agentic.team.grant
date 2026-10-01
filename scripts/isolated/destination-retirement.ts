/**
 * #381 / 0606 — a test destination is retired, never deleted, and the witness
 * can still tell a send it allowed at the time from one it never did.
 *
 *   npx tsx scripts/isolated/destination-retirement.ts <replica-db>
 */
import { provenanceSql } from '../leak-witness.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'ret381')
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const raises = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
const since = String((await one('select app.now_utc()::text as t')).t)
const fixture = (n: number) => `-7${String(Date.now()).slice(-9)}${String(n).padStart(6, '0')}`

// A harness job (a child of a harness turn) and its grandchild.
const harness = String(
  (
    await one(`insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
      values (gen_random_uuid(), ${lit(`ret:${run}`)}, 'research.conclusion', 'verify:retirement') returning job_id::text as v`)
  ).v,
)
const grandchild =
  String(
    (
      await one(
        `select app.enqueue_child(p_parent => ${lit(harness)}::uuid, p_kind => 'office.synthesise', p_payload => '{}'::jsonb)::text as v`,
      )
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0] ?? ''
const A = fixture(1)
const B = fixture(2)
for (const t of [A, B])
  await db.execute(`insert into public.test_destinations (channel, target_ref, why)
    values ('telegram', ${lit(t)}, 'isolated retirement proof, run ${run}')`)

const claim = async (job: string | null, key: string, target: string) => {
  const c = await one(`select outcome from app.claim_delivery(
       ${job === null ? 'app.operator_office()' : `app.job_office(${lit(job)}::uuid)`},
       'telegram', ${lit(key)}, 'acct', ${lit(target)}, 'result',
       null, null, null, ${job === null ? 'null' : `${lit(job)}::uuid`})`)
  // Read in its own statement: the claim's write is invisible to the statement that made it.
  const why = await one(
    `select coalesce(suppressed_reason, '') as why from public.deliveries where dedupe_key = ${lit(key)}`,
  )
  return { outcome: c.outcome, why: why?.why }
}
const markSent = (key: string) =>
  db.execute(`update public.deliveries set state = 'sent', sent_at = app.now_utc(), message_ref = 'm-' || dedupe_key
    where dedupe_key = ${lit(key)}`)

const before = await claim(harness, `ret:${run}:a1`, A)
check(
  'an ACTIVE test destination receives harness work',
  before.outcome === 'claimed',
  String(before.outcome),
)
await markSent(`ret:${run}:a1`)
const jobless = await claim(null, `verify:${run}:a2`, A)
check('and a job-less suite send', jobless.outcome === 'claimed', String(jobless.outcome))
await markSent(`verify:${run}:a2`)

// Retire A. The clock is the transaction's: commit between steps so "later" is later.
check(
  'retiring is one row, and again is none (idempotent)',
  Number((await one(`select app.retire_test_destination('telegram', ${lit(A)}) as n`)).n) === 1 &&
    Number((await one(`select app.retire_test_destination('telegram', ${lit(A)}) as n`)).n) === 0,
  'retired once',
)
const after = await claim(harness, `ret:${run}:a3`, A)
check(
  'after retirement the same job is refused',
  after.outcome !== 'claimed' && /harness traffic/.test(String(after.why)),
  `${String(after.outcome)} ${String(after.why)}`,
)
const afterJobless = await claim(null, `verify:${run}:a4`, A)
check(
  'and a job-less send',
  afterJobless.outcome !== 'claimed',
  `${String(afterJobless.outcome)} ${String(afterJobless.why)}`,
)
const afterChild = await claim(grandchild, `ret:${run}:a5`, A)
check("and the job's descendant", afterChild.outcome !== 'claimed', String(afterChild.outcome))
const other = await claim(harness, `ret:${run}:b1`, B)
check(
  'another run’s destination is untouched by the retirement',
  other.outcome === 'claimed',
  String(other.outcome),
)
await markSent(`ret:${run}:b1`)
await db.execute(`select app.retire_test_destination('telegram', ${lit(B)})`)

check(
  'a retired destination cannot be deleted',
  (await raises(`delete from public.test_destinations where target_ref = ${lit(A)}`)).includes(
    'never delete',
  ),
  'refused',
)
check(
  'nor un-retired',
  (
    await raises(
      `update public.test_destinations set retired_at = null where target_ref = ${lit(A)}`,
    )
  ).includes('stays retired'),
  'refused',
)
const reRegister = await raises(`insert into public.test_destinations (channel, target_ref, why)
  values ('telegram', ${lit(A)}, 'an attempt to re-register a retired destination') on conflict do nothing`)
const stillRetired = await one(`select bool_and(retired_at is not null) as r, count(*)::int as n
  from public.test_destinations where channel = 'telegram' and target_ref = ${lit(A)}`)
const again = await claim(harness, `ret:${run}:a6`, A)
check(
  're-registering a retired destination is refused, the row stays retired, and a send is still refused',
  stillRetired.r === true && Number(stillRetired.n) === 1 && again.outcome !== 'claimed',
  `re-register: ${reRegister === '' ? 'no-op' : reRegister.split('\n')[0]} · send ${String(again.outcome)}`,
)

// A send that the guard never allowed, forced in as if something had bypassed it.
await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, purpose, state, message_ref, sent_at, lease_expires_at)
  values ('telegram', ${lit(`ret:${run}:bypass`)}, 'acct', ${lit(A)}, ${lit(harness)}::uuid, 'result', 'sent', 'm-bypass', app.now_utc(), app.now_utc())`)

const traced = (await db.execute(provenanceSql(`${lit(since)}::timestamptz`))).rows as {
  key: string
  breach: string | null
}[]
const seen = (k: string) => traced.find((r) => r.key === k)
check(
  'the witness reads the sends made while registered as authorised, after retirement (not even examined as breaches)',
  seen(`ret:${run}:a1`) === undefined &&
    seen(`verify:${run}:a2`) === undefined &&
    seen(`ret:${run}:b1`) === undefined,
  `examined: ${traced.map((r) => r.key).join(', ') || 'none'}`,
)
check(
  'and names the one sent after retirement as a breach',
  seen(`ret:${run}:bypass`)?.breach === 'HARNESS_SENT',
  String(seen(`ret:${run}:bypass`)?.breach),
)
const esc = (await one('select app.harness_escapes() as v')).v as { new?: { target: string }[] }
const newTargets = (esc.new ?? []).map((e) => e.target)
check(
  'and app.harness_escapes agrees: one new escape, the bypass; the authorised sends are not escapes',
  newTargets.filter((t) => t === A).length === 1 && !newTargets.includes(B),
  `new escapes to A: ${String(newTargets.filter((t) => t === A).length)}, to B: ${String(newTargets.filter((t) => t === B).length)}`,
)

const failed = results.filter((x) => !x).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
