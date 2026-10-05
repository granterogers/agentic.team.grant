/**
 * Does any script insert into a carrier table without naming its office? (multi-user P3, #403)
 *   npm run check:suite-offices
 *
 * Migration 0860 removed the compatibility bridge, so an insert into a carrier table that omits `office_id` fails with
 * 23502. Dozens of verification suites and proof-of-concept scripts were written before that and are dead until converted
 * (safe, because they fail closed, but a dead suite is a gate nobody is running). Converting them needs the production
 * database they drive, which is not always available, so this does the part that can be done at any time: it makes the
 * debt a measured fact and stops it growing.
 *
 * A ratchet, not a wish: `suite-office-baseline.json` lists every script with its count per table. A count may FALL (a
 * conversion), never rise; a script not in the list may name zero such inserts; and a script that reaches zero must be
 * taken off the list, so the list can only shrink to empty. It reads source text only, no database.
 *
 * The carrier list is data in the baseline (regenerate it from a replica; the command is in the file). A new carrier
 * table is not seen until it is added there, which is stated rather than hidden.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type Counts = Record<string, number>
type Baseline = { carriers: string[]; files: Record<string, Counts> }

/** Inserts into a carrier table whose column list does not name office_id (or that has no column list at all). */
export const insertsWithoutOffice = (source: string, carriers: readonly string[]): Counts => {
  const bare = source.replace(/--[^\n]*/g, '')
  const out: Counts = {}
  const re = /insert\s+into\s+(?:public\.)?([a-z_]+)\b\s*(\([^)]*\))?/gi
  for (const m of bare.matchAll(re)) {
    const table = m[1] ?? ''
    if (!carriers.includes(table)) continue
    if (m[2] !== undefined && /office_id/i.test(m[2])) continue
    out[table] = (out[table] ?? 0) + 1
  }
  return out
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === 'isolated' || e.name === 'node_modules'
        ? []
        : walk(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  )

/** Files that quote an unconverted insert as the DEFECT they detect, not as a write they perform. */
const EXEMPT = new Set(['scripts/p3/check-carrier-writers.ts', 'scripts/p3/check-suite-offices.ts'])

export const compare = (
  found: Record<string, Counts>,
  baseline: Record<string, Counts>,
): { problems: string[]; converted: string[]; total: number } => {
  const problems: string[] = []
  const converted: string[] = []
  let total = 0
  for (const [file, counts] of Object.entries(found)) {
    const allowed = baseline[file]
    for (const [table, n] of Object.entries(counts)) {
      total += n
      const cap = allowed?.[table] ?? 0
      if (n > cap) {
        problems.push(
          `${file}: ${String(n)} insert(s) into ${table} with no office_id, baseline allows ${String(cap)}. Name the office (a harness subject takes app.test_office(), a child takes its parent's).`,
        )
      }
    }
  }
  for (const [file, counts] of Object.entries(baseline)) {
    const now = found[file] ?? {}
    for (const [table, cap] of Object.entries(counts)) {
      if ((now[table] ?? 0) < cap) {
        converted.push(`${file}: ${table} ${String(cap)} -> ${String(now[table] ?? 0)}`)
      }
    }
  }
  return { problems, converted, total }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseline = JSON.parse(
    readFileSync('scripts/p3/suite-office-baseline.json', 'utf8'),
  ) as Baseline
  let failed = false

  // Controls: the predicate sees a defect, and does not see a correct write or a table that is not a carrier.
  const bad = insertsWithoutOffice('insert into public.jobs (kind) values (1)', baseline.carriers)
  const good = insertsWithoutOffice(
    'insert into public.jobs (office_id, kind) values (1, 2)',
    baseline.carriers,
  )
  const other = insertsWithoutOffice(
    'insert into public.staff (slug) values (1)',
    baseline.carriers,
  )
  const bare = insertsWithoutOffice('insert into public.jobs select 1', baseline.carriers)
  const controlOk =
    bad.jobs === 1 &&
    Object.keys(good).length === 0 &&
    Object.keys(other).length === 0 &&
    bare.jobs === 1
  console.log(
    `${controlOk ? 'ok  ' : 'FAIL'} the detector sees an unconverted insert, a bare one, and ignores a converted one`,
  )
  if (!controlOk) failed = true
  // And the ratchet can fail: one more insert than the baseline allows must be a problem.
  const raised = compare({ 'x.ts': { jobs: 2 } }, { 'x.ts': { jobs: 1 } })
  const equal = compare({ 'x.ts': { jobs: 1 } }, { 'x.ts': { jobs: 1 } })
  const ratchetOk = raised.problems.length === 1 && equal.problems.length === 0
  console.log(`${ratchetOk ? 'ok  ' : 'FAIL'} the ratchet refuses a rise and accepts the baseline`)
  if (!ratchetOk) failed = true

  const found: Record<string, Counts> = {}
  for (const file of walk('scripts')) {
    if (EXEMPT.has(file)) continue
    const counts = insertsWithoutOffice(readFileSync(file, 'utf8'), baseline.carriers)
    if (Object.keys(counts).length > 0) found[file] = counts
  }
  const { problems, converted, total } = compare(found, baseline.files)
  // A found-nothing check needs a control: the debt is real, so a scan that finds none is a scan that is broken.
  const baselineTotal = Object.values(baseline.files)
    .flatMap((c) => Object.values(c))
    .reduce((a, b) => a + b, 0)
  if (baselineTotal > 0 && total === 0) {
    problems.push(
      'the scan found no unconverted insert at all while the baseline lists some: the scan is broken',
    )
  }
  for (const p of problems) console.log(`FAIL ${p}`)
  for (const c of converted) {
    console.log(`FAIL converted, so take it off the list: ${c}`)
    failed = true
  }
  if (problems.length > 0) failed = true
  console.log(
    `${String(Object.keys(found).length)} script(s), ${String(total)} insert(s) into a carrier table with no office_id (baseline ${String(baselineTotal)}).`,
  )
  process.exit(failed ? 1 : 0)
}
