/**
 * Measure whether Team HQ's surfaces animate when they close: the Team Chat drawer (closed by its toggle)
 * and Global Settings (closed by its own Back button). Samples transform, opacity and running animations
 * for half a second after the press. Read-only; serves web/studio locally.
 *
 *   npx tsx scripts/verify/probe-close-motion.ts
 */
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()

type Frame = { t: number; present: boolean; transform: string; opacity: string; anims: number }

const sample = (page: Page, selector: string) =>
  page.evaluate(async (sel) => {
    const out: Frame[] = []
    const start = performance.now()
    while (performance.now() - start < 500) {
      const el = document.querySelector<HTMLElement>(sel)
      const cs = el === null ? null : getComputedStyle(el)
      out.push({
        t: Math.round(performance.now() - start),
        present: el !== null && !el.hidden,
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
    // Open the chat, let it settle, then close it with its own toggle.
    const chatToggle = page.getByRole('button', { name: /chat with team/i }).first()
    await chatToggle.click({ force: true })
    await page.waitForTimeout(800)
    const closeRun = sample(page, '.dock')
    await chatToggle.click({ force: true })
    const chatClose = await closeRun
    console.log(
      JSON.stringify({
        reducedMotion: reduced,
        surface: 'team chat drawer close',
        firstFrames: chatClose.slice(0, 4),
        animatedFrames: chatClose.filter((f) => f.anims > 0).length,
        pageErrors: errors.slice(0, 2),
      }),
    )
    // Settings: open, settle, close with its Back button.
    await page.locator('[data-bc-settings]').first().click({ force: true })
    await page.waitForTimeout(800)
    const settingsRun = sample(page, '#settings')
    await page.locator('[data-stg-back]').first().click({ force: true })
    const settingsClose = await settingsRun
    console.log(
      JSON.stringify({
        reducedMotion: reduced,
        surface: 'global settings close',
        firstFrames: settingsClose.slice(0, 4),
        animatedFrames: settingsClose.filter((f) => f.anims > 0).length,
      }),
    )
    await context.close()
  }
} finally {
  await browser.close()
  close()
}
