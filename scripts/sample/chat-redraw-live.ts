/**
 * An answer appears in the dock while it stays open, without a reload or reopening (stress test of 23 November 2026, 0.102.0).
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/sample/chat-redraw-live.ts [label]
 *
 * Sample Office only, one model call. It sends one short question and watches the dock until the answer shows.
 */
import { mkdirSync } from 'node:fs'
import { newPage, settle, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/chat-redraw-${label}`
mkdirSync(out, { recursive: true })
const QUESTION = 'Quick check: what is this project called? One short sentence.'
const studio = await startStudio(4804)
const s = await session()
const { page, errors } = await newPage(studio, { width: 1440, height: 1000 })
await signIn(studio, page, s)
await page.goto(`${studio.base}/p/wellness-studio-launch`, { waitUntil: 'domcontentloaded' })
await settle(page)
if ((await page.locator('[data-docksay]').count()) === 0)
  await page.locator('[data-bc-dock]').first().click()
await page.locator('[data-docksay]').first().waitFor({ timeout: 15000 })
await page.locator('[data-docksay]').first().fill(QUESTION)
await page.locator('[data-dockform] button[type=submit]').click()
const began = Date.now()
const PENDING =
  /has not answered|nobody has picked|put (that |this |it )?to the team|working|sending|waiting|checking/i
let seen = false
while (Date.now() - began < 360000 && !seen) {
  await page.waitForTimeout(5000)
  const lines = (await page.locator('[data-dockthread] .msg').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  )
  const after = lines.slice(
    lines.findLastIndex((m) => m.includes('what is this project called')) + 1,
  )
  seen = after.some((m) => m.length > 20 && !PENDING.test(m) && !/^you\b/i.test(m))
}
console.log(
  `answer shown in the open dock: ${seen ? 'yes' : 'no'} after ${Math.round((Date.now() - began) / 1000)} s`,
)
await page.screenshot({ path: `${out}/dock.png` })
console.log(`page errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`)
await studio.close()
process.exit(seen ? 0 : 1)
