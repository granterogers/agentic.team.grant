/*
  The Notion sync as a property of the ROWS it leaves behind (in-memory stand-in for the tables, real sync code, a Notion
  that answers per path). What each block proves is named, and the ones that guard a call carry a mutation entry in
  scripts/audit/mutations.json (N1...).
*/
import { describe, expect, it } from 'vitest'
import { SqlExecutionError } from '../../src/db/executor.ts'
import { NotionApiError, NotionClient } from '../../src/notion/api.ts'
import {
  fingerprintContent,
  listSharedWithin,
  MAX_CONSECUTIVE_TRANSIENT,
  type NotionObject,
  syncNotion,
  unchangedSinceRead,
} from '../../src/notion/sync.ts'
import {
  fakeNotion,
  json,
  type MemDoc,
  memoryDb,
  pageObject,
  paragraph,
  type Route,
} from './support/memory-db.ts'

const OFFICES = { p1: 'office-1', p2: 'office-1', p3: 'office-2' }
const T0 = '2026-10-01T00:00:00.000Z'
const MS0 = Date.parse(T0)
const office = { jobId: 'j' }

const clientFor = (
  n: ReturnType<typeof fakeNotion>,
  o: ConstructorParameters<typeof NotionClient>[1] = {},
) => new NotionClient('ntn_x', { fetchImpl: n.fetchImpl, sleep: async () => undefined, ...o })

const blocksRoute =
  (text: string): Route =>
  () =>
    json(200, { results: [paragraph(text)], has_more: false })

const searchOf =
  (results: unknown[]): Route =>
  () =>
    json(200, { results, has_more: false })

describe('resumable: interrupted work continues, it does not restart', () => {
  it('a run cut short leaves finished pages stored, and the next run reads ONLY what is left', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let now = 0
    const routes: Record<string, Route> = {
      '/search': searchOf(
        Array.from({ length: 6 }, (_, i) => pageObject(`pg${String(i)}`, `Page ${String(i)}`)),
      ),
    }
    for (let i = 0; i < 6; i += 1)
      routes[`/blocks/pg${String(i)}/children`] = () => {
        now += 25_000 // every page read costs 25 s of the clock
        return json(200, { results: [paragraph(`text ${String(i)}`)], has_more: false })
      }
    const n = fakeNotion(routes)
    const client = clientFor(n)
    const shared = await (async () => {
      const l = await listSharedWithin(client, { expired: () => false })
      return l.objects
    })()

    // Run 1: a 60 s budget, three pages fit.
    const first = await syncNotion(mem.db, office, client, 'p1', {
      shared,
      budget: { expired: () => now >= 60_000 },
    })
    expect(first.added).toBe(3)
    expect(first.deferred).toBe(3)
    expect(mem.docs.map((d) => d.ref).sort()).toEqual(['pg0', 'pg1', 'pg2'])

    // Run 2: a fresh budget. Only the three that were never read are fetched; finished pages cost nothing.
    n.requests.length = 0
    now = 0
    const second = await syncNotion(mem.db, office, client, 'p1', {
      shared,
      budget: { expired: () => now >= 60_000 },
    })
    expect(n.blockReads()).toEqual([
      '/blocks/pg3/children',
      '/blocks/pg4/children',
      '/blocks/pg5/children',
    ])
    expect(second.added).toBe(3)
    expect(second.deferred).toBe(0)
    expect(mem.docs).toHaveLength(6)

    // Run 3: everything is read and unedited, so the whole run costs zero page requests.
    n.requests.length = 0
    const third = await syncNotion(mem.db, office, client, 'p1', { shared })
    expect(n.blockReads()).toEqual([])
    expect(third).toMatchObject({ added: 0, changed: 0, unchanged: 6, deferred: 0 })
  })

  it('a page cut off MID-READ is deferred (not skipped, not stored half-read) and is complete when it is read again', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let now = 0
    // a page with two pages of blocks; the first reply uses up the budget
    let reads = 0
    const n = fakeNotion({
      '/search': searchOf([pageObject('big', 'Big')]),
      '/blocks/big/children': (url) => {
        reads += 1
        if (url.searchParams.get('start_cursor') === null) {
          if (reads === 1) now += 70_000 // only the first read is slow
          return json(200, {
            results: [paragraph('first half')],
            has_more: true,
            next_cursor: 'c1',
          })
        }
        return json(200, { results: [paragraph('second half')], has_more: false })
      },
    })
    const client = clientFor(n)
    const first = await syncNotion(mem.db, office, client, 'p1', {
      budget: { expired: () => now >= 60_000 },
    })
    expect(first.deferred).toBe(1)
    expect(first.skipped).toEqual([])
    expect(mem.docs).toHaveLength(0) // nothing half-read is stored
    expect(reads).toBe(1) // and the guard stopped the cursor request

    now = 0
    const second = await syncNotion(mem.db, office, client, 'p1', {
      budget: { expired: () => now >= 60_000 },
    })
    expect(second.added).toBe(1)
    expect(mem.docs[0]?.content).toContain('first half')
    expect(mem.docs[0]?.content).toContain('second half')
  })

  it('a long FLAT page (no nesting) is bounded by the budget too: it stops between cursor pages', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let now = 0
    let requests = 0
    const n = fakeNotion({
      '/search': searchOf([pageObject('flat', 'Flat')]),
      '/blocks/flat/children': () => {
        requests += 1
        now += 10_000
        return json(200, {
          results: [paragraph(`b${String(requests)}`)],
          has_more: true,
          next_cursor: `c${String(requests)}`,
        })
      },
    })
    const out = await syncNotion(mem.db, office, clientFor(n), 'p1', {
      budget: { expired: () => now >= 30_000 },
    })
    expect(requests).toBe(3)
    expect(out.deferred).toBe(1)
    expect(mem.docs).toHaveLength(0)
  })

  it('a page too large for ONE page-share is named, and does not starve the pages behind it', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let now = 0
    const n = fakeNotion({
      '/search': searchOf([pageObject('monster', 'Monster'), pageObject('small', 'Small')]),
      '/blocks/monster/children': () => {
        now += 6_000
        return json(200, {
          results: [paragraph('m')],
          has_more: true,
          next_cursor: `c${String(now)}`,
        })
      },
      '/blocks/small/children': blocksRoute('small text'),
    })
    const out = await syncNotion(mem.db, office, clientFor(n), 'p1', {
      budget: { expired: () => now >= 60_000 },
      pageBudgetMs: 15_000,
      clock: () => now,
    })
    expect(out.skipped).toEqual(['Monster: too large to read in one pass'])
    expect(out.deferred).toBe(0)
    expect(out.added).toBe(1)
    expect(mem.docs.map((d) => d.ref)).toEqual(['small'])
  })
})

describe('unchanged pages are skipped and changed pages are not missed', () => {
  const held = (ms: number | null, content: string | null = 'x') => [
    {
      office: 'office-1',
      project: 'p1',
      parent: 'page',
      ref: 'pg',
      title: 'T',
      content,
      fingerprint: 'f',
      remoteMs: ms,
    },
  ]
  const objectAt = (lastEdited: string | null): NotionObject => ({
    id: 'pg',
    object: 'page',
    title: 'T',
    lastEdited,
    url: null,
  })
  const skips = async (
    stored: number | null,
    lastEdited: string | null,
    content: string | null = 'x',
  ) => {
    const mem = memoryDb({ offices: OFFICES, docs: held(stored, content) })
    return (await unchangedSinceRead(mem.db, 'p1', [objectAt(lastEdited)])).has('pg')
  }

  it.each([
    ['the same instant, milliseconds', T0],
    ['the same instant, no milliseconds', '2026-10-01T00:00:00Z'],
    ['the same instant, written with an offset', '2026-10-01T02:00:00.000+02:00'],
    ['the same instant, a different fractional length', '2026-10-01T00:00:00.0Z'],
  ])('SKIPS: %s', async (_name, lastEdited) => {
    expect(await skips(MS0, lastEdited)).toBe(true)
  })

  it.each([
    ['edited one millisecond later', MS0, '2026-10-01T00:00:00.001Z'],
    [
      'edited one millisecond earlier than the stored time (a stored time that is AHEAD is not proof)',
      MS0,
      '2026-09-30T23:59:59.999Z',
    ],
    ['edited a whole second later', MS0, '2026-10-01T00:00:01.000Z'],
    ['an edit time Notion no longer reports', MS0, null],
    ['an edit time that does not parse', MS0, 'last tuesday'],
    ['no stored edit time (a page the office wrote itself)', null, T0],
  ])('READS AGAIN: %s', async (_name, stored, lastEdited) => {
    expect(await skips(stored, lastEdited)).toBe(false)
  })

  it('READS AGAIN: a held row with no text yet (null means "not read")', async () => {
    expect(await skips(MS0, T0, null)).toBe(false)
  })

  it('a database is never skipped, because adding a row does not move its own edit time', async () => {
    const row = { ...held(MS0)[0], parent: 'database' } as MemDoc
    const mem = memoryDb({ offices: OFFICES, docs: [row] })
    const set = await unchangedSinceRead(mem.db, 'p1', [
      { id: 'pg', object: 'database', title: 'T', lastEdited: T0, url: null },
    ])
    expect(set.size).toBe(0)
  })

  it('end to end: a page stored from a no-milliseconds time is skipped on a milliseconds time of the same instant, and read when edited by 1 ms', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let edited = '2026-10-01T00:00:00Z'
    const n = fakeNotion({
      '/search': () => json(200, { results: [pageObject('pg', 'T', edited)], has_more: false }),
      '/blocks/pg/children': blocksRoute('body'),
    })
    const client = clientFor(n)
    await syncNotion(mem.db, office, client, 'p1', {
      shared: (await listSharedWithin(client, { expired: () => false })).objects,
    })
    expect(mem.docs[0]?.remoteMs).toBe(MS0)

    edited = T0
    n.requests.length = 0
    await syncNotion(mem.db, office, client, 'p1', {
      shared: (await listSharedWithin(client, { expired: () => false })).objects,
    })
    expect(n.blockReads()).toEqual([])

    edited = '2026-10-01T00:00:00.001Z'
    n.requests.length = 0
    await syncNotion(mem.db, office, client, 'p1', {
      shared: (await listSharedWithin(client, { expired: () => false })).objects,
    })
    expect(n.blockReads()).toEqual(['/blocks/pg/children'])
  })

  it('an edit whose text is the same still moves the stored edit time, so the page is skippable again', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let edited = T0
    const n = fakeNotion({
      '/search': () => json(200, { results: [pageObject('pg', 'T', edited)], has_more: false }),
      '/blocks/pg/children': blocksRoute('body'),
    })
    const client = clientFor(n)
    const list = async () => (await listSharedWithin(client, { expired: () => false })).objects
    await syncNotion(mem.db, office, client, 'p1', { shared: await list() })
    edited = '2026-10-02T00:00:00.000Z' // edited, text identical
    const out = await syncNotion(mem.db, office, client, 'p1', { shared: await list() })
    expect(out.unchanged).toBe(1)
    expect(mem.docs[0]?.remoteMs).toBe(Date.parse(edited))
    n.requests.length = 0
    await syncNotion(mem.db, office, client, 'p1', { shared: await list() })
    expect(n.blockReads()).toEqual([])
  })

  it('a page renamed in Notion with the same body is a change, and the stored title follows', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let title = 'Old name'
    let edited = T0
    const n = fakeNotion({
      '/search': () => json(200, { results: [pageObject('pg', title, edited)], has_more: false }),
      '/blocks/pg/children': blocksRoute('body'),
    })
    const client = clientFor(n)
    const list = async () => (await listSharedWithin(client, { expired: () => false })).objects
    await syncNotion(mem.db, office, client, 'p1', { shared: await list() })
    title = 'New name'
    edited = '2026-10-02T00:00:00.000Z' // a rename moves the page's edit time in Notion
    const out = await syncNotion(mem.db, office, client, 'p1', { shared: await list() })
    expect(out.changed).toBe(1)
    expect(mem.docs[0]?.title).toBe('New name')
  })

  it('a page whose text changed is rewritten and counted as changed', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let text = 'one'
    let edited = T0
    const n = fakeNotion({
      '/search': () => json(200, { results: [pageObject('pg', 'T', edited)], has_more: false }),
      '/blocks/pg/children': () => json(200, { results: [paragraph(text)], has_more: false }),
    })
    const client = clientFor(n)
    const list = async () => (await listSharedWithin(client, { expired: () => false })).objects
    await syncNotion(mem.db, office, client, 'p1', { shared: await list() })
    text = 'two'
    edited = '2026-10-03T00:00:00.000Z'
    const out = await syncNotion(mem.db, office, client, 'p1', { shared: await list() })
    expect(out.changed).toBe(1)
    expect(mem.docs[0]?.fingerprint).toBe(await fingerprintContent(mem.docs[0]?.content ?? ''))
    expect(mem.docs[0]?.content).toContain('two')
  })
})

describe('pagination', () => {
  it('a workspace of 250 shared objects is listed across three requests at page_size 100, none dropped', async () => {
    const all = Array.from({ length: 250 }, (_, i) => pageObject(`id${String(i)}`, `P${String(i)}`))
    const n = fakeNotion({
      '/search': (_url, init) => {
        const body = JSON.parse(String(init.body)) as { start_cursor?: string; page_size?: number }
        expect(body.page_size).toBe(100)
        const from = body.start_cursor === undefined ? 0 : Number(body.start_cursor)
        const next = from + 100
        return json(200, {
          results: all.slice(from, next),
          has_more: next < all.length,
          next_cursor: next < all.length ? String(next) : null,
        })
      },
    })
    const listed = await listSharedWithin(clientFor(n), { expired: () => false })
    expect(listed.complete).toBe(true)
    expect(listed.objects.map((o) => o.id)).toEqual(all.map((o) => o.id))
    expect(n.requests).toHaveLength(3)
  })

  it('inside the block tree: a page of 150 blocks and a toggle with 120 children are read in full', async () => {
    const mem = memoryDb({ offices: OFFICES })
    const flat = Array.from({ length: 150 }, (_, i) => paragraph(`flat-${String(i)}`))
    flat[10] = paragraph('toggle', { id: 'tg', has_children: true })
    const nested = Array.from({ length: 120 }, (_, i) => paragraph(`nested-${String(i)}`))
    const slice = (all: unknown[], url: URL) => {
      const from = Number(url.searchParams.get('start_cursor') ?? 0)
      const next = from + 100
      return json(200, {
        results: all.slice(from, next),
        has_more: next < all.length,
        next_cursor: next < all.length ? String(next) : null,
      })
    }
    const n = fakeNotion({
      '/search': searchOf([pageObject('deep', 'Deep')]),
      '/blocks/deep/children': (url) => slice(flat, url),
      '/blocks/tg/children': (url) => slice(nested, url),
    })
    const out = await syncNotion(mem.db, office, clientFor(n), 'p1')
    expect(out.added).toBe(1)
    const text = mem.docs[0]?.content ?? ''
    expect(text).toContain('flat-149')
    expect(text).toContain('nested-0')
    expect(text).toContain('nested-119')
    // 2 cursor pages of the page, 2 cursor pages of the toggle
    expect(n.blockReads().filter((p) => p === '/blocks/deep/children')).toHaveLength(2)
    expect(n.blockReads().filter((p) => p === '/blocks/tg/children')).toHaveLength(2)
  })

  it('a database with more than 100 rows is read to the end', async () => {
    const mem = memoryDb({ offices: OFFICES })
    const rows = Array.from({ length: 130 }, (_, i) =>
      pageObject(`r${String(i)}`, `Row ${String(i)}`),
    )
    const n = fakeNotion({
      '/search': searchOf([
        { object: 'data_source', id: 'ds', title: [{ plain_text: 'Tasks' }], last_edited_time: T0 },
      ]),
      '/data_sources/ds/query': (_u, init) => {
        const body = JSON.parse(String(init.body)) as { start_cursor?: string }
        const from = body.start_cursor === undefined ? 0 : Number(body.start_cursor)
        return json(200, {
          results: rows.slice(from, from + 100),
          has_more: from + 100 < rows.length,
          next_cursor: from + 100 < rows.length ? String(from + 100) : null,
        })
      },
    })
    await syncNotion(mem.db, office, clientFor(n), 'p1')
    expect(mem.docs[0]?.content).toContain('Row 129')
  })
})

describe('isolation', () => {
  const sharedNotion = (text: () => string) =>
    fakeNotion({
      '/search': searchOf([pageObject('same-id', 'Shared page')]),
      '/blocks/same-id/children': () =>
        json(200, { results: [paragraph(text())], has_more: false }),
    })

  it('two OFFICES with the same Notion page id each keep their own row and never overwrite one another', async () => {
    const mem = memoryDb({ offices: OFFICES })
    let text = 'office one words'
    const n = sharedNotion(() => text)
    await syncNotion(mem.db, office, clientFor(n), 'p1')
    text = 'office two words'
    await syncNotion(mem.db, office, clientFor(n), 'p3')
    expect(mem.docs).toHaveLength(2)
    expect(mem.docs.find((d) => d.office === 'office-1')?.content).toContain('office one words')
    expect(mem.docs.find((d) => d.office === 'office-2')?.content).toContain('office two words')
    // and a later run for office 1 does not see office 2's row as "already read"
    n.requests.length = 0
    text = 'office one again'
    const again = await syncNotion(mem.db, office, clientFor(n), 'p1', {
      shared: [
        {
          id: 'same-id',
          object: 'page',
          title: 'Shared page',
          lastEdited: '2026-10-09T00:00:00.000Z',
          url: null,
        },
      ],
    })
    expect(again.changed).toBe(1)
    expect(mem.docs.find((d) => d.office === 'office-2')?.content).toContain('office two words')
  })

  it('every statement the sync writes or reads names the office of the project, never an unscoped table', async () => {
    const mem = memoryDb({ offices: OFFICES })
    const n = sharedNotion(() => 'x')
    await syncNotion(mem.db, office, clientFor(n), 'p1')
    const docStatements = mem.seen.filter((s) => /public\.documents/.test(s))
    expect(docStatements.length).toBeGreaterThan(0)
    for (const s of docStatements)
      expect(s, s.slice(0, 80)).toContain(
        "select p.office_id from public.projects p where p.project_id = 'p1'::uuid",
      )
  })

  it('DECIDED: a page another project of the SAME office already holds is already read for this office (one row per page per office), and is not re-homed by a second project', async () => {
    const mem = memoryDb({ offices: OFFICES })
    const n = sharedNotion(() => 'body')
    const client = clientFor(n)
    const shared = (await listSharedWithin(client, { expired: () => false })).objects
    await syncNotion(mem.db, office, client, 'p1', { shared })
    n.requests.length = 0
    const second = await syncNotion(mem.db, office, client, 'p2', { shared })
    expect(n.blockReads()).toEqual([]) // no second read of an unedited page
    expect(second.unchanged).toBe(1)
    expect(mem.docs).toHaveLength(1)
    expect(mem.docs[0]?.project).toBe('p1')
  })
})

describe('retries do not duplicate', () => {
  it('running the same pass again leaves the same rows, and a retry after a failed write adds no second copy', async () => {
    const mem = memoryDb({ offices: OFFICES })
    const n = fakeNotion({
      '/search': searchOf([pageObject('a', 'A'), pageObject('b', 'B')]),
      '/blocks/a/children': blocksRoute('aa'),
      '/blocks/b/children': blocksRoute('bb'),
    })
    const client = clientFor(n)
    await syncNotion(mem.db, office, client, 'p1')
    expect(mem.docs).toHaveLength(2)
    const again = await syncNotion(mem.db, office, client, 'p1')
    expect(mem.docs).toHaveLength(2)
    expect(again).toMatchObject({ added: 0, changed: 0 })

    // Now a genuine interruption: the second insert fails once, then the retry completes.
    const mem2 = memoryDb({ offices: OFFICES })
    let calls = 0
    mem2.fail(
      /insert into public\.documents/,
      () => {
        calls += 1
        return new SqlExecutionError(
          'Failed to run sql query: write CONNECTION_CLOSED db:5432',
          null,
        )
      },
      1,
    )
    // the first insert is the one that fails; the retry (a new run) files both
    await expect(syncNotion(mem2.db, office, client, 'p1')).rejects.toThrow(/CONNECTION_CLOSED/)
    expect(calls).toBe(1)
    expect(mem2.docs).toHaveLength(0)
    await syncNotion(mem2.db, office, client, 'p1')
    await syncNotion(mem2.db, office, client, 'p1')
    expect(mem2.docs.map((d) => d.ref).sort()).toEqual(['a', 'b'])
  })
})

describe('one failing page does not block the others, and accuracy about WHY', () => {
  it('a refused page is left out and named; a timing-out page is DEFERRED (not skipped); the rest are filed', async () => {
    const mem = memoryDb({ offices: OFFICES })
    const n = fakeNotion({
      '/search': searchOf([
        pageObject('locked', 'Locked'),
        pageObject('slow', 'Slow'),
        pageObject('fine', 'Fine'),
      ]),
      '/blocks/locked/children': () => json(403, { code: 'restricted_resource' }),
      '/blocks/slow/children': () => json(503, { code: 'service_unavailable' }),
      '/blocks/fine/children': blocksRoute('ok'),
    })
    const out = await syncNotion(mem.db, office, clientFor(n), 'p1')
    expect(out.skipped).toEqual(['Locked: restricted_resource'])
    expect(out.deferred).toBe(1)
    expect(out.added).toBe(1)
    expect(mem.docs.map((d) => d.ref)).toEqual(['fine'])
  })

  it(`after ${String(MAX_CONSECUTIVE_TRANSIENT)} transient failures in a row the rest wait for the next run instead of spending the budget on a Notion that is down`, async () => {
    const mem = memoryDb({ offices: OFFICES })
    const routes: Record<string, Route> = {
      '/search': searchOf(
        Array.from({ length: 8 }, (_, i) => pageObject(`p${String(i)}`, `P${String(i)}`)),
      ),
    }
    for (let i = 0; i < 8; i += 1)
      routes[`/blocks/p${String(i)}/children`] = () => json(500, { code: 'internal_server_error' })
    const n = fakeNotion(routes)
    const out = await syncNotion(mem.db, office, clientFor(n), 'p1')
    expect(n.blockReads()).toHaveLength(MAX_CONSECUTIVE_TRANSIENT)
    expect(out.deferred).toBe(8)
    expect(out.skipped).toEqual([])
  })

  it('a good page between failures resets the run of failures', async () => {
    const mem = memoryDb({ offices: OFFICES })
    const routes: Record<string, Route> = {
      '/search': searchOf(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((i) => pageObject(i, i.toUpperCase())),
      ),
    }
    for (const i of ['a', 'b', 'd', 'e'])
      routes[`/blocks/${i}/children`] = () => json(500, { code: 'x' })
    for (const i of ['c', 'f']) routes[`/blocks/${i}/children`] = blocksRoute(`t${i}`)
    const n = fakeNotion(routes)
    const out = await syncNotion(mem.db, office, clientFor(n), 'p1')
    expect(n.blockReads()).toHaveLength(6)
    expect(out.added).toBe(2)
    expect(out.deferred).toBe(4)
  })

  it('a revoked token part-way through is the whole sync’s problem and is thrown as auth, not listed as a page', async () => {
    const mem = memoryDb({ offices: OFFICES })
    const n = fakeNotion({
      '/search': searchOf([pageObject('a', 'A'), pageObject('b', 'B')]),
      '/blocks/a/children': blocksRoute('ok'),
      '/blocks/b/children': () => json(401, { code: 'unauthorized' }),
    })
    const error = await syncNotion(mem.db, office, clientFor(n), 'p1').then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(NotionApiError)
    expect((error as NotionApiError).kind).toBe('auth')
  })

  it('a database connection failure while filing a page ENDS the run and names itself; it is never "left out: write CONNECT_TIMEOUT"', async () => {
    const mem = memoryDb({ offices: OFFICES })
    mem.fail(
      /insert into public\.documents/,
      () =>
        new SqlExecutionError('Failed to run sql query: write CONNECT_TIMEOUT db.host:5432', null),
    )
    const n = fakeNotion({
      '/search': searchOf([pageObject('a', 'A'), pageObject('b', 'B'), pageObject('c', 'C')]),
      '/blocks/a/children': blocksRoute('1'),
      '/blocks/b/children': blocksRoute('2'),
      '/blocks/c/children': blocksRoute('3'),
    })
    const error = await syncNotion(mem.db, office, clientFor(n), 'p1').then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(SqlExecutionError)
    expect(String((error as Error).message)).toMatch(/CONNECT_TIMEOUT/)
    // it did not go on to hammer the same dead link with the remaining pages
    expect(n.blockReads()).toEqual(['/blocks/a/children'])
  })

  it('NEGATIVE CONTROL: a statement the database refuses for ONE page is that page’s problem; the others are still filed', async () => {
    const mem = memoryDb({ offices: OFFICES })
    mem.fail(
      /insert into public\.documents[\s\S]*bad content/,
      () => new SqlExecutionError('22021: invalid byte sequence for encoding "UTF8": 0x00', null),
    )
    const n = fakeNotion({
      '/search': searchOf([pageObject('a', 'Bad'), pageObject('b', 'Good')]),
      '/blocks/a/children': blocksRoute('bad content'),
      '/blocks/b/children': blocksRoute('good content'),
    })
    const out = await syncNotion(mem.db, office, clientFor(n), 'p1')
    expect(out.skipped).toHaveLength(1)
    expect(out.skipped[0]).toMatch(/^Bad: 22021/)
    expect(mem.docs.map((d) => d.ref)).toEqual(['b'])
  })
})
