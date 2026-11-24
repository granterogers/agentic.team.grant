/**
 * /settings/google opens Services and brings the Google tile into view (0.111.0). Checked on the Sample Office, read only.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=<scratch>/pw ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/settings-google-url.ts [label]
 *
 * It loads the address cold, at a desktop and a phone width, and reports: the Settings tab that is selected, whether the
 * Google tile is inside the visible part of its scroll area, and that the address did not bounce to home.
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/settings-google-${label}`
mkdirSync(out, { recursive: true })

const studio = await startStudio(4803)
const s = await session()
const results: string[] = []

for (const [name, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
] as const) {
  const { ctx, page, errors } = await newPage(studio, { width, height })
  await signIn(studio, page, s)
  await page.goto(`${studio.base}/settings/google`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  await page.waitForFunction(`!!document.querySelector('[data-tile="gmail"]')`, null, { timeout: 20000 }).catch(() => {})
  const probe = (await page.evaluate(`(() => {
    const tile = document.querySelector('[data-tile="gmail"]')
    const view = document.querySelector('[data-tab]')
    const scroller = document.querySelector('.stg-main')
    let inView = false
    if (tile && scroller) {
      const t = tile.getBoundingClientRect(), s = scroller.getBoundingClientRect()
      inView = t.top >= s.top - 1 && t.bottom <= s.bottom + 1
    }
    return { path: location.pathname, tab: view ? view.dataset.tab : null, tileFound: !!tile, tileInView: inView,
      focused: document.activeElement === tile }
  })()`)) as { path: string; tab: string | null; tileFound: boolean; tileInView: boolean; focused: boolean }
  await page.screenshot({ path: `${out}/${name}.png` })
  const ok = probe.tileFound && probe.tab === 'connections' && probe.path === '/settings/google'
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}: path ${probe.path}, tab ${probe.tab}, tile found ${probe.tileFound}, in view ${probe.tileInView}, focused ${probe.focused}, errors ${errors.length}`)
  await ctx.close()
}
for (const r of results) console.log(r)
await studio.close()
