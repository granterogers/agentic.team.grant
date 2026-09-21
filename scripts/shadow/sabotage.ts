/**
 * False-green proofs — §14.
 *
 *   npm run shadow:sabotage
 *   npm run shadow:sabotage -- --only negation
 *
 * For each critical detector: break it on purpose, PROVE the break landed,
 * require the check to go red, restore, require it to go green, and verify
 * the file came back bit-identical.
 *
 * *"A green check that cannot be made red is not proved."*
 *
 * ## Why proving the sabotage landed is half the tool
 *
 * It is not ceremony. Twice in one session while building this harness a
 * sabotage silently failed to apply, and both times "the check did not fire"
 * read exactly like "the check works":
 *
 *   - a `python3 -c` one-liner turned every `\b` in a regex into a literal
 *     backspace, so the pattern matched nothing. That one would have
 *     recorded a SAFETY detector as proved when it had never been shown a
 *     defect.
 *   - a grep for a file that did not exist printed nothing, and nothing was
 *     read as "the credential was redacted".
 *
 * CLAUDE.md records the same shape independently. So every sabotage here
 * must state, in its own terms, evidence that it changed the file: the
 * anchor must appear exactly once before, and the replacement must appear
 * after. A sabotage that cannot prove it landed is reported as INCONCLUSIVE
 * and never as a pass.
 *
 * ## Restoration is verified, not assumed
 *
 * From a copy taken before the edit, compared byte for byte afterwards.
 * CLAUDE.md's oldest trap is `git checkout` on a file somebody was in the
 * middle of editing, and a sabotage tool that restored from git would be
 * that trap with a schedule.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

interface Sabotage {
  readonly name: string
  /** What property this proves is really being checked. */
  readonly proves: string
  readonly file: string
  /** Must appear EXACTLY ONCE, or the sabotage is inconclusive. */
  readonly anchor: string
  readonly replacement: string
  /** The test file that must go red. */
  readonly check: string
}

const SABOTAGES: readonly Sabotage[] = [
  {
    name: 'firewall-content',
    proves: 'hidden intent pasted into a message is detected',
    file: 'src/simulation/isolation.ts',
    anchor: '    if (haystack.includes(needle)) {',
    replacement: '    if (false && haystack.includes(needle)) {',
    check: 'tests/simulation/isolation.test.ts',
  },
  {
    name: 'firewall-shape',
    proves: 'a field riding along on the object that crosses is detected',
    file: 'src/simulation/isolation.ts',
    anchor: '    .filter((k) => !CROSSING_KEYS.includes(k))',
    replacement: '    .filter(() => false)',
    check: 'tests/simulation/isolation.test.ts',
  },
  {
    name: 'negation',
    proves: 'a typo may never respell a negation',
    file: 'src/simulation/roughen.ts',
    anchor:
      "  w.length < 5 || /\\d/.test(w) || NEVER_RESPELL.has(w.toLowerCase().replace(/[^a-z']/g, ''))",
    replacement: '  w.length < 5',
    check: 'tests/simulation/roughen.test.ts',
  },
  {
    name: 'decimal',
    proves: 'stripping punctuation may not reach inside a number',
    file: 'src/simulation/roughen.ts',
    anchor: "    .replace(/(?<!\\d)([.!?,;:])|([.!?,;:])(?!\\d)/g, '')",
    replacement: "    .replace(/([.!?,;:])/g, '')",
    check: 'tests/simulation/roughen.test.ts',
  },
  {
    name: 'hyphen',
    proves: 'a hyphen inside a word is not a dash and must survive',
    file: 'src/simulation/roughen.ts',
    // The literal characters, not the \\u escapes: biome normalises them in
    // the source, so an anchor written with escapes matches nothing - which
    // this tool correctly reported as INCONCLUSIVE rather than as a pass.
    anchor: "    .replace(/\\s+[\u2014\u2013-]+\\s+|[\u2014\u2013]+/g, ' ')",
    replacement: "    .replace(/\\s*[\u2014\u2013-]+\\s*/g, ' ')",
    check: 'tests/simulation/roughen.test.ts',
  },
  {
    name: 'withdrawal-recorded',
    proves: 'a composed change of mind always records what it withdrew',
    file: 'src/simulation/compose.ts',
    anchor: '      withdrawn: [...(other.intent.withdrawn ?? []), d.say],',
    replacement: '      withdrawn: [...(other.intent.withdrawn ?? [])],',
    check: 'tests/simulation/compose.test.ts',
  },
  {
    name: 'limit-survives-composition',
    proves: 'a stated limit binds the whole message however it is restructured',
    file: 'src/simulation/compose.ts',
    // Three functions merge forbids identically, so the bare line is not a
    // unique anchor, and the first attempt to disambiguate it INSERTED a key
    // above the real one - where the later key wins, so the edit landed
    // textually and did nothing. That is the subtler half of the same trap:
    // a sabotage can apply and still be inert. The anchor now REPLACES the
    // real line, identified by the comment above it.
    anchor:
      'over a generator that dropped them.\n      */\n      forbids: [...(d.intent.forbids ?? []), ...(other.intent.forbids ?? [])],',
    replacement: 'over a generator that dropped them.\n      */\n      forbids: [],',
    check: 'tests/simulation/compose.test.ts',
  },
  {
    name: 'arc-ordering',
    proves: 'a turn that needs history is never placed where there is none',
    file: 'src/simulation/compose.ts',
    anchor:
      "      (f.draft(world, new Seeded(1)).intent.turnsOn ?? 'comprehension') !== 'history',",
    replacement: '      true,',
    check: 'tests/simulation/arcs.test.ts',
  },

  /*
    The three canonical dimensions, added when they stopped being
    permanently `unreached` (#295). Each was proved by hand once; a proof
    run by hand once is not a proof that survives, so each lives here.
  */
  {
    name: 'canonical-claim-vs-record',
    proves: 'an answer claiming a task nobody filed is a hard failure',
    file: 'src/simulation/evaluate.ts',
    // Make the admission always true and the detector can never fire.
    /*
      The replacement must not CONTAIN the anchor: this file proves an edit
      landed with `includes(replacement) && !includes(anchor)`, so a
      replacement that keeps the anchor can never register, and the first
      version of this entry was reported INCONCLUSIVE - correctly, and
      about the sabotage rather than about the detector.
    */
    anchor: "  if (said.includes('?')) return true",
    replacement: '  if (true) return true',
    check: 'tests/simulation/evaluate-canonical.test.ts',
  },
  {
    name: 'canonical-effect-completeness',
    proves: 'every effect class has a canonical test, so none reports unreached by omission',
    file: 'src/simulation/evaluate.ts',
    anchor: '  delivery: (e) => e.deliveriesSent > 0,',
    replacement: '',
    check: 'tests/simulation/evaluate-canonical.test.ts',
  },
  {
    name: 'canonical-acted-unasked',
    proves: 'acting when nothing was asked for is caught, not only claiming falsely',
    file: 'src/simulation/evaluate.ts',
    anchor: "  if (want === 'none' && actedAtAll(e)) {",
    replacement: '  if (false) {',
    check: 'tests/simulation/evaluate-canonical.test.ts',
  },

  /*
    #291's reader and the property `context` now asserts. Added with the
    fix, because a detector proved once by hand is a detector nobody
    re-proves.
  */
  {
    name: 'retraction-read',
    proves: 'a clause withdrawn mid-message is seen as withdrawn',
    file: 'src/agents/retraction.ts',
    anchor: '  if (chosen === null) return null',
    replacement: '  if (chosen !== null) return null',
    check: 'tests/agents/retraction.test.ts',
  },
  {
    name: 'retraction-target',
    proves: 'a pivot that names its object withdraws only that object',
    file: 'src/agents/retraction.ts',
    anchor: '  if (target !== null) {',
    replacement: '  if (false) {',
    check: 'tests/agents/retraction.test.ts',
  },
  {
    name: 'retraction-not-a-pivot',
    proves: 'an instruction to remember is never read as a retraction',
    file: 'src/agents/retraction.ts',
    anchor: '    if (NOT_A_PIVOT.test(said.slice(0, m.index))) continue',
    replacement: '    if (false) continue',
    check: 'tests/agents/retraction.test.ts',
  },
]

const only = ((): string => {
  const i = process.argv.indexOf('--only')
  return i === -1 ? '' : (process.argv[i + 1] ?? '')
})()

const green = (test: string): boolean => {
  try {
    execFileSync('npx', ['vitest', 'run', test], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

type Outcome = 'proved' | 'INCONCLUSIVE' | 'NOT PROVED' | 'DIRTY'
const results: { name: string; outcome: Outcome; note: string }[] = []

console.log('\nFalse-green proofs\n')
console.log('  Each detector is shown a defect. A green check that cannot be made')
console.log('  red is not proved, and a sabotage that did not land is not a proof.\n')

for (const s of SABOTAGES) {
  if (only !== '' && !s.name.includes(only)) continue
  process.stdout.write(`  ${s.name.padEnd(30)}`)

  const original = readFileSync(s.file, 'utf8')
  const backup = `${s.file}.sabotage-backup`
  copyFileSync(s.file, backup)

  const occurrences = original.split(s.anchor).length - 1
  if (occurrences !== 1) {
    // The anchor drifted. Say so rather than reporting anything about the
    // detector, because nothing was learned about it either way.
    results.push({
      name: s.name,
      outcome: 'INCONCLUSIVE',
      note: `the anchor appears ${occurrences} times in ${s.file}, so nothing was changed`,
    })
    console.log('INCONCLUSIVE  anchor not found exactly once')
    execFileSync('rm', ['-f', backup])
    continue
  }

  writeFileSync(s.file, original.replace(s.anchor, s.replacement))

  // Evidence that the edit is really in the file, in the file's own terms.
  const after = readFileSync(s.file, 'utf8')
  const landed = after.includes(s.replacement) && !after.includes(s.anchor)
  if (!landed) {
    copyFileSync(backup, s.file)
    execFileSync('rm', ['-f', backup])
    results.push({ name: s.name, outcome: 'INCONCLUSIVE', note: 'the edit did not take' })
    console.log('INCONCLUSIVE  the edit did not take')
    continue
  }

  const stillGreen = green(s.check)

  copyFileSync(backup, s.file)
  execFileSync('rm', ['-f', backup])
  const restored = readFileSync(s.file, 'utf8') === original

  if (!restored) {
    results.push({ name: s.name, outcome: 'DIRTY', note: `${s.file} did not come back identical` })
    console.log('DIRTY         the file did not come back identical')
    continue
  }

  if (stillGreen) {
    results.push({
      name: s.name,
      outcome: 'NOT PROVED',
      note: `${s.check} stayed green with the defect in place`,
    })
    console.log('NOT PROVED    the check stayed green with the defect in place')
    continue
  }

  const greenAgain = green(s.check)
  if (!greenAgain) {
    results.push({
      name: s.name,
      outcome: 'DIRTY',
      note: `${s.check} is red after restoring - something else is wrong`,
    })
    console.log('DIRTY         red after restoring')
    continue
  }

  results.push({ name: s.name, outcome: 'proved', note: s.proves })
  console.log('proved        red with the defect, green without it')
}

console.log()
const bad = results.filter((r) => r.outcome !== 'proved')
if (bad.length === 0) {
  console.log(`  ${results.length} detectors proved. Each was shown a defect and each went red.\n`)
  process.exit(0)
}

console.log('  NOT PROVED\n')
for (const r of bad) console.log(`    ${r.name.padEnd(30)} ${r.outcome}  ${r.note}`)
console.log(`
  An INCONCLUSIVE result means the sabotage did not land - usually the code
  was refactored and the anchor moved. It says nothing about the detector,
  which is why it is not reported as a pass. Fix the anchor and run again.

  A NOT PROVED result is the serious one: the check stayed green while the
  thing it checks was broken.
`)
process.exit(1)
