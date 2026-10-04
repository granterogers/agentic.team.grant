import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import {
  ProviderDownError,
  type RemoteTask,
  type TaskProvider,
  type UpsertResult,
} from '../../src/tasks/provider.ts'
import { type SyncGate, syncOnce } from '../../src/tasks/sync.ts'

/*
  The engine that keeps the office's list and a provider's list in step, driven against a fake provider and a fake
  database that answers by function name. What is pinned is the ordering and the failure rules the module's header
  states: deletions before upserts, an outage touches nothing, one refused task does not stop the others, a gate refusal
  leaves both sides alone, and a priority the provider never set is not sent as a clear.
*/
const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const DEL = '33333333-3333-4333-8333-333333333333'

type Work = { upserts: Record<string, unknown>[]; deletes: Record<string, unknown>[] }
const upsertRow = (id: string, title: string, externalId: string | null = null) => ({
  id,
  revision: 1,
  title,
  detail: null,
  done: false,
  priority: null,
  due_on: null,
  external_id: externalId,
  external_project_id: null,
})

const world = (work: Work, pulledAnswer: Record<string, unknown> = { ok: true }) => {
  const sql: string[] = []
  const db: SqlExecutor = {
    kind: 'fake',
    execute: async (q: string) => {
      sql.push(q)
      if (q.includes('app.tasks_to_push')) return { rows: [{ v: work }] }
      if (q.includes('app.task_pulled')) return { rows: [{ v: pulledAnswer }] }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, sql }
}

const provider = (
  over: Partial<TaskProvider> & { remote?: RemoteTask[] } = {},
): { p: TaskProvider; calls: string[] } => {
  const calls: string[] = []
  const p: TaskProvider = {
    name: 'fake',
    upsert: async (t): Promise<UpsertResult> => {
      calls.push(`upsert:${t.title}`)
      return { externalId: `ext-${t.title}`, externalRevision: 'r1', externalProjectId: 'p1' }
    },
    remove: async (id) => {
      calls.push(`remove:${id}`)
    },
    list: async () => {
      calls.push('list')
      return over.remote ?? []
    },
    reachable: async () => true,
    ...over,
  }
  return { p, calls }
}

const allow: SyncGate = { mayWrite: async () => true, mayDelete: async () => true }
const hold: SyncGate = { mayWrite: async () => false, mayDelete: async () => false }

describe('syncOnce', () => {
  it('pushes deletions before upserts, and pulls last', async () => {
    const { db } = world({
      upserts: [upsertRow(T1, 'one')],
      deletes: [{ id: DEL, title: 'gone', links: [{ provider: 'fake', external_id: 'x9' }] }],
    })
    const { p, calls } = provider()
    const r = await syncOnce(db, p, allow, { office: OFFICE })
    expect(calls).toEqual(['remove:x9', 'upsert:one', 'list'])
    expect(r).toMatchObject({ deleted: 1, pushed: 1, down: null })
  })

  it('an outage ends the round and reports it, having changed nothing already counted', async () => {
    const { db, sql } = world({ upserts: [upsertRow(T1, 'one')], deletes: [] })
    const { p } = provider({
      upsert: async () => {
        throw new ProviderDownError('fake', 'connection refused')
      },
    })
    const r = await syncOnce(db, p, allow, { office: OFFICE })
    expect(r.down).toBe('connection refused')
    expect(r.pushed).toBe(0)
    expect(sql.some((q) => q.includes('app.task_pushed'))).toBe(false)
    expect(sql.some((q) => q.includes('app.task_pulled'))).toBe(false)
  })

  it('one refused task is recorded against it and the next is still pushed', async () => {
    const { db, sql } = world({
      upserts: [upsertRow(T1, 'bad'), upsertRow(T2, 'good')],
      deletes: [],
    })
    const { p } = provider({
      upsert: async (t) => {
        if (t.title === 'bad') throw new Error('title too long')
        return { externalId: 'e2', externalRevision: 'r', externalProjectId: 'p' }
      },
    })
    const r = await syncOnce(db, p, allow, { office: OFFICE })
    expect(r).toMatchObject({ failed: 1, pushed: 1, down: null })
    expect(sql.filter((q) => q.includes('app.task_push_failed'))).toHaveLength(1)
    expect(sql.filter((q) => q.includes('app.task_pushed'))).toHaveLength(1)
  })

  it('a gate that refuses leaves both sides alone and counts what it held', async () => {
    const { db, sql } = world({
      upserts: [upsertRow(T1, 'one')],
      deletes: [{ id: DEL, title: 'gone', links: [{ provider: 'fake', external_id: 'x9' }] }],
    })
    const { p, calls } = provider()
    const r = await syncOnce(db, p, hold, { office: OFFICE })
    expect(calls).toEqual(['list'])
    expect(r).toMatchObject({ held: 2, pushed: 0, deleted: 0 })
    expect(sql.some((q) => q.includes('app.task_delete_pushed'))).toBe(false)
  })

  it('asks the gate create or update according to whether the provider already has it', async () => {
    const asked: string[] = []
    const gate: SyncGate = {
      mayWrite: async (v) => {
        asked.push(v)
        return true
      },
      mayDelete: async () => true,
    }
    const { db } = world({
      upserts: [upsertRow(T1, 'new'), upsertRow(T2, 'old', 'e7')],
      deletes: [],
    })
    await syncOnce(db, provider().p, gate, { office: OFFICE })
    expect(asked).toEqual(['create', 'update'])
  })

  it('a priority the provider did not set is left out of the pull, not sent as a clear', async () => {
    const remote: RemoteTask[] = [
      {
        externalId: 'a',
        externalRevision: '1',
        title: 'no priority',
        detail: '',
        done: false,
        priority: null,
        dueOn: null,
        externalProjectId: 'p',
      },
      {
        externalId: 'b',
        externalRevision: '1',
        title: 'with priority',
        detail: '',
        done: false,
        priority: 20,
        dueOn: null,
        externalProjectId: 'p',
      },
    ]
    const { db, sql } = world({ upserts: [], deletes: [] })
    await syncOnce(db, provider({ remote }).p, allow, { office: OFFICE })
    const pulls = sql.filter((q) => q.includes('app.task_pulled'))
    expect(pulls).toHaveLength(2)
    expect(pulls[0]).not.toContain('"priority"')
    expect(pulls[1]).toContain('"priority":20')
  })

  it('a task he deleted here is removed at the provider when it comes back, behind the delete gate', async () => {
    const remote: RemoteTask[] = [
      {
        externalId: 'zombie',
        externalRevision: '1',
        title: 'deleted here',
        detail: '',
        done: false,
        priority: null,
        dueOn: null,
        externalProjectId: 'p',
      },
    ]
    const tombstoned = world({ upserts: [], deletes: [] }, { deleted: true })
    const a = provider({ remote })
    const ra = await syncOnce(tombstoned.db, a.p, allow, { office: OFFICE })
    expect(a.calls).toContain('remove:zombie')
    expect(ra.deleted).toBe(1)

    const b = provider({ remote })
    const rb = await syncOnce(
      world({ upserts: [], deletes: [] }, { deleted: true }).db,
      b.p,
      hold,
      {
        office: OFFICE,
      },
    )
    expect(b.calls).not.toContain('remove:zombie')
    expect(rb).toMatchObject({ held: 1, deleted: 0 })
  })

  it('a database error that is not an outage is not swallowed', async () => {
    const db = {
      kind: 'fake',
      execute: async () => {
        throw new Error('permission denied')
      },
    } as unknown as SqlExecutor
    await expect(syncOnce(db, provider().p, allow, { office: OFFICE })).rejects.toThrow(
      'permission denied',
    )
  })
})
