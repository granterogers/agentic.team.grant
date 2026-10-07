import { describe, expect, it } from 'vitest'
import {
  type ClaimClass,
  type ConsequenceEvidence,
  consequenceClaims,
  emailCapabilityClaims,
  loadConsequenceEvidence,
  unevidencedClaims,
} from '../../src/agents/consequence.ts'
import { claimsToHaveSent, metadataProblems } from '../../src/agents/quality.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

/*
  Claims of consequence require evidence of consequence.

  The DETECTOR decides when a sentence is a claim and what kind; the EVIDENCE decides whether it is true. These
  tests drive both halves separately and together, with the controls CLAUDE.md asks for: every positive has
  its negation, its question, its future and its quotation beside it, and a corpus of TRUE answers that mention
  the same verbs innocuously must not be refused at all.
*/

const NONE: ConsequenceEvidence = {
  mailed: 0,
  delivered: 0,
  published: 0,
  scheduled: 0,
  removed: 0,
  approved: 0,
  drafted: 0,
  handoffs: 0,
  colleagues: ['Claire', 'Tom', 'Emma', 'Daniel', 'Marcus', 'Ruby', 'Oliver', 'Grace'],
  canEmail: false,
}
const evidence = (over: Partial<ConsequenceEvidence>): ConsequenceEvidence => ({ ...NONE, ...over })

const clsOf = (text: string): ClaimClass[] => consequenceClaims(text).map((c) => c.cls)

describe('the detector: what is a CLAIM of consequence', () => {
  const CLAIMS: [string, ClaimClass][] = [
    // the four phrasings the audit reproduced as missed, and the others the e2e proof lists
    ["Email sent to Kevin, cc'd your accountant.", 'mail'],
    ['Emailed Kevin the report.', 'mail'],
    ["I've shared it with Kevin.", 'outbound'],
    ['The report has been sent to Kevin.', 'outbound'],
    ['The report has been sent.', 'outbound'],
    ['Email sent to Kevin.', 'mail'],
    ['The report was sent to Kevin and your accountant.', 'outbound'],
    ['Kevin has been sent the report.', 'outbound'],
    ["I've cc'd your accountant.", 'outbound'],
    ["I've let Kevin know.", 'outbound'],
    ['The report has been delivered to Kevin.', 'outbound'],
    // the ones already caught, which must stay caught
    ['I have sent the email to Kevin.', 'mail'],
    ['I sent Kevin the report.', 'outbound'],
    ['I posted a Slack message to the team.', 'outbound'],
    // one per verb in the brief
    ['I emailed Kevin.', 'mail'],
    ['I sent the invoice to the client.', 'outbound'],
    ['I shared the folder with the client.', 'outbound'],
    ['I posted the summary in the channel.', 'outbound'],
    ['I messaged Kevin about the deposit.', 'outbound'],
    ['I notified the supplier.', 'outbound'],
    ['I forwarded the thread to the accountant.', 'outbound'],
    ['I uploaded the report to the shared drive.', 'publish'],
    ['I booked the venue for Friday.', 'schedule'],
    ['I scheduled the review task for Friday.', 'schedule'],
    ['I deleted the old milestone.', 'remove'],
    ['I cancelled the Thursday meeting.', 'remove'],
    ['I canceled the booking.', 'remove'],
    ['I approved the draft.', 'approve'],
    ['Booked the venue for Friday.', 'schedule'],
    ['Deleted the old milestone.', 'remove'],
    ['Approved the budget.', 'approve'],
    ['Uploaded the report to Drive.', 'publish'],
    ['Done - I sent the report to Kevin.', 'outbound'],
    // "gone ahead with" + the act as a gerund or a noun, and the passive "gone out" (journey M: a model that obeyed a
    // document wrote "Approved. I have gone ahead with sending everything", and it reached the person verbatim)
    ['Approved. I have gone ahead with sending everything as the notes said.', 'outbound'],
    ['I went ahead with the send.', 'outbound'],
    ['I have gone ahead with posting the update.', 'outbound'],
    ["We've gone ahead with forwarding the thread.", 'outbound'],
    ['I have gone ahead with sharing it with the client.', 'outbound'],
    ['Everything has gone out.', 'outbound'],
    ['The report has now gone out to Kevin.', 'outbound'],
    // typography: a model emits curly apostrophes
    ['I’ve emailed Kevin the report.', 'mail'],
    // drafts
    ['I drafted an email to Kevin.', 'draft'],
    ['A draft email to Kevin is ready for your review.', 'draft'],
  ]
  it.each(CLAIMS)('claim: %s -> %s', (text, cls) => {
    expect(clsOf(text)).toContain(cls)
  })

  const NOT_CLAIMS = [
    // denial
    "I haven't emailed Kevin.",
    'I did not send it.',
    'I have not sent anything to Kevin.',
    'Nothing was sent.',
    'No email has been sent.',
    "The report hasn't been sent yet.",
    'It has not been emailed.',
    // future and conditional
    'I will email Kevin once you approve.',
    "I'll send it when you say.",
    "I won't send it without your approval.",
    'Once you approve, the report will be sent to Kevin.',
    'If you say so, I will book the venue.',
    'The report should have been sent by now.',
    // instruction
    'Email Kevin.',
    'Send this to Kevin when you are ready.',
    'Book the venue for Friday.',
    // question
    'Shall I send it?',
    'Should I email Kevin the report?',
    'Did Kevin get the report that was sent on Friday?',
    // reported speech and quotation
    'Kevin said he emailed it.',
    'Daniel noted that the quote was forwarded to procurement.',
    'The note reads "the invoice was emailed to the client".',
    'According to the thread, the deposit was sent to the venue.',
    // other people's acts and states
    'Kevin emailed the revised quote on Tuesday.',
    'The shared drive holds three budget files.',
    'Sent items are in the Sent folder.',
    'The approved budget is 40,000.',
    'Everything that was posted in the channel is summarised below.',
    // the new shapes' negative controls: denial, question, offer, future, report, and an unrelated "gone out"
    'I have not gone ahead with sending anything.',
    'Shall I go ahead with sending it?',
    'If you want, I can go ahead with sending it.',
    'I will go ahead with the booking once you say.',
    'The notes say we have gone ahead with sending the report last week.',
    'Nothing has gone out.',
    'Has the report gone out?',
    'The lights have gone out.',
  ]
  it.each(NOT_CLAIMS)('not a claim: %s', (text) => {
    expect(consequenceClaims(text).filter((c) => c.cls !== 'draft')).toEqual([])
  })

  it('a claim inside a block quote or a code fence is somebody else’s sentence', () => {
    expect(
      clsOf('The email you forwarded says:\n> I emailed Kevin the report.\nThat is all it says.'),
    ).toEqual([])
    expect(clsOf('The log line is:\n```\nI emailed Kevin\n```')).toEqual([])
  })
})

describe('the evidence decides whether a detected claim is TRUE', () => {
  const NEEDS: [ClaimClass, string, Partial<ConsequenceEvidence>, Partial<ConsequenceEvidence>][] =
    [
      ['mail', 'I emailed Kevin the report.', { delivered: 3, handoffs: 2 }, { mailed: 1 }],
      [
        'outbound',
        'I posted a Slack message to the team.',
        { mailed: 1, published: 1 },
        { delivered: 1 },
      ],
      [
        'publish',
        'I uploaded the report to Drive.',
        { delivered: 2, drafted: 1 },
        { published: 1 },
      ],
      [
        'schedule',
        'I scheduled the review task for Friday.',
        { delivered: 2, removed: 1 },
        { scheduled: 1 },
      ],
      ['remove', 'I deleted the old milestone.', { scheduled: 2, delivered: 1 }, { removed: 1 }],
      ['approve', 'I approved the draft.', { removed: 2, scheduled: 1 }, { approved: 1 }],
    ]
  it.each(NEEDS)(
    '%s: %s is refused without ITS evidence and accepted with it',
    (cls, text, wrong, right) => {
      // the other kinds of evidence do not stand in for this one
      const refused = unevidencedClaims(text, evidence(wrong))
      expect(refused.map((p) => p.cls)).toContain(cls)
      expect(unevidencedClaims(text, evidence(right))).toEqual([])
      // with no evidence object: communication kinds are strict, the rest are not accused
      const unknown = unevidencedClaims(text)
      expect(unknown.length > 0).toBe(cls === 'mail' || cls === 'outbound')
    },
  )

  it('an email claim is NEVER accepted by a delivery: deliveries have no email channel', () => {
    expect(
      unevidencedClaims('Email sent to Kevin.', evidence({ delivered: 5 })).map((p) => p.cls),
    ).toEqual(['mail'])
  })

  it('a hand-off to a named colleague is evidence for "I sent it over to Marcus", and only for a colleague', () => {
    const handoff = evidence({ handoffs: 1 })
    expect(unevidencedClaims('I sent it over to Marcus.', handoff)).toEqual([])
    expect(unevidencedClaims('I sent it over to Kevin.', handoff).map((p) => p.cls)).toEqual([
      'outbound',
    ])
    expect(unevidencedClaims('I sent it over to Marcus.', evidence({})).map((p) => p.cls)).toEqual([
      'outbound',
    ])
  })

  it('a task row or a task change is accepted for scheduled and cancelled respectively', () => {
    expect(
      unevidencedClaims('I scheduled the review task for Friday.', NONE, { acted: 1 }),
    ).toEqual([])
    expect(unevidencedClaims('I cancelled the venue task.', NONE, { tasksChanged: 1 })).toEqual([])
    expect(
      unevidencedClaims('I cancelled the venue task.', NONE, { tasksChanged: 0 }).map((p) => p.cls),
    ).toEqual(['remove'])
  })

  it('the correction says what is true and what to do, never an issue number', () => {
    for (const text of [
      'Email sent to Kevin.',
      'I posted it.',
      'I uploaded it to Drive.',
      'I booked it.',
      'I deleted it.',
      'I approved it.',
      'I drafted an email to Kevin.',
    ]) {
      const p = unevidencedClaims(text, NONE)
      expect(p.length, text).toBeGreaterThan(0)
      for (const x of p) expect(x.problem).not.toMatch(/#\d|§/)
    }
    expect(unevidencedClaims('Email sent to Kevin.', NONE)[0]?.problem).toMatch(
      /cannot be sent|no way to send email/,
    )
  })
})

describe('drafts: what evidence does a draft leave?', () => {
  const draftText =
    'Subject: Venue deposit\n\nHi Kevin,\nCould you confirm the deposit has landed before Friday?\nThanks, Grant'
  it('"I drafted an email to Kevin." with nothing behind it is refused', () => {
    expect(unevidencedClaims('I drafted an email to Kevin.', NONE).map((p) => p.cls)).toEqual([
      'draft',
    ])
  })
  it('allowed when the answer contains the draft', () => {
    expect(
      unevidencedClaims(`I drafted an email to Kevin for your review.\n\n${draftText}`, NONE),
    ).toEqual([])
    expect(
      unevidencedClaims(`A draft email to Kevin is ready for your review.\n\n${draftText}`, NONE),
    ).toEqual([])
  })
  it('allowed when a document was made in this job’s tree', () => {
    expect(unevidencedClaims('I drafted an email to Kevin.', evidence({ drafted: 1 }))).toEqual([])
  })
  it('"ready" with a one-line gloss and no text is still refused', () => {
    expect(
      unevidencedClaims(
        'A draft email to Kevin is ready for your review.\nIt covers the deposit.',
        NONE,
      ).map((p) => p.cls),
    ).toEqual(['draft'])
  })
  it('a draft that says it was NOT sent is a draft claim and nothing else', () => {
    expect(clsOf('This is a draft and has not been sent.')).toEqual([])
    expect(clsOf("I drafted an email to Kevin but haven't sent it.")).toEqual(['draft'])
  })
})

describe('capability language about email is itself a claim, and it is false', () => {
  it('"I can email Kevin." is refused when no email capability exists, with a plain statement to make instead', () => {
    const p = unevidencedClaims('I can email Kevin.', NONE)
    expect(p.map((x) => x.cls)).toEqual(['capability'])
    expect(p[0]?.problem).toMatch(/no email capability/)
    expect(unevidencedClaims("I'm able to send emails for you.", NONE).map((x) => x.cls)).toEqual([
      'capability',
    ])
    expect(unevidencedClaims('I can send it to Kevin by email.', NONE).map((x) => x.cls)).toEqual([
      'capability',
    ])
  })
  it('is allowed when the capability really exists, and when the office speaks of drafts', () => {
    expect(unevidencedClaims('I can email Kevin.', evidence({ canEmail: true }))).toEqual([])
    expect(unevidencedClaims('I can draft an email to Kevin for you to send.', NONE)).toEqual([])
    expect(unevidencedClaims("I can't email Kevin from here.", NONE)).toEqual([])
    expect(unevidencedClaims('I cannot send email.', NONE)).toEqual([])
    expect(unevidencedClaims('Shall I email Kevin?', NONE)).toEqual([])
  })
  it('without an evidence object the capability is not judged (unknown is not false)', () => {
    expect(unevidencedClaims('I can email Kevin.')).toEqual([])
    expect(emailCapabilityClaims('I can email Kevin.')).toHaveLength(1)
  })
})

describe('false-positive corpus: TRUE answers that mention these verbs innocuously are never refused', () => {
  const COLLEAGUES = NONE.colleagues
  // [text, evidence the true state would carry]
  const CORPUS: [string, Partial<ConsequenceEvidence>][] = [
    ['The contract says the invoice was emailed to the client on 3 March.', {}],
    ['According to the minutes, the deposit was sent to the venue last week.', {}],
    ['Daniel noted that the quote was forwarded to procurement.', {}],
    ['The approval was sent back with two comments.', {}],
    ['We sent the proposal in June, per the thread.', {}],
    ['Sent items are in the Sent folder.', {}],
    ['The newsletter went out last Tuesday according to the thread.', {}],
    ['I have not sent anything to Kevin.', {}],
    ['You asked me to email Kevin. I have not done that and I cannot send email from here.', {}],
    ['The report is ready for you to send to Kevin.', {}],
    ['Once you approve it, you can send it to Kevin yourself.', {}],
    ['The shared drive holds three budget files.', {}],
    ['The venue was booked in March and the deposit is due on 1 June.', {}],
    ['The meeting is scheduled for Friday at 10.', {}],
    ['Your calendar shows the review is booked for Thursday.', {}],
    ['The task was cancelled by Kevin last week.', {}],
    ['Kevin emailed the revised quote on Tuesday and asks about the deposit.', {}],
    ['The email from Kevin arrived at 9am.', {}],
    ['The approved budget is 40,000 and the forecast is 41,200.', {}],
    ['Scheduled for Friday: review the budget.', {}],
    ['Approved: yes. Cancelled: no.', {}],
    ['Do you want me to draft a message to Kevin?', {}],
    ['Shall I send it to Kevin?', {}],
    ['I will email Kevin once you approve.', {}],
    ["I'll send it when you say.", {}],
    ["I won't send it without your approval.", {}],
    ['I can draft an email to Kevin for you to send.', {}],
    ['I can write the message and you can send it yourself.', {}],
    ['This is a draft and has not been sent.', {}],
    ['Nothing has been sent, shared or posted.', {}],
    ['No email has been sent.', {}],
    ['Grace has been notified of the risk register change.', {}],
    ['Emma has been asked to look at the margin.', {}],
    ['You sent the message to Kevin yesterday; I can see it in the thread.', {}],
    ['Everything that was posted in the channel is summarised below.', {}],
    ['The documents that were shared with Kevin are listed in the register.', {}],
    ['Kevin has been sent the report by Daniel.', {}],
    ['The message from Kevin says he sent the figures.', {}],
    ['I shared the key findings above.', {}],
    ['The plan was deleted in the August cleanup.', {}],
    [
      'Here is the draft email to Kevin:\n\nSubject: Deposit\n\nHi Kevin,\nCould you confirm the deposit before Friday?\nThanks',
      {},
    ],
    [
      'I drafted an email to Kevin for your review.\n\nSubject: Deposit\n\nHi Kevin,\nCould you confirm the deposit before Friday?\nThanks',
      {},
    ],
    // true because a row exists
    ['I scheduled the review task for Friday.', { scheduled: 1 }],
    ['I added the task and scheduled it for Friday.', { scheduled: 1 }],
    ['I cancelled the venue task.', { removed: 1 }],
    ['I forwarded the question to Daniel.', { handoffs: 1 }],
    ['I posted the summary in the project channel.', { delivered: 1 }],
    ['I drafted an email to Kevin.', { drafted: 1 }],
    ['I uploaded the report to Notion.', { published: 1 }],
    ['I approved the draft you asked for.', { approved: 1 }],
  ]
  it(`holds ${String(CORPUS.length)} true answers`, () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(50)
  })
  it('none of them is refused, and the detector fires on at most the ones its evidence then accepts', () => {
    const refused: string[] = []
    let firedDetector = 0
    for (const [text, ev] of CORPUS) {
      if (consequenceClaims(text).length > 0) firedDetector += 1
      const p = unevidencedClaims(text, evidence(ev))
      if (p.length > 0) refused.push(`${text} -> ${p.map((x) => x.cls).join(',')}`)
    }
    expect(refused).toEqual([])
    // The detector is allowed to fire on a true answer only where evidence then accepts it:
    // exactly the eight that carry a row, plus the two drafts that carry their text.
    expect(firedDetector).toBeLessThanOrEqual(10)
    expect(COLLEAGUES.length).toBe(8)
  })
  it('the legacy detector is not stricter than the corpus allows either', () => {
    const hit = CORPUS.filter(
      ([t, ev]) => Object.keys(ev).length === 0 && claimsToHaveSent(t) !== null,
    ).map(([t]) => t)
    expect(hit).toEqual([])
  })

  // KNOWN LIMITATION, recorded so it is measured rather than discovered: a simple-past passive recount of a send
  // with no date, no named agent and no source attribution reads exactly like a claim. The refusal recovers through
  // the retry (the model is told to attribute it), and a missed fabrication is the cheaper error.
  it('KNOWN: an unattributed, undated simple-past recount of a send is treated as a claim', () => {
    expect(clsOf('The invoice was sent to the client, so the status is paid.')).toEqual([
      'outbound',
    ])
  })
})

describe('through metadataProblems, the gate the worker runs', () => {
  const base = {
    confidence: 'medium',
    evidence: 'inferred',
    sources: [],
    contradictions: null,
  } as const
  it('refuses each missed phrasing with no evidence at all (strict, as before)', () => {
    for (const body of [
      "Email sent to Kevin, cc'd your accountant.",
      'Emailed Kevin the report.',
      "I've shared it with Kevin.",
      'The report has been sent.',
    ]) {
      expect(metadataProblems({ ...base, body }).length, body).toBeGreaterThan(0)
    }
  })
  it('accepts the same words when the tree recorded a delivery (a Slack post that really went)', () => {
    expect(
      metadataProblems({
        ...base,
        body: 'I posted the summary to the team.',
        consequences: evidence({ delivered: 1 }),
      }),
    ).toEqual([])
  })
  it('still refuses an email claim when a delivery exists, and an unevidenced approval', () => {
    expect(
      metadataProblems({
        ...base,
        body: 'Email sent to Kevin.',
        consequences: evidence({ delivered: 1 }),
      }).length,
    ).toBe(1)
    expect(
      metadataProblems({ ...base, body: 'I approved the draft.', consequences: NONE }).length,
    ).toBe(1)
  })
  it('offering email is refused only when the evidence says there is no capability', () => {
    expect(
      metadataProblems({ ...base, body: 'I can email Kevin.', consequences: NONE }).length,
    ).toBe(1)
    expect(metadataProblems({ ...base, body: 'I can email Kevin.' })).toEqual([])
  })
})

describe('loadConsequenceEvidence', () => {
  const rowDb = (row: Record<string, unknown> | undefined, throws = false): SqlExecutor =>
    ({
      kind: 'fake',
      execute: async () => {
        if (throws) throw new Error('boom')
        return { rows: row === undefined ? [] : [row] }
      },
    }) as unknown as SqlExecutor
  const id = '11111111-1111-1111-1111-111111111111'
  it('reads counts, names and the email switch', async () => {
    const ev = await loadConsequenceEvidence(
      rowDb({
        mailed: 0,
        delivered: 2,
        published: 1,
        scheduled: 3,
        removed: 0,
        approved: 0,
        drafted: 1,
        handoffs: 1,
        colleagues: ['Emma'],
        can_email: false,
      }),
      id,
    )
    expect(ev).toEqual({
      mailed: 0,
      delivered: 2,
      published: 1,
      scheduled: 3,
      removed: 0,
      approved: 0,
      drafted: 1,
      handoffs: 1,
      colleagues: ['Emma'],
      canEmail: false,
    })
  })
  it('cannot look means unknown, never zero: the caller falls back to strict-for-comms only', async () => {
    expect(await loadConsequenceEvidence(rowDb(undefined, true), id)).toBeUndefined()
    expect(await loadConsequenceEvidence(rowDb(undefined), id)).toBeUndefined()
    expect(await loadConsequenceEvidence(rowDb({}), "x'; drop table jobs;--")).toBeUndefined()
  })
})
