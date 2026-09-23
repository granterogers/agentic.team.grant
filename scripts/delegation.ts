/**
 * Is the office under-delegating, or correctly answering alone? (#318)
 *
 *   npm run delegation
 *
 * A MEASUREMENT, not a routing change. `npm run measure` already says the
 * delegation rate is near zero; that number on its own is not a defect, and
 * raising it because it is low would be tuning against a preference.
 *
 * ## What is counted, and against what
 *
 * Real delivered requests only — a real channel AND an answer that actually
 * reached somebody, which is the property that survives where a name filter
 * does not (CLAUDE.md records three rounds of chasing harness traffic by
 * name). Bounded to 14 September, because `jobs.recipient_agent` was not
 * written before then: 79 of the 120 delivered real requests have no
 * recorded answerer at all and no routing question can be asked of them.
 *
 * ## Opportunity is not necessity
 *
 * Almost any request COULD go to somebody with a title. A measurement that
 * treats that as the question concludes under-delegation every time — the
 * judge-that-marks-everything-poor shape, pointed at routing. So the verdict
 * is three-way and the controls below are what make it readable: four
 * invented requests whose answer is not in doubt, two that plainly need
 * nobody and two that plainly need somebody. **If the controls do not
 * separate, the run reports that and scores nothing**, because a classifier
 * that cannot tell them apart cannot measure the real corpus either.
 */

import { ManagementApiExecutor, type SqlExecutor } from '../src/db/executor.ts'
import { makeNecessityJudge, type Necessity } from '../src/eval/necessity.ts'
import { ProviderRouter } from '../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const orKey = String(
  (
    (
      await db.execute(`select coalesce(app.resolve_secret(secret_ref), '') as v
                          from public.providers
                         where provider = 'openrouter' and secret_ref is not null limit 1`)
    ).rows[0] as { v?: string }
  )?.v ?? '',
)
const judge = makeNecessityJudge(new ProviderRouter(db, orKey))

/*
  THE CONTROLS. Invented, so nothing of Grant's is in them, and each one's
  answer is not in doubt. A classifier that calls the greeting `warranted` or
  the audit `unnecessary` is not measuring anything.
*/
const CONTROLS: readonly { ask: string; answer: string; want: Necessity }[] = [
  {
    ask: 'hello',
    answer: 'Morning. What would you like to look at?',
    want: 'unnecessary',
  },
  {
    ask: 'what projects have we got open?',
    answer: 'Four: the coaching course, the pricing review, the match funding bid and the venue.',
    want: 'unnecessary',
  },
  {
    ask: 'Model what dropping the middle tier does to twelve-month revenue under three churn assumptions, and tell me which one we should plan against.',
    answer: 'Dropping it would probably reduce revenue somewhat. It depends on churn.',
    want: 'warranted',
  },
  {
    ask: 'Audit the refund policy against consumer law and tell me where we are exposed.',
    answer: 'The refund policy looks broadly fine to me.',
    want: 'warranted',
  },
]

console.log('\n#318 — is the office under-delegating?\n')
console.log('calibrating the classifier on four invented controls')

let controlsAgree = 0
for (const c of CONTROLS) {
  const v = await judge(c.ask, c.answer)
  const got = v?.necessity ?? '(unreadable)'
  const right = got === c.want
  if (right) controlsAgree += 1
  console.log(
    `  ${right ? 'ok  ' : 'MISS'} wanted ${c.want.padEnd(11)} got ${got.padEnd(11)} ${c.ask.slice(0, 44)}`,
  )
}

/*
  Both directions have to separate. Three of four with all the misses on one
  side is a classifier with a bias, and a biased classifier measuring a
  question ABOUT that bias is worthless.
*/
if (controlsAgree < 3) {
  console.log(
    `\n  INCONCLUSIVE — the classifier agreed with ${String(controlsAgree)} of 4 controls, ` +
      'so it cannot separate needing a specialist from merely being able to use one. ' +
      'Nothing below would mean anything.\n',
  )
  process.exit(1)
}
console.log(`  controls: ${String(controlsAgree)}/4\n`)

interface Row {
  instruction: string
  answer: string
  who: string
  children: number
  convened: number
}

const { rows } = await db.execute(`
  select c.instruction,
         coalesce(o.body, '') as answer,
         coalesce(j.recipient_agent, '(none)') as who,
         (select count(*)::int from public.jobs k where k.parent_job_id = j.job_id) as children,
         (select count(*)::int from public.jobs k
           where k.parent_job_id = j.job_id and k.kind = 'office.instruction') as convened
    from public.inbound_commands c
    join public.jobs j on j.job_id = c.job_id
    join public.outputs o on o.job_id = j.job_id
   where not app.harness_job(j.job_id)
     and j.kind = 'office.instruction'
     and j.created_at >= '2026-09-14'
     and split_part(c.origin_ref, ':', 1) !~* '^(verify|probe|gate|fixture|sess)'
     and exists (select 1 from public.deliveries d
                  where d.job_id = j.job_id and d.sent_at is not null)
     and coalesce(trim(o.body), '') <> ''
   order by c.received_at`)

/*
  Harness text that reached a real channel is REPORTED, never silently
  dropped — CLAUDE.md's rule about a sweep that stops early looking exactly
  like one that finished. Both totals are printed so the reader can see what
  the exclusion is worth.
*/
const PROBE = /\b(?:probe|positive control|simultaneous)\b/i
const all = rows as unknown as Row[]
const real = all.filter((r) => !PROBE.test(r.instruction))
console.log(
  `${String(all.length)} delivered real requests since 14 September; ` +
    `${String(all.length - real.length)} are harness text that reached a real channel and are excluded\n`,
)

const verdicts: { row: Row; necessity: Necessity; who: string | null; reason: string }[] = []
let unreadable = 0
for (const r of real) {
  const v = await judge(r.instruction, r.answer)
  if (v === null) {
    unreadable += 1
    continue
  }
  verdicts.push({ row: r, necessity: v.necessity, who: v.who, reason: v.reason })
  const did = r.convened > 0 ? 'convened' : 'alone'
  console.log(
    `  ${v.necessity.padEnd(11)} ${did.padEnd(9)} ${r.instruction.replace(/\s+/g, ' ').slice(0, 56)}`,
  )
}

const n = verdicts.length
const pct = (k: number) => (n === 0 ? '0' : ((k / n) * 100).toFixed(0))
const count = (f: (v: (typeof verdicts)[number]) => boolean) => verdicts.filter(f).length

const unnecessary = count((v) => v.necessity === 'unnecessary')
const beneficial = count((v) => v.necessity === 'beneficial')
const warranted = count((v) => v.necessity === 'warranted')
const delegated = count((v) => v.row.convened > 0)
const missedWarranted = count((v) => v.necessity === 'warranted' && v.row.convened === 0)
const unnecessaryDelegation = count((v) => v.necessity === 'unnecessary' && v.row.convened > 0)
const multi = count((v) => v.row.convened > 1)

console.log(
  `\n  scored ${String(n)}${unreadable === 0 ? '' : `, ${String(unreadable)} unreadable`}\n`,
)
console.log(
  `  delegation UNNECESSARY        ${String(unnecessary).padStart(3)}  ${pct(unnecessary)}%`,
)
console.log(
  `  optional but BENEFICIAL       ${String(beneficial).padStart(3)}  ${pct(beneficial)}%`,
)
console.log(`  clearly WARRANTED             ${String(warranted).padStart(3)}  ${pct(warranted)}%`)
console.log(`  actual delegation rate        ${String(delegated).padStart(3)}  ${pct(delegated)}%`)
console.log(
  `  MISSED warranted delegation   ${String(missedWarranted).padStart(3)}  ${pct(missedWarranted)}%`,
)
console.log(
  `  unnecessary delegation        ${String(unnecessaryDelegation).padStart(3)}  ${pct(unnecessaryDelegation)}%`,
)
console.log(`  multi-specialist collaboration${String(multi).padStart(3)}  ${pct(multi)}%`)

const byWho = new Map<string, number>()
for (const v of verdicts) byWho.set(v.row.who, (byWho.get(v.row.who) ?? 0) + 1)
console.log('\n  who answered:')
for (const [w, k] of [...byWho.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${w.padEnd(24)} ${String(k)}`)
}

if (missedWarranted > 0 || beneficial > 0) {
  console.log('\n  the cases a specialist would have changed:')
  for (const v of verdicts) {
    if (v.necessity === 'unnecessary' || v.row.convened > 0) continue
    console.log(`    [${v.necessity}] ${v.row.instruction.replace(/\s+/g, ' ').slice(0, 54)}`)
    console.log(`      would have wanted: ${v.who ?? '(unsaid)'} — ${v.reason.slice(0, 96)}`)
  }
}
console.log('')
