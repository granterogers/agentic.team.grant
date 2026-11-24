/**
 * A project the question names that the office does not have is said in code (0.111.0, decided by Grant on 24 November 2026).
 * "What is the status of the Zephyr project?" was answered with the office's project list. The helper that finds the name is
 * tested here against a fake database, so no office is touched.
 */
import { describe, expect, it } from 'vitest'
import { unknownProjectNamed } from '../../src/handlers/instruction.ts'

const job = { jobId: '00000000-0000-0000-0000-000000000001' } as never
const fakeDb = (names: string[]) =>
  ({
    execute: async () => ({ rows: names.map((name) => ({ name })) }),
  }) as never

describe('a named project the office does not have', () => {
  it('is found when the name is capitalised and matches no active project', async () => {
    const r = await unknownProjectNamed(
      fakeDb(['Conversations', 'Japan Spring Trip', 'Wellness Studio Launch']),
      job,
      'What is the status of the Zephyr project?',
    )
    expect(r).toEqual({
      named: 'Zephyr',
      active: ['Conversations', 'Japan Spring Trip', 'Wellness Studio Launch'],
    })
  })

  it('is not flagged when an active project has that name', async () => {
    expect(
      await unknownProjectNamed(
        fakeDb(['Wellness Studio Launch']),
        job,
        'Which tasks are overdue in the Wellness Studio Launch project?',
      ),
    ).toBeNull()
  })

  it('is not flagged for a partial name that an active project contains', async () => {
    expect(
      await unknownProjectNamed(
        fakeDb(['Japan Spring Trip']),
        job,
        'What is left on the Japan project?',
      ),
    ).toBeNull()
  })

  it('is not flagged when the words are in lower case, as in ordinary prose', async () => {
    expect(
      await unknownProjectNamed(
        fakeDb(['Conversations']),
        job,
        'Give me the budget project plan in a line.',
      ),
    ).toBeNull()
  })

  it('is not flagged when the message names no project', async () => {
    expect(
      await unknownProjectNamed(
        fakeDb(['Conversations']),
        job,
        'In this project, which travel tasks are overdue?',
      ),
    ).toBeNull()
  })

  it('says there are no active projects when the office has none', async () => {
    const r = await unknownProjectNamed(
      fakeDb([]),
      job,
      'What is the status of the Zephyr project?',
    )
    expect(r?.active).toEqual([])
  })
})
