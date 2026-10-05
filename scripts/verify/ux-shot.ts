/*
 * One-off capture of Team HQ at a given address and viewport, for visual QA.
 *   npx tsx scripts/verify/ux-shot.ts <path> <WxH> <out.png> [js-to-run-first]
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const [path = '/', size = '1440x900', out = '.out/ux.png', pre = ''] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const PORT = 4690 + Math.floor(Math.random() * 50)
const server = await serveStudio(PORT)
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: w ?? 1440, height: h ?? 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => {
  console.log('PAGEERROR', e.message)
})
await page.goto(`http://127.0.0.1:${String(PORT)}${path}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
if (pre !== '') {
  await page.evaluate(pre)
  await page.waitForTimeout(600)
}
await page.screenshot({ path: out })
console.log('wrote', out)
await browser.close()
server.close()
