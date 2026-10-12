/**
 * Screenshot and overflow matrix for Team HQ (`/`): the main surfaces at four widths (1920, 1440, tablet 820, phone 390),
 * in light and dark. Each capture is measured for horizontal overflow (a page wider than its viewport), and each
 * surface reports the page errors it raised. The PNGs are for judging by eye; the numbers are the gate.
 *
 *   npx tsx scripts/verify/probe-matrix.ts
 *
 * Writes .out/probe/matrix-<width>-<scheme>-<surface>.png. Read-only; serves web/studio locally.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const WIDTHS = [
  { name: '1920', width: 1920, height: 1080, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: 'tablet', width: 820, height: 1180, mobile: false },
  { name: 'phone', width: 390, height: 844, mobile: true },
] as const
const SCHEMES = ['light', 'dark'] as const
const OUT = join(process.cwd(), '.out', 'probe')

const overflow = (page: Page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const sw = document.documentElement.scrollWidth
    return { viewport: vw, scrollWidth: sw, overflows: sw > vw + 1 }
  })

const { port, close } = await serve()
const browser = await chromium.launch()
const rows: Array<Record<string, unknown>> = []
try {
  await mkdir(OUT, { recursive: true })
  for (const w of WIDTHS) {
    for (const scheme of SCHEMES) {
      const context = await browser.newContext({
        viewport: { width: w.width, height: w.height },
        isMobile: w.mobile,
        hasTouch: w.mobile,
        colorScheme: scheme,
      })
      await context.addInitScript((s) => {
        localStorage.setItem('studio.appearance', JSON.stringify({ scheme: s, look: 'silver' }))
      }, scheme)
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      const shot = (surface: string) =>
        page.screenshot({ path: join(OUT, `matrix-${w.name}-${scheme}-${surface}.png`) })
      const record = async (surface: string) => {
        rows.push({
          width: w.name,
          scheme,
          surface,
          ...(await overflow(page)),
          errors: errors.length,
        })
      }
      const chatToggle = () => page.getByRole('button', { name: /chat with team/i }).first()

      await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1200)
      await shot('home')
      await record('home')

      await page.locator('[data-bc-menu-open]').first().click({ force: true })
      await page.waitForTimeout(400)
      await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
      await page.waitForTimeout(1500)
      await shot('overview')
      await record('overview')

      await chatToggle().click({ force: true })
      await page.waitForTimeout(700)
      await shot('chat')
      await record('chat')
      await chatToggle().click({ force: true })
      await page.waitForTimeout(500)

      await page.locator('[data-bc-settings]').first().click({ force: true })
      await page.waitForTimeout(900)
      await shot('settings')
      await record('settings')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)

      await page.locator('[data-bc-menu]').first().click({ force: true })
      await page.waitForTimeout(300)
      await page
        .locator('[data-bc-menu-modules] [data-bc-expand="documents"]')
        .first()
        .click({ force: true })
      await page.waitForTimeout(800)
      await shot('module-documents')
      await record('module-documents')
      await page.locator('.bcexpx').first().click({ force: true })
      await page.waitForTimeout(800)

      rows.push({ width: w.name, scheme, surface: 'errors', errors: errors.slice(0, 2) })
      await context.close()
    }
  }
} finally {
  await browser.close()
  close()
}

for (const r of rows) console.log(JSON.stringify(r))
const bad = rows.filter((r) => r.surface !== 'errors' && r.overflows === true)
const errs = rows.filter(
  (r) => r.surface === 'errors' && Array.isArray(r.errors) && r.errors.length > 0,
)
console.log(
  `overflowing captures: ${String(bad.length)}; surfaces with page errors: ${String(errs.length)}`,
)
process.exitCode = bad.length === 0 && errs.length === 0 ? 0 : 1
