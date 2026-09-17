/**
 * #245 — the nouns HOLDS did not cover.
 *
 * Found while writing #246's regressions, as a control that did NOT fire.
 * `HOLDS` mapped eighteen nouns the office actually holds; "account",
 * "renewal", "customer", "client", "supplier" and "subscriber" were outside
 * it, so four flat assertions about what the office holds passed the gate
 * with nothing read.
 *
 * ## Why they go under `unreachable` rather than into a domain
 *
 * Nothing in this office consults a list of accounts, renewals, customers,
 * clients, suppliers or subscribers. There is no reader, so a claim about
 * them is never grounded — which is the honest state of it. The comment on
 * `unreachable` already says what happens next: the day one of them gets a
 * reader it moves up into a domain and the check relaxes on its own.
 *
 * ## The measurement this Issue asked for before widening
 *
 * Every widening of this check costs precision somewhere, and #245 refused to
 * do it on the spot for that reason. Measured over **1,200 real outputs** —
 * harness traffic excluded via `app.harness_job` — under the harshest setting
 * the check has, nothing retrieved and nothing in the grounding:
 *
 *     before   307 / 1200 would be refused
 *     after    307 / 1200
 *
 * **Zero new false positives.** Which is the expected shape rather than a
 * lucky one: the guards that keep this check honest are upstream of the noun
 * list — it is off entirely when something was retrieved, and a figure Grant
 * supplied is exempt through the grounding (#247). The noun list only decides
 * WHICH sentences reach those guards.
 *
 * The negative controls below are the half the corpus cannot supply, because
 * the corpus has no example of Grant stating a customer count and the office
 * repeating it.
 */
import { describe, expect, it } from 'vitest'
import { assertsRecordsUnseen } from '../../src/agents/quality.ts'

/** Nothing was read this turn. */
const NOTHING: { consulted: never[]; complete: never[] } = { consulted: [], complete: [] }

describe('#245 — the six nouns that were outside HOLDS', () => {
  // The four sentences named in the Issue, verbatim.
  const BAITS = [
    'We have 40 accounts on annual billing.',
    'That is the only renewal this quarter.',
    'There are 12 customers on the old tier.',
    'We have three suppliers quoting.',
  ]

  for (const said of BAITS) {
    it(`refuses, with nothing read: ${said}`, () => {
      expect(assertsRecordsUnseen(said, '', NOTHING)).not.toBeNull()
    })
  }

  // The two added beyond the Issue's list, for the same reason and with the
  // same absence of a reader.
  it('refuses a count of clients', () => {
    expect(assertsRecordsUnseen('We have 8 clients on the retainer.', '', NOTHING)).not.toBeNull()
  })

  it('refuses a count of subscribers', () => {
    expect(
      assertsRecordsUnseen('There are 300 subscribers on the free plan.', '', NOTHING),
    ).not.toBeNull()
  })
})

describe('#245 — what the widening must not break', () => {
  /*
    #247's exemption, on the new nouns. This is the expensive direction and
    the one a widening threatens: Grant states a figure, asks a question
    about it, and the office repeats his own number back. Refusing that killed
    a job over his arithmetic once already.
  */
  it('a customer count Grant himself supplied is not a claim about the records', () => {
    const his = 'We have 12 customers on the old tier and I want to move them.'
    expect(
      assertsRecordsUnseen('Moving all 12 customers at once is the risk.', his, NOTHING),
    ).toBeNull()
  })

  it('and in his notation rather than the office s', () => {
    const his = 'We have twelve customers on the old tier.'
    expect(
      assertsRecordsUnseen('Those 12 customers are the ones to move.', his, NOTHING),
    ).toBeNull()
  })

  /*
    The other guard, and the one that matters most in ordinary use: the check
    is off when something WAS read. It is written here about a noun that HAS a
    domain, because the first draft of this test wrote it about "customers"
    and failed - correctly.

    That failure is the point of `unreachable` rather than a hole in it: no
    reader in this office consults a customer list, so retrieving a DOCUMENT
    grounds nothing about customers, and a check that let it through would be
    saying a document search is a census of the customer base. The test was
    wrong and the behaviour was right, which is the one direction that sends
    somebody rewriting a function that works.
  */
  it('a count is allowed once the domain that holds it was consulted, held whole, and agrees', () => {
    expect(
      assertsRecordsUnseen(
        'There are 12 documents on the old tier.',
        // The list the office was handed. Holding it licenses COUNTING it and
        // not choosing a number: the first draft of this test passed an empty
        // grounding and was refused, correctly. Being entitled to count is not
        // being entitled to be wrong, and #185's fabrication was exactly a
        // count with real-looking names after it.
        'The project holds 12 documents.',
        { consulted: ['documents'], complete: ['documents'] },
      ),
    ).toBeNull()
  })

  it('and a count that CONTRADICTS the list it was handed is still refused', () => {
    expect(
      assertsRecordsUnseen(
        'There are 40 documents on the old tier.',
        'The project holds 12 documents.',
        {
          consulted: ['documents'],
          complete: ['documents'],
        },
      ),
    ).not.toBeNull()
  })

  it('but consulting documents grounds nothing about customers, which is what unreachable means', () => {
    expect(
      assertsRecordsUnseen('There are 12 customers on the old tier.', '', {
        consulted: ['documents'],
        complete: ['documents'],
      }),
    ).not.toBeNull()
  })

  /*
    And the rule the noun list exists to protect. An answer may enumerate its
    own thinking; "three options" is reasoning, not retrieval, and a check
    that refused it would stop the office thinking out loud.
  */
  it('still does not refuse an answer counting its own reasoning', () => {
    expect(
      assertsRecordsUnseen('There are three options and the second is cheapest.', '', NOTHING),
    ).toBeNull()
  })

  it('and does not refuse a hypothetical about accounts', () => {
    expect(
      assertsRecordsUnseen(
        'If we had 40 accounts on annual billing that would be worth doing.',
        '',
        NOTHING,
      ),
    ).toBeNull()
  })
})
