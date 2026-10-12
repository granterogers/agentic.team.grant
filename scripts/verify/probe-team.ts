/**
 * Open a specialist's Configure panel in Team Settings on Team HQ (`/`) and list the controls it offers.
 *
 *   npx tsx scripts/verify/probe-team.ts
 *
 * Read-only: it opens panels and reports labels and control types; it changes nothing. Serves web/studio.
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-settings]').first().click({ force: true })
  await page.waitForTimeout(900)
  const configure = page.locator('button', { hasText: /^Configure$/ })
  console.log(JSON.stringify({ configureButtons: await configure.count() }))
  await configure.first().click({ force: true })
  await page.waitForTimeout(900)
  const panel = await page.evaluate(() => {
    const out: string[] = []
    const fields = document.querySelectorAll<HTMLElement>(
      'input, select, textarea, [role="switch"], [role="checkbox"]',
    )
    for (const el of fields) {
      const forId = el.id === '' ? null : document.querySelector(`label[for="${el.id}"]`)
      const named =
        el.getAttribute('aria-label') ??
        forId?.textContent?.trim() ??
        el.closest('label')?.textContent?.trim() ??
        ''
      const label = named
      const type = el.getAttribute('type')
      out.push(`${el.tagName.toLowerCase()}${type ? `[${type}]` : ''}: ${label.slice(0, 60)}`)
    }
    const headings = Array.from(document.querySelectorAll('h2, h3')).map((h) =>
      (h.textContent ?? '').trim().slice(0, 50),
    )
    return { headings: headings.slice(0, 12), controls: out.slice(0, 30), total: out.length }
  })
  console.log(JSON.stringify({ panel, pageErrors: errors.slice(0, 3) }))
  await page.screenshot({ path: join(OUT, 'team-configure.png') })
} finally {
  await browser.close()
  server.close()
}
