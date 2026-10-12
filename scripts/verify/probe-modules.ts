/**
 * Open each canvas module from the hamburger menu on Team HQ (`/`) and check it fills the screen,
 * then close it and check the project is still open. Real browser, desktop and phone widths.
 *
 *   npx tsx scripts/verify/probe-modules.ts
 *
 * Serves web/studio locally and changes nothing that is stored.
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

const MODULES = ['tasks', 'board', 'documents', 'schedule', 'contacts', 'activity', 'sources']

const browser = await chromium.launch()
try {
  await mkdir(OUT, { recursive: true })
  for (const [name, viewport, isMobile] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['phone', { width: 390, height: 844 }, true],
  ] as const) {
    const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile })
    // SCHEME=dark stores the scheme the way a person's choice is stored, so the audit sees the dark theme.
    const scheme = process.env.SCHEME ?? ''
    if (scheme !== '') {
      await context.addInitScript((s) => {
        localStorage.setItem('studio.appearance', JSON.stringify({ scheme: s, look: 'silver' }))
      }, scheme)
    }
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await page.locator('[data-bc-menu-open]').first().click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
    await page.waitForTimeout(1500)
    const projectUrl = new URL(page.url()).pathname
    const results: Record<string, unknown> = {}
    for (const id of MODULES) {
      await page.goto(`http://127.0.0.1:${String(port)}${projectUrl}`, {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForTimeout(1200)
      await page.locator('[data-bc-menu]').first().click({ force: true })
      await page.waitForTimeout(300)
      const item =
        id === 'sources'
          ? page.locator('[data-bc-menu-modules] [data-bc-sources]').first()
          : page.locator(`[data-bc-menu-modules] [data-bc-expand="${id}"]`).first()
      if ((await item.count()) === 0) {
        results[id] = 'menu item missing'
        continue
      }
      await item.click({ force: true })
      await page.waitForTimeout(700)
      const closable = (await page.locator('.bcexpx').count()) > 0
      // Maximised means the open view fills most of the screen, not that it merely opened.
      const fill = await page.evaluate(() => {
        const e = document.querySelector('.bcexp')
        const panel =
          e === null ? undefined : [...e.children].find((c) => !c.classList.contains('bcexpback'))
        const r = panel?.getBoundingClientRect()
        if (r === undefined) return null
        return {
          widthShare: Math.round((r.width / window.innerWidth) * 100) / 100,
          heightShare: Math.round((r.height / window.innerHeight) * 100) / 100,
        }
      })
      await page.screenshot({
        path: join(OUT, `module-${id}-${name}${scheme === '' ? '' : `-${scheme}`}.png`),
      })
      let backTo: string | null = null
      let focusAfterClose = false
      if (closable) {
        await page.locator('.bcexpx').first().click()
        await page.waitForTimeout(900)
        backTo = new URL(page.url()).pathname
        // Focus after the module closes must be on a live control in the workspace, not lost to the body.
        focusAfterClose = await page.evaluate(() => {
          const a = document.activeElement
          return a instanceof HTMLElement && a !== document.body && a.isConnected
        })
        if (id === 'sources') await page.screenshot({ path: join(OUT, 'closed-sources.png') })
        await page.screenshot({ path: join(OUT, `closed-${id}-${name}.png`) })
      }
      const maximised = fill !== null && fill.widthShare >= 0.8 && fill.heightShare >= 0.6
      results[id] = {
        closable,
        maximised,
        fill,
        closedTo: backTo,
        returnedToProject: backTo === projectUrl,
        focusAfterClose,
      }
    }
    console.log(
      JSON.stringify({ viewport: name, projectUrl, results, pageErrors: errors.slice(0, 2) }),
    )
    await page.screenshot({
      path: join(OUT, `modules-${name}${scheme === '' ? '' : `-${scheme}`}.png`),
    })
    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}
