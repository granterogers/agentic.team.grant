import { describe, expect, it } from 'vitest'
import { recordedException } from '../../src/backup/restore.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

/**
 * Production holds `lessons_supersedes_same_office` NOT VALID on purpose over ONE recorded cross-office row (migration 0658,
 * `public.office_edge_exceptions`). A restore of the real backup failed on it, because the restore validated every key it re-added.
 * `recordedException` is the rule that lets exactly that case through: every violating row is a recorded exception, and nothing else is
 * wrong with the key. These drive it with a fake executor so each refusal is shown to be a refusal, and the acceptance is shown to need
 * all three conditions.
 */
const FK = {
  rel: 'public.lessons',
  name: 'lessons_supersedes_same_office',
  def: 'FOREIGN KEY (supersedes, office_id) REFERENCES lessons(lesson_id, office_id)',
}

const executor = (answers: {
  pk?: string[]
  bad?: number
  recorded?: number
  other?: number
  throws?: boolean
}): SqlExecutor =>
  ({
    kind: 'fake',
    execute: async (sql: string) => {
      if (sql.includes('indisprimary'))
        return { rows: (answers.pk ?? ['lesson_id']).map((k) => ({ k })) }
      if (sql.includes('office_edge_exceptions')) {
        if (answers.throws === true) throw new Error('relation does not exist')
        return { rows: [{ bad: answers.bad ?? 0, recorded: answers.recorded ?? 0 }] }
      }
      return { rows: [{ other: answers.other ?? 0 }] }
    },
  }) as unknown as SqlExecutor

describe('recordedException', () => {
  it('accepts a violation that is entirely a recorded exception and has no other fault', async () => {
    expect(await recordedException(executor({ bad: 1, recorded: 1 }), FK)).toBe(true)
  })
  it('refuses when a violating row is NOT recorded (the restore must still fail on an unexplained row)', async () => {
    expect(await recordedException(executor({ bad: 2, recorded: 1 }), FK)).toBe(false)
  })
  it('refuses when nothing violates (then validation would not have failed for this reason)', async () => {
    expect(await recordedException(executor({ bad: 0, recorded: 0 }), FK)).toBe(false)
  })
  it('refuses when the same key also has a row whose parent is absent, which is not a cross-office row', async () => {
    expect(await recordedException(executor({ bad: 1, recorded: 1, other: 1 }), FK)).toBe(false)
  })
  it('refuses a key that is not a same-office composite key', async () => {
    const plain = { ...FK, def: 'FOREIGN KEY (supersedes) REFERENCES lessons(lesson_id)' }
    expect(await recordedException(executor({ bad: 1, recorded: 1 }), plain)).toBe(false)
  })
  it('refuses a table without exactly one primary key column (it cannot name the child row)', async () => {
    expect(await recordedException(executor({ pk: [], bad: 1, recorded: 1 }), FK)).toBe(false)
    expect(await recordedException(executor({ pk: ['a', 'b'], bad: 1, recorded: 1 }), FK)).toBe(
      false,
    )
  })
  it('refuses when the exceptions table cannot be read (an unreadable record is not a recorded one)', async () => {
    expect(await recordedException(executor({ throws: true }), FK)).toBe(false)
  })
})
