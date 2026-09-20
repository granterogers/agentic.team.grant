/**
 * His own to-do list, as canonical state (#282, anchor A).
 *
 * The clause split alone does not make "what are my current tasks" ANSWERABLE:
 * this handler supplied documents, mail and the project spine and nothing at
 * all about `public.tasks`. `taskSpine` is what closes that, and these are the
 * two properties it has to hold — it is accurate, and where it has nothing it
 * says so rather than being silent, because a silent absence is the one shape
 * a model reads as licence to fill in.
 */
import { describe, expect, it } from 'vitest'
import { taskSpine } from '../../src/handlers/instruction.ts'

const t = (title: string, due: string | null = null, overdue = false) => ({
  title,
  due_on: due,
  overdue,
})

describe('taskSpine', () => {
  it('says the list is empty rather than saying nothing', () => {
    /*
      The important half. Returning '' for an empty list would leave the model
      with no statement about his tasks at all, which is indistinguishable from
      never having looked — and CLAUDE.md records exactly that shape producing
      "there is nothing in your email" about a search that never ran.
    */
    expect(taskSpine([], [], [], { all: 0 })).toContain('empty')
  })

  it('names what is overdue, and how many', () => {
    const said = taskSpine([t('Ring the venue', '2026-09-01')], [], [], { all: 1, overdue: 1 })
    expect(said).toContain('Overdue, 1')
    expect(said).toContain('Ring the venue')
    expect(said).toContain('2026-09-01')
  })

  it('keeps the three buckets apart', () => {
    const said = taskSpine([t('A')], [t('B')], [t('C', '2026-12-01')], { all: 3 })
    expect(said.indexOf('Overdue')).toBeLessThan(said.indexOf('Due today'))
    expect(said.indexOf('Due today')).toBeLessThan(said.indexOf('Coming up'))
  })

  it('leaves out a bucket that is empty rather than announcing a zero', () => {
    const said = taskSpine([], [t('B')], [], { all: 1 })
    expect(said).not.toContain('Overdue')
    expect(said).toContain('Due today or earlier, 1')
  })

  it('a task with no date is named without inventing one', () => {
    expect(taskSpine([], [t('Something', null)], [], { all: 1 })).toContain('Something.')
  })

  it('a list with items but none due still reports the count', () => {
    /*
      `all` counts everything open; the three buckets are only the dated ones.
      A message saying nothing at all here would be the empty-list sentence
      about a list that is not empty.
    */
    const said = taskSpine([], [], [], { all: 4 })
    expect(said).toContain('4')
    expect(said).not.toContain('empty')
  })

  it('states a fact and gives no instruction', () => {
    /*
      `projectSpine` measured this: a negative imperative beside the data it is
      about invites a model to over-obey it, and two of three answers got worse.
      Asserted as a property so the next edit cannot quietly add one back.
    */
    const said = taskSpine([t('A', '2026-09-01')], [t('B')], [], { all: 2, overdue: 1 })
    expect(said.toLowerCase()).not.toMatch(/\bdo not\b|\bnever\b|\bmust\b|\byou should\b/)
  })
})
