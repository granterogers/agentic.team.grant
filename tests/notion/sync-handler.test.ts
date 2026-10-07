/*
  M2 - office.notion_sync, driven through the REAL handler with deterministic Notion fakes (no network, no
  production credential). Every case asserts what the job would do: complete with a notice, throw so it is retried, or
  write documents. The fakes speak Notion's real shapes at API version 2026-03-11 (data sources, `/search`, block
  children with cursors) and nothing else.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { notionSyncHandler } from '../../src/handlers/notion-sync.ts'
import type { HandlerOutput, Job } from '../../src/jobs/worker.ts'
import { NOTION_VERSION, NotionApiError } from '../../src/notion/api.ts'
import { fingerprintContent } from '../../src/notion/sync.ts'

const JOB = '11111111-1111-4111-8111-111111111111'
const job = { jobId: JOB, correlationId: 'c', kind: 'office.notion_sync' } as unknown as Job

let spentModel = false
vi.mock('../../src/text/voice.ts', async (original) => ({
  ...(await original<typeof import('../../src/text/voice.ts')>()),
  // The model path: speaking spends an inference, recorded against the job's correlation.
  sayAs: vi.fn(async (_db: unknown, _router: unknown, _who: string, o: { fallback: string }) => {
    spentModel = true
    return `in my words: ${o.fallback}`
  }),
}))

interface Cfg {
  enabled?: boolean
  token?: string | null
  projects?: { id: string; name: string }[]
  /** document fingerprints already held, keyed by Notion id */
  known?: Set<string>
  /** the fingerprint a known document holds (default: one that matches nothing) */
  fingerprint?: string
}
const executor = (cfg: Cfg = {}) => {
  const seen: string[] = []
  const db = {
    kind: 'fake',
    execute: async (sql: string) => {
      seen.push(sql)
      if (/knowledge_connectors/.test(sql))
        return {
          rows: [
            {
              enabled: cfg.enabled ?? true,
              disabled_reason: null,
              token: cfg.token === undefined ? 'ntn_test_token' : cfg.token,
            },
          ],
        }
      if (/project_attachments/.test(sql))
        return { rows: cfg.projects ?? [{ id: 'p1', name: 'Legacy Coaching Course' }] }
      if (/app\.container_refs/.test(sql)) return { rows: [] }
      if (/select content_fingerprint from public\.documents/.test(sql)) {
        const id = [...(cfg.known ?? [])].find((k) => sql.includes(`'${k}'`))
        return { rows: id === undefined ? [] : [{ content_fingerprint: cfg.fingerprint ?? 'stale' }] }
      }
      if (/insert into public\.documents/.test(sql)) return { rows: [{ document_id: 'd' }] }
      if (/inference_usage/.test(sql)) return { rows: [{ n: spentModel ? 1 : 0 }] }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, seen, inserts: () => seen.filter((s) => /insert into public\.documents/.test(s)) }
}

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>
/** A Notion that answers per path; records every request made. */
const notion = (routes: Record<string, Route>) => {
  const requests: { path: string; init: RequestInit }[] = []
  const impl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/v1/, '')
    requests.push({ path, init })
    const hit = Object.entries(routes).find(([p]) => path === p || path.startsWith(`${p}/`))
    if (hit === undefined) return json(404, { code: 'object_not_found' })
    return hit[1](url, init)
  })
  vi.stubGlobal('fetch', impl)
  return { requests, impl }
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers })
const page = (id: string, title: string) => ({
  object: 'page',
  id,
  last_edited_time: '2026-10-01T00:00:00.000Z',
  url: `https://notion.so/${id}`,
  properties: { Name: { type: 'title', title: [{ plain_text: title }] } },
})
const paragraph = (text: string) => ({
  object: 'block',
  id: `b-${text}`,
  type: 'paragraph',
  has_children: false,
  paragraph: { rich_text: [{ plain_text: text }] },
})
const blocks = (text: string) => () => json(200, { results: [paragraph(text)], has_more: false })

const run = async (cfg: Cfg = {}): Promise<{ out: HandlerOutput; ctx: ReturnType<typeof executor> }> => {
  const ctx = executor(cfg)
  const out = await notionSyncHandler(ctx.db, null).handle(job, ctx.db)
  return { out, ctx }
}
const thrown = async (cfg: Cfg = {}): Promise<unknown> => {
  const ctx = executor(cfg)
  return await notionSyncHandler(ctx.db, null)
    .handle(job, ctx.db)
    .then(
      () => null,
      (e: unknown) => e,
    )
}

beforeEach(() => {
  spentModel = false
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a healthy sync', () => {
  it('reads shared pages at the pinned API version and files them in the job\'s office', async () => {
    const n = notion({
      '/search': () => json(200, { results: [page('pg1', 'Notes'), page('pg2', 'Ideas')], has_more: false }),
      '/blocks/pg1/children': blocks('first page text'),
      '/blocks/pg2/children': blocks('second page text'),
    })
    const { out, ctx } = await run()
    expect(out.announce).toBe(true)
    expect(out.body).toMatch(/2 new pages/)
    expect(ctx.inserts()).toHaveLength(2)
    expect(ctx.inserts()[0]).toMatch(/app\.job_office|select p\.office_id from public\.projects/)
    for (const r of n.requests) {
      expect((r.init.headers as Record<string, string>)['Notion-Version']).toBe(NOTION_VERSION)
      expect((r.init.headers as Record<string, string>).Authorization).toBe('Bearer ntn_test_token')
    }
  })

  it('follows pagination: pages beyond the first 100 are read, not silently dropped', async () => {
    // a scripted two-page search keyed on the cursor in the POST body
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
        const path = new URL(String(input)).pathname.replace(/^\/v1/, '')
        if (path === '/search') {
          calls += 1
          const cursor = (JSON.parse(String(init.body)) as { start_cursor?: string }).start_cursor
          return cursor === undefined
            ? json(200, { results: [page('a', 'A')], has_more: true, next_cursor: 'cur-1' })
            : json(200, { results: [page('b', 'B')], has_more: false, next_cursor: null })
        }
        return blocks(`text of ${path}`)()
      }),
    )
    const { out, ctx } = await run()
    expect(calls).toBe(2)
    expect(ctx.inserts()).toHaveLength(2)
    expect(out.body).toMatch(/2 new pages/)
  })

  it('a data source (2026-03-11) is queried at /data_sources/:id/query, never /databases', async () => {
    const n = notion({
      '/search': () =>
        json(200, {
          results: [
            {
              object: 'data_source',
              id: 'ds1',
              title: [{ plain_text: 'Tasks' }],
              last_edited_time: '2026-10-01T00:00:00.000Z',
            },
          ],
          has_more: false,
        }),
      '/data_sources/ds1/query': () =>
        json(200, { results: [page('row1', 'Write the outline')], has_more: false }),
    })
    const { ctx } = await run()
    expect(n.requests.map((r) => r.path)).toContain('/data_sources/ds1/query')
    expect(n.requests.some((r) => r.path.startsWith('/databases'))).toBe(false)
    expect(ctx.inserts()).toHaveLength(1)
  })

  it('one unreadable page is left out and named; the others still sync', async () => {
    notion({
      '/search': () => json(200, { results: [page('ok', 'Readable'), page('bad', 'Private')], has_more: false }),
      '/blocks/ok/children': blocks('fine'),
      '/blocks/bad/children': () => json(403, { code: 'restricted_resource' }),
    })
    const { out, ctx } = await run()
    expect(ctx.inserts()).toHaveLength(1)
    expect(out.body).toMatch(/1 page was left out: Private: restricted_resource/)
  })

  it('a known page whose text differs is counted as a change; one whose text is the same is not rewritten', async () => {
    notion({
      '/search': () => json(200, { results: [page('pg1', 'Notes')], has_more: false }),
      '/blocks/pg1/children': blocks('edited text'),
    })
    const changed = await run({ known: new Set(['pg1']) })
    expect(changed.out.body).toMatch(/1 change/)
    expect(changed.ctx.inserts()).toHaveLength(1)

    const fingerprint = await fingerprintContent('edited text')
    const same = await run({ known: new Set(['pg1']), fingerprint })
    expect(same.ctx.inserts()).toHaveLength(0)
    expect(same.out.body).toMatch(/Nothing new/)
  })
})

describe('switched off, unconfigured', () => {
  it('the kill-switch reads nothing and says nothing', async () => {
    const n = notion({})
    const { out } = await run({ enabled: false })
    expect(n.requests).toHaveLength(0)
    expect(out.announce).toBe(false)
    expect(out.body).toMatch(/switched off/)
  })

  it('no token in the vault: says so, reads nothing', async () => {
    const n = notion({})
    const { out } = await run({ token: null })
    expect(n.requests).toHaveLength(0)
    expect(out.announce).toBe(true)
    expect(out.body).toMatch(/no Notion token/)
  })

  it('no project attaches a database: nothing is read and nothing is announced', async () => {
    const n = notion({})
    const { out } = await run({ projects: [] })
    expect(n.requests).toHaveLength(0)
    expect(out.announce).toBe(false)
  })
})

describe('a refusal no retry can change is REPORTED once, not thrown every two hours for ever', () => {
  it('401 (revoked token or removed integration): completes with a notice, one request, no document, no retry loop', async () => {
    const n = notion({ '/search': () => json(401, { code: 'unauthorized', message: 'API token is invalid.' }) })
    const { out, ctx } = await run()
    expect(out.announce).toBe(true)
    expect(out.topic).toBe('notion.token_refused')
    expect(out.body).toMatch(/stopped accepting the connection/)
    expect(out.body).not.toMatch(/unauthorized|ntn_/)
    expect(n.requests.map((r) => r.path)).toEqual(['/search'])
    expect(ctx.inserts()).toHaveLength(0)
    expect(out.path).toBe('deterministic_retrieval')
  })

  it('the notice is keyed by a topic, so the daily-once rule holds a repeat even when the words change', async () => {
    notion({ '/search': () => json(401, { code: 'unauthorized' }) })
    const a = (await run()).out
    const b = (await run()).out
    expect(a.topic).toBeDefined()
    expect(a.topic).toBe(b.topic)
  })

  it('a 400 from /search (API drift) is reported with its status under its own topic', async () => {
    notion({ '/search': () => json(400, { code: 'validation_error', message: 'body.filter is not valid' }) })
    const { out } = await run()
    expect(out.topic).toBe('notion.sync_refused')
    expect(out.body).toMatch(/HTTP 400/)
    expect(out.announce).toBe(true)
  })

  it('NEGATIVE CONTROL: a 403 on one page is still just that page left out, never the whole-sync notice', async () => {
    notion({
      '/search': () => json(200, { results: [page('x', 'Locked')], has_more: false }),
      '/blocks/x/children': () => json(403, { code: 'restricted_resource' }),
    })
    const { out } = await run()
    expect(out.topic).toBeUndefined()
    expect(out.body).toMatch(/left out/)
  })
})

describe('a failure a retry CAN fix still throws, so the job retries', () => {
  it.each([
    ['500', () => json(500, { code: 'internal_server_error' })],
    ['an HTML 502 from a proxy (not JSON)', () => new Response('<html>502 Bad Gateway</html>', { status: 502 })],
    ['a 200 that is not a JSON object', () => new Response('"ok"', { status: 200 })],
    ['a 200 with an HTML body', () => new Response('<html>maintenance</html>', { status: 200 })],
  ])('%s', async (_name, answer) => {
    notion({ '/search': answer })
    const err = await thrown()
    expect(err).toBeInstanceOf(NotionApiError)
    expect((err as NotionApiError).kind).toBe('transient')
  })

  it('a 502 HTML body is classified by its STATUS (transient), not a raw SyntaxError', async () => {
    notion({ '/search': () => new Response('<html>502</html>', { status: 502 }) })
    const err = await thrown()
    expect(err).not.toBeInstanceOf(SyntaxError)
    expect((err as NotionApiError).status).toBe(502)
  })

  it('a Notion that never answers is abandoned at the deadline and thrown as a transient timeout', async () => {
    vi.useFakeTimers()
    notion({ '/search': () => new Promise<Response>(() => undefined) })
    const ctx = executor()
    const state: { done: boolean; err?: unknown } = { done: false }
    void notionSyncHandler(ctx.db, null)
      .handle(job, ctx.db)
      .catch((e: unknown) => {
        state.err = e
      })
      .finally(() => {
        state.done = true
      })
    await vi.advanceTimersByTimeAsync(19_000)
    expect(state.done, 'still waiting just before the deadline').toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    for (let i = 0; i < 50; i += 1) await Promise.resolve()
    // a flag, not an await: a client with no deadline fails here instead of hanging the suite
    expect(state.done, 'HUNG: no deadline').toBe(true)
    expect(state.err).toBeInstanceOf(NotionApiError)
    expect((state.err as NotionApiError).code).toBe('timeout')
    expect((state.err as NotionApiError).kind).toBe('transient')
  })

  it('429 honours Retry-After and then succeeds (rate limiting is waited out, not failed)', async () => {
    vi.useFakeTimers()
    let calls = 0
    notion({
      '/search': () => {
        calls += 1
        return calls === 1
          ? json(429, { code: 'rate_limited' }, { 'retry-after': '2' })
          : json(200, { results: [], has_more: false })
      },
    })
    const ctx = executor()
    const result: { out?: HandlerOutput } = {}
    void notionSyncHandler(ctx.db, null)
      .handle(job, ctx.db)
      .then((o) => {
        result.out = o
      })
    await vi.advanceTimersByTimeAsync(1_900)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(300)
    for (let i = 0; i < 50; i += 1) await Promise.resolve()
    expect(calls).toBe(2)
    expect(result.out?.body).toMatch(/Nothing new/)
  })
})

describe('the provenance claim is made AFTER the model is spent (the 18 September defect, driven)', () => {
  it('a run that speaks through the model reports path inference, not deterministic_retrieval', async () => {
    notion({
      '/search': () => json(200, { results: [page('pg1', 'Notes')], has_more: false }),
      '/blocks/pg1/children': blocks('text'),
    })
    const { out } = await run()
    expect(spentModel).toBe(true)
    expect(out.body).toMatch(/^in my words/)
    expect(out.path).toBe('inference')
  })

  it('a run with nothing to say spends nothing and stays deterministic', async () => {
    notion({ '/search': () => json(200, { results: [], has_more: false }) })
    const { out } = await run()
    expect(spentModel).toBe(false)
    expect(out.path).toBe('deterministic_retrieval')
    expect(out.announce).toBe(false)
  })
})
