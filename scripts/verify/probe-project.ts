/**
 * Capture a project's overview on Team HQ (`/`) in a real browser, at desktop and phone widths.
 *
 *   npx tsx scripts/verify/probe-project.ts <label>
 *
 * Opens the project menu, opens the first prototype project, and saves a screenshot to
 * .out/probe/project-<label>-<width>.png. It also reports the Card Table's box, so a width change
 * can be measured rather than judged by eye. Read-only: it serves web/studio locally.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const label = process.argv[2] ?? 'current'
const ROOT = join(process.cwd(), 'web', 'studio')
const OUT = join(process.cwd(), '.out', 'probe')
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
  await mkdir(OUT, { recursive: true })
  for (const [name, viewport, isMobile] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['phone', { width: 390, height: 844 }, true],
  ] as const) {
    const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await page.locator('[data-bc-menu-open]').first().click({ force: true })
    await page.waitForTimeout(400)
    const first = page.locator('[data-bc-go*="/p/"]').first()
    await first.click({ force: true })
    await page.waitForTimeout(1500)
    if (process.argv[3] === 'chat') {
      await page
        .getByRole('button', { name: /chat with team/i })
        .first()
        .click({ force: true })
      await page.waitForTimeout(1200)
      const ancestry = await page.evaluate(() => {
        const m = document.querySelector<HTMLElement>('.msg')
        const names: string[] = []
        for (let el: HTMLElement | null = m; el !== null && names.length < 7; el = el.parentElement)
          names.push(
            `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`,
          )
        return names
      })
      console.log(JSON.stringify({ msgAncestry: ancestry }))
    }
    const box = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-mod="board"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
    })
    console.log(
      JSON.stringify({ label, viewport: name, cardTable: box, pageErrors: errors.slice(0, 2) }),
    )
    await page.screenshot({ path: join(OUT, `project-${label}-${name}.png`), fullPage: false })
    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}
