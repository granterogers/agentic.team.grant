/**
 * Capture the sign-in and Sample Office entry screen on Team HQ (`/?welcome`) in both schemes, desktop and phone.
 *
 *   npx tsx scripts/verify/probe-entry.ts
 *
 * Read-only; serves web/studio locally.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

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
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile })
      await context.addInitScript((s) => {
        localStorage.setItem('studio.appearance', JSON.stringify({ scheme: s, look: 'silver' }))
      }, scheme)
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`http://127.0.0.1:${String(port)}/?welcome`, {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(OUT, `entry-${name}-${scheme}.png`), fullPage: true })
      const kicker = await page.evaluate(() => {
        const el = document.querySelector('.bcentrykicker')
        if (el === null) return null
        const root = getComputedStyle(document.documentElement)
        return {
          color: getComputedStyle(el).color,
          accent: root.getPropertyValue('--bc-accent').trim(),
          palette: document.documentElement.dataset.palette ?? '(none)',
        }
      })
      console.log(JSON.stringify({ name, scheme, kicker, pageErrors: errors.slice(0, 2) }))
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}
