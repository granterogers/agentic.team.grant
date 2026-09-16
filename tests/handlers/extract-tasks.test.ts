/**
 * What survives from the model's answer, and what must not (#130).
 *
 * Every row that survives `readTasks` becomes a real write into a list Grant
 * looks at, so this is the whole of the risk and it is pure text — no
 * database, no model, thirty cases for milliseconds.
 *
 * `curriculum()` in the Notion import makes the same argument about validating
 * a free model's JSON hard. The difference is the cost of being wrong: a bad
 * curriculum makes an odd page, a bad task list puts invented work on his
 * project.
 */
import { describe, expect, it } from 'vitest'
import { readTasks } from '../../src/handlers/extract-tasks.ts'

const wrap = (tasks: unknown): string => JSON.stringify({ tasks })

describe('what the model proposed, kept only where it is usable', () => {
  it('reads a clean answer', () => {
    const got = readTasks(
      wrap([
        { title: 'Draft the outreach note', detail: 'Mentioned on page two.' },
        { title: 'Pick three price points' },
      ]),
    )
    expect(got).toEqual([
      { title: 'Draft the outreach note', detail: 'Mentioned on page two.', due_on: null },
      { title: 'Pick three price points', detail: null, due_on: null },
    ])
  })

  /*
    A free model asked for JSON gives JSON with an apology around it. Same
    treatment as the curriculum: find the first brace and the last.
  */
  it('reads an answer with commentary around it', () => {
    expect(
      readTasks(
        `Sure! Here are the tasks I found:\n\n${wrap([{ title: 'Book the venue' }])}\n\nHope that helps.`,
      ),
    ).toHaveLength(1)
  })

  it('returns nothing rather than throwing on rubbish', () => {
    expect(readTasks('I could not do that')).toEqual([])
    expect(readTasks('{ not json at all')).toEqual([])
    expect(readTasks(wrap('a string where a list belongs'))).toEqual([])
    expect(readTasks('')).toEqual([])
  })
})

describe('what must not survive', () => {
  /*
    The one that would land in his diary.

    A model asked for a date it does not have will produce a plausible one, and
    nothing about the answer says it was guessed. Only an unambiguous ISO day
    is kept — and `Date.parse` is asked as well as the pattern, because
    2026-02-31 matches the pattern and is not a day.
  */
  it('drops a date that is not one, including a well-formed impossible one', () => {
    expect(readTasks(wrap([{ title: 'A', due_on: 'next Friday' }]))[0]?.due_on).toBeNull()
    expect(readTasks(wrap([{ title: 'A', due_on: '2026-02-31' }]))[0]?.due_on).toBeNull()
    expect(readTasks(wrap([{ title: 'A', due_on: '12/03/2026' }]))[0]?.due_on).toBeNull()
    expect(readTasks(wrap([{ title: 'A', due_on: '2026-03-12' }]))[0]?.due_on).toBe('2026-03-12')
  })

  it('drops an entry with nothing to call it', () => {
    expect(readTasks(wrap([{ title: '' }, { detail: 'orphan' }, { title: '   ' }]))).toEqual([])
  })

  it('drops a title too long to be one', () => {
    expect(readTasks(wrap([{ title: 'x'.repeat(161) }]))).toEqual([])
    expect(readTasks(wrap([{ title: 'x'.repeat(160) }]))).toHaveLength(1)
  })

  /*
    A document with a summary at the end says the same action twice, and a
    model asked for a list returns both. Two identical tasks is the office
    looking careless in the most visible way available.
  */
  it('says the same action once', () => {
    expect(
      readTasks(
        wrap([{ title: 'Book the venue' }, { title: 'book the VENUE' }, { title: 'Pay deposit' }]),
      ).map((t) => t.title),
    ).toEqual(['Book the venue', 'Pay deposit'])
  })

  /*
    More than twelve from one document is a model listing sentences rather
    than finding actions, and twelve rows appearing at once is already a lot.
  */
  it('stops at twelve', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `Do thing ${String(i)}` }))
    expect(readTasks(wrap(many))).toHaveLength(12)
  })

  it('keeps a null detail as null rather than as the word null', () => {
    const got = readTasks(wrap([{ title: 'A', detail: null }]))
    expect(got[0]?.detail).toBeNull()
  })
})
