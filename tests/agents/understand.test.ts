/**
 * The schema and the anti-fabrication control (#282).
 *
 * `understand()` is the one place a model is allowed to decide what Grant
 * meant, so the interesting tests are not "does it work when the model is
 * good" — they are what happens when it is bad. Every one of these runs
 * without a provider, because every one is about a malformed answer.
 *
 * The property under all of them: a failure yields the WHOLE utterance as one
 * reading, which is exactly the behaviour the office shipped with. The model
 * can improve on that and cannot make it worse.
 */
import { describe, expect, it } from 'vitest'
import { grounded, readAnswer, understand } from '../../src/agents/understand.ts'

const UTTER =
  'Create a task for me and the um... No actually, you know what? Scan the entirety of ' +
  'the Legacy Coaching Project and create appropriate tasks for me to review.'

const good = JSON.stringify({
  surviving: [
    {
      kind: 'delegate',
      text: 'Scan the Legacy Coaching Project and create appropriate tasks for me to review.',
    },
  ],
  abandoned: ['Create a task for me and the um...'],
})

describe('a good answer is taken', () => {
  it('keeps the surviving request and the abandoned fragment apart', () => {
    const u = readAnswer(good, UTTER, 'a-model')
    expect(u.how).toBe('model')
    expect(u.surviving).toHaveLength(1)
    expect(u.surviving[0]?.kind).toBe('delegate')
    expect(u.abandoned[0]).toContain('Create a task for me')
  })

  it('and reads JSON out of prose and code fences, rather than refusing it', () => {
    const wrapped = `Sure! Here is the JSON:\n\`\`\`json\n${good}\n\`\`\`\nHope that helps.`
    expect(readAnswer(wrapped, UTTER, 'm').how).toBe('model')
  })
})

describe('every bad answer falls back to exactly today', () => {
  const fellBack = (content: string): void => {
    const u = readAnswer(content, UTTER, 'm')
    expect(u.how).toBe('fallback')
    expect(u.why).not.toBeNull()
    // The whole utterance, unchanged — which is what the cascade sees now.
    expect(u.surviving).toEqual([{ kind: 'other', text: UTTER }])
    expect(u.abandoned).toEqual([])
  }

  it('no JSON at all', () => fellBack('I think he wants two things.'))
  it('broken JSON', () => fellBack('{"surviving": [ '))
  it('no surviving list', () => fellBack('{"abandoned":["x"]}'))
  it('an unknown kind', () =>
    fellBack('{"surviving":[{"kind":"delete_everything","text":"Scan the project"}]}'))
  it('an empty text', () => fellBack('{"surviving":[{"kind":"delegate","text":"   "}]}'))
  it('a text longer than any request', () =>
    fellBack(`{"surviving":[{"kind":"delegate","text":"${'x'.repeat(401)}"}]}`))
  it('more intents than a sentence can carry', () =>
    fellBack(
      JSON.stringify({
        surviving: Array.from({ length: 7 }, () => ({ kind: 'other', text: 'Scan the project' })),
      }),
    ))
  it('nothing found at all', () => fellBack('{"surviving":[],"abandoned":[]}'))

  it('CONTROL: "he asked for nothing, having replaced it" is a real reading', () => {
    // Empty surviving is only a failure when nothing was abandoned either.
    const u = readAnswer('{"surviving":[],"abandoned":["Create a task for me"]}', UTTER, 'm')
    expect(u.how).toBe('model')
    expect(u.surviving).toEqual([])
  })
})

describe('a rewrite must be made of what he actually said', () => {
  it('refuses an invented subject, which is the one unforgivable failure', () => {
    const invented = JSON.stringify({
      surviving: [{ kind: 'task_create', text: 'Email Priya about the Q3 pricing review' }],
    })
    const u = readAnswer(invented, UTTER, 'm')
    expect(u.how).toBe('fallback')
    expect(u.why).toContain('grounded')
  })

  it('allows dropping filler and an abandoned clause', () => {
    expect(grounded('Scan the Legacy Coaching Project and create tasks', UTTER)).toBe(true)
  })

  it('allows ONE normalised word form, because stemming here would be a second parser', () => {
    expect(grounded('Scanning the Legacy Coaching Project', UTTER)).toBe(true)
  })

  it('but not two strangers', () => {
    expect(grounded('Scan the Acme Pricing Notebook', UTTER)).toBe(false)
  })

  it('CONTROL: a rewrite of only function words is grounded, not refused', () => {
    expect(grounded('Tell me what it is', UTTER)).toBe(true)
  })
})

describe('what never reaches a model at all', () => {
  it('an empty message', async () => {
    const u = await understand('   ', undefined)
    expect(u.how).toBe('trivial')
    expect(u.surviving).toEqual([])
  })

  it('a short single request, so "ok" does not cost a call', async () => {
    const u = await understand('remind me to ring the venue', undefined)
    expect(u.how).toBe('trivial')
    expect(u.surviving[0]?.text).toBe('remind me to ring the venue')
  })

  it('CONTROL: but anything with a correction or a second clause DOES', async () => {
    // No provider here, so it falls back — the point is that it TRIED, which
    // the `fallback` reason distinguishes from the trivial short-circuit.
    for (const said of [
      'remind me to ring the venue, and also what is on my list today',
      'remind me to ring the venue. Actually make that the printers',
    ]) {
      expect((await understand(said, undefined)).how).toBe('fallback')
    }
  })

  it('and a long single request is read for meaning rather than assumed simple', async () => {
    const long =
      'I need you to have a look at the onboarding material we put together last month ' +
      'and tell me whether it still matches how we actually run the course'
    expect((await understand(long, undefined)).how).toBe('fallback')
  })
})
