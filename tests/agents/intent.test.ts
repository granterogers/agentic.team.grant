/**
 * §6's cost governor. The tests are mostly about the asymmetry: a question
 * misread as an assignment spends quota and produces unasked-for work, while
 * an assignment misread as a question costs one round trip. The classifier is
 * not symmetric, so neither are these.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyIntent,
  INTENT_COST,
  justifiesConsultation,
  needsClarification,
} from '../../src/agents/intent.ts'

describe('the classes it gets right outright', () => {
  it.each([
    ['What is the status of the migration?', 'question'],
    ['Tell me what the sources say', 'question'],
    ['We should maybe rethink the pricing', 'suggestion'],
    ['Just an idea: a weekly digest', 'suggestion'],
    // NOT 'discussion', though it matches the discussion rule too. The
    // question rules also fire, question is cheaper, and §6 says the cheaper
    // reading wins. Asserted as `question` deliberately: expecting
    // `discussion` here would have been asking the classifier to resolve
    // upward, which is the one thing it must never do.
    ['What do you think about the Q3 plan?', 'question'],
    ['Have a quick look at the competitor pricing', 'light_investigation'],
    ['I need you to draft the announcement', 'assignment'],
    ['Do the migration right now', 'direct_command'],
    ['Random thought, the onboarding feels long', 'thought'],
  ])('%s -> %s', (text, expected) => {
    expect(classifyIntent(text).intent).toBe(expected)
  })
})

describe('auxiliary verbs that open an imperative, not a question', () => {
  // The rule that classifies "Do you ...?" as a question was wrong twice: once
  // matching a bare `do`, and once matching `do` + a determiner. Both read "Do
  // the migration right now" as a question, and §6's downward rule then
  // faithfully preferred the cheap reading. These pin the distinction.
  it.each([
    'Do the migration right now',
    'Do the deploy before friday',
    'Have the report ready by tomorrow',
    'Can the release wait',
  ])('does not read %s as a question', (text) => {
    expect(classifyIntent(text).considered).not.toContain('question')
  })

  it('still reads a pronoun-subject auxiliary as a question', () => {
    for (const text of ['Do you know the deploy window', 'Is there a blocker on this']) {
      expect(classifyIntent(text).intent).toBe('question')
    }
  })

  it('catches a determiner-subject question by its question mark instead', () => {
    // The cost of dropping determiners from the interrogative rule, paid here.
    expect(classifyIntent('Do the tests pass?').intent).toBe('question')
  })

  it('lands an unpunctuated determiner question on thought, unconfident', () => {
    // The other half of that cost, and the reason it is acceptable: the miss
    // is downward. "Are the tests passing" produces a clarifying question, not
    // a job.
    const r = classifyIntent('Are the tests passing')
    expect(r.intent).toBe('thought')
    expect(r.confident).toBe(false)
    expect(needsClarification(r)).toBe(true)
  })
})

describe('ambiguity resolves downward, never upward', () => {
  it('takes the cheaper reading when two classes are argued for', () => {
    // "What if we..." is a suggestion; the question mark argues for question.
    // Question is cheaper, so question wins.
    const r = classifyIntent('What if we moved the deadline?')
    expect(r.intent).toBe('question')
    expect(r.confident).toBe(false)
    expect(r.considered.length).toBeGreaterThan(1)
    expect(r.reason).toMatch(/cheapest/)
  })

  it('never resolves upward, across every contested pair the rules can produce', () => {
    // The property, not an example of it. Whatever the rules argue for, the
    // chosen class must be the cheapest of them — an upward resolution is the
    // unbounded-cost error §6 exists to prevent.
    for (const text of [
      'What if we should maybe look into this by tomorrow?',
      'Please can you tell me the status?',
      'Thoughts? I need you to decide',
      'Quick look — what do you think?',
      'FYI we should assign this to someone urgently',
    ]) {
      const r = classifyIntent(text)
      const cheapest = [...r.considered].sort((a, b) => INTENT_COST[a] - INTENT_COST[b])[0]
      expect(r.intent, text).toBe(cheapest)
    }
  })

  it('treats an unrecognised instruction as a remark, not as work', () => {
    // The most important default in the file. Text we do not understand
    // becoming an assignment is exactly the unbounded-cost failure; becoming a
    // thought costs a question.
    const r = classifyIntent('the flange bracket on the third iteration')
    expect(r.intent).toBe('thought')
    expect(r.confident).toBe(false)
    expect(r.reason).toMatch(/remark rather than as work/)
  })

  it('does not turn "please tell me" into an assignment', () => {
    // "please <verb>" argues for assignment, but "tell me" is a question and
    // is cheaper. Getting this wrong turns every polite question into work.
    expect(classifyIntent('Please tell me where we got to').intent).toBe('question')
  })
})

describe('word boundaries', () => {
  it('does not classify on substrings', () => {
    // /can you/ inside "American youth" would make this a question. The cost
    // of a spurious match here is a spurious job.
    const r = classifyIntent('American youth demographics keep shifting')
    expect(r.matched).not.toContain('interrogative-opening')
  })
})

describe('justifiesConsultation', () => {
  it('refuses to convene anyone for cheap classes', () => {
    // §9: "Trivial work spawns no subagents. Simple factual retrieval is not a
    // team meeting."
    for (const text of ['What is the status?', 'Random thought about pricing', 'Thoughts?']) {
      expect(justifiesConsultation(classifyIntent(text)), text).toBe(false)
    }
  })

  it('allows it for a confident investigation or above', () => {
    expect(justifiesConsultation(classifyIntent('I need you to draft the plan'))).toBe(true)
  })

  it('refuses when the reading was contested, whatever the class', () => {
    // An uncertain reading is where convening a team is most expensive and
    // least justified.
    const contested = classifyIntent('What if we should maybe look into this by tomorrow?')
    expect(contested.confident).toBe(false)
    expect(justifiesConsultation(contested)).toBe(false)
  })
})

describe('needsClarification', () => {
  it('asks when the expensive reading would have done something substantive', () => {
    const r = classifyIntent('Please look into the numbers by tomorrow')
    if (!r.confident) expect(needsClarification(r)).toBe(true)
  })

  it('does not ask when both readings are cheap and harmless', () => {
    // A contested thought/question needs no clarification: the cheaper reading
    // does nothing, so being wrong costs nothing.
    const r = classifyIntent('What if we moved the deadline?')
    expect(r.confident).toBe(false)
    expect(needsClarification(r)).toBe(false)
  })

  it('asks when nothing matched at all', () => {
    expect(needsClarification(classifyIntent('the flange bracket'))).toBe(true)
  })

  it('never asks about a confident classification', () => {
    const r = classifyIntent('What is the status of the migration?')
    expect(r.confident).toBe(true)
    expect(needsClarification(r)).toBe(false)
  })
})

describe('the cost ladder', () => {
  it('is strictly ordered, because "cheapest" must be well defined', () => {
    const costs = Object.values(INTENT_COST)
    expect(new Set(costs).size).toBe(costs.length)
  })

  it('matches the database CHECK on jobs.intent_class', () => {
    // jobs_intent_class_known lists these seven. A class here that the column
    // refuses would fail at an INSERT rather than in CI.
    const allowed = new Set([
      'thought',
      'question',
      'discussion',
      'suggestion',
      'light_investigation',
      'assignment',
      'direct_command',
    ])
    for (const k of Object.keys(INTENT_COST)) expect(allowed).toContain(k)
    expect(Object.keys(INTENT_COST).length).toBe(allowed.size)
  })
})
