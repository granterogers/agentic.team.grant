/**
 * #391 (Run 5, 0626) - the voice-note dispatch goes through the CI ledger.
 *
 *   npx tsx scripts/isolated/ci-voice-ledger.ts <replica-db>
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'ci626')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const spentBefore = Number((await one(`select app.ci_spent_this_month() as s`)).s)

check(
  'voice-note is a workflow the office may run (it was "not a workflow the office may run")',
  parse((await one(`select app.ci_may_run('voice-note') as v`)).v).may === true,
  'may',
)
const taken = parse(
  (await one(`select public.ci_reserve('voice-note', 'voice-note', 'proof', 'grant', null) as v`))
    .v,
)
check(
  'the public wrapper reserves minutes and returns the run to release',
  taken.may === true && typeof taken.ci_run_id === 'string' && Number(taken.reserved) > 0,
  JSON.stringify(taken).slice(0, 90),
)
const spentAfter = Number((await one(`select app.ci_spent_this_month() as s`)).s)
check(
  'the reservation is counted against the month',
  spentAfter > spentBefore,
  `${String(spentBefore)} -> ${String(spentAfter)}`,
)
const released = parse(
  (
    await one(
      `select public.ci_release(${lit(String(taken.ci_run_id))}::uuid, 'GitHub refused') as v`,
    )
  ).v,
)
const spentReleased = Number((await one(`select app.ci_spent_this_month() as s`)).s)
check(
  'a refusal by GitHub releases it: the month is back where it was',
  released.ok === true && spentReleased === spentBefore,
  `${String(spentReleased)} vs ${String(spentBefore)}`,
)
const again = parse(
  (await one(`select public.ci_release(${lit(String(taken.ci_run_id))}::uuid, 'again') as v`)).v,
)
check('releasing twice is harmless and changes nothing', again.ok === false, JSON.stringify(again))
// the ceiling refuses when the month is spent
await db.execute(`update public.system_config set value = '1'::jsonb where key = 'ci.monthly_minutes'`)
const refused = parse(
  (await one(`select public.ci_reserve('voice-note', 'voice-note', 'over', 'grant', null) as v`)).v,
)
check(
  'when the month is spent the ledger refuses and starts nothing',
  refused.may === false && refused.ci_run_id === undefined,
  String(refused.why).slice(0, 70),
)
const ghost = parse(
  (await one(`select public.ci_reserve('not-a-workflow', 'x', 'x', 'grant', null) as v`)).v,
)
check(
  'an unregistered workflow still cannot be reserved (control)',
  ghost.may === false,
  String(ghost.why).slice(0, 60),
)
const anon = (await one(
  `select has_function_privilege('anon', 'public.ci_reserve(text,text,text,text,uuid)', 'execute') as a,
            has_function_privilege('authenticated', 'public.ci_release(uuid,text)', 'execute') as b,
            has_function_privilege('service_role', 'public.ci_reserve(text,text,text,text,uuid)', 'execute') as c`,
)) as { a: boolean; b: boolean; c: boolean }
check(
  'the public key reaches neither door; the service role reaches both',
  anon.a === false && anon.b === false && anon.c === true,
  JSON.stringify(anon),
)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
