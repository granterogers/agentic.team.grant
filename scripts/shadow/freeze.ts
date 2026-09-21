/**
 * Take or check the held-out corpus fingerprint — §13.
 *
 *   npm run shadow:freeze            # print the current fingerprint
 *   npm run shadow:freeze -- --check # compare against the recorded one
 *
 * A mismatch is not a failure. It says the generator changed, so any number
 * from before it is no longer comparable with any number from after it.
 */

import { FROZEN, fingerprint, HELD_OUT_SEED } from '../../src/simulation/frozen.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'
import { RECORDED_FINGERPRINT } from './frozen-fingerprint.ts'

const now = fingerprint(DEFAULT_WORLD, HELD_OUT_SEED, FROZEN.perFamily)
const checking = process.argv.includes('--check')

console.log(`\nHeld-out corpus`)
console.log(`  seed         ${HELD_OUT_SEED}`)
console.log(`  frozen       ${FROZEN.at} against ${FROZEN.against}`)
console.log(`  personas     ${FROZEN.personas.join(', ')}`)
console.log(`  recorded     ${RECORDED_FINGERPRINT}`)
console.log(`  now          ${now}`)

if (!checking) {
  console.log(
    `\n${now === RECORDED_FINGERPRINT ? 'Unchanged.' : 'CHANGED - see below.'}  Paste into scripts/shadow/frozen-fingerprint.ts to re-freeze.\n`,
  )
  process.exit(0)
}

if (now === RECORDED_FINGERPRINT) {
  console.log('\nUnchanged. Numbers from before and after this point are comparable.\n')
  process.exit(0)
}

console.log(`
The generator no longer produces the corpus this fingerprint was taken from.

That is not a defect and it is not a failure. It means one of the families,
personas, mutation operators or the world changed - all of which are
legitimate - and that any baseline recorded before this point cannot be
compared with one recorded after it. Two runs across this line are two
instruments.

What to do:

  1. Say in the commit what changed and why.
  2. Re-record the baseline. Do not carry the old percentages forward.
  3. Update RECORDED_FINGERPRINT in scripts/shadow/frozen-fingerprint.ts.

What NOT to do: adjust an expectation so the fingerprint comes back. The
fingerprint covers the recorded intents as well as the sentences, precisely
so that quietly changing what a scenario expects is visible here.
`)
process.exit(1)
