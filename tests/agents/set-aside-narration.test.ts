/**
 * The office apologising for a rule it kept (#277).
 *
 * Grant caught it answering a pricing question with *"I'm setting aside the
 * bullet-point rule so I can keep this answer as a single short paragraph as
 * required"* — on an answer that broke no rule at all.
 *
 * That sentence is not a lie about the world, so no coherence gate can see it;
 * it is a lie about the ANSWER, and it makes a standing preference read as a
 * constant negotiation. `setAsideUnsaid` cannot see it either, by
 * construction: it returns null the moment nothing is broken.
 *
 * Two detectors, and the pair is the measurement. `brokeAForm` is a fact about
 * the text; `narratesSetAside` is what the office SAID about itself. The
 * defect is one without the other, in either direction — a spurious apology,
 * or #231's original silent drop.
 */
import { describe, expect, it } from 'vitest'
import { brokeAForm, narratesSetAside, setAsideUnsaid } from '../../src/agents/quality.ts'

const ONE_PARA = 'Keep every answer to a single short paragraph, no lists.'

describe('did the answer actually break a form rule', () => {
  it('a list under a no-lists rule is a break, named in Grant’s words', () => {
    expect(brokeAForm('Three things:\n- one\n- two\n- three', [ONE_PARA])).toBe(ONE_PARA)
  })

  it('two paragraphs under a one-paragraph rule is a break', () => {
    expect(brokeAForm('First thought.\n\nSecond thought.', [ONE_PARA])).toBe(ONE_PARA)
  })

  it('CONTROL: one short paragraph under the same rule is not', () => {
    // The case the whole issue turns on. If this ever returns a rule, every
    // measurement below is inverted.
    expect(brokeAForm('Forty pounds a month across three tiers.', [ONE_PARA])).toBeNull()
  })

  it('CONTROL: a list with no rule about lists is not a break', () => {
    expect(brokeAForm('- one\n- two', [])).toBeNull()
  })
})

describe('did the answer narrate setting one aside', () => {
  it('catches the sentence Grant actually got', () => {
    expect(
      narratesSetAside(
        "I'm setting aside the bullet-point rule so I can keep this answer as a " +
          'single short paragraph as required.',
      ),
    ).toBe(true)
  })

  it('catches the honest version too, because the detector is about the CLAIM', () => {
    /*
      Deliberately not "only the wrong ones". The detector answers *did it say
      it dropped a rule*, and whether that was right is decided by pairing it
      with `brokeAForm` — the same split 0304 argues for. A detector that tried
      to judge rightness on its own would be the fused function again.
    */
    expect(
      narratesSetAside('Here are the five steps. I am breaking your no-lists rule to fit them.'),
    ).toBe(true)
    expect(
      narratesSetAside('Setting aside your one-paragraph preference, the four options are below.'),
    ).toBe(true)
  })

  it('catches conforming-and-explaining, which is the commoner shape', () => {
    /*
      Missed by the first draft, and it cost a whole measured run: the office
      said *"I'm providing the onboarding steps in prose rather than a numbered
      list because your instruction forbids lists"* — the clause working
      perfectly — and the harness scored it as a SILENT drop. It never uses the
      words "set aside"; it conforms and explains.
    */
    expect(
      narratesSetAside(
        "I'm providing the onboarding steps in prose rather than a numbered list " +
          'because your instruction forbids lists.',
      ),
    ).toBe(true)
    expect(
      narratesSetAside(
        'Here it is in one paragraph instead of bullets, since you asked me not to use them.',
      ),
    ).toBe(true)
  })

  it('CONTROL: naming a CONSTRAINT is what makes it an acknowledgement', () => {
    // A choice of form DESCRIBED is not a choice of form EXPLAINED. Both of
    // these have a contrast word; neither names a rule, instruction or limit.
    expect(narratesSetAside('The terms are in prose rather than a list.')).toBe(false)
    expect(narratesSetAside('Here is the summary in one paragraph instead of three.')).toBe(false)
  })

  it('does not require the word "you", because the office often does not use it', () => {
    /*
      Both of these came out of a real measured run and both fell on the
      CANDIDATE's side of the comparison — so a detector that missed them
      would have been biased towards the verdict it happened to produce, which
      is the one way an instrument can be wrong that nobody notices.
    */
    expect(
      narratesSetAside(
        "I'm providing the steps in paragraph form instead of a numbered list because " +
          'my standing instructions prohibit lists.',
      ),
    ).toBe(true)
    expect(
      narratesSetAside(
        "I'm providing the full renewal terms clause-by-clause despite the 60-word limit " +
          'because the request requires comprehensive coverage.',
      ),
    ).toBe(true)
  })

  it('catches "I can\u2019t do X because your rule", which needs no contrast word', () => {
    expect(
      narratesSetAside(
        "I'm providing a checklist in prose because I can't use bullet points as per " +
          'your standing instruction.',
      ),
    ).toBe(true)
  })

  it('CONTROL: an inability that names no rule is not an acknowledgement', () => {
    expect(narratesSetAside('I cannot find the list you mentioned.')).toBe(false)
    expect(narratesSetAside("I can't shorten the paragraph any further today.")).toBe(false)
  })

  it('CONTROL: an ordinary answer that mentions a list does not count', () => {
    // The expensive direction. A false positive here reports a good answer as
    // defective, which is how a measurement starts lying about the product.
    expect(narratesSetAside('The onboarding list is with Priya and should land Thursday.')).toBe(
      false,
    )
    expect(narratesSetAside('You asked for the pricing, so: forty pounds a month.')).toBe(false)
    expect(narratesSetAside('Normally they invoice monthly, but this contract is annual.')).toBe(
      false,
    )
  })

  it('CONTROL: a set-aside verb about something that is not FORM does not count', () => {
    expect(narratesSetAside('We are setting aside the Ibiza trip until the contract lands.')).toBe(
      false,
    )
    expect(narratesSetAside('I am ignoring the duplicate rows in the export.')).toBe(false)
  })

  it('CONTROL: the two halves must be in one sentence', () => {
    // A set-aside verb in one place and a form noun a paragraph away is not a
    // narration, and scoping to the sentence is what stops it becoming one.
    expect(
      narratesSetAside('I am setting aside the Ibiza question.\n\nThe onboarding list is short.'),
    ).toBe(false)
  })

  it('an empty answer narrates nothing', () => {
    expect(narratesSetAside('')).toBe(false)
    expect(narratesSetAside('   ')).toBe(false)
  })
})

describe('the pair, which is what the measurement counts', () => {
  const spurious = (body: string): boolean =>
    narratesSetAside(body) && brokeAForm(body, [ONE_PARA]) === null
  const silent = (body: string): boolean =>
    !narratesSetAside(body) && brokeAForm(body, [ONE_PARA]) !== null

  it('#277: an apology with nothing to apologise for', () => {
    expect(
      spurious("Forty pounds a month. I'm setting aside the bullet-point rule to keep this short."),
    ).toBe(true)
  })

  it('#231: a rule dropped in silence, which is the other defect', () => {
    expect(silent('Three steps:\n1. sign\n2. pay\n3. onboard')).toBe(true)
  })

  it('CONTROL: a break that IS acknowledged is neither', () => {
    const good =
      'Breaking your no-lists rule because five steps do not fit a paragraph:\n1. sign\n2. pay'
    expect(spurious(good)).toBe(false)
    expect(silent(good)).toBe(false)
  })

  it('CONTROL: a kept rule with no apology is neither', () => {
    const good = 'Forty pounds a month across three tiers, email support, two weeks to onboard.'
    expect(spurious(good)).toBe(false)
    expect(silent(good)).toBe(false)
    // And the shipped gate agrees there is nothing to chase.
    expect(setAsideUnsaid(good, [ONE_PARA])).toBeNull()
  })
})
