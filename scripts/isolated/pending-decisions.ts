// biome-ignore-all lint/suspicious/noExplicitAny: SQL results are untyped rows
/**
 * One count of the decisions waiting for the person (SET-03, migration 1115), on the isolated replica only.
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/pending-decisions.ts
 *
 * What is proved, each with a control beside the refusal:
 *   1. the total is the sum of its four parts (blockers, proposals, requests, offers);
 *   2. each part equals a direct count from its own table with the same exclusions (so the function reads the right rows);
 *   3. an office the caller cannot open is refused (require_office), not counted as zero;
 *   4. the function answers the same thing twice in a row (it is stable).
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import { isolated } from './guard.ts'

const DB = process.argv[2] ?? 'post'
const main = await isolated(DB)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const one = async (sql: string): Promise<any> =>
  ((await (main as PgExecutor).execute(sql)).rows as Record<string, unknown>[])[0]

const office = String(
  (await one('select office_id::text o from public.offices order by created_at limit 1')).o,
)

type Item = { id: string; kind: string; title: string; who: string; overdue: boolean; at: string }
type Parts = {
  count: number
  blockers: number
  proposals: number
  requests: number
  offers: number
  items: Item[]
}
const fn = async (): Promise<Parts> => {
  const row = await one(`select app.pending_decisions(${lit(office)}::uuid) as v`)
  return (typeof row.v === 'string' ? JSON.parse(row.v) : row.v) as Parts
}
const got = await fn()
const direct = {
  blockers: Number(
    (
      await one(
        `select count(*)::int c from public.blockers b where b.office_id = ${lit(office)}::uuid and b.state = 'open'::blocker_state and not coalesce(app.harness_job(b.job_id), false)`,
      )
    ).c,
  ),
  proposals: Number(
    (
      await one(
        `select count(*)::int c from public.proposals r where r.office_id = ${lit(office)}::uuid and r.state = 'open' and not app.harness_proposal(r.staff_slug, r.needed)`,
      )
    ).c,
  ),
  requests: Number(
    (
      await one(
        `select count(*)::int c from public.tool_requests q where q.office_id = ${lit(office)}::uuid and q.state = 'open'`,
      )
    ).c,
  ),
  offers: Number(
    (
      await one(
        `select count(*)::int c from public.suggestions g where g.office_id = ${lit(office)}::uuid and g.state = 'open' and g.offer_kind is not null and not app.harness_suggestion(g.offer_args)`,
      )
    ).c,
  ),
}

check(
  'the total is the sum of the four parts',
  got.count === got.blockers + got.proposals + got.requests + got.offers,
  `count ${String(got.count)}`,
)
check(
  'each part matches a direct count from its own table',
  got.blockers === direct.blockers &&
    got.proposals === direct.proposals &&
    got.requests === direct.requests &&
    got.offers === direct.offers,
  `blockers ${String(got.blockers)}/${String(direct.blockers)}, proposals ${String(got.proposals)}/${String(direct.proposals)}, requests ${String(got.requests)}/${String(direct.requests)}, offers ${String(got.offers)}/${String(direct.offers)}`,
)

// The list agrees with the count: each kind lists its items, at most twenty, and no item is listed twice.
const listed = (kind: string): number => got.items.filter((i) => i.kind === kind).length
check(
  'the list shows each kind with the same count (capped at twenty)',
  listed('approval') === Math.min(got.blockers, 20) &&
    listed('proposal') === Math.min(got.proposals, 20) &&
    listed('tool') === Math.min(got.requests, 20) &&
    listed('offer') === Math.min(got.offers, 20) &&
    new Set(got.items.map((i) => `${i.kind}:${i.id}`)).size === got.items.length,
  `${String(got.items.length)} item(s)`,
)

// A positive control: one open request must raise the requests part and the total by exactly one. Run through the gate, which
// clones the replica first, so the write never reaches the template.
const beforeRequest = await fn()
await one(
  `insert into public.tool_requests (tool, asked_by, what_for, because, office_id) values ('proof.pending_decisions', 'chief-of-staff', 'pending-decisions proof', '{}'::jsonb, ${lit(office)}::uuid) returning request_id`,
)
const afterRequest = await fn()
check(
  'an open request raises its own part and the total by exactly one (control)',
  afterRequest.requests === beforeRequest.requests + 1 &&
    afterRequest.count === beforeRequest.count + 1,
  `requests ${String(beforeRequest.requests)} -> ${String(afterRequest.requests)}, total ${String(beforeRequest.count)} -> ${String(afterRequest.count)}`,
)

let refused = false
try {
  await one(`select app.pending_decisions('00000000-0000-4000-8000-00000000dead'::uuid) as v`)
} catch {
  refused = true
}
check('an office that does not exist is refused, not counted as zero', refused)

const again = await fn()
check(
  'the same question gives the same answer twice',
  again.count === afterRequest.count,
  `${String(afterRequest.count)} then ${String(again.count)}`,
)

const passed = results.filter(Boolean).length
console.log(`\n${String(passed)} of ${String(results.length)} checks passed`)
process.exit(passed === results.length ? 0 : 1)
