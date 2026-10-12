/**
 * Two checks from the independent review of the Team HQ frontend diff, in a real browser.
 *
 *   npx tsx scripts/verify/probe-review.ts
 *
 * 1. Escape closes Global Settings and leaves no stale settings history entry: after Escape, Back must
 *    not reopen Settings.
 * 2. The project menu's Sources item opens the Sources view from a non-Overview tab (the Tasks list).
 * Read-only; serves web/studio locally.
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
  const settingsOpen = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('#settings')
      return el !== null && !el.hidden
    })
  const openProject = async () => {
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await page.locator('[data-bc-menu-open]').first().click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
    await page.waitForTimeout(1500)
  }

  // 1. Escape, then Back: Settings must stay closed.
  await openProject()
  await page.locator('[data-bc-settings]').first().click({ force: true })
  await page.waitForTimeout(500)
  const openedBefore = await settingsOpen()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const closedByEscape = !(await settingsOpen())
  const entryAfterEscape = await page.evaluate(() => history.state?.settings === true)
  await page.goBack()
  await page.waitForTimeout(700)
  const reopenedByBack = await settingsOpen()
  console.log(
    JSON.stringify({
      escape: {
        openedBefore,
        closedByEscape,
        settingsEntryLeftOnStack: entryAfterEscape,
        reopenedByBack,
      },
    }),
  )

  // 2. Sources from the Tasks tab.
  await openProject()
  const tasksPath = `${new URL(page.url()).pathname.replace(/\/$/, '')}/tasks`
  await page.goto(`http://127.0.0.1:${String(port)}${tasksPath}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu]').first().click({ force: true })
  await page.waitForTimeout(300)
  const sourcesItem = page.locator('[data-bc-menu-modules] [data-bc-sources]').first()
  const itemCount = await sourcesItem.count()
  if (itemCount > 0) await sourcesItem.click({ force: true })
  await page.waitForTimeout(800)
  const sourcesOpen = (await page.locator('.bcexpx').count()) > 0
  const path = new URL(page.url()).pathname
  console.log(JSON.stringify({ sources: { path, menuItem: itemCount, sourcesOpen } }))
  console.log(JSON.stringify({ pageErrors: errors.slice(0, 3) }))
} finally {
  await browser.close()
  server.close()
}
