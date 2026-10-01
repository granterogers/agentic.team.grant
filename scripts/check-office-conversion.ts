/**
 * P3 ratchet: an externally reachable function that touches owned tables must be classified.
 * Fails when a LEGACY_UNSCOPED function appears that the committed manifest does not list
 * (a new unclassified door), or when a function the manifest calls converted regressed.
 * Shrinking the legacy set is the goal; it may never grow.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const out = `${tmpdir()}/p3-live-manifest.json`
execFileSync('npx', ['tsx', 'scripts/p3/inventory.ts', '--manifest', out], { stdio: 'ignore' })
type M = { functions: Record<string, { class: string }> }
const live = (JSON.parse(readFileSync(out, 'utf8')) as M).functions
const base = (JSON.parse(readFileSync('docs/multi-user/conversion-manifest.json', 'utf8')) as M)
  .functions
const bad: string[] = []
for (const [fn, e] of Object.entries(live)) {
  if (e.class !== 'LEGACY_UNSCOPED') continue
  if (!base[fn]) bad.push(`${fn}: new office-sensitive function with no manifest entry`)
  else if (base[fn].class !== 'LEGACY_UNSCOPED')
    bad.push(`${fn}: was ${base[fn].class}, now LEGACY_UNSCOPED`)
}
const legacy = Object.values(live).filter((e) => e.class === 'LEGACY_UNSCOPED').length
const was = Object.values(base).filter((e) => e.class === 'LEGACY_UNSCOPED').length
console.log(`legacy-unscoped: ${legacy} (manifest ${was})`)
if (bad.length) {
  for (const b of bad) console.error(`FAIL ${b}`)
  process.exit(1)
}
console.log('check:office-conversion OK')
