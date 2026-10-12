/**
 * Check that the appearance (look) dialog keeps its position and size while its controls change, on
 * Team HQ (`/`), at desktop and phone widths. Picks textures and moves each background slider, and reports
 * the dialog's box after each change. Nothing is applied or stored; the sheet is cancelled at the end.
 *
 *   npx tsx scripts/verify/probe-dialog-stable.ts
 *
 * Serves web/studio locally.
 */
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

type Sample = { step: string; box: number[] | null }

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  for (const [name, viewport, isMobile] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['phone', { width: 390, height: 844 }, true],
  ] as const) {
    const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile })
    const page: Page = await context.newPage()
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
    const box = () =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('#viewer .sheet')
        if (el === null) return null
        const r = el.getBoundingClientRect()
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
      })
    const samples: Sample[] = [{ step: 'open', box: await box() }]
    const pick = async (label: RegExp) => {
      await page.locator('[data-bd-pick]', { hasText: label }).first().click({ force: true })
      await page.waitForTimeout(400)
    }
    await pick(/^Warm walnut$/)
    samples.push({ step: 'pick walnut', box: await box() })
    for (const key of ['intensity', 'tint', 'scale']) {
      const dir = key === 'tint' ? 'ArrowRight' : 'ArrowLeft'
      await page.locator(`[data-bd-range="${key}"]`).first().focus()
      await page.keyboard.press(dir)
      await page.keyboard.press(dir)
      await page.waitForTimeout(300)
      samples.push({ step: `move ${key}`, box: await box() })
    }
    await pick(/^Charcoal$/)
    samples.push({ step: 'pick charcoal', box: await box() })
    await page.locator('[data-bd-cancel]').first().click({ force: true })

    const first = JSON.stringify(samples[0]?.box ?? null)
    const moved = samples.filter((s) => s.box !== null && JSON.stringify(s.box) !== first)
    console.log(
      JSON.stringify({
        viewport: name,
        samples,
        stable: moved.length === 0,
        pageErrors: errors.slice(0, 2),
      }),
    )
    await context.close()
  }
} finally {
  await browser.close()
  close()
}
