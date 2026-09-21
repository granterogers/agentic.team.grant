/**
 * How much of a baseline figure is the product, and how much is the draw — §19.
 *
 *   npm run shadow:variance
 *   npm run shadow:variance -- --runs 8
 *
 * §19: *"Do not quote reliability percentages from inadequate/noisy
 * samples."* The only way to know whether a sample is adequate is to run it
 * more than once, and this repository has already paid for not doing that:
 * CLAUDE.md records a routing suite scoring 56/56 and then 55/56 against
 * identical code, three days apart, both runs honest, with the cause an
 * undecided ORDER BY nobody had looked at.
 *
 * Nothing here is stochastic — every corpus is deterministic in its seed and
 * no model is called. The spread is entirely the DRAW: which persona each
 * family gets, which phrasing, whether a structural mutation fires. That is
 * real variation in the population of messages a person might send, which is
 * exactly what the harness is supposed to sample, and it means a single
 * seed's percentage is a sample statistic rather than a measurement.
 *
 * So the honest report is a range and a spread, and the spread is the number
 * that says how much weight a headline figure can carry.
 */

import { generateCorpus } from '../../src/simulation/compose.ts'
import { DIMENSIONS, type Dimension, rate, tally } from '../../src/simulation/dimensions.ts'
import { HELD_OUT_SEED } from '../../src/simulation/frozen.ts'
import { runCorpus } from '../../src/simulation/run.ts'
import { comprehensionDoor } from '../../src/simulation/transport.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

const i = process.argv.indexOf('--runs')
const runs = i === -1 ? 6 : Number(process.argv[i + 1] ?? '6')
const door = comprehensionDoor()

const seeds = [...Array(runs).keys()].map((n) => n + 1)
const collected = new Map<Dimension, number[]>()
const hard: number[] = []

console.log(`\nVariance across ${runs} seeds, comprehension door\n`)

for (const seed of seeds) {
  const summary = await runCorpus(generateCorpus(DEFAULT_WORLD, seed, 2), door)
  if (summary.leaks.length > 0) {
    console.log(`seed ${seed}: HIDDEN INTENT LEAKED - no figures reportable`)
    process.exit(1)
  }
  hard.push(summary.verdicts.reduce((n, v) => n + v.hard.length, 0))
  for (const d of Object.keys(DIMENSIONS) as Dimension[]) {
    const r = rate(tally(summary.verdicts, d))
    if (r !== null) collected.set(d, [...(collected.get(d) ?? []), r])
  }
}

const pct = (x: number): string => `${String(Math.round(x * 100)).padStart(3)}%`

console.log('  dimension        low   high  spread   median')
for (const [d, xs] of collected) {
  const sorted = [...xs].sort((a, b) => a - b)
  const low = sorted[0] ?? 0
  const high = sorted[sorted.length - 1] ?? 0
  const mid = sorted[Math.floor(sorted.length / 2)] ?? 0
  console.log(
    `  ${d.padEnd(15)} ${pct(low)}  ${pct(high)}   ${String(Math.round((high - low) * 100)).padStart(2)}pt    ${pct(mid)}`,
  )
}

const hardLow = Math.min(...hard)
const hardHigh = Math.max(...hard)
console.log(`\n  hard failures   ${hardLow} to ${hardHigh} per run`)

const widest = Math.max(...[...collected.values()].map((xs) => Math.max(...xs) - Math.min(...xs)))
console.log(`
WHAT THIS MEANS FOR A HEADLINE FIGURE

  The widest spread across these ${runs} runs is ${Math.round(widest * 100)} percentage points, on a corpus
  that is fully deterministic in its seed and calls no model. None of that is
  noise in the product - it is the draw: which persona each family gets, which
  phrasing, whether a structural mutation fires.

  So a single seed's percentage is a sample statistic, not a measurement. Any
  claim that a change improved things by less than ${Math.round(widest * 100)} points is a claim about
  which seed was run. Compare a change across the same seeds, or across enough
  of them, and report the range rather than the number.
`)

// The held-out seed, alongside, so it can be seen in context rather than
// mistaken for a result.
const held = await runCorpus(generateCorpus(DEFAULT_WORLD, HELD_OUT_SEED, 2), door)
console.log('  For comparison, the frozen held-out seed:')
for (const d of Object.keys(DIMENSIONS) as Dimension[]) {
  const r = rate(tally(held.verdicts, d))
  if (r === null) continue
  const xs = collected.get(d) ?? []
  const inRange = r >= Math.min(...xs) && r <= Math.max(...xs)
  console.log(
    `    ${d.padEnd(15)} ${pct(r)}  ${inRange ? 'within the development range' : 'OUTSIDE the development range - worth reading'}`,
  )
}
console.log()
