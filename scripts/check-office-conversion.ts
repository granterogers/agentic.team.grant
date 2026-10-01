/**
 * P3 ratchet: an externally reachable function that touches owned tables must be classified.
 * Fails when a LEGACY_UNSCOPED function appears that the committed manifest does not list
 * (a new unclassified door), or when a function the manifest calls converted regressed.
 * Shrinking the legacy set is the goal; it may never grow.
 *
 * A function the inventory finds reachable only from the worker can leave the debt by a REVIEWED OVERRIDE in
 * docs/multi-user/conversion-overrides.json: a class (OFFICE_TRUSTED_DERIVED, GLOBAL or SYSTEM), a reason, and the exact
 * title of the attack case in scripts/isolated/p3-cases/ that proves it. This fails when
 *   - an override names a proof that no case file contains (a claim with nothing behind it),
 *   - an override names a function that is executable by a browser role (anon, authenticated, public), or that no longer exists.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const out = `${tmpdir()}/p3-live-manifest.json`
const problemsFile = `${tmpdir()}/p3-live-override-problems.json`
execFileSync(
  'npx',
  ['tsx', 'scripts/p3/inventory.ts', '--manifest', out, '--problems', problemsFile],
  {
    stdio: 'ignore',
  },
)
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

// ---- the reviewed overrides: every one names a proof that exists --------------------------------------------------------
type Override = { class: string; reason: string; proof: string }
const overrides = JSON.parse(
  readFileSync('docs/multi-user/conversion-overrides.json', 'utf8'),
) as Record<string, Override>
const caseDir = 'scripts/isolated/p3-cases'
const caseText = readdirSync(caseDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(`${caseDir}/${f}`, 'utf8'))
  .join('\n')
/** The title must appear as a string literal in a case file: a mention in a comment proves nothing. */
export const hasProof = (text: string, title: string): boolean =>
  ["'", '"', '`'].some((q) => text.includes(`${q}${title}${q}`))
for (const [fn, o] of Object.entries(overrides))
  if (!hasProof(caseText, o.proof))
    bad.push(`${fn}: the override names a proof no case file contains: "${o.proof}"`)
for (const p of JSON.parse(readFileSync(problemsFile, 'utf8')) as string[]) bad.push(p)

const legacy = Object.values(live).filter((e) => e.class === 'LEGACY_UNSCOPED').length
const was = Object.values(base).filter((e) => e.class === 'LEGACY_UNSCOPED').length
console.log(
  `legacy-unscoped: ${legacy} (manifest ${was}); reviewed overrides: ${Object.keys(overrides).length}`,
)
if (bad.length) {
  for (const b of bad) console.error(`FAIL ${b}`)
  process.exit(1)
}
console.log('check:office-conversion OK')
