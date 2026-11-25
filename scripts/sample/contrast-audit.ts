/**
 * Measures the contrast of every module title on the project page, in light and dark theme (0.117.2). Read only.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=<scratch>/pw ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/contrast-audit.ts
 *
 * The colour of each title is read from the page, its background from the nearest opaque ancestor, and the ratio is WCAG's.
 */
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const studio = await startStudio(4840)
const s = await session()
for (const scheme of ['light', 'dark'] as const) {
  const { ctx, page } = await newPage(studio, { width: 1440, height: 900 })
  await signIn(studio, page, s)
  await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  await page.evaluate(`document.documentElement.dataset.scheme = '${scheme}'`)
  await settle(page)
  const rows = await page.evaluate(`(() => {
    const lum = (c) => { let m = c.match(/[\\d.]+/g).map(Number); if (c.startsWith('color(')) m = m.slice(0, 3).map((v) => v * 255); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]) }
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    const bg = (el) => { let n = el; while (n) { const c = getComputedStyle(n).backgroundColor; const m = c.match(/[\\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.9)) return c; n = n.parentElement } return 'rgb(255,255,255)' }
    return [...document.querySelectorAll('.bcmodtitle')].filter((t) => t.getBoundingClientRect().width > 0).map((t) => ({ title: t.textContent.trim().slice(0, 24), ratio: Math.round(ratio(getComputedStyle(t).color, bg(t)) * 10) / 10 }))
  })()`)
  console.log(scheme.toUpperCase(), JSON.stringify(rows))
  await ctx.close()
}
await studio.close()
