/**
 * The quality gate (§10, §16).
 *
 * The rule under test is that provenance decides, never importance. §16 is
 * explicit about why: "was it important?" is not checkable and "how was it
 * produced?" is, so a gate keyed on the first is a gate decided ad hoc.
 */
import { describe, expect, it } from 'vitest'
import {
  canCommit,
  claimsGrantSaid,
  claimsToHaveRead,
  claimsToHaveSent,
  disagreementNeedsGrant,
  fabricatedWhen,
  metadataProblems,
  promisesToReachOut,
  refuseToSend,
  reviewRequired,
  SUBSTANTIVE_KINDS,
  unresolvableSources,
} from '../../src/agents/quality.ts'

describe('provenance decides, not importance', () => {
  it('sends everything a model wrote to review, however trivial it looks', () => {
    // The tempting exemption, and the one §16 rules out. A status line is
    // routine; a status line a model wrote is a model's words.
    const d = reviewRequired({ path: 'inference', kind: 'status' })
    expect(d.required).toBe(true)
    expect(d.exempt).toBe(false)
  })

  it('exempts a deterministic retrieval, however important it looks', () => {
    const d = reviewRequired({ path: 'deterministic_retrieval', kind: 'status' })
    expect(d.required).toBe(false)
    expect(d.exempt).toBe(true)
  })

  it.each(SUBSTANTIVE_KINDS)('requires review for %s under inference', (kind) => {
    expect(reviewRequired({ path: 'inference', kind }).required).toBe(true)
  })

  it('still reviews a mechanical path that introduces outside material', () => {
    // No model was involved, so the exemption was available and is withheld:
    // a mechanical path into a wrong belief is still a wrong belief.
    for (const kind of ['external_source_introduced', 'notebook_write'] as const) {
      const d = reviewRequired({ path: 'mechanical_transformation', kind })
      expect(d.required).toBe(true)
      expect(d.reason).toContain(kind)
    }
  })

  it('exempts a quote from already-reviewed material', () => {
    expect(reviewRequired({ path: 'quoted_from_reviewed', kind: 'restatement' }).exempt).toBe(true)
  })
})

describe('metadata combinations that are individually legal and jointly impossible', () => {
  const base = {
    confidence: 'medium',
    evidence: 'inferred',
    sources: [],
    contradictions: null,
  } as const

  it('accepts a coherent set', () => {
    expect(metadataProblems(base)).toEqual([])
  })

  it('rejects verified with nothing to verify against', () => {
    const p = metadataProblems({ ...base, evidence: 'verified' })
    expect(p.map((x) => x.field)).toEqual(['sources'])
  })

  it('accepts verified when there are sources', () => {
    expect(metadataProblems({ ...base, evidence: 'verified', sources: ['notebook:abc'] })).toEqual(
      [],
    )
  })

  /*
    #185. The message that reached Grant's phone at 03:45 on 13 September,
    verbatim, because a regression here is a lie sent to a person and the exact
    words are the point.
  */
  describe('a claim of having read, from an output that read nothing (#185)', () => {
    const REAL =
      'I pulled the project records. The db read shows five active projects: ' +
      'mtz08joe, mtyz6js5, mtyyz7zy, mtyywoxz and mty9izdi. No other project ' +
      'entries are present.'

    it('catches the message that actually reached Grant', () => {
      const p = metadataProblems({ ...base, body: REAL })
      expect(p.map((x) => x.field)).toEqual(['body'])
      // The phrase is quoted back, so the failure names what it objected to
      // rather than saying "something in here".
      expect(p[0]?.problem).toContain('I pulled the project records')
    })

    it('catches the older one too, five days earlier and the same model', () => {
      expect(claimsToHaveRead("I've pulled that from the Projects table.")).toBe(
        "I've pulled that from the Projects table",
      )
    })

    it('CONTROL: a genuine read may say it read', () => {
      // The whole point is the CONTRADICTION, not the words. With
      // `evidence: verified` and something to verify against, the same
      // sentence is simply true.
      expect(
        metadataProblems({ ...base, evidence: 'verified', sources: ['db:projects'], body: REAL }),
      ).toEqual([])
    })

    it('CONTROL: does not fire on honest summaries that merely mention data', () => {
      // A check that fired on these would be turned off within a week, so the
      // false-positive cases are pinned as hard as the true ones.
      for (const body of [
        'The brief suggests three priorities, and I think the second is the weakest.',
        'Based on what we have, the launch is the risk.',
        'The records show four projects.',
        'According to the brief, Priya came through the published piece.',
        'I read the room on this one — nobody wants a fourth workshop.',
        'I looked at it from the angle of the client.',
      ]) {
        expect(claimsToHaveRead(body), body).toBeNull()
        expect(metadataProblems({ ...base, body })).toEqual([])
      }
    })

    it('says nothing about an output with no body, so every other caller is unaffected', () => {
      expect(claimsToHaveRead('')).toBeNull()
      expect(metadataProblems(base)).toEqual([])
    })
  })

  it('rejects high confidence in a speculative finding', () => {
    const p = metadataProblems({ ...base, evidence: 'speculative', confidence: 'high' })
    expect(p.map((x) => x.field)).toEqual(['confidence'])
  })

  it('rejects high confidence alongside a recorded contradiction', () => {
    // The averaging failure at its source: naming a disagreement and then
    // reporting high confidence has resolved it silently.
    const p = metadataProblems({
      ...base,
      confidence: 'high',
      contradictions: 'Source A says 4%, source B says 11%.',
    })
    expect(p).toHaveLength(1)
    expect(p[0]?.problem).toContain('averaging')
  })

  it('does not fire on whitespace masquerading as a contradiction', () => {
    expect(metadataProblems({ ...base, confidence: 'high', contradictions: '   ' })).toEqual([])
  })

  it('reports every problem, not the first', () => {
    const p = metadataProblems({
      confidence: 'high',
      evidence: 'speculative',
      sources: [],
      contradictions: 'They disagree.',
    })
    expect(p.length).toBe(2)
  })
})

describe('when Grant is told about a disagreement', () => {
  it('is told when a contradiction survived review and shipped anyway', () => {
    for (const status of ['approved', 'approved_with_reservations'] as const) {
      expect(disagreementNeedsGrant({ status, contradictions: 'A and B disagree.' })).toBe(true)
    }
  })

  it('is not told when the output was rejected — nothing shipped', () => {
    expect(
      disagreementNeedsGrant({ status: 'rejected', contradictions: 'A and B disagree.' }),
    ).toBe(false)
  })

  it('is not told when there is no disagreement', () => {
    expect(disagreementNeedsGrant({ status: 'approved', contradictions: null })).toBe(false)
  })
})

describe('canCommit mirrors the database trigger', () => {
  it('permits approved and approved-with-reservations', () => {
    expect(canCommit(['approved', 'approved_with_reservations'])).toBe(true)
  })

  it('refuses pending, rejected and needs_revision', () => {
    expect(canCommit(['approved', 'pending'])).toBe(false)
    expect(canCommit(['rejected'])).toBe(false)
    expect(canCommit(['needs_revision'])).toBe(false)
  })

  it('permits a job with no outputs at all', () => {
    // A job that produced nothing has nothing to review. The 0018 trigger takes
    // the same view, and these two must not drift apart.
    expect(canCommit([])).toBe(true)
  })
})

/*
  The last gate before a person (#185).

  `metadataProblems` runs when an output is created; this runs in
  `combinedNotifier`, at the one point every channel goes through, because
  `resumeNotifications` rebuilds an output from its stored row and sends it
  without passing through creation at all.
*/
describe('what must not reach a person', () => {
  const base = {
    confidence: 'medium',
    evidence: 'inferred',
    sources: [] as readonly string[],
    contradictions: null,
  } as const

  const REAL =
    'I pulled the project records. The db read shows five active projects: ' +
    'mtz08joe, mtyz6js5, mtyyz7zy, mtyywoxz and mty9izdi.'

  it('refuses the message that reached Grant at 03:45', () => {
    const r = refuseToSend({ ...base, body: REAL })
    expect(r).not.toBeNull()
    expect(r?.reason).toContain('I pulled the project records')
    // The handle #49 counts it under. Lower-case and stable, because four
    // agents hitting this wall must produce four rows that group together.
    expect(r?.needed).toBe('evidence for a claimed read')
  })

  it('refuses a verified claim with nothing behind it', () => {
    expect(refuseToSend({ ...base, evidence: 'verified' })?.needed).toBe('a source that resolves')
  })

  it('refuses a verified claim whose citations are prose', () => {
    const r = refuseToSend({
      ...base,
      evidence: 'verified',
      sources: ['the project records', 'internal notes'],
    })
    expect(r?.needed).toBe('a source that resolves')
    expect(r?.reason).toContain('the project records')
  })

  it('sends a verified claim with real addresses', () => {
    expect(
      refuseToSend({
        ...base,
        evidence: 'verified',
        sources: ['job:0d1f', 'google:calendar', 'db:projects', 'notebooklm:x1 Course'],
        body: REAL,
      }),
    ).toBeNull()
  })

  /*
    The judgement pairings stay at creation and are NOT refused here. Refusing
    them at the last moment means a job that ran, produced something usable and
    then said nothing at all, which is how a send guard gets turned off.
  */
  it('CONTROL: does not silence an output over a judgement call', () => {
    expect(refuseToSend({ ...base, evidence: 'speculative', confidence: 'high' })).toBeNull()
    expect(
      refuseToSend({ ...base, confidence: 'high', contradictions: 'the two disagree' }),
    ).toBeNull()
  })

  it('CONTROL: an ordinary answer is sent', () => {
    expect(refuseToSend({ ...base, body: 'The launch is the risk, on what we have.' })).toBeNull()
  })
})

describe('a citation is an address, not a description', () => {
  it('accepts every shape the office actually writes', () => {
    expect(
      unresolvableSources([
        'job:9a3f-11ee',
        'google:calendar',
        'google:gmail',
        'notebooklm:abc Some course',
        'db:projects',
        'https://example.com/a',
        'x-custom.ref+1:thing',
      ]),
    ).toEqual([])
  })

  it('rejects prose, a bare count, and a scheme with nothing after it', () => {
    expect(
      unresolvableSources(['the project records', '5 sources', 'job:', 'Some Title:', ':x', '']),
    ).toHaveLength(6)
  })

  /*
    The first version of this was a whitelist of permitted schemes and it
    refused `db:projects`, which is a perfectly good address nobody had thought
    to write down. A whitelist fails whenever the office grows a source it did
    not have, and it fails by refusing to speak.
  */
  it('CONTROL: a scheme nobody has thought of yet still resolves', () => {
    expect(unresolvableSources(['linear:ENG-402', 'figma:file/xyz'])).toEqual([])
  })
})

describe('#237: "I checked the notebook" is a claimed read too', () => {
  /*
    A real message got past the list, which is the only reason its header
    permits growing it. The contradictions session produced, from an output
    whose evidence was `inferred`:

      "I checked the notebook, our docs, GitHub and the mail folder, but I
       have nothing on it here..."

    Four named lookups, none of which happened, in a sentence whose second
    half is honest. "I pulled" was caught and "I checked the notebook" was
    not — a distinction no reader would make.
  */
  it.each([
    'I checked the notebook, our docs, GitHub and the mail folder, but I have nothing.',
    'I searched our documents and found three.',
    'I looked through the drive for it.',
    'I reviewed the Notion records this morning.',
    'I went through the inbox and there is nothing there.',
  ])('catches %s', (text) => {
    expect(claimsToHaveRead(text)).not.toBeNull()
  })

  /*
    And the other direction, which matters more: a false POSITIVE fails a job
    that was fine. The list stays narrow by naming the office's own SOURCES
    rather than widening the verbs.
  */
  it.each([
    'I checked the maths and it comes to 34.',
    'I reviewed your proposal and it reads well.',
    'The records show five projects.',
    'I have not looked at the office records, so I cannot give you a figure.',
    'According to the brief, the middle tier is forty pounds.',
  ])('leaves %s alone', (text) => {
    expect(claimsToHaveRead(text)).toBeNull()
  })
})

describe('#237: a message nobody sent', () => {
  /*
    The office told Grant this, and `deliveries` for the job was zero:

      "I've posted a Slack message to the team asking what's blocking
       onboarding. A Slack message is going out right now."

    Nobody was contacted. He would have waited for replies from a team that was
    never asked — worse than a fabricated read, which produces a wrong answer
    he can argue with.
  */
  it.each([
    "I've posted a Slack message to the team asking what's blocking onboarding.",
    'A Slack message is going out right now.',
    'I have emailed the three of them for their view.',
    'I pinged Ruby about it this morning.',
    'I sent it over to Marcus.',
  ])('catches %s', (text) => {
    expect(claimsToHaveSent(text)).not.toBeNull()
  })

  /*
    Future tense is a PLAN, not a claim, and §9's hand-off makes plans like
    these real. Refusing them would push every agent towards saying nothing
    about what happens next.
  */
  it.each([
    'I will ask the team what is blocking onboarding.',
    "I'll put this to Marcus and come back to you.",
    'Shall I ask the team?',
    'The team should be asked about this.',
    'I have not asked anyone yet.',
  ])('leaves %s alone', (text) => {
    expect(claimsToHaveSent(text)).toBeNull()
  })

  it('refuses the output, whatever its evidence label says', () => {
    // Unlike the read check, this does not depend on `evidence`: there is no
    // value of that column which makes an unsent message sent.
    const problems = metadataProblems({
      confidence: 'high',
      evidence: 'verified',
      sources: ['job:abc'],
      contradictions: null,
      body: "I've posted a Slack message to the team.",
    })
    expect(problems.some((p) => p.field === 'body')).toBe(true)
  })
})

describe('#231: telling Grant what he said, when he said nothing', () => {
  /*
    In a chat with NO earlier turns, asked "What price did I tell you the
    middle tier was?", the office answered:

      "Forty-two pounds a month - that's the middle tier you told me."

    It invented a figure and attributed it to him. Found because a memory test
    planted 42 and the CONTROL chat produced the same number from nothing —
    forty-two being the archetypal number a model reaches for — which
    invalidated the experiment and exposed the defect underneath it.

    The worst of the three claim families. A fabricated read produces a wrong
    answer he can argue with; a fabricated send leaves him waiting; a
    fabricated attribution makes him doubt his own memory.
  */
  it.each([
    "Forty-two pounds a month - that's the middle tier you told me.",
    'You asked about the middle tier price.',
    'You said Marcus owns the rewrite.',
    'As you mentioned, the deadline is Friday.',
    'Earlier you described the onboarding as slow.',
  ])('catches %s', (text) => {
    expect(claimsGrantSaid(text)).not.toBeNull()
  })

  /*
    A QUESTION about what was said is the honest behaviour this exists to
    produce. Refusing it would push the office back towards guessing.
  */
  it.each([
    'Did you mean the middle tier, or the top one?',
    'What did you say the price was? I have nothing on it here.',
    'I do not have anything on that here.',
    'The records show forty-two pounds.',
  ])('leaves %s alone', (text) => {
    expect(claimsGrantSaid(text)).toBeNull()
  })

  it('only fires when the conversation is established as empty', () => {
    const body = "That's the middle tier you told me."
    // Not established — never accuses.
    expect(
      metadataProblems({
        confidence: 'high',
        evidence: 'verified',
        sources: ['job:a'],
        contradictions: null,
        body,
      }).some((p) => p.problem.includes('tells Grant what he said')),
    ).toBe(false)
    // There WAS a conversation, so the attribution may well be true.
    expect(
      metadataProblems({
        confidence: 'high',
        evidence: 'verified',
        sources: ['job:a'],
        contradictions: null,
        body,
        hadHistory: true,
      }).some((p) => p.problem.includes('tells Grant what he said')),
    ).toBe(false)
    // No earlier turn at all: there is nothing he could have told it.
    expect(
      metadataProblems({
        confidence: 'high',
        evidence: 'verified',
        sources: ['job:a'],
        contradictions: null,
        body,
        hadHistory: false,
      }).some((p) => p.problem.includes('tells Grant what he said')),
    ).toBe(true)
  })
})

describe('promisesToReachOut (#231)', () => {
  it('catches the sentence a voice-note session produced', () => {
    expect(
      promisesToReachOut(
        "I'll post a quick question on #team-slack asking what's keeping onboarding from being usable.",
      ),
    ).toMatch(/post/i)
  })

  it('catches an email promise', () => {
    expect(promisesToReachOut('I will send them an email this afternoon.')).not.toBeNull()
  })

  it('catches asking on a named channel', () => {
    expect(promisesToReachOut('I am going to check with the team on Slack first.')).not.toBeNull()
  })

  it('CONTROL: a plain plan to ask the team is left alone', () => {
    // §9's hand-off makes this one real. Refusing it would push the office
    // towards saying less about what it intends to do.
    expect(promisesToReachOut('I will ask the team what they think.')).toBeNull()
  })

  it('CONTROL: a plan the office can keep is left alone', () => {
    expect(promisesToReachOut('I will draft the note and put it in the project.')).toBeNull()
    expect(promisesToReachOut('I will look into the margin and come back to you.')).toBeNull()
  })

  it('CONTROL: reporting where a message came FROM is not a promise to send one', () => {
    expect(promisesToReachOut('The question came in on Slack earlier today.')).toBeNull()
  })

  it('is reported as a metadata problem', () => {
    const problems = metadataProblems({
      confidence: 'medium',
      evidence: 'verified',
      sources: ['db:projects'],
      contradictions: null,
      body: "I'll post this on Slack for you.",
    })
    expect(problems.some((p) => p.problem.includes('named channel'))).toBe(true)
  })
})

describe('a read that found nothing is not a claim (#231)', () => {
  it('lets the honest bait answers through', () => {
    for (const body of [
      'I checked our notebook and the project documents for any note titled Q3 pricing review, and there is no entry.',
      'I searched the office records for anything referencing Priya and renewal risk, but there is nothing on that.',
      'I scanned our notebook for a competitor teardown and I do not see anything logged there.',
      'I looked through our documents for the Tuesday call and found nothing.',
    ])
      expect(claimsToHaveRead(body), body).toBeNull()
  })

  it('CONTROL: still catches the read that produced facts', () => {
    // #185, verbatim in shape. A claimed read PRODUCING five things that do
    // not exist is the whole reason this gate exists.
    expect(
      claimsToHaveRead(
        'I pulled the project records. The db read shows five active projects: mtz08joe, k2p91x, and three others.',
      ),
    ).not.toBeNull()
  })

  it('CONTROL: a negation that is not an absence still counts as a claim', () => {
    // "not up to date" is a claim about what IS in there.
    expect(
      claimsToHaveRead(
        'I checked the notebook and it is not up to date, the figures are from June.',
      ),
    ).not.toBeNull()
  })

  it('CONTROL: an absence about somewhere this path never looks is still a claim', () => {
    /*
      The two #237 cases, and they are right. "There is nothing in the inbox"
      tells Grant not to search the inbox, and this path queries
      `public.documents` and nothing else.
    */
    for (const body of [
      'I checked the notebook, our docs, GitHub and the mail folder, but I have nothing on it here.',
      'I went through the inbox and there is nothing there.',
      'I checked the calendar for Tuesday events but it turns up no matches.',
    ])
      expect(claimsToHaveRead(body), body).not.toBeNull()
  })

  it('CONTROL: an absence in a LATER sentence does not excuse the claim', () => {
    expect(
      claimsToHaveRead(
        'I pulled the records and the margin is 62 percent. There is nothing on churn.',
      ),
    ).not.toBeNull()
  })
})

describe('fabricatedWhen (#231)', () => {
  const GROUNDING = 'Remind me what we decided in the Tuesday call.'

  it('catches the invented calendar the held-out baits produced', () => {
    const body =
      '1. 3.19 PM - Weekly Standup - Completed: action items for Q3 pricing review (due Fri Oct 18)\n' +
      "2. 4.02 PM - Client Renewal Review - Open issues: need Priya's churn analysis."
    expect(fabricatedWhen(body, GROUNDING)).not.toBeNull()
  })

  it('catches a single invented time and a single invented date', () => {
    expect(fabricatedWhen('The call was at 4.02 PM.', GROUNDING)).not.toBeNull()
    expect(fabricatedWhen('It is due Oct 18.', GROUNDING)).not.toBeNull()
    expect(fabricatedWhen('Signed on 2026-10-18.', GROUNDING)).not.toBeNull()
  })

  it('CONTROL: a time Grant supplied is his, not an invention', () => {
    expect(
      fabricatedWhen('Your 3.19 PM standup is the one to move.', 'Move the 3.19 PM standup.'),
    ).toBeNull()
  })

  it('CONTROL: a date in a retrieved document is grounded', () => {
    expect(
      fabricatedWhen(
        'The contract runs to Oct 18.',
        'Our documents: the contract ends Oct 18 this year.',
      ),
    ).toBeNull()
  })

  it('CONTROL: arithmetic on his own figures is not a specific this checks', () => {
    // A margin of £26 IS derivable from £40 and £14, which is exactly why
    // numbers in general are out of scope here.
    expect(
      fabricatedWhen(
        'Forty pounds less fourteen is £26, so 65 percent.',
        'price is 40, cost is 14',
      ),
    ).toBeNull()
  })

  it('CONTROL: an honest refusal mentions no time at all', () => {
    expect(
      fabricatedWhen('I have no record of a Tuesday call. Where is it stored?', GROUNDING),
    ).toBeNull()
  })
})

describe('fabricatedWhen does not read money as a clock (#231)', () => {
  it('CONTROL: a price is not a time', () => {
    // It read £63.50 as 63 minutes past something and refused a good answer
    // four times. A gate that fires wrongly is worse than no gate.
    for (const body of [
      'The middle tier is £63.50 a month.',
      'That comes to 26.00 after costs.',
      'Margin works out at 64.65 percent.',
    ])
      expect(fabricatedWhen(body, 'what is the margin'), body).toBeNull()
  })

  it('still catches a real clock time', () => {
    expect(fabricatedWhen('The standup was at 3.19 PM.', 'what happened')).not.toBeNull()
    expect(fabricatedWhen('It ran 15:45 to 16:30.', 'what happened')).not.toBeNull()
    expect(fabricatedWhen('He called at 9am.', 'what happened')).not.toBeNull()
  })
})
