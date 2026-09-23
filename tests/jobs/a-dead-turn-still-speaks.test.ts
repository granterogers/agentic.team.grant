/**
 * He sent a 17-second voice note and heard nothing, ever.
 *
 * 8 September, 08:02, his real Telegram chat. The transcription path threw,
 * the job retried to attempt 4 of 5, moved to `failed`, and
 * `public.deliveries` for it holds zero rows. The crash is long fixed; the
 * SILENCE was the general case, and every terminal failure in `worker.ts`
 * still ended `moveTo(job, 'failed')` and returned.
 *
 * These assert PROPERTIES of the sentence rather than its words. CLAUDE.md
 * records six occasions where a literal-string assertion became a wording
 * lock and went red over a correct rewrite, so nothing here matches a phrase
 * the sentence happens to use today.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { capabilityLies } from '../../src/agents/capability-claims.ts'
import { apology } from '../../src/jobs/lastword.ts'

describe('what the office says when a turn of his died', () => {
  it('says the attempt failed, and never that it cannot', () => {
    /*
      #320's invariant, which is the whole reason this sentence is composed in
      code rather than asked of a model: *cannot perform* / *needs something* /
      *this attempt failed* / *done* must not collapse into one refusal. The
      office CAN answer him. This try did not finish.
    */
    for (const spoken of [true, false]) {
      const said = apology(spoken)
      expect(said).toMatch(/not something I am unable to do|did not finish/i)
      // The denial shapes, none of which may appear.
      expect(said).not.toMatch(/\bI (can'?t|cannot|am not able to)\b/i)
      expect(said).not.toMatch(/\bnot (capable|possible)\b/i)
    }
  })

  /*
    The office's own instrument, pointed at the sentence. `capabilityLies` is
    what #320 added to catch the office denying something it can do, so a
    sentence that tripped it would be this fix reintroducing the very defect
    it repairs.

    IT IS GIVEN A REAL CAPABILITY, and the first draft was not. With
    `EMPTY_CAPABILITY` there is nothing to lie about, so the check could never
    fail - it stayed green under a sabotage that made the apology say "I
    cannot do" outright. That is CLAUDE.md's vacuous control, written into the
    test guarding against it. The pair below is what makes it a control: the
    real sentence must pass AND a denial of the same capability must fail.
  */
  const ABLE = {
    can: [
      {
        inReply: true,
        tool: 'artifact.report',
        verbs: ['write', 'produce'],
        what: 'write a PDF report',
      },
    ],
    cannot: [],
    declined: [],
    mustAsk: [],
    reach: [],
  }

  it('CONTROL: the office’s own false-capability detector stays quiet on it', () => {
    for (const spoken of [true, false]) {
      expect(capabilityLies(apology(spoken), ABLE)).toHaveLength(0)
    }
  })

  it('CONTROL: and that detector DOES fire on a denial of the same thing', () => {
    // Without this line the one above proves only that the instrument is
    // silent, which an instrument that is always silent also satisfies.
    expect(capabilityLies('I cannot write a PDF report for you.', ABLE).length).toBeGreaterThan(0)
  })

  it('tells him what to do next, in one move', () => {
    // An apology with no next step is a notification, and he asked for the
    // office to be usable from his phone rather than legible from it.
    expect(apology(false)).toMatch(/again/i)
  })

  it('knows a spoken message from a typed one', () => {
    /*
      Not decoration. Silence on a voice note is indistinguishable from never
      having been heard, which is why `lastWord` spends a query on
      `voice_file_id` — and the two sentences must therefore actually differ.
    */
    expect(apology(true)).not.toBe(apology(false))
    expect(apology(true)).toMatch(/sent/i)
  })

  it('carries nothing written for a machine', () => {
    /*
      A message is for a person and a comment is for a machine. The internal
      reason for these deaths is "incoherent output metadata: body"; putting
      that on his phone is the issue-number defect, where #242 reached seven
      real outputs because a gate's refusal was composed for a model.
    */
    for (const spoken of [true, false]) {
      const said = apology(spoken)
      expect(said).not.toMatch(/#\d+|§\d+/)
      expect(said).not.toMatch(/metadata|job|state|attempt \d|null|undefined/i)
    }
  })

  it('is short enough to read on a phone', () => {
    // He reads this on Telegram, having already waited for an answer that
    // never came. A paragraph of contrition is a second imposition.
    expect(apology(false).length).toBeLessThan(260)
  })
})

/**
 * And it is actually CALLED.
 *
 * CLAUDE.md records three vacuous controls in one session, all of the same
 * shape: a test asserting `source.toContain('lastWord')` stays green when the
 * call is replaced by nothing, because the import still names the function.
 * What discriminates is the WIRED expression, so these match the call with its
 * arguments bound and the branch it sits in.
 */
describe('the seam', () => {
  const worker = readFileSync('src/jobs/worker.ts', 'utf8')

  it('speaks from the one place every terminal failure arrives', () => {
    expect(worker).toMatch(/await lastWord\(db, job, options\.notify\)/)
  })

  it('speaks only for a death, never for a retry', () => {
    /*
      Bounded at BOTH ends. CLAUDE.md's slice trap: a window opened at one
      anchor and left to run on was satisfied by a neighbouring function that
      happened to contain the words, so a gutted branch stayed green.
    */
    const from = worker.indexOf("if (result.finalState === 'failed')")
    expect(from).toBeGreaterThan(-1)
    const window = worker.slice(from, worker.indexOf('done.push(result)', from))
    expect(window).toMatch(/await lastWord\(db, job, options\.notify\)/)
  })

  it('cannot turn an apology into a second failure', () => {
    const from = worker.indexOf('await lastWord(db, job, options.notify)')
    expect(worker.slice(from, from + 220)).toMatch(/catch/)
  })
})
