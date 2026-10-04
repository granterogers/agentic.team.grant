/*
 * THE VISUAL MATRIX FOR THE 4 OCTOBER WORK: captures and mechanical checks.
 *   npx tsx scripts/verify/ux-matrix.ts
 * Home, calendar (expanded), documents, activity at 1440, 1280, 768 and 390,
 * dark and light, and reduced motion. Writes .out/ux-matrix-*.png for LOOKING
 * at (section 14A) and asserts the things a machine can: no sideways scroll, no
 * page errors, nothing under the 12px type floor in the new surfaces, and that
 * reduced motion really removes the maximise animation.
 */
import { chromium } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'
import { serveStudio } from './serve-studio.ts'

const PORT = 4695
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) pass += 1
  else fail += 1
  console.log(
    `${ok ? 'ok   ' : 'FAIL '} ${what}${ok || detail === '' ? '' : `\n        ${detail}`}`,
  )
}
const browser = await chromium.launch()
const probe = await (await browser.newContext()).newPage()
await probe.goto(url('/'))
await probe.waitForTimeout(500)
const slug = (await probe.evaluate(
  `document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`,
)) as string

const sizes = [
  ['1440', 1440, 900],
  ['1280', 1280, 800],
  ['768', 768, 1024],
  ['390', 390, 844],
] as const
const errs: string[] = []
/* Team HQ ships one scheme (dark): there is no light theme to capture, and a capture named light that is dark is the trap CLAUDE.md records. */
for (const scheme of ['dark'] as const) {
  for (const [name, w, h] of sizes) {
    const mobile = w < 500
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile,
      hasTouch: mobile || w === 768,
      colorScheme: scheme,
    })
    await ctx.addInitScript(seedAppearance(scheme))
    const page = await ctx.newPage()
    page.on('pageerror', (e) => {
      errs.push(`${name}/${scheme}: ${e.message}`)
    })
    for (const [what, path] of [
      ['home', slug],
      ['calendar', `${slug}/schedule`],
      ['documents', `${slug}/documents`],
      ['activity', `${slug}/activity`],
    ] as const) {
      await page.goto(url(path), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(700)
      const sideways = (await page.evaluate(
        `document.documentElement.scrollWidth > innerWidth + 1`,
      )) as boolean
      check(`${what} ${name} ${scheme}: no sideways scroll`, !sideways)
      await page.screenshot({ path: `.out/ux-matrix-${what}-${name}-${scheme}.png` })
    }
    /* the type floor, on the surfaces added today */
    if (scheme === 'dark') {
      await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)
      const small = (await page.evaluate(
        `[...document.querySelectorAll('.bcdocfilter *, .bcdocsrc, .bcsrcchip')].filter((e) => e.children.length === 0 && e.textContent.trim() !== '' && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.className)`,
      )) as string[]
      check(
        `documents ${name}: nothing under 12px in the filter bar`,
        small.length === 0,
        small.join(','),
      )
    }
    await ctx.close()
  }
}
check('no page errors across the matrix', errs.length === 0, errs.slice(0, 3).join(' | '))

/* reduced motion: the maximise animation is not played, and everything still works */
const rm = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
})
const rp = await rm.newPage()
await rp.goto(url(slug), { waitUntil: 'domcontentloaded' })
await rp.waitForSelector('.bcstage [data-mod]')
await rp.waitForTimeout(500)
await rp.locator('[data-mod="documents"]').hover()
await rp.locator('[data-bc-max="documents"]').click()
await rp.waitForSelector('.bcexp .bcexpbox')
const animating = (await rp.evaluate(
  `document.querySelector('.bcexp .bcexpbox').getAnimations().length`,
)) as number
check('reduced motion: the maximised card does not animate in', animating === 0, String(animating))
await rp.keyboard.press('Escape')
await rp.waitForTimeout(200)
check('reduced motion: and closes at once', (await rp.locator('.bcexp').count()) === 0)
await rp.locator('.bcdock [data-bc-zoom="out"]').click()
await rp.waitForTimeout(100)
const zoomAnim = (await rp.evaluate(
  `document.querySelector('.bcstage').getAnimations().length`,
)) as number
check('reduced motion: zoom does not animate', zoomAnim === 0)
await rm.close()

console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
