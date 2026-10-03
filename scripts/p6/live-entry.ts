/** One look at the DEPLOYED page as a stranger: the entry screen, not the prototype. npx tsx scripts/p6/live-entry.ts [label] */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const label = process.argv[2] ?? 'now'
mkdirSync(`.out/live-${label}`, { recursive: true })
const browser = await chromium.launch()
let bad = 0
for (const vp of [
  { n: 'desktop', w: 1440, h: 900 },
  { n: 'phone', w: 390, h: 844 },
]) {
  const page = await (
    await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
  ).newPage()
  await page.goto('https://ai-team-hq.vercel.app/', { waitUntil: 'domcontentloaded' })
  const ok = await page
    .waitForSelector('.bcentrycard', { timeout: 30000 })
    .then(() => true)
    .catch(() => false)
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${vp.n}: stranger sees the entry screen`,
    ok ? '' : body.slice(0, 120),
  )
  if (!ok || /Legacy Coaching|Prototype data/i.test(body)) bad += 1
  await page.screenshot({ path: `.out/live-${label}/${vp.n}.png`, fullPage: true })
}
await browser.close()
process.exitCode = bad === 0 ? 0 : 1
