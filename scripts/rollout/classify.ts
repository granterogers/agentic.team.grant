/**
 * Classify a step as IMPROVED, UNCHANGED, WORSE or AMBIGUOUS by the approved rules (scripts/rollout/classify-lib.ts). Offline: it
 * reads the canary log and two `m1_edge` captures and sends nothing.
 *
 *   npx tsx scripts/rollout/classify.ts --before=<B1>,<B2> --after=<A1>,<A2> --edge-before=<file> --edge-after=<file>
 *
 * Each of B1, B2, A1, A2 is the start of a reading's ISO timestamp in .out/rollout/gate-log.jsonl (for example 2026-10-06T14:02),
 * and each reading was taken with `gate.ts read --counters`. The edge files are the `m1_edge` captures written by
 * `npm run forensics:logs -- --set=m1_edge --start=<B1> --end=<B2>` (and the same for A1 to A2), under .out/forensics/logs/.
 * A missing edge file is "unavailable" and the verdict is AMBIGUOUS, never a pass.
 */
import { readFileSync } from 'node:fs'
import { classify, edgeSummary } from './classify-lib.ts'
import type { Reading } from './gate-lib.ts'
import { GATE_LOG, readLines } from './log.ts'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const pair = (n: string): [Reading, Reading] => {
  const parts = (arg(n) ?? '').split(',')
  const log = readLines<Reading>(GATE_LOG)
  const pick = (p: string): Reading => {
    const hit = log.filter((r) => p !== '' && r.at.startsWith(p))
    if (hit.length !== 1) {
      console.error(
        `--${n}: "${p}" matches ${hit.length} readings in ${GATE_LOG} (it must match exactly one)`,
      )
      process.exit(2)
    }
    return hit[0] as Reading
  }
  if (parts.length !== 2) {
    console.error(`--${n} needs two comma-separated reading timestamps`)
    process.exit(2)
  }
  return [pick(parts[0] as string), pick(parts[1] as string)]
}
const edge = (n: string) => {
  const f = arg(n)
  if (f === undefined) return null
  try {
    return edgeSummary(JSON.parse(readFileSync(f, 'utf8')))
  } catch {
    return null
  }
}

const [b1, b2] = pair('before')
const [a1, a2] = pair('after')
const result = classify({ a: b1, b: b2 }, { a: a1, b: a2 }, edge('edge-before'), edge('edge-after'))
console.log(`VERDICT: ${result.verdict}`)
for (const [k, v] of Object.entries(result.numbers)) console.log(`  ${k}: ${v}`)
for (const r of result.reasons) console.log(`  - ${r}`)
process.exit(result.verdict === 'WORSE' ? 1 : 0)
