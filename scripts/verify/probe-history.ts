/**
 * Probe browser Back and Forward around Global Settings on Team HQ (`/`), in a real browser.
 *
 *   npx tsx scripts/verify/probe-history.ts
 *
 * Presses the office settings control (the three-dot Global Settings button), then uses the
 * browser's own Back and Forward. At each step it reports the URL and whether a settings sheet is
 * open (its #settings element is not hidden). Read-only: it serves web/studio locally.
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
  const state = async (label: string) => {
    await page.waitForTimeout(500)
    const s = await page.evaluate(() => {
      const settings = document.querySelector<HTMLElement>('#settings')
      return {
        url: location.pathname + location.search,
        sheetOpen: settings !== null && !settings.hidden,
      }
    })
    console.log(JSON.stringify({ step: label, ...s }))
    return s
  }
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const start = await state('start')
  await page.locator('[data-bc-settings]').first().click({ force: true })
  const opened = await state('after Global Settings press')
  await page.goBack()
  const back = await state('after Back')
  await page.goForward()
  const forward = await state('after Forward')
  // Closing with the page's own Back button must leave no entry that Forward would reopen.
  await page.locator('[data-stg-back]').first().click({ force: true })
  const closedByButton = await state('after the Back button closes Settings')
  await page.goForward()
  const forwardAfterButton = await state('after Forward past a button close')
  console.log(
    JSON.stringify({
      verdict: {
        buttonCloseMatchesBack: !closedByButton.sheetOpen && forwardAfterButton.sheetOpen,
        openedSheet: opened.sheetOpen,
        backClosedSheet: !back.sheetOpen && back.url === start.url,
        forwardReopenedSheet: forward.sheetOpen && forward.url === opened.url,
      },
      pageErrors: errors.slice(0, 3),
    }),
  )
} finally {
  await browser.close()
  server.close()
}
