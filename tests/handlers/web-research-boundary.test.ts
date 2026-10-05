/**
 * The approval boundary of web research (the autonomy line, drawn in code).
 *
 *   (a) searching, reading, following a link, extracting, photographing and downloading are AUTONOMOUS: nothing here asks;
 *   (b) anything consequential is REFUSED by the browser tier and exists only as a plan step, asked about through the
 *       one approval architecture (`mayAct` / `app.authorize_effect`) - there is no second one;
 *   (c) a harness or fixture job never reaches a real destination: it is refused before the search engine or a page.
 *
 * The real policy (`app.authorize_effect`) is driven in SQL by `scripts/isolated/ux-be/05-web-sources.sql`; what is
 * proved here is the code on this side of it. Each property is asserted from the wired expression, not from a name that
 * merely appears in a file.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mayAct } from '../../src/agents/approval.ts'
import { FetchedBrowser } from '../../src/browser/fetched.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { webResearchHandler } from '../../src/handlers/web-research.ts'
import { containmentRefusal, REACH } from '../../src/jobs/containment.ts'
import type { Job } from '../../src/jobs/worker.ts'

// Comments are explanation, not behaviour: every property below is asserted over the CODE.
const handlerSource = readFileSync('src/handlers/web-research.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
const migration0442 = readFileSync(
  'migrations/0442_a_session_that_stays_valid_not_a_browser_that_stays_open.sql',
  'utf8',
)

const job = (kind = 'web.research'): Job => ({
  attempt: 1,
  correlationId: 'c',
  idempotencyKey: 'k-1234567',
  jobId: '00000000-0000-0000-0000-000000000001',
  kind,
  projectId: 'p',
})

const ACTING = [
  'click',
  'type',
  'submit',
  'post',
  'send',
  'publish',
  'email',
  'purchase',
  'buy',
  'book',
  'upload',
  'pay',
  'fill',
  'press',
]

describe('(a) reading is autonomous', () => {
  it('web.research is classified as reading: nothing external, so containment does not gate it and no question is asked', async () => {
    expect(REACH['web.research']?.reach).toBe('reads')
    const db = {
      execute: async () => ({ rows: [{ o: 'harness', known: true }] }),
    } as unknown as SqlExecutor
    // Even for a harness origin, containment itself says nothing about a read: the handler refuses it (see (c)).
    expect(await containmentRefusal(db, job())).toBeNull()
  })

  it('the handler composes only reading verbs, and every one is in the ledger CHECK', () => {
    const composed = new Set(
      [...handlerSource.matchAll(/\bnote\(\s*\n?\s*'([a-z]+)'/g)].map((m) => m[1] as string),
    )
    expect(composed.size).toBeGreaterThanOrEqual(3)
    for (const v of composed) expect(['open', 'read', 'shot', 'download']).toContain(v)
    const check = /check \(verb in \(([^)]+)\)/i.exec(migration0442)?.[1] ?? ''
    expect(check).not.toBe('')
    for (const v of composed) expect(check).toContain(`'${v}'`)
  })

  it('asks nobody for permission to read, but reads the dial: mayAct for web.read only, never governEffect or a blocker', () => {
    expect(handlerSource).toMatch(/\bconst policy = await mayAct\(db, \{[^}]*tool: 'web\.read'/s)
    expect(handlerSource).toMatch(/policy\.verdict !== 'proceed'/)
    expect(handlerSource).not.toMatch(/\bgovernEffect\s*\(/)
    expect(handlerSource).not.toMatch(/raiseBlocker\s*\(/)
    // and the dial is read BEFORE the first search: the refusal precedes every adapter and provider use in the file
    const dial = handlerSource.indexOf('policy.verdict !== ')
    expect(dial).toBeGreaterThan(0)
    expect(dial).toBeLessThan(handlerSource.indexOf('provider.search'))
  })

  it('the runtime that ships can only GET: asked to "click" it still issues a bodiless GET and nothing else', async () => {
    const seen: RequestInit[] = []
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      seen.push(init ?? {})
      return new Response(
        `<html><title>t</title><body>${'A real sentence of page content. '.repeat(30)}</body></html>`,
      )
    }) as unknown as typeof fetch
    await new FetchedBrowser({ fetchImpl }).gather({
      url: 'https://example.org/',
      verbs: ['click' as never, 'submit' as never, 'read'],
    })
    expect(seen.length).toBeGreaterThan(0)
    for (const s of seen) {
      expect(s.method ?? 'GET').toBe('GET')
      expect(s.body).toBeUndefined()
    }
    // control: the adapter has no acting method to call at all
    const methods = Object.getOwnPropertyNames(FetchedBrowser.prototype).filter(
      (m) => m !== 'constructor',
    )
    expect(methods).toEqual(['gather'])
  })
})

describe('(b) anything consequential is refused here and goes to the approval architecture', () => {
  it('the ledger CHECK lists no acting word', () => {
    const check = /check \(verb in \(([^)]+)\)/i.exec(migration0442)?.[1] ?? ''
    expect(check).not.toBe('')
    for (const w of ACTING) expect(check, w).not.toContain(`'${w}'`)
  })

  it('the handler source composes none of them as a verb', () => {
    for (const w of ACTING) expect(handlerSource, w).not.toMatch(new RegExp(`note\\(\\s*'${w}'`))
  })

  it('mayAct never turns a missing, malformed or empty policy answer into permission', async () => {
    for (const answer of [
      undefined,
      null,
      {},
      { verdict: 'proceed!' },
      'not json at all'.length === 0 ? '' : '{"verdict":"maybe"}',
    ]) {
      const db = {
        execute: async () => ({ rows: [{ d: answer }] }),
      } as unknown as SqlExecutor
      const d = await mayAct(db, { projectId: null, tool: 'form.submit' })
      expect(d.verdict).toBe('ask')
    }
  })

  it('mayAct hands a consequential tool whatever the policy said, and ask/refuse are never proceed', async () => {
    for (const tool of [
      'gmail.send',
      'slack.post',
      'spend.money',
      'form.submit',
      'booking.make',
      'upload.external',
    ]) {
      for (const verdict of ['ask', 'refuse'] as const) {
        const db = {
          execute: async () => ({
            rows: [{ d: { action_level: 3, because: 'x', tool, verdict } }],
          }),
        } as unknown as SqlExecutor
        const d = await mayAct(db, { projectId: 'p', tool })
        expect(d.verdict).toBe(verdict)
        expect(d.verdict).not.toBe('proceed')
      }
    }
    // control: the same function does say proceed when the policy does, so the assertions above can fail
    const yes = {
      execute: async () => ({
        rows: [{ d: { action_level: 0, because: 'read', tool: 'web.search', verdict: 'proceed' } }],
      }),
    } as unknown as SqlExecutor
    expect((await mayAct(yes, { projectId: 'p', tool: 'web.search' })).verdict).toBe('proceed')
  })

  it('asks the policy with the ONE function: authorize_effect, and no second approval path exists in the handler', () => {
    const approval = readFileSync('src/agents/approval.ts', 'utf8')
    expect(approval).toMatch(/select app\.authorize_effect\(/)
    expect(handlerSource).not.toMatch(
      /authorize_effect|approval_options|standing_authorizations|blockers/,
    )
  })
})

describe('(c) a harness or fixture job never reaches a real destination', () => {
  const spy = () => {
    const calls: string[] = []
    const boom = (what: string) => async () => {
      calls.push(what)
      throw new Error(`${what} must not be called for harness work`)
    }
    return {
      adapter: { gather: boom('adapter.gather'), name: 'spy' },
      calls,
      download: boom('download') as never,
      search: { name: 'spy', search: boom('search'), urlFor: () => 'https://spy.invalid/' },
      store: boom('store') as never,
    }
  }

  it('refuses before the search engine, any page, storage or the ledger is touched', async () => {
    const statements: string[] = []
    const db = {
      execute: async (sql: string) => {
        statements.push(sql)
        return {
          rows: [
            { harness: true, pinned_config: { question: 'what do widgets cost' }, project: 'p' },
          ],
        }
      },
    } as unknown as SqlExecutor
    const s = spy()
    const out = await webResearchHandler({
      adapter: s.adapter,
      db,
      download: s.download,
      projectRef: 'x',
      search: s.search,
      serviceKey: '',
      store: s.store,
    }).handle(job(), db)
    expect(s.calls).toEqual([])
    expect(out.body).toMatch(/contained/)
    expect(out.announce).toBe(false)
    // one read of the job row, and nothing that writes: no ledger note, no checkpoint, no page kept
    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatch(/harness_browsing/)
  })

  it('an unreadable job row is treated as contained, never as real', async () => {
    const db = { execute: async () => ({ rows: [] }) } as unknown as SqlExecutor
    const s = spy()
    const out = await webResearchHandler({
      adapter: s.adapter,
      db,
      projectRef: 'x',
      search: s.search,
      serviceKey: '',
    }).handle(job(), db)
    expect(out.body).toMatch(/contained|not told what/)
    expect(s.calls).toEqual([])
  })

  it('a null harness answer is not "real" either', async () => {
    const db = {
      execute: async () => ({
        rows: [{ harness: null, pinned_config: { question: 'q words here' }, project: 'p' }],
      }),
    } as unknown as SqlExecutor
    const s = spy()
    const out = await webResearchHandler({
      adapter: s.adapter,
      db,
      projectRef: 'x',
      search: s.search,
      serviceKey: '',
    }).handle(job(), db)
    expect(out.body).toMatch(/contained/)
    expect(s.calls).toEqual([])
  })

  it('the containment decision is wired BEFORE the first step runs (the wired expression, not a name)', () => {
    const gate = handlerSource.indexOf('row.harness !== false')
    const firstStep = handlerSource.indexOf('await runSteps(')
    const firstSearch = handlerSource.indexOf('provider.search(')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(firstStep)
    expect(gate).toBeLessThan(firstSearch)
    expect(handlerSource).toMatch(/app\.harness_browsing\(job_id, project_id\) as harness/)
  })
})

describe('(d) the autonomy dial is read before the web is touched', () => {
  const run = async (verdict: 'proceed' | 'refuse' | 'ask' | 'unreadable') => {
    const touched: string[] = []
    const boom = (what: string) => async () => {
      touched.push(what)
      return { detail: 'x', ms: 1, ok: false }
    }
    const db = {
      execute: async (sql: string) => {
        if (sql.includes('authorize_effect')) {
          return {
            rows: [
              verdict === 'unreadable'
                ? { d: null }
                : { d: { action_level: 1, because: 'dial', tool: 'web.read', verdict } },
            ],
          }
        }
        if (sql.includes('browser_budget')) return { rows: [{ r: { exhausted: true } }] }
        return {
          rows: [
            { harness: false, pinned_config: { question: 'what do widgets cost' }, project: 'p' },
          ],
        }
      },
    } as unknown as SqlExecutor
    const out = await webResearchHandler({
      adapter: { gather: boom('gather') as never, name: 'spy' },
      db,
      projectRef: 'x',
      search: {
        name: 'spy',
        search: boom('search') as never,
        urlFor: () => 'https://spy.invalid/',
      },
      serviceKey: '',
    }).handle({ jobId: 'j1' } as unknown as Job, {} as never)
    return { out, touched }
  }
  for (const v of ['refuse', 'ask', 'unreadable'] as const) {
    it(`${v}: stops with a plain sentence before the budget, search or any page`, async () => {
      const { out, touched } = await run(v)
      expect(out.body).toMatch(/Autonomy for this project does not let me read the web/)
      expect(touched).toEqual([])
    })
  }
  it('control: a plain yes goes on to the next step (here the budget, which this fixture has spent)', async () => {
    const { out } = await run('proceed')
    expect(out.body).toMatch(/browser-minutes/)
  })
})
