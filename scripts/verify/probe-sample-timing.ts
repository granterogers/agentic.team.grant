// The gate comes first: this reads the production site, so it refuses to run without ALLOW_PRODUCTION_CHECKS=1.
import '../../src/safety/require-production-checks.ts'
/**
 * Timing of the public Sample Office on production, as a visitor (read-only: "Explore the Sample Office" creates a visitor
 * session, which is the authorised public path; nothing is written to any office). It records, for each run:
 *
 *   - navigation timing of the page (DNS, connect, TLS, time to first byte, DOM content loaded, load);
 *   - when the Sample entry appears, when the sign-in call starts and ends, when the first project appears in the menu, and
 *     when the board draws its first card;
 *   - every gateway request with its method, path (section), status and duration, so a slow phase can be attributed to
 *     authentication (signin), the API (hq-api), or the page itself;
 *   - whether the "Connecting to your office" strip is still on screen at 20 s and 40 s;
 *   - the banner height on a 390px phone, for the mobile banner check.
 *
 *   npx tsx scripts/verify/probe-sample-timing.ts [runs]
 *
 * Output is printed; the numbers are the evidence, not an assertion. Production contact: GET requests and the Sample visitor
 * sign-in only.
 */
import { chromium, type Page } from 'playwright'

const BASE = 'https://ai-team-hq.vercel.app/'
const runs = Number(process.argv[2] ?? '2')
const browser = await chromium.launch()

type Req = { url: string; status: number; ms: number; start: number; bytes?: number; ttfb?: number }

const sectionOf = (url: string) => {
  const u = new URL(url)
  const s = u.searchParams.get('section')
  if (u.pathname.includes('/signin')) return 'auth:signin'
  if (u.pathname.includes('/hq-api')) return `api:${s ?? '-'}`
  if (u.pathname.includes('/functions/')) return `fn:${u.pathname.split('/').pop() ?? ''}`
  return u.hostname === new URL(BASE).hostname ? 'page' : `other:${u.hostname}`
}

const runOnce = async (index: number, width: number, mobile: boolean) => {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: mobile,
    hasTouch: mobile,
  })
  const page: Page = await context.newPage()
  const t0 = Date.now()
  const reqs: Req[] = []
  const pending = new Map<string, number>()
  page.on('request', (r) => pending.set(r.url() + r.method(), Date.now()))
  page.on('requestfinished', async (r) => {
    const start = pending.get(r.url() + r.method()) ?? t0
    const resp = await r.response()
    const timing = r.timing()
    const sizes = await r.sizes().catch(() => null)
    if (resp !== null && resp.status() >= 400 && sectionOf(r.url()).startsWith('api:')) {
      const text = await resp.text().catch(() => '')
      console.log(`BODY ${sectionOf(r.url())} ${String(resp.status())}: ${text.slice(0, 240)}`)
    }
    reqs.push({
      url: r.url(),
      status: resp?.status() ?? 0,
      ms: Date.now() - start,
      start: start - t0,
      bytes: sizes?.responseBodySize ?? 0,
      ttfb: Math.round(timing.responseStart),
    })
  })
  page.on('requestfailed', (r) => {
    reqs.push({
      url: r.url(),
      status: -1,
      ms: Date.now() - (pending.get(r.url() + r.method()) ?? t0),
      start: 0,
    })
    console.log(
      `FAILED ${sectionOf(r.url())} ${r.url().slice(0, 140)} :: ${r.failure()?.errorText ?? ''}`,
    )
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 })
  const domReady = Date.now() - t0
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (n === undefined) return null
    return {
      dns: Math.round(n.domainLookupEnd - n.domainLookupStart),
      tcp: Math.round(n.connectEnd - n.connectStart),
      tls: Math.round(n.secureConnectionStart > 0 ? n.connectEnd - n.secureConnectionStart : 0),
      ttfb: Math.round(n.responseStart - n.requestStart),
      domContentLoaded: Math.round(n.domContentLoadedEventEnd),
      load: Math.round(n.loadEventEnd),
    }
  })
  const sampleButton = page.getByRole('button', { name: /explore the sample office/i }).first()
  await sampleButton.waitFor({ state: 'visible', timeout: 60000 })
  const landingVisible = Date.now() - t0
  await page.waitForTimeout(500)
  const clickAt = Date.now() - t0
  await sampleButton.click({ force: true })
  let connectingAt20: boolean | null = null
  let connectingAt40: boolean | null = null
  let firstProjectAt: number | null = null
  let firstCardAt: number | null = null
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    /* The sign-in navigates the page, so a read during a navigation has no document to read; that sample is skipped. */
    const state = await page
      .evaluate(() => ({
        connecting: document.body.innerText.includes('Connecting to your office'),
        projects: document.querySelectorAll('.bcmenuitem[data-bc-go*="/p/"]').length,
        card: document.body.innerText.includes('Your projects could not be loaded')
          ? 'failed'
          : document.querySelectorAll('.bcmod, .bcdoc, .bcpanel, .bcmodhead').length,
      }))
      .catch(() => null)
    if (state === null) {
      await page.waitForTimeout(500)
      continue
    }
    const elapsed = Date.now() - t0
    if (firstProjectAt === null && state.projects > 0) firstProjectAt = elapsed
    if (firstCardAt === null && typeof state.card === 'number' && state.card > 0)
      firstCardAt = elapsed
    if (elapsed >= 20000 && connectingAt20 === null) connectingAt20 = state.connecting
    if (elapsed >= 40000 && connectingAt40 === null) connectingAt40 = state.connecting
    if (firstCardAt !== null && elapsed >= 40000) break
    await page.waitForTimeout(500)
  }
  const banner = await page.evaluate(() => {
    const strip = document.querySelector('.bcnotlive')
    const top = document.querySelector('.bctop')
    return {
      stripHeight: strip === null ? 0 : Math.round(strip.getBoundingClientRect().height),
      headerHeight: top === null ? 0 : Math.round(top.getBoundingClientRect().height),
    }
  })
  const byKind = new Map<string, { n: number; total: number; max: number; fails: number }>()
  for (const r of reqs) {
    if (r.status === -1 || r.status >= 400) {
      const k = sectionOf(r.url)
      byKind.set(k, {
        n: (byKind.get(k)?.n ?? 0) + 1,
        total: (byKind.get(k)?.total ?? 0) + r.ms,
        max: Math.max(byKind.get(k)?.max ?? 0, r.ms),
        fails: (byKind.get(k)?.fails ?? 0) + 1,
      })
      continue
    }
    const k = sectionOf(r.url)
    const cur = byKind.get(k) ?? { n: 0, total: 0, max: 0, fails: 0 }
    byKind.set(k, {
      n: cur.n + 1,
      total: cur.total + r.ms,
      max: Math.max(cur.max, r.ms),
      fails: cur.fails,
    })
  }
  const slowest = [...reqs]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 4)
    .map((r) => `${sectionOf(r.url)} ${String(r.status)} ${String(r.ms)}ms @${String(r.start)}`)
  console.log(
    JSON.stringify({
      run: index,
      width,
      domReady,
      landingVisible,
      clickAt,
      firstProjectAt,
      firstCardAt,
      connectingAt20,
      connectingAt40,
      nav,
      banner,
      requests: reqs.length,
      failed: reqs
        .filter((r) => r.status === -1 || r.status >= 400)
        .map((r) => `${sectionOf(r.url)} ${String(r.status)}`),
      studioBytes: reqs.filter((r) => sectionOf(r.url) === 'api:studio').map((r) => r.bytes ?? 0),
      studioTtfbMs: reqs.filter((r) => sectionOf(r.url) === 'api:studio').map((r) => r.ttfb ?? -1),
      activityLedgerUrl: reqs
        .filter((r) => sectionOf(r.url) === 'api:activity_ledger')
        .map((r) => r.url.slice(0, 160))
        .slice(0, 1),
      byKind: Object.fromEntries(
        [...byKind].map(([k, v]) => [
          k,
          {
            n: v.n,
            avgMs: Math.round(v.total / Math.max(1, v.n - v.fails)),
            maxMs: v.max,
            fails: v.fails,
          },
        ]),
      ),
      slowest,
    }),
  )
  /* Let the per-request handlers finish before the context closes; they read response metadata after the fact. */
  await page.waitForTimeout(3000)
  await context.close()
}

try {
  for (let i = 1; i <= runs; i++) {
    await runOnce(i, 1440, false)
  }
  await runOnce(runs + 1, 390, true)
} finally {
  await browser.close()
}
