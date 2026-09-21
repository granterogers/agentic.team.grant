/*
 * §21 — capture both project-home compositions at the two viewports the
 * redesign prompt names, plus the shipped grid as the control.
 *
 * THIS PASSES AND FAILS NOTHING. It is the capture half of the loop; the
 * choice is made by opening the images. A directory of unreviewed captures is
 * a failed comparison, not a completed one.
 *
 * The composition is chosen through the same localStorage key a viewer would
 * use, set before the first paint, so what is captured is the real page under
 * the real shell rather than a renderer called in a harness.
 */
import { mkdir } from 'node:fs/promises'
import { chromium, devices } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4639
const OUT = '.out/basecamp-compose'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

const SIZES = [
  { id: 'desktop', width: 1440, height: 900, touch: false },
  { id: 'phone', width: 390, height: 844, touch: true },
] as const

const PICKS = ['grid', 'a', 'b'] as const

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const thrown: string[] = []
const missed: string[] = []
let taken = 0

for (const size of SIZES) {
  for (const pick of PICKS) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      locale: 'en-GB',
      timezoneId: 'Europe/London',
      ...(size.touch ? devices['Pixel 7'] : {}),
      deviceScaleFactor: 1,
      isMobile: size.touch,
      hasTouch: size.touch,
    })
    /*
      Set before any script runs, so the first paint is already the
      composition under test. Setting it after the paint would capture the
      shipped grid and then a redraw, which is a race and has cost this
      repository a capture run before.
    */
    await ctx.addInitScript(`try { localStorage.setItem('bc.compose', '${pick}') } catch {}`)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => {
      thrown.push(`${size.id}/${pick}: ${e.message}`)
    })
    const name = `${pick === 'grid' ? 'shipped' : `comp-${pick}`}-${size.id}`
    try {
      await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(400)
      const slug = (await page.evaluate(
        `(() => { const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
           return el === null ? '' : (el.dataset.bcGo ?? '') })()`,
      )) as string
      if (slug === '') throw new Error('no project link on the portfolio')
      await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
      await page.waitForSelector(pick === 'grid' ? '.bcgrid' : '.bccomp', { timeout: 6000 })
      await page.waitForTimeout(450)
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
      await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true })
      taken += 1
    } catch (e) {
      missed.push(`${name}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
    }
    await ctx.close()
  }
}

await browser.close()
server.close()

console.log(`captured ${String(taken)} of ${String(SIZES.length * PICKS.length)} into ${OUT}/`)
if (thrown.length > 0) {
  console.log(`\nPAGE ERRORS (${String(thrown.length)}):`)
  for (const t of new Set(thrown)) console.log(`  ${t}`)
}
if (missed.length > 0) {
  console.log(`\nCOULD NOT CAPTURE (${String(missed.length)}):`)
  for (const m of missed) console.log(`  ${m}`)
}
console.log('\nThis passes and fails nothing. Open the images.')
