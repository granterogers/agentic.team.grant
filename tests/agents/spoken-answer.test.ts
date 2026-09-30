/**
 * Ledger R33 — "Yes, go ahead." answers the question the office asked.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { optionFor, spokenAnswer } from '../../src/agents/spoken-answer.ts'

const OPTIONS = ['Yes, do it', 'No, leave it']

describe('a short yes or no', () => {
  it.each([
    'Yes, go ahead.',
    'yes please',
    'Go for it',
    'Yes',
    'sure, thanks',
    'go ahead',
    'do it',
    'proceed',
    'send it',
    'Please do.',
    'approved',
    'ok, go ahead',
    'OK do it',
    'thanks, yes please',
    'yes thanks',
    'yep 👍',
  ])('yes: %s', (s) => {
    expect(spokenAnswer(s)).toBe('yes')
    expect(optionFor('yes', OPTIONS)).toBe('Yes, do it')
  })
  it.each(['no, leave it', 'nope', 'not now', 'no thanks', "don't", 'No thank you.'])(
    'no: %s',
    (s) => {
      expect(spokenAnswer(s)).toBe('no')
      expect(optionFor('no', OPTIONS)).toBe('No, leave it')
    },
  )
  it.each([
    'yes but change the title first',
    'no idea',
    'ok so what about the budget',
    'Yes, and also book the barn',
  ])('NEGATIVE CONTROL, not a bare answer: %s', (s) => {
    expect(spokenAnswer(s)).toBeNull()
  })
  it('NEGATIVE CONTROL: a question about thanks is not an acknowledgement', () => {
    expect(spokenAnswer('thanks for the update on the venue')).toBeNull()
  })
  it('NEGATIVE CONTROL: options with no yes-shaped answer are never guessed', () => {
    expect(optionFor('yes', ['Notion', 'Drive'])).toBeNull()
    expect(optionFor('yes', ['Yes, add them', 'Yes, but only the PDFs'])).toBeNull()
  })
})

/*
  #374: AN ACKNOWLEDGEMENT IS NOT AN AUTHORISATION. Grant, 28 September: a bare
  acknowledgement must never by itself authorise a pending consequential
  action; a genuinely unclear reply leaves the question open and is asked
  about. 'unclear' is not a yes, and it is not "nothing was said" either (null
  would let the reply fall through as new work while a question waits).
*/
describe('an acknowledgement answers nothing', () => {
  it.each([
    'ok',
    'okay',
    'OK.',
    'thanks',
    'Thanks!',
    'thank you',
    'ok thanks',
    'Okay, thank you.',
    'cheers',
    'ta',
    '👍',
    '🙏',
    '✅',
    'ok 👍',
    'got it',
    'noted',
    'great, thanks',
    'ok cool thanks',
    'sounds good',
    'fine',
    "that's fine",
    'no worries',
    'alright',
  ])('unclear: %s', (s) => {
    expect(spokenAnswer(s)).toBe('unclear')
  })
  it.each(['yes no', 'no, go ahead'])('contradicting itself is unclear: %s', (s) => {
    expect(spokenAnswer(s)).toBe('unclear')
  })
  it('a change of mind is never read as a yes (the retraction reader owns it)', () => {
    expect(spokenAnswer('do it — actually no')).not.toBe('yes')
  })
  it('"no worries" is an acknowledgement, never a decline', () => {
    expect(spokenAnswer('no worries')).not.toBe('no')
  })
})

describe("the handler answers only this conversation's ONE open question", () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  it('through the same door the dashboard uses', () => {
    // And AS whoever the door recorded on this turn (0608): the principal is read
    // from the command, never supplied by the handler.
    expect(src).toMatch(
      /app\.hq_answer_blocker\(\$\{lit\(q\.id\)\}::uuid, \$\{lit\(option\)\},\s*app\.command_principal\(/,
    )
  })
  it('an unclear reading leaves the question open and asks, before any option is chosen', () => {
    const i = src.indexOf("if (q !== undefined && spoken === 'unclear') {")
    const j = src.indexOf('optionFor(spoken, q.options)')
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    expect(src.slice(i, j)).toContain('did: false')
  })
  it('the clarification binds its turn to the question, and the next reply may answer only that one', () => {
    const i = src.indexOf("if (q !== undefined && spoken === 'unclear') {")
    expect(
      src.indexOf("jsonb_build_object('awaiting_answer', ${lit(q.id)}::text)", i),
    ).toBeGreaterThan(i)
    // Read back from the turn immediately before (ours), never searched for across the chat. The query moved into
    // app.open_questions_for_reply (0622, #394), so the property is asserted where it now lives.
    const fn = readFileSync(
      'migrations/0622_a_typed_yes_answers_the_question_he_was_shown.sql',
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*--.*$/gm, '')
    expect(fn).toMatch(
      /or b\.blocker_id = \(select nullif\(j\.pinned_config ->> 'awaiting_answer', ''\)::uuid\s+from public\.jobs j\s+where j\.job_id = \(select job_id from ours\)\)/,
    )
  })
  it('asks when there is more than one', () => {
    expect(src).toMatch(/if \(open\.length > 1\) \{/)
  })
})
