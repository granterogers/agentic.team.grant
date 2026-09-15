/**
 * #247 — a user-provided premise is not a claim about the records.
 *
 * Grant, 2026-09-15, formalising it after the hostile corpus killed a job over
 * his own arithmetic:
 *
 *     USER-PROVIDED PREMISE  ≠  CANONICAL RECORD CLAIM
 *
 * He may say "we get about 60 tickets a week" and then ask "at 60 a week, how
 * many is that per quarter?", and the office must be able to reason from it.
 * It may NOT turn that into "our records show 60 tickets per week" unless
 * something was actually read.
 *
 * The invariant already earned is preserved exactly: a claim about what the
 * records CONTAIN still needs a source that was read. What changes is that a
 * figure HE supplied stops being treated as one.
 */
import { describe, expect, it } from 'vitest'
import { assertsRecordsUnseen } from '../../src/agents/quality.ts'

/** Nothing was read this turn — the state the hostile corpus ran in. */
const NOTHING: { consulted: never[]; complete: never[] } = { consulted: [], complete: [] }

describe('#247 — reasoning from a premise Grant supplied', () => {
  // The case that failed, and its notation: he writes numbers as words and the
  // office answers in digits. That mismatch alone is what killed the job.
  const HIS_WORDS = 'For this one, the support inbox gets about sixty tickets a week.'

  it('the exact failing case: arithmetic on his own figure', () => {
    expect(
      assertsRecordsUnseen('At 60 tickets a week that is about 780 a quarter.', HIS_WORDS, NOTHING),
    ).toBeNull()
  })

  it('the RESULT of the arithmetic, with the record noun attached', () => {
    /*
      The shape the live office actually produced, and the reason the first fix
      was not enough. "780 a quarter" carries no record noun so it never
      matched; "780 tickets a quarter" does, and 780 appears in no grounding
      anywhere because the office worked it out.

      A derived figure is not a retrieved one. What makes it checkable without
      a model is the same thing CLAUDE.md already says about times: not truth,
      DERIVABILITY. The sentence shows its input — 60, which he gave — so it is
      showing its working rather than citing a record.
    */
    expect(
      assertsRecordsUnseen(
        'At 60 tickets a week that comes to about 780 tickets a quarter.',
        HIS_WORDS,
        NOTHING,
      ),
    ).toBeNull()
  })

  it('but a derived figure with no input shown is still a claim', () => {
    expect(
      assertsRecordsUnseen('That comes to about 780 tickets a quarter.', HIS_WORDS, NOTHING),
    ).not.toBeNull()
  })

  it('and showing the input does not license attributing the result', () => {
    expect(
      assertsRecordsUnseen(
        'At 60 tickets a week, our records show 780 tickets a quarter.',
        HIS_WORDS,
        NOTHING,
      ),
    ).not.toBeNull()
  })

  it('the same figure repeated back in his own notation', () => {
    expect(
      assertsRecordsUnseen(
        'Sixty tickets a week comes to about 780 a quarter.',
        HIS_WORDS,
        NOTHING,
      ),
    ).toBeNull()
  })

  it('an estimate built on the premise', () => {
    expect(
      assertsRecordsUnseen(
        'At 60 tickets a week you would need roughly two people on the inbox.',
        HIS_WORDS,
        NOTHING,
      ),
    ).toBeNull()
  })

  it('a hypothetical built on the premise', () => {
    expect(
      assertsRecordsUnseen(
        'If that doubled to 120 tickets a week the current rota would not hold.',
        HIS_WORDS,
        NOTHING,
      ),
    ).toBeNull()
  })

  it('a comparison between two figures he gave', () => {
    expect(
      assertsRecordsUnseen(
        'That is 60 tickets a week against 40 tickets a week last year, so half again.',
        'sixty tickets a week now, forty tickets a week last year',
        NOTHING,
      ),
    ).toBeNull()
  })

  it('planning against the premise', () => {
    expect(
      assertsRecordsUnseen(
        'I would plan the rota around 60 tickets a week and revisit in a month.',
        HIS_WORDS,
        NOTHING,
      ),
    ).toBeNull()
  })

  it('a projection from the premise', () => {
    expect(
      assertsRecordsUnseen(
        'Growing ten percent a quarter, 60 tickets a week becomes about 80 tickets a week by winter.',
        HIS_WORDS,
        NOTHING,
      ),
    ).toBeNull()
  })

  it('a reference several turns later, with unrelated turns between', () => {
    const thread = [
      HIS_WORDS,
      'Separately, can you look at the supplier quote.',
      'And the renewal is on the 14th.',
      'Back to the first one.',
    ].join('\n')
    expect(
      assertsRecordsUnseen('At 60 tickets a week, a quarter is about 780.', thread, NOTHING),
    ).toBeNull()
  })

  it('a correction he makes to his own figure', () => {
    expect(
      assertsRecordsUnseen(
        'Using 75 tickets a week instead, the quarter is about 975.',
        'sixty tickets a week — actually make that seventy five tickets a week',
        NOTHING,
      ),
    ).toBeNull()
  })

  it('the superseded figure is still his, so quoting it is still listening', () => {
    expect(
      assertsRecordsUnseen(
        'You had said 60 tickets a week before the correction.',
        'sixty tickets a week — actually make that seventy five tickets a week',
        NOTHING,
      ),
    ).toBeNull()
  })
})

describe('#247 — and the loophole stays shut', () => {
  const HIS_WORDS = 'the support inbox gets about sixty tickets a week'

  it('his premise may not be re-attributed to the records', () => {
    // The whole hazard in one sentence. The number IS in the grounding, and
    // that is exactly why this must still be refused: the claim being made is
    // not about the number, it is about where it came from.
    expect(
      assertsRecordsUnseen('Our records show 60 tickets a week.', HIS_WORDS, NOTHING),
    ).not.toBeNull()
  })

  it('nor to the database', () => {
    expect(
      assertsRecordsUnseen('The database has 60 tickets logged this week.', HIS_WORDS, NOTHING),
    ).not.toBeNull()
  })

  it('nor to a system that was never queried', () => {
    expect(
      assertsRecordsUnseen('The system shows 60 tickets a week on file.', HIS_WORDS, NOTHING),
    ).not.toBeNull()
  })

  it('a DIFFERENT number is not his premise at all', () => {
    expect(assertsRecordsUnseen('There are 84 tickets a week.', HIS_WORDS, NOTHING)).not.toBeNull()
  })

  it('a figure nobody supplied is still invention', () => {
    expect(assertsRecordsUnseen('There are 12 open tickets.', '', NOTHING)).not.toBeNull()
  })

  it('an absence about a source nothing read is still a claim', () => {
    expect(
      assertsRecordsUnseen('There are no tickets outstanding.', HIS_WORDS, NOTHING),
    ).not.toBeNull()
  })
})

describe('#247 — the "suppose" gap, previously unmeasured', () => {
  const NOTHING2: { consulted: never[]; complete: never[] } = { consulted: [], complete: [] }

  // The gap was left open deliberately for the hostile corpus, which never
  // reached it. It is measured here instead, in both directions.
  const SUPPOSING: readonly string[] = [
    'Suppose there were 12 open tickets — you would need a second person.',
    'If we had 40 accounts on annual billing, cash would land a month earlier.',
    'Assuming 3 documents a week, the notebook fills up by spring.',
    'Were it to reach 200 tickets a week, the rota would not hold.',
    'Growing at that rate it becomes about 90 tickets a week by winter.',
    'That could mean 5 renewals slipping into the next quarter.',
    'Hypothetically, 8 projects open at once would be too many.',
  ]

  for (const body of SUPPOSING) {
    it(`supposing is not reporting: ${body.slice(0, 44)}…`, () => {
      expect(assertsRecordsUnseen(body, '', NOTHING2)).toBeNull()
    })
  }

  // And the other direction, which is what stops the escape being a hole: the
  // same figures, asserted flat, with nothing read.
  const ASSERTING: readonly string[] = [
    'There are 12 open tickets.',
    'We have 40 documents on annual billing.',
    'The notebook holds 3 documents on this.',
    'There are no tickets outstanding.',
    'That is the only meeting this quarter.',
  ]
  // Two earlier controls here named "accounts" and "renewals" and did not fire.
  // That is not this change: HOLDS has never listed either noun, so the check
  // has never covered them, and it read as a regression only because the
  // control was chosen without checking what the check is about (#245).
  // Validate the test before concluding the code is wrong.

  for (const body of ASSERTING) {
    it(`but asserting still needs a source: ${body.slice(0, 44)}`, () => {
      expect(assertsRecordsUnseen(body, '', NOTHING2)).not.toBeNull()
    })
  }

  it('a supposition does not become a fact for the next turn', () => {
    // The hazard runs this way, and provenance.ts is what closes it: the
    // office's own prose is not grounding, so last turn's "suppose 12 tickets"
    // cannot license this turn's assertion.
    const officeSaidItLastTurn = ''
    expect(
      assertsRecordsUnseen('There are 12 open tickets.', officeSaidItLastTurn, NOTHING2),
    ).not.toBeNull()
  })
})
