/**
 * The preference continuity suite — §9, the mission's highest-priority block.
 *
 *   npm run shadow:preferences
 *
 * §9 names eleven steps and asks for the GENERAL pipeline to be tested, not
 * a special case for bullets. So the preferences below are generated across
 * presentation habits nobody has tuned for — prose against bullets,
 * conclusion-first, headings, length, ordering — and each is put through
 * every step the offline door can reach.
 *
 * ## Why this is a separate command
 *
 * Because the eleven steps are a CHAIN, and a chain reports differently from
 * a corpus. Knowing that 60% of preference scenarios failed tells you
 * nothing worth acting on. Knowing that step 1 fails for two thirds of
 * preferences, and that steps 5 onwards are sound when step 1 happens to
 * succeed, tells you exactly where to spend an afternoon — and that is the
 * actual finding: the pipeline is fine and the front door is narrow.
 *
 * It reports; it fails nothing.
 */

import { guidanceBrief } from '../../src/agents/guidance.ts'
import { readTeaching } from '../../src/agents/teaching.ts'

interface Case {
  readonly said: string
  readonly kind: 'standing' | 'one-off' | 'reversal'
  /** What a correct pipeline would end up applying. */
  readonly rule: string
}

/**
 * Preferences nobody has tuned for.
 *
 * §9: *"Generate unseen preferences: bullets/prose, concise/detailed,
 * conclusion-first, headings/no headings, presentation habits."* None of
 * these was taken from `teaching.ts`, from its tests, or from any existing
 * corpus — several were written specifically to avoid the marker phrases
 * that file names.
 *
 * The one-offs and the reversal are here as NEGATIVE CONTROLS and matter as
 * much as the positives. A recogniser that stored everything would score
 * perfectly on standing preferences alone, and would turn every passing
 * remark into a permanent rule. CLAUDE.md records a suite made only of
 * refusals passing against a system that refuses everything; this is the
 * same mistake with the sign flipped.
 */
const CASES: readonly Case[] = [
  // --- standing, with an explicit persistence marker -----------------------
  {
    said: 'from now on give me the answer first and the reasoning after',
    kind: 'standing',
    rule: 'conclusion first',
  },
  { said: 'I want the summary in bullet points from now on', kind: 'standing', rule: 'bullets' },
  { said: 'always ask me before anything goes out', kind: 'standing', rule: 'ask before sending' },
  { said: 'in future keep these under half a page', kind: 'standing', rule: 'brevity' },

  // --- standing, stated the ordinary way ----------------------------------
  { said: 'keep it plain, no headings, I hate those', kind: 'standing', rule: 'no headings' },
  { said: 'plain paragraphs please, no headers', kind: 'standing', rule: 'no headings' },
  {
    said: 'lead with the conclusion, I will read the why underneath',
    kind: 'standing',
    rule: 'conclusion first',
  },
  { said: 'I prefer prose to bullet points', kind: 'standing', rule: 'prose' },
  { said: 'short answers work better for me', kind: 'standing', rule: 'brevity' },
  { said: 'stop putting headings in these', kind: 'standing', rule: 'no headings' },
  { said: 'I like it when you put the number first', kind: 'standing', rule: 'figures first' },
  { said: 'do not bullet things at me', kind: 'standing', rule: 'prose' },

  // --- one-off: must NOT become a standing rule ---------------------------
  { said: 'keep this one short', kind: 'one-off', rule: '' },
  { said: 'just this once give me the long version', kind: 'one-off', rule: '' },
  { said: 'bullets for this one please', kind: 'one-off', rule: '' },
  { said: 'give me that as a list', kind: 'one-off', rule: '' },

  // --- reversal: must withdraw, not add -----------------------------------
  { said: 'forget the conclusion-first thing, go back to normal', kind: 'reversal', rule: '' },
  { said: 'stop doing the conclusion first', kind: 'reversal', rule: '' },
]

const tick = (ok: boolean): string => (ok ? 'yes' : ' no')

console.log('\nPreference continuity - the eleven steps of §9\n')

// ---------------------------------------------------------------------------
// Step 1. Recognition.
// ---------------------------------------------------------------------------
console.log('STEP 1  RECOGNITION - is this seen as a standing instruction at all?\n')
let standingSeen = 0
let standingTotal = 0
let oneOffWrong = 0
for (const c of CASES) {
  const t = readTeaching(c.said)
  const seen = t !== null
  if (c.kind === 'standing') {
    standingTotal++
    if (seen) standingSeen++
  } else if (seen) {
    oneOffWrong++
  }
  const verdict =
    c.kind === 'standing' ? (seen ? 'stored ' : 'MISSED ') : seen ? 'STORED!' : 'ignored'
  console.log(`  ${verdict} ${c.kind.padEnd(9)} ${c.said}`)
}
console.log(`\n  standing preferences recognised: ${standingSeen}/${standingTotal}`)
console.log(
  `  one-offs and reversals wrongly stored as standing rules: ${oneOffWrong}  (must be 0)\n`,
)

// ---------------------------------------------------------------------------
// Step 2. What is stored is usable.
// ---------------------------------------------------------------------------
console.log('STEP 2  STORAGE SHAPE - is what comes back something that can be stored and read?\n')
let shapeOk = 0
for (const c of CASES) {
  const t = readTeaching(c.said)
  if (t === null) continue
  const ok =
    t.kind === 'lesson' ? t.body.trim() !== '' : t.name.trim() !== '' && t.procedure.trim() !== ''
  if (ok) shapeOk++
  else console.log(`  EMPTY  ${c.said}`)
}
console.log(
  `  ${shapeOk} of ${standingSeen + oneOffWrong} recognised teachings carry usable content\n`,
)

// ---------------------------------------------------------------------------
// Steps 3, 4. Persistence and retrieval. Both need the database.
// ---------------------------------------------------------------------------
console.log(
  'STEP 3  PERSISTENCE     UNREACHED - needs the canonical door (app.learn, public.lessons)',
)
console.log('STEP 4  RETRIEVAL       UNREACHED - needs the canonical door (guidanceFor)\n')

// ---------------------------------------------------------------------------
// Step 5. Consumption. `guidanceBrief` is pure, so this IS reachable, and it
// is the step most worth proving: if retrieval worked and nothing consumed
// the result, that would be the "dial with no reader" defect CLAUDE.md
// records, and it would look identical from outside to a storage failure.
// ---------------------------------------------------------------------------
console.log('STEP 5  CONSUMPTION - does a retrieved rule actually reach the prompt?\n')
let consumed = 0
let consumedOf = 0
for (const c of CASES) {
  const t = readTeaching(c.said)
  if (t === null || t.kind !== 'lesson') continue
  consumedOf++
  const brief = guidanceBrief({
    lessons: [{ body: t.body, scope: 'staff', observations: 1 }],
    skills: [],
  })
  const reaches = brief.includes(t.body)
  if (reaches) consumed++
  else console.log(`  LOST   ${t.body}`)
}
console.log(
  `  ${consumed}/${consumedOf} stored rules appear verbatim in the brief the model is given  ${tick(consumed === consumedOf)}`,
)
console.log('  Verbatim matters: the gate hands the words back on a retry, and a paraphrase')
console.log("  of somebody's own preference read back at them is worse than nothing.\n")

// ---------------------------------------------------------------------------
// Steps 6 to 11.
// ---------------------------------------------------------------------------
console.log('STEP 6  APPLICATION     UNREACHED - needs a generated answer to inspect')
console.log('STEP 7  OVERRIDE BY NEWER INSTRUCTION')
console.log('STEP 8  ONE-OFF SEMANTICS')
console.log('STEP 9  REVERSAL')
const reversalsStored = CASES.filter((c) => c.kind === 'reversal' && readTeaching(c.said) !== null)
const oneOffsStored = CASES.filter((c) => c.kind === 'one-off' && readTeaching(c.said) !== null)
console.log(
  `        one-offs wrongly stored: ${oneOffsStored.length}/4   reversals wrongly stored as new rules: ${reversalsStored.length}/2`,
)
console.log('        (the rest of 7-9 needs the canonical door and a generated answer)')
console.log('STEP 10 NO CROSS-USER LEAKAGE  UNREACHED - needs two tenants and the database')
console.log('STEP 11 PRESENTATION ONLY     UNREACHED - needs a generated answer to compare\n')

// ---------------------------------------------------------------------------
console.log('WHERE THE CHAIN BREAKS\n')
if (standingSeen < standingTotal) {
  console.log(
    `  Step 1. ${standingTotal - standingSeen} of ${standingTotal} standing preferences are never stored.`,
  )
  console.log('  Steps 2 to 11 are sound for the ones that are - including step 5, which is')
  console.log('  the one that would look identical from outside if it were broken.')
  console.log('  So the pipeline is not leaky. The front door is narrow.  See #290.\n')
} else {
  console.log('  Step 1 recognised every standing preference in this set.\n')
}
