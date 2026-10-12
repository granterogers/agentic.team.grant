/**
 * Keyboard operation on Team HQ (`/`) in a real browser: a Post-it is moved and resized from its grip with
 * the arrow keys (Alt for moving, Alt+Shift for resizing), and Escape closes the appearance sheet.
 *
 *   npx tsx scripts/verify/probe-keyboard.ts
 *
 * Read-only: the Post-it changes are local to this run. Serves web/studio locally.
 */
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.locator('[data-bc-menu-open]').first().click({ force: true })
  await page.waitForTimeout(400)
  await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
  await page.waitForTimeout(1500)

  const note = '[data-bc-note-grip]'
  const box = () =>
    page.evaluate((s) => {
      const el = document.querySelector<HTMLElement>(s)
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
    }, note)
  // The note's box is on its grip's parent; measure the note itself.
  const noteBox = () =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-bc-note-grip]')?.closest<HTMLElement>('.bcpostit')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
    })
  void box
  const before = await noteBox()
  await page.locator(note).first().focus()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await page.keyboard.press('Alt+Shift+ArrowRight')
  await page.waitForTimeout(500)
  const resized = await noteBox()
  await page.keyboard.press('Alt+ArrowLeft')
  await page.waitForTimeout(500)
  const moved = await noteBox()
  console.log(JSON.stringify({ postit: { before, resized, moved } }))

  // Escape closes the appearance sheet.
  await page.locator('[data-bc-pagemenu]').first().click({ force: true })
  await page.waitForTimeout(300)
  await page.locator('[data-bc-look]').first().click({ force: true })
  await page.waitForTimeout(900)
  const openBefore = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#viewer')
    return el !== null && !el.hidden
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const openAfter = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#viewer')
    return el !== null && !el.hidden
  })
  console.log(JSON.stringify({ escape: { openBefore, openAfter }, pageErrors: errors.slice(0, 2) }))
} finally {
  await browser.close()
  close()
}
