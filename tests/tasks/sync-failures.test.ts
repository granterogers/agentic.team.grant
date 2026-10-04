import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { syncBody } from '../../src/handlers/tasks-sync.ts'
import {
  ProviderAuthError,
  ProviderDownError,
  type TaskProvider,
} from '../../src/tasks/provider.ts'
import { permitEverything, syncOnce } from '../../src/tasks/sync.ts'

/*
  The round's failure rules, on a fake database that answers by function name: a refused credential ends the round and
  says so in different words from an outage; a refused delete is one task's problem; a placeholder link is cleared, not
  sent to the provider.
*/
const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const world = (work: unknown) => {
  const sql: string[] = []
  const db = {
    kind: 'fake',
    execute: async (q: string) => {
      sql.push(q)
      if (q.includes('app.tasks_to_push')) return { rows: [{ v: work }] }
      return { rows: [{ v: { ok: true } }] }
    },
  } as unknown as SqlExecutor
  return { db, sql }
}
const base = (over: Partial<TaskProvider>): TaskProvider => ({
  name: 'fake',
  upsert: async () => ({ externalId: 'e', externalRevision: 'r', externalProjectId: 'p' }),
  remove: async () => undefined,
  list: async () => [],
  reachable: async () => true,
  ...over,
})
const zero = { pushed: 0, pulled: 0, created: 0, deleted: 0, conflicts: 0, failed: 0 }

describe('failure words', () => {
  it('a refused credential is reported as refused, an outage as unreachable', async () => {
    const { db } = world({ upserts: [], deletes: [] })
    const refused = await syncOnce(
      db,
      base({
        list: async () => {
          throw new ProviderAuthError('fake', 401)
        },
      }),
      permitEverything,
      { office: OFFICE },
    )
    expect(refused.downKind).toBe('refused')
    expect(syncBody({ ...zero, ...refused })).toMatch(/turned the connection down.*new token/)
    const down = await syncOnce(
      db,
      base({
        list: async () => {
          throw new ProviderDownError('fake', 'http 503')
        },
      }),
      permitEverything,
      { office: OFFICE },
    )
    expect(down.downKind).toBe('unreachable')
    expect(syncBody({ ...zero, ...down })).toMatch(/could not be reached \(http 503\)/)
    expect(syncBody({ ...zero, ...down })).not.toContain('token')
  })
})

describe('deletions', () => {
  const del = (ext: string | null) => ({
    upserts: [],
    deletes: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'gone',
        links: ext === null ? [] : [{ provider: 'fake', external_id: ext }],
      },
    ],
  })

  it('a refused delete is counted against the round and the rest of it still runs', async () => {
    const { db } = world({
      upserts: [],
      deletes: [
        ...del('x1').deletes,
        {
          id: '44444444-4444-4444-8444-444444444444',
          title: 'also gone',
          links: [{ provider: 'fake', external_id: 'x2' }],
        },
      ],
    })
    const removed: string[] = []
    const r = await syncOnce(
      db,
      base({
        remove: async (id) => {
          if (id === 'x1') throw new Error('vikunja refused: http 400')
          removed.push(id)
        },
      }),
      permitEverything,
      { office: OFFICE },
    )
    expect(removed).toEqual(['x2'])
    expect(r).toMatchObject({ failed: 1, deleted: 1, down: null })
  })

  it('a tombstone with nothing at the provider is cleared without asking anybody or calling the provider', async () => {
    const { db, sql } = world(del(null))
    let asked = 0
    let called = 0
    const r = await syncOnce(
      db,
      base({
        remove: async () => {
          called += 1
        },
      }),
      {
        mayWrite: async () => true,
        mayDelete: async () => {
          asked += 1
          return true
        },
      },
      { office: OFFICE },
    )
    expect(called).toBe(0)
    expect(asked).toBe(0)
    expect(sql.some((q) => q.includes('app.task_delete_pushed'))).toBe(true)
    expect(r.deleted).toBe(0)
  })
})

describe('the mark travels with a pulled task', () => {
  it('canonical_id reaches app.task_pulled when the provider carries one, and is absent when it does not', async () => {
    const { db, sql } = world({ upserts: [], deletes: [] })
    const remote = (canonicalId: string | null) => ({
      externalId: '7',
      externalRevision: 'r',
      title: 't',
      detail: '',
      done: false,
      priority: null,
      dueOn: null,
      externalProjectId: '1',
      canonicalId,
    })
    await syncOnce(
      db,
      base({ list: async () => [remote('0b6d1c3e-8f4a-4a52-9a6e-1f2d3c4b5a69')] }),
      permitEverything,
      { office: OFFICE },
    )
    await syncOnce(db, base({ list: async () => [remote(null)] }), permitEverything, {
      office: OFFICE,
    })
    const pulls = sql.filter((q) => q.includes('app.task_pulled'))
    expect(pulls[0]).toContain('"canonical_id":"0b6d1c3e-8f4a-4a52-9a6e-1f2d3c4b5a69"')
    expect(pulls[1]).not.toContain('canonical_id')
  })
})
