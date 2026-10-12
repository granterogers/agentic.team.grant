/**
 * Measure the schedule toolbar across Day, Week and Month on Team HQ, in a real browser.
 *
 *   npx tsx scripts/verify/probe-calendar.ts
 *
 * Opens the first prototype project, then for each view reports the box of the title, the
 * prev/next nav, the view switch and the New button. The toolbar is stable when those boxes do not
 * move between views. Read-only: it serves web/studio locally.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = join(process.cwd(), 'web', 'studio')
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  let path = decodeURIComponent(url.pathname)
  if (path.endsWith('/')) path += 'index.html'
  try {
    const body = await readFile(join(ROOT, path))
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    if (extname(path) !== '' && extname(path) !== '.html') {
      res.writeHead(404)
      res.end()
      return
    }
    const body = await readFile(join(ROOT, 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(body)
  }
})
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()))
const address = server.address()
const port = typeof address === 'object' && address !== null ? address.port : 0

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu-open]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
  await page.waitForTimeout(1500)
  const measure = () =>
    page.evaluate(() => {
      const selectors = {
        title: '.bccal2title',
        nav: '.bccal2nav',
        views: '.bccal2views',
        newButton: '[data-cal-new]',
        compact: '.bccal2compact',
      }
      const out: Record<string, number[] | null> = {}
      for (const key of Object.keys(selectors)) {
        const el = document.querySelector<HTMLElement>(selectors[key as keyof typeof selectors])
        if (el === null) {
          out[key] = null
          continue
        }
        const r = el.getBoundingClientRect()
        out[key] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
      }
      return out
    })
  const rows: Record<string, unknown> = {}
  for (const view of ['day', 'week', 'month']) {
    await page.locator(`[data-cal-view="${view}"]`).first().click({ force: true })
    await page.waitForTimeout(500)
    rows[view] = await measure()
  }
  const stable = ['title', 'nav', 'views', 'newButton'].every((k) => {
    const boxes = ['day', 'week', 'month'].map((v) =>
      JSON.stringify((rows[v] as Record<string, unknown>)[k]),
    )
    return boxes.every((b) => b === boxes[0])
  })
  console.log(
    JSON.stringify({ toolbarStable: stable, ...rows, pageErrors: errors.slice(0, 2) }, null, 2),
  )
  await page.screenshot({ path: join(process.cwd(), '.out', 'probe', 'calendar-month.png') })
} finally {
  await browser.close()
  server.close()
}
