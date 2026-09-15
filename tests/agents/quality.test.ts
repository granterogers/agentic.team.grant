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
  claimsToHaveRead,
  disagreementNeedsGrant,
  metadataProblems,
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
