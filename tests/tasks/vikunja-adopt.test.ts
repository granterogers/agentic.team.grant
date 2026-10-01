import { describe, expect, it } from 'vitest'
import type { CanonicalTask } from '../../src/tasks/provider.ts'
import { markerOf, readTask, VikunjaProvider, withMark } from '../../src/tasks/vikunja.ts'

/*
  The recorded crash hazard: a crash between the remote create and `app.task_pushed` leaves the task with no
  external id, and the next round used to create it again - two tasks on the board. The office's own mark in the
  description turns the second create into an adoption.
*/
const ID = '0b6d1c3e-8f4a-4a52-9a6e-1f2d3c4b5a69'
const task = (over: Partial<CanonicalTask> = {}): CanonicalTask => ({
  id: ID,
  revision: 1,
  title: 'Pay the printer',
  detail: 'Before Friday',
  done: false,
  priority: null,
  dueOn: null,
  externalId: null,
  externalProjectId: null,
  ...over,
})

/** A board that remembers what it was sent, and can lose a record on the office's side. */
const board = (initial: Record<string, unknown>[] = []) => {
  const tasks = [...initial]
  const calls: string[] = []
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${u.replace('https://v.test/api/v1', '')}`)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
    if (method === 'GET') return json(tasks)
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    if (method === 'PUT') {
      const made = { id: tasks.length + 100, project_id: 1, ...body }
      tasks.push(made)
      return json(made)
    }
    const id = Number(u.split('/').pop())
    const at = tasks.findIndex((t) => t.id === id)
    tasks[at] = { ...tasks[at], ...body }
    return json(tasks[at])
  }
  // A new provider per round, as the duty makes one: a crash loses the first instance and everything it remembered.
  const make = () =>
    new VikunjaProvider({ baseUrl: 'https://v.test', token: 'tk_x', projectId: 1, fetch })
  return { tasks, calls, make, provider: make() }
}

describe('the office marks what it writes, and finds its own mark before it creates', () => {
  it('writes the canonical id into the description and strips it on the way back', async () => {
    const b = board()
    await b.provider.upsert(task())
    expect(String(b.tasks[0]?.description)).toContain(`[agentic:${ID}]`)
    const read = readTask(b.tasks[0] as never)
    expect(read.detail).toBe('Before Friday')
    expect(read.canonicalId).toBe(ID)
    expect(markerOf(withMark('x', ID))).toBe(ID)
  })

  it('a create whose record was lost is ADOPTED, not duplicated', async () => {
    const b = board()
    await b.provider.upsert(task()) // the first round: created, then "crashed" before task_pushed
    const second = await b.make().upsert(task()) // the next round, a new provider: still no external id
    expect(b.tasks).toHaveLength(1)
    expect(second.externalId).toBe(String(b.tasks[0]?.id))
    expect(b.calls.filter((c) => c.startsWith('PUT'))).toHaveLength(1)
  })

  it('a different task is still created (the control: adoption is by mark, not by title)', async () => {
    const b = board()
    await b.provider.upsert(task())
    await b.provider.upsert(task({ id: '11111111-2222-4333-8444-555555555555' }))
    expect(b.tasks).toHaveLength(2)
  })

  it('an update with an external id never lists the board first', async () => {
    const b = board([{ id: 7, title: 'x', description: '', project_id: 1 }])
    await b.provider.upsert(task({ externalId: '7' }))
    expect(b.calls.some((c) => c.startsWith('GET'))).toBe(false)
    expect(b.calls).toContain('POST /tasks/7')
  })

  it('a task the office did not write carries no mark and is never adopted', async () => {
    const b = board([
      { id: 9, title: 'Pay the printer', description: 'Before Friday', project_id: 1 },
    ])
    await b.provider.upsert(task())
    expect(b.tasks).toHaveLength(2)
  })
})
