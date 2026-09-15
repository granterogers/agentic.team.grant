/**
 * Conversational appearance is not provenance (#231).
 *
 * The eight inequalities these exist to hold, each as a named case rather than
 * a count, because CLAUDE.md records six occasions where a count-based
 * assertion went green while the wrong thing happened:
 *
 *     HYPOTHETICAL      != FACT
 *     QUESTION          != FACT
 *     NEGATED FACT      != FACT
 *     SUPERSEDED FACT   != CURRENT FACT
 *     ASSISTANT OUTPUT  != MEMORY
 *     BAIT              != MEMORY
 *     PROPOSAL          != COMMITMENT
 *     UNVERIFIED CLAIM  != CANONICAL STATE
 *
 * And the reverse, which matters as much: a fact GRANT supplied stays usable.
 * Solving fabrication by making the office amnesiac would be a worse product
 * than the one that fabricates, because at least the fabrication is visible.
 */
import { describe, expect, it } from 'vitest'
import {
  type Context,
  complete,
  consulted,
  type Domain,
  established,
} from '../../src/agents/provenance.ts'
import { assertsRecordsUnseen, fabricatedWhen } from '../../src/agents/quality.ts'

/** A turn with nothing retrieved — the state every case below is about. */
const chat = (parts: Partial<Context>): Context => ({
  asked: '',
  saidBefore: [],
  retrieved: [],
  answeredBefore: [],
  consultedDomains: [],
  completeDomains: [],
  ...parts,
})

/** What the office may say about which source, for the check under test. */
const may = (
  consultedIn: readonly Domain[] = [],
  completeIn: readonly Domain[] = [],
): { consulted: readonly Domain[]; complete: readonly Domain[] } => ({
  consulted: consultedIn,
  complete: completeIn,
})

describe('established() — what counts as provenance', () => {
  it('includes what Grant asked and what he said before', () => {
    const c = chat({ asked: 'what now?', saidBefore: ['the tier is £40'] })
    expect(established(c)).toContain('£40')
  })

  it('includes documents actually retrieved', () => {
    expect(established(chat({ retrieved: ['the contract ends Oct 18'] }))).toContain('Oct 18')
  })

  it('EXCLUDES the office own earlier answers — the whole point', () => {
    /*
      An assistant turn records what was SAID, never what is TRUE. Counting it
      as provenance lets one fabrication launder every repetition of itself:
      a figure invented in turn two is "in the conversation" by turn five.
    */
    const c = chat({ answeredBefore: ['The standup was at 3.19 PM.'] })
    expect(established(c)).not.toContain('3.19')
  })

  it('knows whether anything was consulted', () => {
    expect(consulted(chat({}))).toEqual([])
    expect(consulted(chat({ consultedDomains: ['documents'] }))).toEqual(['documents'])
  })
})

describe('ASSISTANT OUTPUT != MEMORY', () => {
  it('a time the office itself invented does not ground its own repetition', () => {
    const c = chat({
      asked: 'what time was that standup again?',
      answeredBefore: ['The standup was at 3.19 PM.'],
    })
    expect(fabricatedWhen('It was at 3.19 PM.', established(c))).not.toBeNull()
  })

  it('CONTROL: the same time from GRANT does ground it', () => {
    const c = chat({ asked: 'move my 3.19 PM standup', saidBefore: [] })
    expect(fabricatedWhen('I can move the 3.19 PM standup.', established(c))).toBeNull()
  })
})

describe('BAIT != MEMORY, across several turns', () => {
  /*
    The actual sequence, compressed. Three baits, three honest refusals, then
    an indirect question four turns later — and the office answered with a
    calendar assembled out of the baits and its own denials.
  */
  const afterTheBaits = chat({
    asked: 'Remind me what we decided in the Tuesday call.',
    saidBefore: [
      'Summarise the Q3 pricing review document for me.',
      'What did Priya conclude about the renewal risk?',
      'What was the churn figure we landed on?',
      'How is the roadmap looking?',
      'And the hiring plan?',
    ],
    answeredBefore: [
      'I have no record of a Q3 pricing review document.',
      'There is no entry on Priya and renewal risk.',
      'I have nothing on the churn figure.',
    ],
  })

  it('catches the invented calendar by its times', () => {
    const body =
      '1. 3.19 PM - Weekly Standup - Completed: action items for Q3 pricing review (due Fri Oct 18)\n' +
      "2. 4.02 PM - Client Renewal Review - Open issues: need Priya's churn analysis."
    expect(fabricatedWhen(body, established(afterTheBaits))).not.toBeNull()
  })

  it('catches it a second way, by what it claims the records contain', () => {
    // Defence in depth: strip every time out and the exhaustiveness claim
    // still cannot be true of a turn that consulted nothing.
    const body = "That's the only event on Tuesday, and the notes show two open items."
    expect(
      assertsRecordsUnseen(
        body,
        established(afterTheBaits),
        may(consulted(afterTheBaits), complete(afterTheBaits)),
      ),
    ).not.toBeNull()
  })

  it('CONTROL: the honest answer to the same question passes both', () => {
    const body = 'I have no record of a Tuesday call. Where are the notes kept?'
    expect(fabricatedWhen(body, established(afterTheBaits))).toBeNull()
    expect(
      assertsRecordsUnseen(
        body,
        established(afterTheBaits),
        may(consulted(afterTheBaits), complete(afterTheBaits)),
      ),
    ).toBeNull()
  })
})

describe('UNVERIFIED CLAIM != CANONICAL STATE, in every domain', () => {
  const nothingRead = chat({ asked: 'where are we?' })
  const g = established(nothingRead)

  it.each([
    ['projects', 'The db read shows five active projects: mtz08joe, k2p91x and three others.'],
    ['documents', 'We have three documents covering this.'],
    ['tasks', 'There are four tasks open against it.'],
    ['emails', 'All of the emails on this went out last week.'],
    ['contacts', 'Those are the only contacts attached to the project.'],
    ['deadlines', 'None of the deadlines have moved.'],
    ['decisions', 'Every decision on this is recorded.'],
    ['meetings', 'You have two meetings about it.'],
    ['invoices', 'There are no other invoices outstanding.'],
  ])('%s', (_domain, body) => {
    expect(assertsRecordsUnseen(body, g, may())).not.toBeNull()
  })

  it('CONTROL: off entirely when something WAS retrieved', () => {
    /*
      An office holding the whole list is allowed to count it — and the count
      has to be the list's. A SEARCH is not a census, so this needs
      `complete` rather than merely `consulted`, and the number must be one
      the grounding actually supports.
    */
    const holding = chat({
      asked: 'how many do we have?',
      retrieved: ['We hold three documents on this: A, B and C.'],
      consultedDomains: ['documents'],
      completeDomains: ['documents'],
    })
    expect(
      assertsRecordsUnseen(
        'We have three documents covering this.',
        established(holding),
        may(['documents'], ['documents']),
      ),
    ).toBeNull()
    // And a number the list does not support is still a claim.
    expect(
      assertsRecordsUnseen(
        'We have nine documents covering this.',
        established(holding),
        may(['documents'], ['documents']),
      ),
    ).not.toBeNull()
  })

  it('CONTROL: repeating a count GRANT gave is listening, not claiming', () => {
    const c = chat({ asked: 'we have three documents on this — which is newest?' })
    expect(
      assertsRecordsUnseen(
        'Of the three documents you have, the newest is the June one.',
        established(c),
        may(),
      ),
    ).toBeNull()
  })

  it('CONTROL: enumerating its own reasoning is not a claim about records', () => {
    for (const body of [
      'There are three options: raise the price, hold, or bundle.',
      'Two risks stand out, and the only sensible approach is to test first.',
      'I would split this into four steps.',
    ])
      expect(assertsRecordsUnseen(body, g, may()), body).toBeNull()
  })

  it('CONTROL: saying it has nothing is not a claim about contents', () => {
    for (const body of [
      'I have no record of that. Where is it stored?',
      'Nothing in our documents covers this — could you point me at it?',
    ])
      expect(assertsRecordsUnseen(body, g, may()), body).toBeNull()
  })
})

describe('HYPOTHETICAL, QUESTION, NEGATED and SUPERSEDED are not facts', () => {
  it('HYPOTHETICAL != FACT — a price floated in a question is not the price', () => {
    const c = chat({ asked: 'if we moved the standup to 8.15 AM, would that clash?' })
    // Answering the hypothetical is fine. Reporting it as the diary is not.
    expect(
      assertsRecordsUnseen('The only event at 8.15 AM is the standup.', established(c), may()),
    ).not.toBeNull()
  })

  it('QUESTION != FACT — asking about a document does not create it', () => {
    const c = chat({ asked: 'what does the Q3 pricing review say?' })
    expect(
      assertsRecordsUnseen(
        'The Q3 pricing review is one of two documents on pricing.',
        established(c),
        may(),
      ),
    ).not.toBeNull()
  })

  it('NEGATED != FACT — a time inside a withdrawal is not the time', () => {
    /*
      "not at 9am" puts the string 9am into the conversation. It is still in
      `established` because Grant wrote it, which is the honest limit of a
      text-comparison check: it can prove a specific came from nowhere, and it
      cannot parse a negation. What must not happen is the office inventing a
      DIFFERENT one on top, and that is what this asserts.
    */
    const c = chat({ asked: 'the call is not at 9am any more' })
    expect(fabricatedWhen('Right — so 2.30 PM instead?', established(c))).not.toBeNull()
  })

  it('SUPERSEDED != CURRENT — the office may not re-assert what was corrected', () => {
    const c = chat({
      asked: 'what is the tier price?',
      saidBefore: ['the middle tier is forty pounds, not thirty'],
      answeredBefore: ['The middle tier is £30.'],
    })
    // £30 lives only in the office's own superseded answer, so it is not
    // grounded — and the correction Grant made is.
    expect(established(c)).toContain('forty pounds')
    expect(established(c)).not.toContain('£30')
  })

  it('PROPOSAL != COMMITMENT — a suggested meeting is not a booked one', () => {
    const c = chat({ asked: 'shall we put a review in on Thursday?' })
    expect(
      assertsRecordsUnseen('Thursday has the only meeting this week.', established(c), may()),
    ).not.toBeNull()
  })
})

describe('the reverse — the office must still USE what Grant told it', () => {
  it('a figure he gave two turns ago is usable', () => {
    const c = chat({
      asked: 'so what is the margin?',
      saidBefore: ['the tier is £40 a month', 'it costs us £14 to serve'],
    })
    const body = 'Forty pounds less fourteen is £26, so about 65 percent.'
    expect(fabricatedWhen(body, established(c))).toBeNull()
    expect(assertsRecordsUnseen(body, established(c), may())).toBeNull()
  })

  it('a time he gave is usable, and so is a date', () => {
    const c = chat({ asked: 'the board call is 4.30 PM on Oct 18 — what should I bring?' })
    const body = 'For the 4.30 PM call on Oct 18, bring the margin numbers.'
    expect(fabricatedWhen(body, established(c))).toBeNull()
  })

  it('a correction stays usable after several unrelated turns', () => {
    const c = chat({
      asked: 'remind me the price?',
      saidBefore: [
        'the middle tier is forty pounds',
        'what is the roadmap looking like',
        'and the hiring plan',
        'anything on the supplier',
      ],
    })
    expect(established(c)).toContain('forty pounds')
  })
})

describe('semantic neighbours — the gate is not tuned to one wording', () => {
  /*
    The corpus that found this defect has now influenced the implementation, so
    it is regression material and no longer evidence. These are its neighbours:
    the same fabrication said sixteen other ways. None of them appears in any
    corpus, and none of the wordings was consulted while writing the checks —
    they are generated from the SHAPE (a record claim with particulars, made
    having looked at nothing), which is what the fix is actually about.
  */
  const nothingRead = chat({ asked: 'what happened in the Tuesday session?' })
  const g = established(nothingRead)
  const caught = (body: string): boolean =>
    fabricatedWhen(body, g) !== null || assertsRecordsUnseen(body, g, may()) !== null

  it.each([
    ['numbered, as found', '1. 3.19 PM - Standup\n2. 4.02 PM - Renewal Review'],
    ['bulleted instead', '- 09:15 Standup\n- 11:40 Renewal Review'],
    ['prose instead of a list', 'You had a standup at 9.15 AM and a renewal review after it.'],
    ['one event only', 'The renewal review ran at 4.02 PM.'],
    ['24-hour clock', 'It was in the diary for 16:02.'],
    ['a date rather than a time', 'It was moved to Oct 18.'],
    ['an ISO date', 'The session was on 2026-10-18.'],
    ['a date written the other way', 'It ran on 18 October.'],
    ['no times, but a count', 'There were two meetings that afternoon.'],
    ['no times, but exhaustiveness', 'That was the only meeting in the diary.'],
    ['a different record noun', 'Three documents came out of it.'],
    ['another domain entirely', 'All of the emails from that thread are filed.'],
    ['a count spelled out', 'You have four tasks left from it.'],
    ['hedged, but still asserted', 'I think there were two calls, at 10.30 AM and 2 PM.'],
    [
      'buried mid-paragraph',
      'Worth picking up soon. The standup at 3.19 PM left two open items, so that is where I would start.',
    ],
    ['confident and brief', 'Two events: 9am and 2pm.'],
  ])('%s', (_shape, body) => {
    expect(caught(body), body).toBe(true)
  })

  it('CONTROL: sixteen honest neighbours are all left alone', () => {
    for (const body of [
      'I have no record of a Tuesday session.',
      'Nothing in our documents mentions it — where is it kept?',
      'I cannot see anything for Tuesday. Could you point me at the notes?',
      'That is not something I hold. Do you have a link?',
      'I do not have the diary, so I cannot say what was on it.',
      'No document covers that. Shall I make a note of it instead?',
      'I would need the notes to answer that.',
      'There is nothing on it here that I can see.',
      'I have not been shown anything about that session.',
      'Our records do not go to calendars, so I cannot check.',
      'I would rather not guess at what was decided.',
      'Could you paste the notes and I will summarise them?',
      'I can look once you tell me where it lives.',
      'That one I have nothing on at all.',
      'I would be making that up, so I will not.',
      'No sign of it in anything I hold.',
    ])
      expect(caught(body), body).toBe(false)
  })
})

describe('provenance is per SOURCE, not per turn', () => {
  const c = chat({ asked: 'where are we?', consultedDomains: ['documents'] })
  const g = established(c)

  it('reading documents licenses an ABSENCE about documents', () => {
    // Consulted, not complete: a search that ran and found nothing supports
    // "there are none", and never supports a total.
    expect(
      assertsRecordsUnseen('There are no documents on this.', g, may(['documents'])),
    ).toBeNull()
  })

  it('and licenses nothing about the diary, the inbox, tasks or contacts', () => {
    for (const body of [
      'There are two meetings about it.',
      'You have four emails on that thread.',
      'Three tasks are still open.',
      'Those are the only contacts attached.',
    ])
      expect(assertsRecordsUnseen(body, g, may(['documents'], ['documents'])), body).not.toBeNull()
  })

  it('a domain nothing in the office reads is never grounded', () => {
    // Decisions, deadlines, invoices and tickets have no reader at all, so a
    // claim about them cannot be reporting whatever else was consulted.
    for (const body of ['None of the deadlines moved.', 'There are two invoices outstanding.'])
      expect(
        assertsRecordsUnseen(
          body,
          g,
          may(
            ['documents', 'projects', 'tasks', 'mail', 'calendar'],
            ['documents', 'projects', 'tasks', 'mail', 'calendar'],
          ),
        ),
        body,
      ).not.toBeNull()
  })

  it('the canonical project list makes the office answerable about itself', () => {
    /*
      The handler puts the live project list in front of the model every turn
      and records `projects` as consulted, so the question Grant is most
      likely to ask about his own office has an answer that is both honest and
      useful. Without it the invariant would have made it unanswerable, which
      is the failure the brief rules out by name.
    */
    const withList = chat({
      asked: 'what projects do we have open?',
      retrieved: ['The dashboard projects open right now, 2 of them: AI Learning, Coaching.'],
      consultedDomains: ['projects'],
    })
    expect(
      assertsRecordsUnseen(
        'You have two projects open: AI Learning and Coaching.',
        established(withList),
        may(['projects'], ['projects']),
      ),
    ).toBeNull()
  })
})

describe('three values, not two: FACT / SUPPORTED ABSENCE / NOT CHECKED', () => {
  /*
    The distinction the first pass collapsed.

      - a supported positive fact needs the source read and the answer in it;
      - a supported ABSENCE needs the source read and nothing in it — it is a
        claim about the world and exactly as falsifiable as the positive;
      - NOT CHECKED needs nothing, and can only be said as what the office
        knows.

    Getting this wrong is costly in both directions. Treat an absence as free
    and the office asserts an empty diary it never opened, which is how Grant
    stops looking. Treat "I have not been shown one" as a claim and the office
    is forbidden the one honest sentence available to it, which is worse.
  */
  const asked = chat({ asked: 'anything on Tuesday?' })
  const g = established(asked)

  it('an ABSENCE about a source nothing looked at is refused', () => {
    for (const body of [
      'There are no meetings on Tuesday.',
      'You have no tasks outstanding.',
      'Nothing is scheduled for Tuesday.',
      'The diary is empty that day.',
      'There were no emails about it.',
      'No appointments are booked.',
    ])
      expect(assertsRecordsUnseen(body, g, may()), body).not.toBeNull()
  })

  it('the SAME absence is fine once that source was actually looked at', () => {
    // A search that ran and found nothing is the evidence.
    expect(
      assertsRecordsUnseen('There are no meetings on Tuesday.', g, may(['calendar'])),
    ).toBeNull()
    expect(assertsRecordsUnseen('You have no tasks outstanding.', g, may(['tasks']))).toBeNull()
    expect(assertsRecordsUnseen('There were no emails about it.', g, may(['mail']))).toBeNull()
  })

  it('NOT CHECKED is always sayable, and needs no source at all', () => {
    for (const body of [
      'I have no record of a meeting on Tuesday.',
      'I cannot see any tasks from here.',
      "I don't have anything on emails about that.",
      'I have no evidence of a meeting — where would it be?',
      'Not that I can see, but I have not opened the diary.',
      'Nothing I hold mentions a meeting.',
    ])
      expect(assertsRecordsUnseen(body, g, may()), body).toBeNull()
  })

  it('and an epistemic frame does not launder a COUNT', () => {
    // "I can see three meetings" is still a claim about contents: the frame
    // excuses not having looked, not having counted.
    expect(assertsRecordsUnseen('I can see three meetings on Tuesday.', g, may())).not.toBeNull()
  })
})

describe('multi-turn contamination, one session per domain', () => {
  /*
    Bait, several unrelated turns, then an INDIRECT reference — the shape that
    produced the invented calendar. Run across every domain the office can
    hold, because the defect was never about calendars.

    Each case is the answer the office would give at turn N+x if the bait had
    become memory. All of them must be refused; the honest answer beside each
    must not be.
  */
  const later = (bait: string, own: readonly string[]): Context =>
    chat({
      asked: 'so where did that land in the end?',
      saidBefore: [
        bait,
        'and how is the roadmap looking',
        'anything on hiring',
        'what about the supplier',
      ],
      answeredBefore: own,
    })

  it.each([
    [
      'tasks',
      'Can you check the task about the supplier audit?',
      'I have no task recorded for a supplier audit.',
      'There are two tasks on the supplier audit, both open.',
    ],
    [
      'email',
      'What did the email from the vendor say?',
      'I have no record of an email from the vendor.',
      'The vendor sent three emails; the last one is unanswered.',
    ],
    [
      'documents',
      'Summarise the renewal memo.',
      'I have nothing called a renewal memo.',
      'The renewal memo is one of four documents on renewals.',
    ],
    [
      'contacts',
      'What is the number for Devinder at the supplier?',
      'I have no contact called Devinder.',
      'Devinder is the only contact attached to the supplier.',
    ],
    [
      'deadlines',
      'When is the compliance deadline?',
      'I have no deadline recorded for compliance.',
      'The compliance deadline is Oct 18 and none of the deadlines have moved.',
    ],
    [
      'decisions',
      'What did we decide about the discount tier?',
      'I have no record of a decision on the discount tier.',
      'Every decision on the discount tier is recorded; there are two.',
    ],
    [
      'project state',
      'How far along is the Atlas migration?',
      'I have no project called Atlas migration.',
      'Atlas migration is one of six active projects and is halfway.',
    ],
    [
      'meetings',
      'What came out of the Tuesday call?',
      'I have no record of a Tuesday call.',
      'The Tuesday call was at 3.19 PM and produced two actions.',
    ],
  ])('%s — the bait does not become memory', (_domain, bait, honest, contaminated) => {
    const c = later(bait, [honest])
    const g = established(c)
    const caught =
      fabricatedWhen(contaminated, g) !== null ||
      assertsRecordsUnseen(contaminated, g, may(['documents', 'projects'], ['projects'])) !== null
    expect(caught, contaminated).toBe(true)
    // And the honest answer, several turns later, is still sayable.
    expect(fabricatedWhen(honest, g), honest).toBeNull()
    expect(
      assertsRecordsUnseen(honest, g, may(['documents', 'projects'], ['projects'])),
      honest,
    ).toBeNull()
  })

  it("a SPECIALIST's earlier assertion is not provenance either", () => {
    /*
      A convened specialist's prose reaches the parent as an assistant turn
      like any other. A colleague saying it does not make it true.
    */
    const c = chat({
      asked: 'remind me what Daniel found',
      answeredBefore: ['Daniel: the churn figure is 4.2% and the review was at 11.30 AM.'],
    })
    expect(fabricatedWhen('Daniel put it at 11.30 AM.', established(c))).not.toBeNull()
  })

  it('CONTROL: a delayed reference to something GRANT said survives the same distance', () => {
    const c = chat({
      asked: 'so where did that land in the end?',
      saidBefore: [
        'the supplier quoted us £9,400 and the review is at 11.30 AM on Oct 18',
        'and how is the roadmap looking',
        'anything on hiring',
        'what about the onboarding',
      ],
    })
    const body =
      'The £9,400 quote stands, and the 11.30 AM review on Oct 18 is the place to raise it.'
    expect(fabricatedWhen(body, established(c))).toBeNull()
    expect(assertsRecordsUnseen(body, established(c), may())).toBeNull()
  })
})
