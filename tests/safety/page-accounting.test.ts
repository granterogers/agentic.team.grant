/**
 * Browser request accounting: exact counts through a REAL Chromium against a local static server (no production host is
 * contacted: a made-up hostname is mapped to 127.0.0.1 inside the browser and the helper is told it is "production"), plus a
 * fake page for the pure logic and the controls that prove the detector can fail.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountPage,
  type PageLike,
  type PageStats,
  type RequestLike,
} from '../../src/safety/page-accounting.ts'
import { ProductionBudget } from '../../src/safety/request-budget.ts'

const budgetFor = (limit: number, pageLoadLimit = 10) => {
  const lines: string[] = []
  const b = new ProductionBudget(
    { cls: 'p4-browser', limit, pageLoadLimit, defaultLimit: limit, raised: [] },
    { write: (l) => lines.push(l), setExitCode: () => undefined },
  )
  return { b, lines }
}

const GATEWAY = 'gateway.test'
const isGateway = (u: string): boolean => {
  try {
    return new URL(u).hostname === GATEWAY
  } catch {
    return false
  }
}

const fakePage = () => {
  let listener: (r: RequestLike) => void = () => undefined
  let closed = 0
  const page: PageLike = {
    on: (_e, l) => {
      listener = l
    },
    context: () => ({
      close: async () => {
        closed += 1
      },
    }),
  }
  const req = (url: string, nav = false, main = true, method = 'GET'): RequestLike => ({
    url: () => url,
    method: () => method,
    isNavigationRequest: () => nav,
    frame: () => ({ parentFrame: () => (main ? null : {}) }),
  })
  return { page, fire: (r: RequestLike) => listener(r), req, closed: () => closed }
}

describe('the pure logic, with a fake page', () => {
  it('counts production requests and main-frame loads, and nothing local', () => {
    const { b } = budgetFor(100)
    const f = fakePage()
    const stats = accountPage(f.page, { budget: b, isProduction: isGateway })
    f.fire(f.req('http://127.0.0.1:4797/', true))
    f.fire(f.req('http://127.0.0.1:4797/app.js'))
    for (let i = 0; i < 25; i += 1) f.fire(f.req(`http://${GATEWAY}/hq-api?section=${i}`))
    expect(stats).toMatchObject({ requests: 27, production: 25, loads: 1, stopped: false })
    expect(b.used).toBe(25)
    expect(b.pageLoads).toBe(1)
  })

  it('ignores about:blank and subframe navigations as loads', () => {
    const { b } = budgetFor(100)
    const f = fakePage()
    const stats = accountPage(f.page, { budget: b, isProduction: isGateway })
    f.fire(f.req('about:blank', true))
    f.fire(f.req('http://127.0.0.1:4797/frame', true, false))
    expect(stats.loads).toBe(0)
  })

  it('stops the page (closes its context) when the request budget is spent', () => {
    const { b, lines } = budgetFor(3)
    const f = fakePage()
    const stats = accountPage(f.page, { budget: b, isProduction: isGateway })
    for (let i = 0; i < 4; i += 1) f.fire(f.req(`http://${GATEWAY}/x`))
    expect(stats.stopped).toBe(true)
    expect(f.closed()).toBe(1)
    expect(lines.join('\n')).toContain('budget of 3')
    f.fire(f.req(`http://${GATEWAY}/y`))
    expect(f.closed()).toBe(1) // closed once, not once per request
  })

  it('stops the page when the page-load budget is spent', () => {
    const { b } = budgetFor(100, 2)
    const f = fakePage()
    const stats = accountPage(f.page, { budget: b, isProduction: isGateway })
    f.fire(f.req('http://127.0.0.1:4797/', true))
    f.fire(f.req('http://127.0.0.1:4797/', true))
    expect(stats.stopped).toBe(false)
    f.fire(f.req('http://127.0.0.1:4797/', true))
    expect(stats.stopped).toBe(true)
  })

  it('with no budget (not a command) it only counts', () => {
    const f = fakePage()
    const stats = accountPage(f.page, { budget: null, isProduction: isGateway })
    for (let i = 0; i < 500; i += 1) f.fire(f.req(`http://${GATEWAY}/x`))
    expect(stats.production).toBe(500)
    expect(stats.stopped).toBe(false)
  })

  it('uses the production gate definition of a production host by default', () => {
    const { b } = budgetFor(100)
    const f = fakePage()
    const stats = accountPage(f.page, { budget: b })
    f.fire(f.req('https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'))
    f.fire(f.req('https://ai-team-hq.vercel.app/'))
    f.fire(f.req('http://localhost:4797/'))
    expect(stats.production).toBe(2)
  })

  it('control: a helper that never listens is caught by the exact-count assertion', () => {
    const { b } = budgetFor(100)
    const f = fakePage()
    const stats: PageStats = { requests: 0, production: 0, loads: 0, stopped: false } // the sabotage: no listener
    for (let i = 0; i < 5; i += 1) f.fire(f.req(`http://${GATEWAY}/x`))
    expect(() => expect(stats.production).toBe(5)).toThrow()
    const real = accountPage(f.page, { budget: b, isProduction: isGateway })
    for (let i = 0; i < 5; i += 1) f.fire(f.req(`http://${GATEWAY}/x`))
    expect(real.production).toBe(5)
  })
})

describe('in a real Chromium, against a local static server', () => {
  let server: Server
  let port = 0
  let hits = { gateway: 0, local: 0 }
  let launched = false
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

  const PAGE = (n: number) =>
    `<!doctype html><title>t</title><script>
      for (let i = 0; i < ${n}; i++) fetch('http://${GATEWAY}:${port}/rest/' + i, { mode: 'no-cors' }).catch(() => {});
      fetch('/local', { mode: 'no-cors' }).catch(() => {});
    </script>`

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith('/rest/')) hits.gateway += 1
      else if (req.url === '/local') hits.local += 1
      const m = /^\/page\/(\d+)/.exec(req.url ?? '')
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('content-type', m === null ? 'text/plain' : 'text/html')
      res.end(m === null ? 'ok' : PAGE(Number(m[1])))
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    port = (server.address() as AddressInfo).port
    try {
      browser = await chromium.launch({
        args: [`--host-resolver-rules=MAP ${GATEWAY} 127.0.0.1`],
      })
      launched = true
    } catch {
      launched = false
    }
  })
  afterAll(async () => {
    await browser?.close()
    await new Promise<void>((ok) => server.close(() => ok()))
  })

  const settle = (ms = 600) => new Promise((ok) => setTimeout(ok, ms))

  it('a Chromium is available here (otherwise the real-browser checks below prove nothing)', () => {
    expect(launched).toBe(true)
  })

  it('counts N gateway requests and two loads exactly, and not the local ones', async () => {
    if (browser === null) return
    hits = { gateway: 0, local: 0 }
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const { b } = budgetFor(1000)
    const stats = accountPage(page, { budget: b, isProduction: isGateway })
    await page.goto(`http://127.0.0.1:${port}/page/7`, { waitUntil: 'load' })
    await settle()
    await page.reload({ waitUntil: 'load' })
    await settle()
    expect(hits.gateway).toBe(14) // what the server actually received
    expect(stats.production).toBe(14) // what the helper counted: the same
    expect(b.used).toBe(14)
    expect(stats.loads).toBe(2)
    expect(b.pageLoads).toBe(2)
    expect(hits.local).toBe(2)
    await ctx.close()
  }, 60000)

  it('closes the context and names the budget when a page spends it', async () => {
    if (browser === null) return
    hits = { gateway: 0, local: 0 }
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const { b, lines } = budgetFor(5)
    const stats = accountPage(page, { budget: b, isProduction: isGateway })
    await page.goto(`http://127.0.0.1:${port}/page/20`, { waitUntil: 'load' }).catch(() => null)
    await settle(1000)
    expect(b.exceeded).toBe(true)
    expect(stats.stopped).toBe(true)
    expect(page.isClosed()).toBe(true)
    expect(lines.join('\n')).toContain('budget of 5')
    expect(lines.join('\n')).toContain('p4-browser')
  }, 60000)

  it('control: without the helper the same page sends all its requests unseen', async () => {
    if (browser === null) return
    hits = { gateway: 0, local: 0 }
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${port}/page/20`, { waitUntil: 'load' })
    await settle()
    expect(hits.gateway).toBe(20) // nothing stopped it: this is the blind spot the helper closes
    await ctx.close()
  }, 60000)
})
