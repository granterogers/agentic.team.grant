// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a dense diagnostic kept readable as written
/**
 * Bounded diagnosis of the intermittent "the page did not open / the canvas did not come back after a reload" reports.
 *
 *   npx tsx scripts/verify/load-reliability.ts [base-url] [iterations]      (default: the local page, 12 iterations)
 *   npx tsx scripts/verify/load-reliability.ts https://team-hq-ux-review.vercel.app 10
 *
 * Each iteration is a COLD context (empty cache, empty storage) that signs in with a made-up session against a stand-in office on
 * 127.0.0.1 (no production service is contacted), waits for the menu and the board, places a Post-it, reloads, and checks the Post-it
 * came back. Recorded per iteration: the time to the menu and to the board, every failed request (with the browser's error text),
 * every 4xx/5xx and whether it carried x-vercel-id (a failure without one was not sent by Vercel: the sandbox proxy), page errors and
 * console errors. A failure is classified by evidence, never retried away: the iteration is reported as it happened.
 */
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const window: any

const arg = process.argv[2] ?? ''
const N = Number(process.argv[3] ?? '12')
const LOCAL_PORT = 4731
const local = arg === '' || arg.startsWith('http://127.0.0.1')
const server = local ? await serveStudio(LOCAL_PORT) : null
const base = (local ? `http://127.0.0.1:${String(LOCAL_PORT)}` : arg).replace(/\/$/, '')

/* the page's own mock projects become the stand-in office's answer */
const probe = await chromium.launch()
const lp = await probe.newPage()
const mockServer = local ? null : await serveStudio(4732)
await lp.goto(local ? `${base}/` : 'http://127.0.0.1:4732/', { waitUntil: 'domcontentloaded' })
const mock = JSON.parse((await lp.evaluate(`import('/data.js').then((m) => JSON.stringify({ projects: m.PROJECTS, crew: m.CREW.map((c) => ({ slug: c.staffSlug ?? c.slug, name: c.name, role: c.role, state: 'idle', expertise: c.expertise ?? [] })) }))`)) as string) as { projects: any[]; crew: any[] }
await probe.close()
mockServer?.close()

const layouts: Record<string, any[]> = {}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' }
const PORT = 4733
let delayMs = 0
const office = createServer((req, res) => {
  const go = () => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'POST') {
      let raw = ''
      req.on('data', (c) => { raw += String(c) })
      req.on('end', () => {
        const b = JSON.parse(raw || '{}') as { action?: string; args?: any }
        if (b.action === 'dashboard_layout_set') layouts[String(b.args?.p_slug)] = b.args?.p_panels ?? []
        res.writeHead(200, cors)
        res.end(JSON.stringify({ result: { ok: true, rev: 1 } }))
      })
      return
    }
    res.writeHead(200, cors)
    const sec = url.searchParams.get('section')
    if (sec === 'studio') res.end(JSON.stringify({ data: { generated_at: new Date().toISOString(), crew: mock.crew, projects: mock.projects.map((p) => ({ ...p, layout_board: layouts[p.slug] })) } }))
    else if (sec === 'layout') res.end(JSON.stringify({ error: 'unknown section' }))
    else res.end(JSON.stringify({ data: {} }))
  }
  if (delayMs > 0) setTimeout(go, delayMs)
  else go()
})
await new Promise<void>((r) => office.listen(PORT, '127.0.0.1', () => r()))

const browser = await chromium.launch()
const SESSION = `try { localStorage.setItem('hq.session', JSON.stringify({ access_token: 'a.b.' + 'x'.repeat(70), refresh_token: 'r', expires_at: Date.now() + 36000000 })) } catch {}`
const GW = `window.HQ_API = 'http://127.0.0.1:${String(PORT)}/hq-api'`

type Row = { i: number; menuMs: number | null; boardMs: number | null; restored: boolean | null; failed: string[]; non2xx: string[]; pageErrors: string[]; consoleErrors: string[]; slowest: string; verdict: string }
const rows: Row[] = []
for (let i = 1; i <= N; i += 1) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(GW)
  await ctx.addInitScript(SESSION)
  const page = await ctx.newPage()
  const failed: string[] = []
  const non2xx: string[] = []
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('requestfailed', (r) => failed.push(`${r.url().replace(base, '')} ${r.failure()?.errorText ?? ''}`))
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(base)) non2xx.push(`${String(r.status())} ${r.url().replace(base, '')} vercel=${String(r.headers()['x-vercel-id'] !== undefined)} type=${r.headers()['content-type'] ?? ''}`) })
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 160)))
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
  const t0 = Date.now()
  let menuMs: number | null = null
  let boardMs: number | null = null
  let restored: boolean | null = null
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('[data-bc-menu]', { timeout: 30000 })
    menuMs = Date.now() - t0
    await page.click('[data-bc-menu]')
    await page.locator('.bcmenulist .bcmenuitem').nth(1).click()
    await page.waitForSelector('[data-bc-board]', { timeout: 30000 })
    boardMs = Date.now() - t0
    await page.waitForTimeout(800)
    const path = new URL(page.url()).pathname
    /* place a note, wait for it to save, reload, and look for it */
    await page.evaluate(`import('/bc/layout.js').then((L) => { const s = ${JSON.stringify(path.split('/')[2] ?? '')}; const n = L.addPostit(s); L.setPostit(s, n.id, { text: 'diag-${String(i)}' }); L.flush() })`)
    await page.waitForTimeout(2500)
    await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('[data-bc-board]', { timeout: 30000 })
    await page.waitForTimeout(1200)
    restored = ((await page.evaluate(() => document.body.innerHTML)) as string).includes(`diag-${String(i)}`)
  } catch (e) {
    /* the iteration failed: report it with whatever evidence the page gave */
  }
  const res = (await page.evaluate(`performance.getEntriesByType('resource').map((r) => ({ n: r.name, d: Math.round(r.duration) })).sort((a, b) => b.d - a.d).slice(0, 1)`).catch(() => [])) as { n: string; d: number }[]
  const verdict = menuMs === null ? 'NO MENU' : boardMs === null ? 'NO BOARD' : restored === true ? 'ok' : 'NOT RESTORED'
  rows.push({ i, menuMs, boardMs, restored, failed, non2xx, pageErrors, consoleErrors, slowest: res[0] === undefined ? '' : `${res[0].n.replace(base, '')} ${String(res[0].d)}ms`, verdict })
  console.log(`#${String(i).padStart(2)} ${verdict.padEnd(12)} menu ${String(menuMs)}ms board ${String(boardMs)}ms restored=${String(restored)} failed=${failed.length} non2xx=${non2xx.length} pageErrors=${pageErrors.length} console=${consoleErrors.length} slowest ${rows.at(-1)?.slowest}`)
  for (const f of failed) console.log(`      failed: ${f}`)
  for (const f of non2xx) console.log(`      non2xx: ${f}`)
  for (const f of pageErrors) console.log(`      pageerror: ${f}`)
  for (const f of consoleErrors.slice(0, 3)) console.log(`      console: ${f}`)
  await ctx.close()
}
await browser.close()
office.close()
server?.close()
const bad = rows.filter((r) => r.verdict !== 'ok')
const ms = rows.map((r) => r.boardMs ?? 0).sort((a, b) => a - b)
console.log(`\n${rows.length - bad.length}/${rows.length} ok; board time min ${String(ms[0])} median ${String(ms[Math.floor(ms.length / 2)])} max ${String(ms.at(-1))} ms; page errors in ${rows.filter((r) => r.pageErrors.length > 0).length}; failed requests in ${rows.filter((r) => r.failed.length > 0).length}; non-2xx in ${rows.filter((r) => r.non2xx.length > 0).length}`)
process.exit(bad.length === 0 ? 0 : 1)
