/**
 * Landing page captures, named for the appearance they were actually drawn in. The scheme is set through the stored
 * appearance (what a person's choice does) and the body background is read back and recorded, so a file cannot be
 * named Dark while drawn Light. Writes .out/visual/landing-<scheme>-<width>.png. Local, read-only.
 *
 *   npx tsx scripts/verify/probe-landing.ts
 */
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
let failures = 0
try {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [width, height, mobile] of [
      [1440, 900, false],
      [390, 844, true],
    ] as const) {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: mobile,
        hasTouch: mobile,
      })
      await context.addInitScript(
        (value) => {
          try {
            localStorage.setItem('studio.appearance', value)
          } catch {
            /* private */
          }
        },
        JSON.stringify({
          palette: 'slate',
          texture: 'none',
          own: null,
          ownName: '',
          scheme,
          density: 'comfortable',
          look: 'silver',
          glass: 'soft',
          depth: 'soft',
        }),
      )
      const page = await context.newPage()
      await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1400)
      const drawn = await page.evaluate(() => ({
        scheme:
          document.documentElement.getAttribute('data-scheme') ??
          document.body.getAttribute('data-scheme') ??
          'none',
        background: getComputedStyle(document.body).backgroundColor,
      }))
      const name = `landing-${scheme}-${String(width)}`
      await page.screenshot({ path: `.out/visual/${name}.png` })
      const isDark = drawn.scheme === 'dark'
      const ok = scheme === 'dark' ? isDark : !isDark
      if (!ok) failures++
      console.log(
        `${ok ? 'PASS' : 'FAIL'}: ${name}.png drawn as ${drawn.scheme} (${drawn.background})`,
      )
      await context.close()
    }
  }
} finally {
  await browser.close()
  await close()
}
if (failures > 0) process.exit(1)
