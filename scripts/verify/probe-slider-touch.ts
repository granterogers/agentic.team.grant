/**
 * Touch interaction with the canvas background sliders on Team HQ (`/`), in a real browser.
 *
 *   npx tsx scripts/verify/probe-slider-touch.ts
 *
 * Opens the look sheet on a project, picks a texture, then drags the Opacity and Shade thumbs with real
 * touch events and reads the value and the board's rendering after each gesture. Nothing is applied or
 * stored: the sheet is cancelled at the end. Serves web/studio locally.
 */
import { chromium } from 'playwright'
import { serve, touchDrag } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
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
  await page.locator('[data-bc-pagemenu]').first().click({ force: true })
  await page.waitForTimeout(300)
  await page.locator('[data-bc-look]').first().click({ force: true })
  await page.waitForTimeout(900)
  await page
    .locator('[data-bd-pick]', { hasText: /^Warm walnut$/ })
    .first()
    .click({ force: true })
  await page.waitForTimeout(500)

  const readBoard = () =>
    page.evaluate(() => {
      const board = document.querySelector<HTMLElement>('[data-bc-board]') ?? document.body
      const cs = getComputedStyle(board)
      return {
        veil: cs.getPropertyValue('--bc-bg-veilp').trim(),
        shade: cs.getPropertyValue('--bc-bg-shadep').trim(),
      }
    })
  const results: Record<string, unknown> = {}
  for (const key of ['intensity', 'tint'] as const) {
    const input = page.locator(`[data-bd-range="${key}"]`).first()
    const box = await input.boundingBox()
    if (box === null) throw new Error(`no ${key} slider`)
    const y = box.y + box.height / 2
    // Touch-drag the thumb: start at its left end, move across the track to 80%.
    const startX = box.x + 2
    const beforeValue = await input.inputValue()
    const beforeBoard = await readBoard()
    await touchDrag(page, [startX, y], box.width * 0.8, 0, 10)
    await page.waitForTimeout(300)
    results[key] = {
      before: beforeValue,
      after: await input.inputValue(),
      boardBefore: beforeBoard,
      boardAfter: await readBoard(),
    }
  }
  console.log(JSON.stringify({ touchSliders: results, pageErrors: errors.slice(0, 3) }))
  await page.locator('[data-bd-cancel]').first().click({ force: true })
} finally {
  await browser.close()
  close()
}
