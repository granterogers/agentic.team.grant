/**
 * Drive the canvas background controls on Team HQ (`/`) in a real browser.
 *
 *   npx tsx scripts/verify/probe-backdrop.ts
 *
 * Opens the first prototype project, opens its project menu, then "How this project looks", and
 * checks each texture preset, the Opacity / Shade / Scale sliders (keyboard and pointer), Cancel,
 * Apply with a reload, and Restore default. The prototype keeps nothing on a server, so Apply
 * persists only for this browser profile. Serves web/studio locally.
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

const PRESETS = [
  'Microcement',
  'Blue-grey slate',
  'Warm walnut',
  'Brushed aluminium',
  'Warm microcement',
  'Natural linen',
  'Tan leather',
  'Handmade paper',
  'Speckled light stone',
  'Plain',
  'Stone',
  'Sand',
  'Sage',
  'Mist',
  'Charcoal',
]

const browser = await chromium.launch()
try {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const openLook = async () => {
    await page.locator('[data-bc-pagemenu]').first().click({ force: true })
    await page.waitForTimeout(300)
    await page.locator('[data-bc-look]').first().click({ force: true })
    await page.waitForTimeout(900)
  }
  const pick = async (name: string) => {
    await page
      .locator('[data-bd-pick]', { hasText: new RegExp(`^${name}$`) })
      .first()
      .click({ force: true })
    await page.waitForTimeout(400)
  }
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu-open]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
  await page.waitForTimeout(1500)
  await openLook()

  const readBoard = () =>
    page.evaluate(() => {
      const board = document.querySelector<HTMLElement>('[data-bc-board]') ?? document.body
      const cs = getComputedStyle(board)
      return {
        bg: board.getAttribute('data-bg') ?? '(none)',
        veil: cs.getPropertyValue('--bc-bg-veilp').trim(),
        shade: cs.getPropertyValue('--bc-bg-shadep').trim(),
        tile: cs.getPropertyValue('--bc-bg-tw').trim(),
        image: cs.backgroundImage.slice(0, 60),
      }
    })

  await pick('Warm walnut')
  console.log(JSON.stringify({ afterPick: 'Warm walnut', board: await readBoard() }))
  await page.screenshot({ path: join(OUT, 'backdrop-sheet.png') })

  for (const key of ['intensity', 'tint', 'scale']) {
    const input = page.locator(`[data-bd-range="${key}"]`).first()
    await input.focus()
    const before = await input.inputValue()
    const boardBefore = await readBoard()
    const dir = key === 'tint' ? 'ArrowRight' : 'ArrowLeft'
    await page.keyboard.press(dir)
    await page.keyboard.press(dir)
    await page.waitForTimeout(300)
    const after = await input.inputValue()
    console.log(
      JSON.stringify({ slider: key, before, after, boardBefore, boardAfter: await readBoard() }),
    )
  }

  const slider = page.locator('[data-bd-range="intensity"]').first()
  const box = await slider.boundingBox()
  const outBefore = await slider.inputValue()
  if (box !== null) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  await page.waitForTimeout(300)
  console.log(
    JSON.stringify({
      pointerDrag: { from: outBefore, to: await slider.inputValue(), board: await readBoard() },
    }),
  )

  const beforeCancel = await readBoard()
  await page.locator('[data-bd-cancel]').first().click({ force: true })
  await page.waitForTimeout(500)
  console.log(JSON.stringify({ cancel: { beforeCancel, afterCancel: await readBoard() } }))

  // Persistence: pick, move Scale, Apply, reload, and read what the board shows.
  await pick('Warm walnut')
  const scaleInput = page.locator('[data-bd-range="scale"]').first()
  await scaleInput.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.locator('[data-bd-apply]').first().click({ force: true })
  await page.waitForTimeout(1500)
  const applied = await readBoard()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  console.log(JSON.stringify({ persistence: { applied, afterReload: await readBoard() } }))

  // Every preset must visibly apply: its picked board reads a background image, not 'none'.
  await openLook()
  const perPreset: Record<string, string> = {}
  for (const name of PRESETS) {
    await pick(name)
    const b = await readBoard()
    perPreset[name] = `${b.bg} / ${b.image === 'none' ? 'no image' : 'image'}`
  }
  console.log(JSON.stringify({ perPreset }))
  await page
    .locator('[data-bd-restore], button', { hasText: 'Restore the default' })
    .first()
    .click({ force: true })
  await page.waitForTimeout(400)
  console.log(JSON.stringify({ afterRestore: await readBoard() }))
  // Upload path: a real picture goes into the background control and shows as a pending choice.
  if ((await page.locator('[data-bd-file]').count()) === 0) await openLook()
  await page
    .locator('[data-bd-file]')
    .first()
    .setInputFiles(join(ROOT, 'textures', 'bg', 'brushed-aluminium.webp'))
  await page.waitForTimeout(1500)
  const uploaded = await page.evaluate(() => ({
    yourPicture: Array.from(document.querySelectorAll('[data-bd] [data-bd-pick]')).some((t) =>
      (t.textContent ?? '').includes('Your picture'),
    ),
    applyEnabled:
      (document.querySelector('[data-bd-apply]') as HTMLButtonElement | null)?.disabled === false,
  }))
  console.log(JSON.stringify({ upload: uploaded, board: await readBoard() }))
  await page.locator('[data-bd-cancel]').first().click({ force: true })
  await page.waitForTimeout(400)
  console.log(JSON.stringify({ uploadCancelled: await readBoard() }))
  console.log(JSON.stringify({ pageErrors: errors.slice(0, 3) }))
} finally {
  await browser.close()
  server.close()
}
