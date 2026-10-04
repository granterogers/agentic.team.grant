/**
 * Fingerprint every office with Grant's and the Sample's named explicitly, and compare two takes. Read only.
 *   npm run sample:fingerprint -- take <label>          writes .out/fp-<label>.json
 *   npm run sample:fingerprint -- diff <before> <after>  prints GRANT, SAMPLE and FOREIGN (the other 23) separately
 *
 * `otherOffices` (fingerprint.ts) digests every office EXCEPT the one it is given, so Grant is taken from a second call that
 * excludes the Sample. A report that says "24 other offices unchanged" does not say which one is Grant's; this does.
 * The all-states task digest differs after any Sample reset that had job-made tasks to remove (they are cancelled, not deleted);
 * `npm run sample:status` is the proof of semantic equivalence for the Sample, this is the right proof for Grant and the rest.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { diffFingerprints, otherOffices } from './fingerprint.ts'

const GRANT = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const SAMPLE = '205669cc-c270-4f11-ad63-b7ac4f994340'
const [mode, a, b] = process.argv.slice(2)
type Take = Record<string, Record<string, string> | undefined>

if (mode === 'take' && a !== undefined) {
  mkdirSync('.out', { recursive: true })
  const notGrant = await otherOffices(GRANT)
  const notSample = await otherOffices(SAMPLE)
  const all: Take = { ...notGrant, [GRANT]: notSample[GRANT] }
  writeFileSync(`.out/fp-${a}.json`, JSON.stringify(all))
  console.log(
    `fingerprinted ${Object.keys(all).length} offices (Grant and Sample named) -> .out/fp-${a}.json`,
  )
} else if (mode === 'diff' && a !== undefined && b !== undefined) {
  const x = JSON.parse(readFileSync(`.out/fp-${a}.json`, 'utf8')) as Take
  const y = JSON.parse(readFileSync(`.out/fp-${b}.json`, 'utf8')) as Take
  for (const [name, id] of [
    ['GRANT', GRANT],
    ['SAMPLE', SAMPLE],
  ] as const)
    console.log(
      name,
      JSON.stringify(diffFingerprints({ [id]: x[id] } as never, { [id]: y[id] } as never)),
    )
  const rest = (o: Take) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== GRANT && k !== SAMPLE))
  console.log(
    `FOREIGN (${Object.keys(rest(x)).length} offices)`,
    JSON.stringify(diffFingerprints(rest(x) as never, rest(y) as never)),
  )
} else {
  console.log('usage: sample:fingerprint -- take <label> | diff <before> <after>')
  process.exitCode = 1
}
