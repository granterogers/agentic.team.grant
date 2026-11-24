/**
 * Visual check of the Team HQ project page: the arrange menu and its Layouts popover, and the page after a resize (0.113.0).
 *
 *   PLAYWRIGHT_BROWSERS_PATH=<scratch>/pw ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/layout-audit.ts [label]
 *
 * Read-only on the Sample Office. It writes screenshots to .out/layout-audit-<label>/ and prints where the Layouts popover sits
 * against the page, so a popover that opens off the screen is measured rather than judged by eye.
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/layout-audit-${label}`
mkdirSync(out, { recursive: true })
const studio = await startStudio(4805)
const s = await session()

const { ctx, page, errors } = await newPage(studio, { width: 1440, height: 900 })
await signIn(studio, page, s)
await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
await settle(page)
await page.screenshot({ path: `${out}/1-project-1440.png` })

await page.locator('[data-bc-plus]').first().click()
await page
  .locator('[data-bc-layouts]:visible')
  .first()
  .click({ timeout: 5000 })
  .catch((e: Error) => console.log('click failed', e.message.slice(0, 120)))
await settle(page)
await page.screenshot({ path: `${out}/2-layouts-1440.png` })
const pop = await page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('[data-bc-layouts]')].find((b) => b.getBoundingClientRect().width > 0)
  const sheet = document.querySelector('.bcpop--layouts')
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) } }
  return { button: box(btn), popover: box(sheet), vw: innerWidth, vh: innerHeight }
})()`)
console.log('LAYOUTS', JSON.stringify(pop))

await page.setViewportSize({ width: 1000, height: 800 })
await settle(page)
await page.screenshot({ path: `${out}/3-resized-1000.png` })
await ctx.close()

const phone = await newPage(studio, { width: 390, height: 844 })
await signIn(studio, phone.page, s)
await phone.page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
await settle(phone.page)
await phone.page.screenshot({ path: `${out}/4-project-390.png` })
await phone.ctx.close()
console.log('page errors', errors.length)
await studio.close()
