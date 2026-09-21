/**
 * The live representative matrix — a deliberately diverse handful of
 * families, run against the real office one scenario at a time.
 *
 *   npm run shadow:matrix
 *   npm run shadow:matrix -- --seed 77
 *
 * ## Why this is a script and not a shell loop
 *
 * The first version was a bash loop that ran the baseline once per family
 * and copied `.out/…json`. When a run timed out nothing was written, the
 * copy took the PREVIOUS family's file, and the report cheerfully printed
 * one family's result under another family's heading. A stale artifact
 * read as a fresh result, which is the found-nothing shape wearing a
 * different hat.
 *
 * One process, one pass, results held in memory and each keyed to the
 * scenario that produced it. A family that could not run says so.
 *
 * ## What it covers, and why these
 *
 * The brief names the areas. One family each, chosen so that a green here
 * means something different in each row: no-action, deterministic action,
 * referent resolution, correction, cancellation, approval boundaries,
 * specialist routing, preference persistence, truthful narration under no
 * results, and recovery from a specialist failure.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { generateCorpus } from '../../src/simulation/compose.ts'
import type { Verdicts } from '../../src/simulation/dimensions.ts'
import { DIMENSIONS, type Dimension, rate, tally } from '../../src/simulation/dimensions.ts'
import { runCorpus } from '../../src/simulation/run.ts'
import { canonicalDoor, comprehensionDoor } from '../../src/simulation/transport.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}

/** One family per area the brief names. A green means a different thing in each. */
export const MATRIX: readonly { readonly family: string; readonly covers: string }[] = [
  { family: 'noaction.acknowledgement', covers: 'no action - nothing may be created' },
  { family: 'noaction.pure-question', covers: 'a question, answered, nothing written' },
  { family: 'task.explicit', covers: 'deterministic action - a task must exist' },
  { family: 'task.indirect', covers: 'the same, asked indirectly' },
  { family: 'project.lookup', covers: 'referent resolution by name' },
  { family: 'project.by-nickname', covers: 'referent resolution by a name Grant taught' },
  { family: 'noaction.cancelled-outright', covers: 'cancellation - the whole message withdraws' },
  { family: 'multi.partial-cancel', covers: 'correction - one clause withdrawn, one kept' },
  { family: 'approval.write-under-review', covers: 'approval boundary - it must stop and ask' },
  { family: 'specialist.appropriate', covers: 'specialist routing' },
  { family: 'specialist.failure', covers: 'recovery when a specialist cannot' },
  { family: 'preference.establish', covers: 'preference persistence' },
  { family: 'preference.applied-later', covers: 'preference application, later' },
  { family: 'knowledge.no-result', covers: 'truthful narration when there is nothing' },
  { family: 'knowledge.grounded', covers: 'truthful narration when there is something' },
]

const seed = Number(arg('seed', '1'))
/*
  A slice, because the whole matrix live is about twenty minutes and this
  repository does not background work: CLAUDE.md says to split a run that
  cannot finish inside ten minutes rather than hide it. --from and --count
  select a window of MATRIX, so four calls cover it and each one prints.
*/
const from = Number(arg('from', '0'))
const count = Number(arg('count', String(MATRIX.length)))
const rows = MATRIX.slice(from, from + count)
const live = !process.argv.includes('--offline')

const transport = live
  ? canonicalDoor({ runToken: Math.random().toString(36).slice(2, 10) })
  : comprehensionDoor()

if (live && !transport.reachable) {
  console.log(`\n  ${transport.blockedBecause ?? 'unreachable'}\n`)
  process.exit(0)
}

const all = generateCorpus(DEFAULT_WORLD, seed, 1)

console.log(`\nShadow Grant - the live representative matrix`)
console.log(`  door    ${transport.door}`)
console.log(`  seed    ${seed}`)
console.log(`  rows    ${String(rows.length)} of ${String(MATRIX.length)} (from ${String(from)})\n`)

const verdicts: Verdicts[] = []
const couldNot: { family: string; because: string }[] = []

const mark = (v: string): string => ({ pass: 'P', fail: 'F', unreached: '-' })[v] ?? '?'

for (const row of rows) {
  const corpus = all.filter((s) => s.family === row.family)
  if (corpus.length === 0) {
    couldNot.push({ family: row.family, because: 'no scenario generated for this family' })
    console.log(`  ${row.family.padEnd(30)} NOT GENERATED`)
    continue
  }

  let summary: Awaited<ReturnType<typeof runCorpus>>
  try {
    summary = await runCorpus(corpus, transport)
  } catch (error) {
    // A family that could not run SAYS SO, rather than inheriting the
    // previous row's numbers, which is what the shell version did.
    couldNot.push({ family: row.family, because: String((error as Error).message).slice(0, 160) })
    console.log(
      `  ${row.family.padEnd(30)} COULD NOT RUN - ${String((error as Error).message).slice(0, 70)}`,
    )
    continue
  }

  if (summary.leaks.length > 0) {
    console.log('\nHIDDEN INTENT LEAKED. No figures from this run are reportable.\n')
    for (const l of summary.leaks) console.log(`  ${l}`)
    process.exit(1)
  }

  for (const v of summary.verdicts) {
    verdicts.push(v)
    const by = new Map(v.findings.map((f) => [f.dimension, f.verdict]))
    const line = (Object.keys(DIMENSIONS) as Dimension[])
      .map((d) => `${d.slice(0, 4)}:${mark(by.get(d) ?? 'unreached')}`)
      .join(' ')
    const hard = v.hard.length === 0 ? '' : `  HARD=${v.hard.map((h) => h.failure).join(',')}`
    console.log(`  ${row.family.padEnd(30)} ${line}${hard}`)
    for (const f of v.findings)
      if (f.verdict === 'fail') console.log(`      ${f.dimension}: ${f.because.slice(0, 110)}`)
  }
  for (const u of summary.unrun) couldNot.push({ family: row.family, because: u.because })
}

console.log('\nBY DIMENSION')
for (const d of Object.keys(DIMENSIONS) as Dimension[]) {
  const t = tally(verdicts, d)
  const r = rate(t)
  const pct = r === null ? '     -' : `${String(Math.round(r * 100)).padStart(4)}%`
  console.log(
    `  ${d.padEnd(14)} ${pct}   pass ${String(t.pass).padStart(3)}  fail ${String(t.fail).padStart(3)}  unreached ${String(t.unreached).padStart(3)}`,
  )
}

const hard = verdicts.flatMap((v) => v.hard.map((h) => ({ ...h, scenario: v.scenario })))
console.log('\nHARD FAILURES')
if (hard.length === 0) console.log('  none')
else for (const h of hard) console.log(`  ${h.failure}\n    ${h.scenario}\n    ${h.detail}`)

if (couldNot.length > 0) {
  console.log('\nCOULD NOT BE RUN')
  for (const c of couldNot) console.log(`  ${c.family}: ${c.because}`)
}

console.log(`\n${String(verdicts.length)} turns across ${String(rows.length)} areas\n`)

mkdirSync('.out', { recursive: true })
writeFileSync(
  `.out/shadow-matrix-${transport.door}-${String(seed)}-${String(from)}.json`,
  JSON.stringify({ seed, door: transport.door, verdicts, couldNot }, null, 2),
)
console.log(`Full record: .out/shadow-matrix-${transport.door}-${String(seed)}.json\n`)
