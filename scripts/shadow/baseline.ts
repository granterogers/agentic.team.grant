/**
 * The behavioural baseline — §18.
 *
 *   npm run shadow:baseline                 # the default corpus, seed 1
 *   npm run shadow:baseline -- --seed 77    # a fresh seeded corpus
 *   npm run shadow:baseline -- --per 3      # more variants per family
 *   npm run shadow:baseline -- --family task.indirect
 *
 * It reports, and it fails nothing. §18's primary deliverable is *"the
 * trustworthy testing system and honest baseline"*, and a baseline that
 * exits non-zero is a gate — which would make somebody's first instinct to
 * get it green rather than to read it. Green is not the goal; §23 says so
 * in its first line.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { generateCorpus } from '../../src/simulation/compose.ts'
import { DIMENSIONS, type Dimension, rate, tally } from '../../src/simulation/dimensions.ts'
import { HELD_OUT_SEED } from '../../src/simulation/frozen.ts'
import { GOAL_FAMILIES } from '../../src/simulation/goals.ts'
import { runCorpus } from '../../src/simulation/run.ts'
import {
  canonicalDoor,
  comprehensionDoor,
  firstRunChecklist,
} from '../../src/simulation/transport.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}

/*
  The held-out corpus, which nobody has read.

  §13 and §18: a fix must be shown to work on scenarios it was not tuned
  against, and every finding in the first baseline came from seed 1. Passing
  --heldout runs the frozen seed instead, whose sentences have deliberately
  not been inspected.
*/
const heldOut = process.argv.includes('--heldout')
const seed = heldOut ? HELD_OUT_SEED : Number(arg('seed', '1'))
const per = Number(arg('per', '2'))
const only = arg('family', '')
const wantLive = process.argv.includes('--live')

const world = DEFAULT_WORLD
const all = generateCorpus(world, seed, per)
const corpus = only === '' ? all : all.filter((s) => s.family.includes(only))

const transport = wantLive
  ? canonicalDoor({ runToken: Math.random().toString(36).slice(2, 10) })
  : comprehensionDoor()

if (wantLive && !transport.reachable) {
  // Printed in full rather than summarised. This door writes to the
  // Supabase Grant's real office runs on and has never been exercised.
  console.log(`\n  ${transport.blockedBecause ?? 'unreachable'}`)
  if (!process.argv.includes('--i-have-checked-the-first-run')) console.log(firstRunChecklist())
}

console.log(`\nShadow Grant - behavioural baseline`)
console.log(
  `  door      ${transport.door}${transport.reachable ? '' : ` (UNREACHABLE: ${transport.blockedBecause ?? 'unknown'})`}`,
)
console.log(`  seed      ${seed}${heldOut ? '  (FROZEN HELD-OUT - not tuned against)' : ''}`)
console.log(
  `  corpus    ${corpus.length} scenarios across ${new Set(corpus.map((s) => s.family)).size} families`,
)
console.log(`  personas  ${[...new Set(corpus.map((s) => s.persona))].join(', ')}\n`)

const summary = await runCorpus(corpus, transport)

if (summary.leaks.length > 0) {
  // Printed first, alone, and the numbers are withheld. A run in which
  // hidden intent reached the office is not a run whose other figures mean
  // anything, and a summary that carried this in a footnote would be one
  // somebody quotes the headline from.
  console.log('HIDDEN INTENT LEAKED. No figures from this run are reportable.\n')
  for (const l of summary.leaks) console.log(`  ${l}`)
  process.exit(1)
}

if (summary.verdicts.length === 0) {
  console.log(`Nothing ran. ${summary.unrun[0]?.because ?? 'no reason recorded'}`)
  console.log(`\n${summary.unrun.length} scenarios could not be attempted.\n`)
  process.exit(0)
}

console.log('BY DIMENSION')
console.log('  Each kept apart. An average across these would hide the one that matters.\n')
for (const d of Object.keys(DIMENSIONS) as Dimension[]) {
  const t = tally(summary.verdicts, d)
  const r = rate(t)
  const pct = r === null ? '     -' : `${String(Math.round(r * 100)).padStart(4)}%`
  const note = r === null ? '  (nothing to divide by - not a score of zero)' : ''
  console.log(
    `  ${d.padEnd(14)} ${pct}   pass ${String(t.pass).padStart(3)}  fail ${String(t.fail).padStart(3)}  unreached ${String(t.unreached).padStart(3)}${note}`,
  )
}

console.log('\nHARD FAILURES')
const hard = summary.verdicts.flatMap((v) => v.hard.map((h) => ({ ...h, scenario: v.scenario })))
if (hard.length === 0) console.log('  none observed on this door\n')
else {
  const byKind = new Map<string, number>()
  for (const h of hard) byKind.set(h.failure, (byKind.get(h.failure) ?? 0) + 1)
  for (const [k, n] of byKind) console.log(`  ${k.padEnd(22)} ${n}`)
  console.log()
  for (const h of hard.slice(0, 5)) console.log(`  ${h.scenario}\n    ${h.detail}`)
  console.log()
}

console.log('WHERE IT FAILS, BY FAMILY')
console.log('  Families with no failure are omitted. A family is a defect class, not a sentence.\n')
const byFamily = new Map<string, { fail: number; total: number; why: Set<string> }>()
for (const v of summary.verdicts) {
  const e = byFamily.get(v.family) ?? { fail: 0, total: 0, why: new Set<string>() }
  e.total++
  for (const f of v.findings) {
    if (f.verdict === 'fail') {
      e.fail++
      e.why.add(`${f.dimension}: ${f.because}`)
    }
  }
  byFamily.set(v.family, e)
}
const failing = [...byFamily.entries()]
  .filter(([, e]) => e.fail > 0)
  .sort((a, b) => b[1].fail - a[1].fail)
for (const [family, e] of failing) {
  console.log(`  ${family}  (${e.fail} finding(s) over ${e.total} scenario(s))`)
  for (const w of [...e.why].slice(0, 2)) console.log(`      ${w}`)
}
if (failing.length === 0) console.log('  none\n')

console.log(
  `\n${summary.verdicts.length} turns, ${summary.modelCalls} model calls, ${(summary.ms / 1000).toFixed(1)}s`,
)
if (summary.unrun.length > 0)
  console.log(`${summary.unrun.length} scenarios could not be attempted.`)
console.log(`Families in the corpus: ${GOAL_FAMILIES.length}\n`)

mkdirSync('.out', { recursive: true })
const path = `.out/shadow-baseline-${transport.door}-${seed}.json`
writeFileSync(path, JSON.stringify({ seed, door: transport.door, summary }, null, 2))
console.log(`Full record: ${path}\n`)
