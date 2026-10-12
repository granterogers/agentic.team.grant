/**
 * Drag, resize and persistence of canvas modules and Post-its on Team HQ (`/`), in a real browser.
 *
 *   npx tsx scripts/verify/probe-drag.ts
 *
 * Opens the first prototype project and, with real pointer gestures, drags the To-dos module by its
 * header, resizes it from its handle, and drags the first Post-it by its grip. It reads each box before
 * and after, reloads, and reads the boxes again. Serves web/studio locally.
 */
import { readFile } from 'node:fs/promises'
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

const boxOf = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(s)
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
  }, sel)

const dragBy = async (page: Page, from: [number, number], dx: number, dy: number) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + dx / 2, from[1] + dy / 2, { steps: 6 })
  await page.mouse.move(from[0] + dx, from[1] + dy, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(600)
}

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const open = async () => {
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await page.locator('[data-bc-menu-open]').first().click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
    await page.waitForTimeout(1500)
  }
  await open()
  const mod = '[data-mod="tasks"]'
  const before = await boxOf(page, mod)
  if (before === null) throw new Error('no to-dos module on the board')
  // Drag by the header: the top strip, away from its buttons (left third of the title row).
  await dragBy(page, [before[0] + 60, before[1] + 16], 120, 60)
  const afterDrag = await boxOf(page, mod)
  // Repeated drags: five 30px steps should accumulate to 150px without losing a gesture.
  const repeatStart = afterDrag ?? [0, 0, 0, 0]
  for (let i = 0; i < 5; i++) {
    const at = await boxOf(page, mod)
    if (at !== null) await dragBy(page, [at[0] + 60, at[1] + 16], 30, 0)
  }
  const repeatEnd = await boxOf(page, mod)
  console.log(
    JSON.stringify({
      repeated: { fromX: repeatStart[0], toX: repeatEnd?.[0], expectedDelta: 150 },
    }),
  )
  // Resize from the bottom-right handle.
  const resizer = await boxOf(page, `${mod} .bcresize`)
  let afterResize: number[] | null = null
  if (resizer !== null) {
    await dragBy(page, [resizer[0] + resizer[2] / 2, resizer[1] + resizer[3] / 2], 60, 40)
    afterResize = await boxOf(page, mod)
  }
  const note = '[data-bc-note-grip]'
  const noteBefore = await boxOf(page, note)
  if (noteBefore !== null) {
    await dragBy(
      page,
      [noteBefore[0] + noteBefore[2] / 2, noteBefore[1] + noteBefore[3] / 2],
      -90,
      50,
    )
  }
  const noteAfter = await boxOf(page, note)
  console.log(
    JSON.stringify({
      module: { before, afterDrag, afterResize },
      note: { noteBefore, noteAfter },
    }),
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.waitForTimeout(1500)
  console.log(
    JSON.stringify({
      afterReload: { module: await boxOf(page, mod), note: await boxOf(page, note) },
      pageErrors: errors.slice(0, 3),
    }),
  )
  await page.screenshot({ path: join(process.cwd(), '.out', 'probe', 'drag-after-reload.png') })
} finally {
  await browser.close()
  server.close()
}
