/**
 * A smart quote defeated every coherence gate in the building (#237).
 *
 * Found by re-running `out-of-bounds`, whose second turn is a calendar write
 * the office cannot perform. The job **completed** — Grant was told it was
 * done — and the answer was:
 *
 *     I’ve added an all-day “Second-round interviews” event on the 11th to
 *     your calendar.
 *
 * The same sentence with a STRAIGHT apostrophe is caught by
 * `claimsToHaveMade`. With U+2019 it is not, because the pattern is
 * `I(?:'ve|\s+have)?` and a model emits the curly one. So the first-person
 * half of that gate — the most important shape it has — has been silently
 * inert on the office's real output for its whole life. Everything it ever
 * caught was caught by the noun-first pattern, which happens to need no
 * apostrophe.
 *
 * ## It was never one function
 *
 * `claimsGrantSaid` has `that's`. `claimsToHaveSent` and `claimsToHaveRead`
 * have `I've`. `promisesToReachOut` has `I'll`. The honest-absence reader has
 * `can't` and `haven't`. The deliberation detector has `we'll` and `let's`.
 * Every one of them, all along.
 *
 * So the fix is `straighten()`, applied once at the top of each detector,
 * rather than a repaired character class in ten regexes — which would leave
 * the eleventh, written next month, with the same hole.
 *
 * CLAUDE.md calls this the ninth instance of the trap. The session harness's
 * `plain()` exists for exactly it. This is the same fix in the file where it
 * is a SAFETY gate rather than a score, and where being wrong means Grant is
 * told a calendar entry exists that does not.
 */
import { describe, expect, it } from 'vitest'
import {
  claimsGrantSaid,
  claimsToHaveMade,
  claimsToHaveRead,
  claimsToHaveSent,
  straighten,
} from '../../src/agents/quality.ts'

/** U+2019, which is what a model actually emits. */
const C = '’'

describe('#237 — the gates read the office, not a tidied version of it', () => {
  it('catches the calendar entry that was delivered to Grant', () => {
    expect(
      claimsToHaveMade(
        `I${C}ve added an all-day “Second-round interviews” event on the 11th to your calendar.`,
      ),
    ).not.toBeNull()
  })

  it('every first-person gate sees a curly apostrophe', () => {
    expect(claimsToHaveMade(`I${C}ve created a task to chase the printers.`)).not.toBeNull()
    expect(claimsToHaveSent(`I${C}ve posted a message to the team on Slack.`)).not.toBeNull()
    expect(claimsToHaveRead(`I${C}ve pulled the project records.`)).not.toBeNull()
    expect(claimsGrantSaid(`That${C}s the figure you gave me last week.`)).not.toBeNull()
  })

  it('CONTROL: the straight-quote forms still work', () => {
    // The fix must not trade one encoding for the other.
    expect(claimsToHaveMade("I've created a task to chase the printers.")).not.toBeNull()
    expect(claimsToHaveSent("I've posted a message to the team on Slack.")).not.toBeNull()
  })

  it('CONTROL: plans, questions and denials stay quiet in BOTH encodings', () => {
    for (const q of ["'", C]) {
      expect(claimsToHaveMade(`I${q}ll create a task once you confirm.`), q).toBeNull()
      expect(claimsToHaveSent(`Shall I ask the team? I can${q}t send mail.`), q).toBeNull()
    }
    expect(claimsGrantSaid('I have no record of your instructions.')).toBeNull()
  })

  it('straighten leaves ordinary text alone', () => {
    // A normaliser that rewrites more than it should would corrupt the phrase
    // these functions hand back to a person.
    expect(straighten('plain text, unchanged')).toBe('plain text, unchanged')
    expect(straighten(`don${C}t`)).toBe("don't")
    expect(straighten('“quoted”')).toBe('"quoted"')
    expect(straighten('non‑breaking')).toBe('non-breaking')
  })
})
