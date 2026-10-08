/*
  office.notion_sync inside the host's clock, driven through the REAL handler on fake timers.

  The edge worker starts no job after 60 s and is killed at 150 s, so a job that starts last has 90 s. The handler's
  numbers (handlers/notion-sync.ts, RUN_BUDGET_MS) have to fit in that with room, in the WORST case rather than the typical
  one: a Notion that never answers, one that answers 429 for ever, one that answers slowly page after page. Time here is
  the (fake) wall clock, so "stays inside" is measured, not argued.
*/
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SqlExecutionError } from '../../src/db/executor.ts'
import {
  NOTION_CALL_DEADLINE_MS,
  notionSyncHandler,
  PAGE_BUDGET_MS,
  RUN_BUDGET_MS,
  VOICE_BUDGET_MS,
} from '../../src/handlers/notion-sync.ts'
import type { HandlerOutput, Job } from '../../src/jobs/worker.ts'
import {
  fakeNotion,
  json,
  memoryDb,
  pageObject,
  paragraph,
  type Route,
} from './support/memory-db.ts'

const job = {
  jobId: '11111111-1111-4111-8111-111111111111',
  correlationId: 'c',
  kind: 'office.notion_sync',
} as unknown as Job
const OFFICES = { p1: 'office-1' }
const projects = [{ id: 'p1', name: 'Legacy' }]
const HOST_BUDGET_AFTER_START_MS = 150_000 - 60_000
// Taken before any test fakes the clock.
const realTimeout = globalThis.setTimeout

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const drive = async (
  mem: ReturnType<typeof memoryDb>,
  routes: Record<string, Route>,
): Promise<{ elapsedMs: number; out?: HandlerOutput; error?: unknown }> => {
  vi.useFakeTimers()
  const n = fakeNotion(routes)
  vi.stubGlobal('fetch', n.fetchImpl)
  const t0 = Date.now()
  const state: { done: boolean; out?: HandlerOutput; error?: unknown } = { done: false }
  notionSyncHandler(mem.db, null)
    .handle(job, mem.db)
    .then(
      (o) => {
        state.out = o
        state.done = true
      },
      (e: unknown) => {
        state.error = e
        state.done = true
      },
    )
  let at = Date.now()
  while (!state.done && at - t0 < 400_000) {
    await vi.advanceTimersByTimeAsync(250)
    // Hashing a page (crypto.subtle.digest) runs on the thread pool, in REAL time the fake clock does not control. Let it
    // finish before the clock moves on, or "the page was filed" and "250 ms passed" race and the test is a coin.
    await new Promise<void>((r) => realTimeout(r, 4))
    at = Date.now()
  }
  expect(state.done, 'the handler never finished: it can run indefinitely').toBe(true)
  return {
    elapsedMs: at - t0,
    ...(state.out ? { out: state.out } : {}),
    ...(state.error ? { error: state.error } : {}),
  }
}

describe('the numbers fit the host, in the worst case', () => {
  it('reads started + one call in flight + writes + voice leaves at least 20 s of the 90 s a last-started job has', () => {
    const WRITES_ALLOWANCE_MS = 10_000
    const worst = RUN_BUDGET_MS + NOTION_CALL_DEADLINE_MS + WRITES_ALLOWANCE_MS + VOICE_BUDGET_MS
    expect(worst).toBeLessThanOrEqual(HOST_BUDGET_AFTER_START_MS - 20_000)
    // the previous figures, for the record: 60 s of reading + one 20 s request left a margin of about ten seconds,
    // with the Retry-After waits (up to 3 x 30 s) outside every bound.
    expect(60_000 + 20_000 + WRITES_ALLOWANCE_MS).toBeGreaterThan(
      HOST_BUDGET_AFTER_START_MS - 20_000,
    )
    expect(PAGE_BUDGET_MS).toBeLessThan(RUN_BUDGET_MS)
  })

  it('a Notion that never answers /search ends the run at the call deadline, as a transient error the job retries', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    const r = await drive(mem, { '/search': () => new Promise<Response>(() => undefined) })
    expect(r.error).toMatchObject({ code: 'timeout', kind: 'transient' })
    expect(r.elapsedMs).toBeLessThanOrEqual(NOTION_CALL_DEADLINE_MS + 500)
  })

  it('a Notion that answers search and then never answers a page: a bounded run, nothing recorded as skipped', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    const routes: Record<string, Route> = {
      '/search': () =>
        json(200, {
          results: ['a', 'b', 'c', 'd', 'e'].map((i) => pageObject(i, i)),
          has_more: false,
        }),
    }
    for (const i of ['a', 'b', 'c', 'd', 'e'])
      routes[`/blocks/${i}/children`] = () => new Promise<Response>(() => undefined)
    const r = await drive(mem, routes)
    expect(r.out?.body).toMatch(/not read this time/)
    expect(r.out?.body).not.toMatch(/left out/)
    expect(r.elapsedMs).toBeLessThanOrEqual(RUN_BUDGET_MS + NOTION_CALL_DEADLINE_MS + 500)
    expect(mem.docs).toHaveLength(0)
  })

  it('endless 429s with a huge Retry-After: bounded too, and the 429 is deferred rather than failing the job', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    const routes: Record<string, Route> = {
      '/search': () =>
        json(200, {
          results: Array.from({ length: 10 }, (_, i) =>
            pageObject(`p${String(i)}`, `P${String(i)}`),
          ),
          has_more: false,
        }),
    }
    for (let i = 0; i < 10; i += 1)
      routes[`/blocks/p${String(i)}/children`] = () =>
        json(429, { code: 'rate_limited' }, { 'retry-after': '86400' })
    const r = await drive(mem, routes)
    expect(r.error).toBeUndefined()
    expect(r.out?.body).toMatch(/not read this time/)
    expect(r.elapsedMs).toBeLessThanOrEqual(RUN_BUDGET_MS + NOTION_CALL_DEADLINE_MS + 500)
  })

  it('429 with a short Retry-After on every page: waits are real (fake) time and still inside the budget plus one call', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    const routes: Record<string, Route> = {
      '/search': () =>
        json(200, {
          results: Array.from({ length: 10 }, (_, i) =>
            pageObject(`p${String(i)}`, `P${String(i)}`),
          ),
          has_more: false,
        }),
    }
    for (let i = 0; i < 10; i += 1)
      routes[`/blocks/p${String(i)}/children`] = () =>
        json(429, { code: 'rate_limited' }, { 'retry-after': '5' })
    const r = await drive(mem, routes)
    expect(r.elapsedMs).toBeLessThanOrEqual(RUN_BUDGET_MS + NOTION_CALL_DEADLINE_MS + 500)
    expect(r.elapsedMs).toBeGreaterThan(10_000) // it did wait: the test is not passing by never trying
  })

  it('slow-but-answering pages: the run stops starting reads when the budget is spent, files what it read and reports the rest', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    const ids = Array.from({ length: 12 }, (_, i) => `p${String(i)}`)
    const routes: Record<string, Route> = {
      '/search': () => json(200, { results: ids.map((i) => pageObject(i, i)), has_more: false }),
    }
    for (const i of ids)
      routes[`/blocks/${i}/children`] = async () => {
        await new Promise((r) => setTimeout(r, 6_000))
        return json(200, { results: [paragraph(`text ${i}`)], has_more: false })
      }
    const r = await drive(mem, routes)
    // (a page costs 6 s plus the pump's 250 ms steps, so three to five start inside 25 s; what is exact is the sum)
    expect(mem.docs.length).toBeGreaterThanOrEqual(3)
    expect(mem.docs.length).toBeLessThanOrEqual(5)
    expect(r.out?.body).toContain(`${String(12 - mem.docs.length)} pages were not read this time`)
    expect(r.elapsedMs).toBeLessThanOrEqual(RUN_BUDGET_MS + NOTION_CALL_DEADLINE_MS)
  })

  it('a workspace too big to LIST in half the budget is read as far as it got, and the report says the list was partial', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    let n = 0
    const routes: Record<string, Route> = {
      '/search': async () => {
        await new Promise((r) => setTimeout(r, 4_000))
        n += 1
        return json(200, {
          results: [pageObject(`s${String(n)}`, `S${String(n)}`)],
          has_more: true,
          next_cursor: `c${String(n)}`,
        })
      },
    }
    for (let i = 1; i < 20; i += 1)
      routes[`/blocks/s${String(i)}/children`] = () =>
        json(200, { results: [paragraph('t')], has_more: false })
    const r = await drive(mem, routes)
    expect(r.out?.body).toMatch(/list of shared pages was cut short/)
    // the listing stopped at half the budget (12.5 s): requests at 0, 4 and 8 s began, the fourth would begin at 12 s
    expect(n).toBeLessThanOrEqual(4)
    expect(mem.docs.length).toBeGreaterThan(0)
    expect(r.elapsedMs).toBeLessThanOrEqual(RUN_BUDGET_MS + NOTION_CALL_DEADLINE_MS)
  })
})

describe('what an exception is, at the handler (the job lifecycle decides what follows)', () => {
  const twoPages: Record<string, Route> = {
    '/search': () =>
      json(200, { results: [pageObject('a', 'A'), pageObject('b', 'B')], has_more: false }),
    '/blocks/a/children': () => json(200, { results: [paragraph('1')], has_more: false }),
    '/blocks/b/children': () => json(200, { results: [paragraph('2')], has_more: false }),
  }

  it('a database connection timeout is THROWN as itself (the job is retried), not reported as pages left out', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    mem.fail(
      /insert into public\.documents/,
      () =>
        new SqlExecutionError('Failed to run sql query: write CONNECT_TIMEOUT db.host:5432', null),
    )
    const r = await drive(mem, twoPages)
    expect(r.out).toBeUndefined()
    expect(r.error).toBeInstanceOf(SqlExecutionError)
    expect(String((r.error as Error).message)).toMatch(/CONNECT_TIMEOUT/)
  })

  it('a database connection timeout BEFORE any Notion work (reading the attached projects) is thrown too', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    mem.fail(
      /project_attachments/,
      () =>
        new SqlExecutionError('Failed to run sql query: write CONNECT_TIMEOUT db.host:5432', null),
    )
    const r = await drive(mem, twoPages)
    expect(String((r.error as Error).message)).toMatch(/CONNECT_TIMEOUT/)
  })

  it('a token revoked part-way is reported once as a refusal and completes (retrying cannot change it)', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    const r = await drive(mem, {
      ...twoPages,
      '/blocks/b/children': () => json(401, { code: 'unauthorized' }),
    })
    expect(r.error).toBeUndefined()
    expect(r.out?.topic).toBe('notion.token_refused')
  })

  it('NEGATIVE CONTROL: a page refused by Notion is still just that page, and the sync completes', async () => {
    const mem = memoryDb({ offices: OFFICES, handler: { projects } })
    const r = await drive(mem, {
      ...twoPages,
      '/blocks/b/children': () => json(403, { code: 'restricted_resource' }),
    })
    expect(r.out?.body).toMatch(/left out: B: restricted_resource/)
    expect(mem.docs.map((d) => d.ref)).toEqual(['a'])
  })
})
