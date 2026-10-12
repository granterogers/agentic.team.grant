/**
 * Probe the colour scheme on Team HQ (`/`) in a real browser.
 *
 *   npx tsx scripts/verify/probe-scheme.ts
 *
 * For each stored scheme (light, dark, system) it seeds the preference the way a person's
 * choice is stored, opens the page, and reports the computed canvas colour, the root's
 * data-scheme and data-look attributes, and the surface behind the body. It changes nothing.
 * Read-only: it serves web/studio from a local port and talks to no network origin.
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
    // Team HQ is the root document; a page route falls back to it. A missing asset is a 404, so it cannot pass for a script.
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
  for (const scheme of ['light', 'dark', 'system'] as const) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        colorScheme: dark ? 'dark' : 'light',
        viewport: { width: 1440, height: 900 },
      })
      await context.addInitScript((s) => {
        // The page reads its appearance from storage before first paint, so the seed goes in first.
        localStorage.setItem('studio.appearance', JSON.stringify({ scheme: s, look: 'silver' }))
      }, scheme)
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1200)
      const reading = await page.evaluate(() => {
        const root = document.documentElement
        const body = getComputedStyle(document.body)
        const canvas = getComputedStyle(root).getPropertyValue('--bc-canvas').trim()
        return {
          dataScheme: root.dataset.scheme ?? '(absent)',
          dataLook: root.dataset.look ?? '(absent)',
          bodyBackground: body.backgroundColor,
          bodyColour: body.color,
          canvasToken: canvas,
        }
      })
      await mkdir(OUT, { recursive: true })
      const shot = `scheme-${scheme}-os-${dark ? 'dark' : 'light'}.png`
      await page.screenshot({ path: join(OUT, shot) })
      console.log(
        JSON.stringify({
          stored: scheme,
          osDark: dark,
          ...reading,
          pageErrors: errors.slice(0, 2),
        }),
      )
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}
