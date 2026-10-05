import { describe, expect, it } from 'vitest'
import { ProviderDownError } from '../../src/tasks/provider.ts'
import { VikunjaProvider } from '../../src/tasks/vikunja.ts'
import { FakeVikunja } from './fake-vikunja.ts'

/*
  The adapter against an in-memory Vikunja that speaks the real API's shapes (tests/tasks/fake-vikunja.ts).

  Written failing first (HQ-VIC audit): each block below is a defect that was reproducible against the code as it
  stood - a note flattened on its first round trip, a "<" eaten as if it opened a tag, a listing silently cut short,
  a request that could hang for ever, and an auth refusal treated as one task's problem.
*/
const ID = '0b6d1c3e-8f4a-4a52-9a6e-1f2d3c4b5a69'
const mk = (v: FakeVikunja, over: { timeoutMs?: number } = {}) =>
  new VikunjaProvider({
    baseUrl: 'https://v.test',
    token: 'tk_secret',
    projectId: v.projectId,
    fetch: v.fetch,
    ...over,
  })
const canon = (over: Record<string, unknown> = {}) => ({
  id: ID,
  revision: 1,
  title: 'Pay the printer',
  detail: '',
  done: false,
  priority: null,
  dueOn: null,
  externalId: null,
  externalProjectId: null,
  ...over,
})

describe('a note (task detail) survives a round trip through Vikunja', () => {
  it('keeps its line breaks', async () => {
    const v = new FakeVikunja()
    const p = mk(v)
    await p.upsert(canon({ detail: 'First line\nSecond line\n\nAfter a gap' }))
    const [back] = await p.list()
    expect(back?.detail).toBe('First line\nSecond line\n\nAfter a gap')
  })

  it('does not eat text that merely contains angle brackets', async () => {
    const v = new FakeVikunja()
    const p = mk(v)
    await p.upsert(canon({ detail: 'ship if stock < 5 and price > 3' }))
    expect((await p.list())[0]?.detail).toBe('ship if stock < 5 and price > 3')
  })

  it('reads what the Vikunja editor writes: paragraphs and entities become plain text', async () => {
    const v = new FakeVikunja()
    v.seed('Edited there', {
      description: '<p>Fish &amp; chips</p><p>Second&nbsp;para<br>next line</p>',
    })
    const [t] = await mk(v).list()
    expect(t?.detail).toBe('Fish & chips\nSecond para\nnext line')
  })
})

describe('listing is complete or it says it is not', () => {
  it('follows pages when the server caps per_page below what was asked', async () => {
    const v = new FakeVikunja()
    v.maxPerPage = 25
    for (let i = 0; i < 70; i += 1) v.seed(`t${String(i)}`)
    expect(await mk(v).list()).toHaveLength(70)
  })

  it('refuses to hand back a truncated list rather than cutting it silently', async () => {
    const v = new FakeVikunja()
    for (let i = 0; i < 5001; i += 1) v.seed(`t${String(i)}`)
    await expect(mk(v).list()).rejects.toThrow(/more than/)
  })
})

describe('failure classes', () => {
  it('a request that never answers ends as an outage, not a hang', async () => {
    const v = new FakeVikunja()
    v.faults = [{ on: 'GET /projects', hang: true }]
    await expect(mk(v, { timeoutMs: 30 }).list()).rejects.toBeInstanceOf(ProviderDownError)
  })

  for (const status of [500, 502, 503, 429]) {
    it(`http ${String(status)} is an outage (retry later, change nothing)`, async () => {
      const v = new FakeVikunja()
      v.faults = [{ on: 'GET /projects', status }]
      await expect(mk(v).list()).rejects.toMatchObject({ name: 'ProviderDownError' })
    })
  }

  for (const status of [401, 403]) {
    it(`http ${String(status)} on any call ends the round as a refused credential, in words`, async () => {
      const v = new FakeVikunja()
      v.faults = [{ on: 'GET /projects', status }]
      const e = await mk(v)
        .list()
        .catch((x: unknown) => x)
      expect(e).toBeInstanceOf(ProviderDownError)
      expect(String((e as Error).message)).toMatch(/token was refused/)
      expect(String((e as Error).message)).not.toContain('tk_secret')
    })
  }

  it('deleting a task that is already gone is a success; a 403 is not swallowed', async () => {
    const v = new FakeVikunja()
    await expect(mk(v).remove('999')).resolves.toBeUndefined()
    const t = v.seed('x')
    v.faults = [{ on: 'DELETE', status: 403 }]
    await expect(mk(v).remove(String(t.id))).rejects.toBeInstanceOf(Error)
    expect(v.tasks.has(t.id)).toBe(true)
  })

  it('a network failure never carries the token into the message', async () => {
    const v = new FakeVikunja()
    v.faults = [{ on: 'GET', network: true }]
    const e = await mk(v)
      .list()
      .catch((x: unknown) => x as Error)
    expect(e).toBeInstanceOf(ProviderDownError)
    expect((e as Error).message).not.toContain('tk_secret')
  })
})
