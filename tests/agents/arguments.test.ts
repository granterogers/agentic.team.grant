/**
 * #249 — the arguments of an action, read semantically rather than positionally.
 *
 * `taskRequest` found the title by demanding it sit immediately after the word
 * "task", so *"put a task ON ALPHA to get three build quotes"* reached the
 * writer and arrived with nothing to call it. The office then asked what to
 * call something that was plainly in the sentence.
 *
 * `taskTitle` works by subtraction: remove the instruction preamble, the
 * project adjunct and the due-date adjunct, and whatever open-class text
 * survives is the title. It cannot invent, because everything it returns was
 * typed by Grant.
 */
import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const title = (say: string): string | null | undefined =>
  taskRequest(say, classifyIntent(say))?.title

describe('#249 — the title survives whatever sits between it and the verb', () => {
  const CASES: readonly [string, string][] = [
    [
      'Put a task on alpha to get three build quotes by the end of next week.',
      'get three build quotes by the end of next week',
    ],
    ['Add a task under alpha for the stand build quotes.', 'the stand build quotes'],
    ['Make me a task to chase the supplier quote.', 'chase the supplier quote'],
    ['Create a task to chase the supplier quote.', 'chase the supplier quote'],
    ['Put a task on the board to chase the quote.', 'chase the quote'],
    ['Add a task for the renewal.', 'the renewal'],
    ['Task: chase the supplier for the revised quote.', 'chase the supplier for the revised quote'],
    ['Create a task called Renew the domain.', 'Renew the domain'],
    ['Log a task to renew the insurance before the 30th.', 'renew the insurance before the 30th'],
    [
      'Raise a task in alpha to review the lease break clause by Friday.',
      'review the lease break clause by Friday',
    ],
  ]
  for (const [say, want] of CASES) {
    it(`${say.slice(0, 46)} -> ${want}`, () => {
      expect(title(say)).toBe(want)
    })
  }
})

describe('#249 — and it does not invent what Grant did not say', () => {
  it('a referent is not a title — it asks instead', () => {
    // "that" points at something earlier. A task called "that" is worse than
    // a question, and the office asks one short question instead.
    expect(title('Add a task for that.')).toBeNull()
    expect(title('Make a task about it.')).toBeNull()
  })

  it('no title at all is null, not a guess', () => {
    expect(title('Make a task.')).toBeNull()
    expect(title('Add a new task please.')).toBeNull()
  })

  it('an omitted due date stays omitted', () => {
    // The writer takes a title and nothing else is required. Inventing a
    // Friday because tasks usually have one would be a consequential
    // parameter the semantic layer is not allowed to supply.
    expect(title('Make me a task to chase the landlord.')).toBe('chase the landlord')
  })

  it('a prohibition writes nothing, whatever else the sentence contains', () => {
    expect(title('Do not make a task for this yet.')).toBeUndefined()
    expect(title("Don't add a task to chase the supplier.")).toBeUndefined()
  })

  it('a question about tasks is not an instruction to write one', () => {
    expect(title('Do we have a task for the renewal?')).toBeUndefined()
    expect(title('What tasks are open on alpha?')).toBeUndefined()
  })

  it('a correction replaces the action rather than adding to it', () => {
    // "Actually don't email them; make it a task instead" — the prohibition is
    // on the email, and the task is the instruction that survives.
    const say = 'Actually do not email the landlord; make a task to chase them instead.'
    expect(classifyIntent(say).recognised).toBe(true)
  })
})
