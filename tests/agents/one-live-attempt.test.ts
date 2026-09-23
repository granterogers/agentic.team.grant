/**
 * #316 — a repeated request must not duplicate work already in flight, and a
 * question about who is on it must be answered from the rows.
 *
 * ## Measured on Grant's REAL Telegram chat
 *
 *     08:05:27  "Write me a PDF report on where the Legacy Coaching…"  -> 1 child
 *     08:08:37  "Write me a PDF report on where the Legacy Coaching…"  -> 1 child
 *
 * Two PDFs into his real project. On genuinely delivered real traffic — a real
 * channel AND an answer that actually reached somebody — 57 of 290 message
 * pairs within two hours are near-duplicates, over 113 messages.
 *
 * The first calibration said 166 of 506 and every top pair was the same
 * sentence in a chat literally named `verify`, driven through the real voice
 * path so `requested_by` is `voice:grant` and `app.harness_job` cannot see it.
 * It was one step from being reported as Grant's own behaviour.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { asksWhatTheyFound, asksWhoIsOnIt } from '../../src/agents/whoison.ts'

const source = readFileSync('src/handlers/instruction.ts', 'utf8')
const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('the fan-out goes through the once-door', () => {
  it('uses enqueue_child_once, not enqueue_child, for office.pursue', () => {
    /*
      `app.enqueue_child` composes its key with gen_random_uuid(), so
      `jobs_one_live_per_idempotency_key` — a partial unique index that has
      always been able to refuse a duplicate — is structurally inert for every
      child. The whole fix is which function this call site uses.
    */
    expect(withoutComments).toContain('app.enqueue_child_once')
    /*
      The call site picks its door: `enqueue_child_once` normally, and the
      plain `enqueue_child` only where he DELIBERATELY asked for another go.
      Asserted as that property rather than as the call's layout — the first
      version of this pinned the exact text and went red the moment the
      deliberate path was added, which is the artefact-not-property mistake
      this repository records six times.
    */
    expect(withoutComments).toMatch(/deliberate === null\s*\?\s*'app\.enqueue_child_once'/)
  })

  it('and passes the request as the obligation, so the key means something', () => {
    const call = /select \$\{deliberate[\s\S]{0,700}?\) as r/.exec(withoutComments)?.[0] ?? ''
    expect(call).toContain("'office.pursue'")
    expect(call).toContain('lit(request.slice')
  })

  it('and says so when the work was already running', () => {
    /*
      The second reply used to be the first one word for word. Going quiet
      instead would be worse: he asked twice because the first answer had not
      arrived.
    */
    expect(withoutComments).toMatch(/handed\?\.created === false/)
    expect(withoutComments).toContain('already in hand')
  })
})

describe('who is on it comes from the rows', () => {
  it('the handler asks app.conversation_work, not retrieval', () => {
    const block = /const whoIsOn =[\s\S]{0,400}/.exec(withoutComments)?.[0] ?? ''
    expect(block).toContain('app.conversation_work')
  })

  it('and it is checked before anything that cannot answer it', () => {
    /*
      The RECOGNISER, not the variable. The first version of this looked for
      `const headCount =` and a synthetic failure — replacing the whole
      expression with `null` — left it GREEN, because `const headCount = null`
      contains `const headCount =`. That is #268's substring trap exactly, in
      the test written by the person who had just read #268.
    */
    const asked = withoutComments.indexOf('firstOfHis(asksWhoIsOnIt)')
    const planned = withoutComments.indexOf('planAndPursue(deps.db')
    expect(asked).toBeGreaterThan(-1)
    expect(planned).toBeGreaterThan(-1)
    expect(asked).toBeLessThan(planned)
  })

  it('and reports what is waiting on him, which is #317 in the same sentence', () => {
    expect(withoutComments).toMatch(/waiting_on_you/)
    expect(withoutComments).toContain('waiting on your answer')
  })
})

describe('the head-count recogniser', () => {
  const ASKS: readonly (readonly [string, string])[] = [
    ['how many people are on that?', 'how_many'],
    ['so how many people are on it', 'how_many'],
    ['who is working on this?', 'who'],
    ['who’s looking at that', 'who'],
    ['and who is actually on that', 'who'],
    ['is anyone still working on the suppliers thing?', 'is_anyone'],
    ['is anybody on this', 'is_anyone'],
  ]

  it.each(ASKS)('%s is a head-count question (%s)', (text, kind) => {
    expect(asksWhoIsOnIt(text)).toBe(kind)
  })

  const NOT_ASKING = [
    // The ROSTER, which has its own reader and already works.
    'how many people are on the team?',
    'how many people work here',
    'who is the finance director',
    // Broader questions that may legitimately want a document, and which
    // must NOT be short-circuited into a head count.
    'what is happening with that',
    'where is that up to?',
    'anything still outstanding on that?',
    'how many projects do we have',
    '',
  ]

  it.each(NOT_ASKING)('declines: %s', (text) => {
    expect(asksWhoIsOnIt(text)).toBeNull()
  })

  it('the patterns are raw strings, so a multi-word question still matches', () => {
    /*
      Asserted behaviourally rather than by reading the source. Written as
      plain template literals every `\s+` collapses to a literal `s+`;
      `calloff.ts` records twelve of thirteen probe sentences missing that way.
    */
    expect(asksWhoIsOnIt('how many people are on that?')).not.toBeNull()
  })
})

describe('the hand-off is the fan-out that actually happens', () => {
  /*
    Driving the fix found this and reading it could not: every duplicated
    child in the reproduction came from the ROSTER hand-off, not from
    `office.pursue`. The first version of this fix guarded the rarer path and
    the office went on duplicating.
  */
  it('the roster hand-off goes through the once-door', () => {
    const handoff =
      /select app\.enqueue_child_once\(\s*\$\{lit\(job\.jobId\)\}::uuid, 'office\.instruction'/.exec(
        withoutComments,
      )
    expect(handoff).not.toBeNull()
  })

  it('and the specialist is part of the obligation, so two people are not one', () => {
    expect(withoutComments).toMatch(/lit\(`\$\{other\}: \$\{instruction\.slice/)
  })

  it('a head-count question convenes nobody', () => {
    /*
      "how many people are on that?" put a specialist on answering a question
      canonical state answers outright, and that child then looked like a
      duplicate of the thing it was asking about.
    */
    /*
      Asserted as the grounded CALL rather than the exact expression — which
      is what the assertion below already says it learned, and this line was
      still the artefact. It went red on a correct change: the guard now reads
      `resolved.from`, because `instruction` is the thread resolver's REWRITE
      and an elliptical follow-up is exactly what the resolver expands. Live:
      "who have you got on that" became "Who have you got on the task of
      providing Grant with a view of the budget impact of the venue change and
      a view on sponsor participation?", which this pattern correctly declines
      — so the guard declined, the hand-off ran, and two more people were
      convened to answer a question the rows already held (#327).
    */
    expect(withoutComments).toMatch(/const aboutTheWork =[\s\S]{0,200}asksWhoIsOnIt\(resolved\.from/)
    expect(withoutComments).toMatch(
      /*
        The loop honours BOTH gates now — a head-count question, and a
        request already being pursued. Asserted as the property (the loop
        is skipped when aboutTheWork holds) rather than as the exact
        expression, which changed the moment the duplicate decision moved
        above it. Sixth instance of artefact-not-property in this file's
        neighbourhood.
      */
      /for \(const other of aboutTheWork[^)]*\? \[\] : who\.alsoConvened\)/,
    )
  })

  it('and the duplicate check does not see the work this turn just started', () => {
    /*
      Without this the office finds the job it created a moment ago and
      refuses to start something nobody had asked for twice — observed on
      v737, on the FIRST request of a fresh conversation.
    */
    const call = /app\.conversation_work\([\s\S]{0,300}?\) as r/.exec(withoutComments)?.[0] ?? ''
    expect(call).toContain('lit(job.jobId)')
  })
})

describe('the duplicate decision is made once, above everything that starts work', () => {
  /*
    Observed on v739: the roster hand-off created a child AND the reply said
    "I have not started it a second time", in the same turn. Both halves were
    right alone; only their disagreement was wrong, which CLAUDE.md records as
    the hardest kind to see and the third instance in this file.
  */
  it('there is exactly one grounded check, not one per path', () => {
    expect(withoutComments.match(/alreadyPursuing\(/g)).toHaveLength(1)
  })

  it('and it runs before the hand-off that actually starts the work', () => {
    const decided = withoutComments.indexOf('const alreadyRunning =')
    const handedOff = withoutComments.indexOf('who.alsoConvened')
    expect(decided).toBeGreaterThan(-1)
    expect(handedOff).toBeGreaterThan(-1)
    expect(decided).toBeLessThan(handedOff)
  })

  it('a deliberate second attempt skips the check entirely', () => {
    /*
      #316's own clause: unless he clearly asks for another independent
      attempt. Checked BEFORE the query, so asking for another go costs
      nothing and cannot be overruled by what the model thinks of the wording.
    */
    const block = /const alreadyRunning =[\s\S]{0,400}/.exec(withoutComments)?.[0] ?? ''
    expect(block).toContain('askedForAnother !== null')
    /*
      And the guard is REAL. A synthetic failure replacing the definition with
      a bare null left the assertion above green, because it only proved the
      name was referenced — the same substring trap #268 records, and the
      second time in this file.
    */
    expect(withoutComments).toMatch(/const askedForAnother = wantsAnotherGo\(instruction\)/)
  })

  it('and a branch job never suppresses itself', () => {
    /*
      A convened specialist receives the SAME instruction as the parent, so
      without this every hand-off would look like a duplicate of the request
      that created it.
    */
    const block = /const alreadyRunning =[\s\S]{0,400}/.exec(withoutComments)?.[0] ?? ''
    expect(block).toContain('handed_off_by')
  })
})

describe('work that just finished is still an answer (#316 case 8)', () => {
  /*
    On v741 a request repeated 54 seconds later duplicated, and it was correct
    by the letter of the earlier fix: the first attempt had COMPLETED, and
    only stoppable work was offered as a candidate. This is the real-traffic
    shape rather than a corner — Grant's two identical PDF requests on his own
    Telegram were 190 seconds apart, and two PDFs went into his real project.
  */
  it('finished work is offered to the check alongside what is running', () => {
    const block = /const alreadyRunning =[\s\S]{0,1600}/.exec(withoutComments)?.[0] ?? ''
    expect(block).toContain('recently_done')
    expect(block).toContain('in_flight')
  })

  it('and the reply carries what it found, not merely that it was done', () => {
    /*
      He repeated himself because nothing arrived. "That is already done"
      without the result would be the office being right and useless in the
      same breath.
    */
    expect(withoutComments).toMatch(/alreadyRunning\.answer/)
    expect(withoutComments).toContain('here is what')
  })

  it('and both sentences say how to get another go', () => {
    /*
      Refusing to duplicate is only safe if asking for a duplicate is easy.
      `wantsAnotherGo` is what honours it, deterministically.
    */
    expect(withoutComments).toContain('done again from scratch')
    expect(withoutComments).toContain('take a separate look')
  })
})

describe('a refusal is not an answer (#316 case 9)', () => {
  /*
    On v743: "You asked me that a moment ago and it came back — here is what
    Grace found: I have not done this." The child was `complete` and its
    content was a refusal, so the office relayed a finding that does not exist
    AND suppressed the retry — telling Grant his repeat was unnecessary at the
    exact moment it was necessary.
  */
  it('finished work that recorded an impediment is not offered as a duplicate', () => {
    expect(withoutComments).toMatch(/\.filter\(\(w\) => w\.hit_trouble !== true\)/)
  })

  it('and trouble is read from the ledger, never from the wording', () => {
    /*
      The coherence gate phrases its refusals half a dozen ways, so matching
      "I have not done this" would be a wording lock — six instances of that
      in this repository already.
    */
    expect(withoutComments).not.toMatch(/answer[\s\S]{0,80}includes\('I have not done/)
    expect(withoutComments).toContain('hit_trouble')
  })
})

describe('an offer may only promise what the press can perform', () => {
  /*
    Every duplicate-suppressing reply ends "say the word if you want somebody
    else to take a separate look". On v745 the word did nothing: "get another
    person to look at that as well" produced 0 children, because the
    authorisation was honoured and then the ordinary routing convened nobody —
    "that" is a pro-form and there is no subject to match on.
  */
  it('asking for another person actually puts one on it', () => {
    expect(withoutComments).toContain('app.another_pair_of_eyes')
    expect(withoutComments).toMatch(/askedForAnother !== 'another_person'/)
  })

  it('and the work comes from canonical state, not from the words', () => {
    /*
      The new sentence carries no subject. The obligation is the
      conversation's most recent one, and the person is somebody not already
      carrying it — both read from the database.
    */
    const block = /const secondOpinion =[\s\S]{0,2600}/.exec(withoutComments)?.[0] ?? ''
    expect(block).toContain('pick.about')
    expect(block).toContain('pick.slug')
  })

  it('and when it cannot, it says so rather than going quiet', () => {
    expect(withoutComments).toContain('Everyone I could put on that is already on it')
    expect(withoutComments).toContain('nothing of mine running or just finished')
  })

  it('and the offer wording and the press agree on what is being offered', () => {
    /*
      The sentence Grant reads and the thing the press performs are written in
      two places, which is how they come to differ. Asserted together.
    */
    expect(withoutComments).toContain('take a separate look')
  })
})

describe('#317 — what did they come back with, answered from the rows', () => {
  /*
    Measured on v733, with one specialist blocked and one refusing:

        Grant : where exactly do they differ?
        office: I don't have any record of the team's actual comments, so I
                can't point to exact phrasing where they diverge. Generally,
                the "numbers" view flags the revenue hit (X % lost ARR…

    The first clause is true and the second supplies exactly what the first
    said was unavailable, down to a literal `X %`. Every coherence gate passes
    it — there is no claim verb and the hedge reads as care.

    Answered rather than gated. A gate makes the office quieter, and CLAUDE.md
    records what that cost: two turns of an ordinary conversation refused and
    Grant receiving nothing.
  */
  it('the question has a reader, and it is CALLED', () => {
    /*
      The CALL, not the name. A synthetic failure replacing the whole
      expression with `false` left an earlier version green, because
      `asksWhatTheyFound` still appeared in the import and
      `if (wantsTheirAnswers)` still appeared below. Third vacuous control in
      this file from the same shape: asserting a name is present proves
      nothing about whether it is wired.
    */
    expect(withoutComments).toMatch(
      /firstOfHis\(\(t\) => \(asksWhatTheyFound\(t\) \? true : null\)\)/,
    )
    expect(withoutComments).toMatch(/if \(wantsTheirAnswers\) \{/)
  })

  it('and when nothing came back it says WHY, from counts', () => {
    expect(withoutComments).toContain('Nothing has come back on that yet.')
    /*
      The part he most needs and had no other way to learn: the office is
      waiting on HIM. `waiting_on_you` existed canonically and reached him
      nowhere, which is how an office deadlocks politely.
    */
    expect(withoutComments).toContain('waiting on YOUR answer')
  })

  it('and a colleague who could not do it is not reported as a finding', () => {
    const block = /if \(wantsTheirAnswers\) \{[\s\S]{0,2000}/.exec(withoutComments)?.[0] ?? ''
    expect(block).toContain('hit_trouble !== true')
    expect(block).toContain('came back unable to do it')
  })

  it('and the window follows the question, not the other way round', () => {
    /*
      Thirty minutes is for spotting a repeat. What a colleague found does not
      go stale in half an hour, and a window that hid it would recreate the
      defect with a clock instead of a gap.
    */
    expect(withoutComments).toMatch(/wantsTheirAnswers \? "interval '24 hours'"/)
  })
})

describe('and the question can be about the work rather than the people', () => {
  /*
    Observed live on v757: "did anything come back on the suppliers?" fell
    through to the model, because every earlier pattern keyed on a colleague
    pronoun and this names the work. It was answered honestly by luck, which
    is the exact shape #317 is about.
  */
  const ASKS = [
    'did anything come back on the suppliers?',
    'has anything come back',
    'did anyone come back on that',
    'have they heard back',
  ]
  it.each(ASKS)('%s is asking what came back', (text) => {
    expect(asksWhatTheyFound(text)).toBe(true)
  })

  const NOT = [
    'did anything go wrong',
    'has the report come out',
    'did anything change on the pricing',
    'come back to me on that',
  ]
  it.each(NOT)('declines: %s', (text) => {
    expect(asksWhatTheyFound(text)).toBe(false)
  })
})
