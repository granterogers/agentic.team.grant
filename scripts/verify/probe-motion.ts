/**
 * Measure whether Team HQ's surfaces animate when they open: the Team Chat drawer and Global Settings.
 *
 *   npx tsx scripts/verify/probe-motion.ts
 *
 * Samples each surface's transform and opacity over the first half-second after its press, once with
 * normal motion and once with reduced motion. Read-only; serves web/studio locally.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, type Page } from 'playwright'

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

/** Sample a surface after a press: its transform, opacity and running animations, every 60 ms for 500 ms. */
const sample = (page: Page, selector: string) =>
  page.evaluate(async (sel) => {
    const out: Array<{ t: number; transform: string; opacity: string; anims: number }> = []
    const start = performance.now()
    while (performance.now() - start < 500) {
      const el = document.querySelector<HTMLElement>(sel)
      const cs = el === null ? null : getComputedStyle(el)
      out.push({
        t: Math.round(performance.now() - start),
        transform: cs?.transform ?? 'none',
        opacity: cs?.opacity ?? '-',
        anims: el === null ? 0 : el.getAnimations({ subtree: true }).length,
      })
      await new Promise((r) => setTimeout(r, 60))
    }
    return out
  }, selector)

const browser = await chromium.launch()
try {
  await mkdir(join(process.cwd(), '.out', 'probe'), { recursive: true })
  for (const reduced of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await page.locator('[data-bc-menu-open]').first().click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
    await page.waitForTimeout(1500)
    const chatPress = page.getByRole('button', { name: /chat with team/i }).first()
    const chatRun = sample(page, '.dock')
    await chatPress.click({ force: true })
    const chat = await chatRun
    console.log(
      JSON.stringify({
        reducedMotion: reduced,
        surface: 'team chat drawer',
        firstFrames: chat.slice(0, 4),
        animatedFrames: chat.filter((f) => f.anims > 0).length,
      }),
    )
    await page.locator('[data-bc-settings]').first().click({ force: true })
    const settings = await sample(page, '#settings')
    console.log(
      JSON.stringify({
        reducedMotion: reduced,
        surface: 'global settings',
        firstFrames: settings.slice(0, 3),
        animatedFrames: settings.filter((f) => f.anims > 0).length,
        pageErrors: errors.slice(0, 2),
      }),
    )
    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}
