/*
 * Team HQ UX capture (8 October 2026). Captures only; passes and fails nothing.
 *   npx tsx scripts/verify/ux-shots.ts <label> [width x height ...]
 * Serves web/studio statically (no office, no production) and writes PNGs to .out/ux/<label>-*.png.
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4651
const label = process.argv[2] ?? 'now'
const OUT = '.out/ux'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const sizes = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ['1440x900']
const errors: string[] = []
for (const sz of sizes) {
  const [w, h] = sz.split('x').map(Number) as [number, number]
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: w < 600,
    isMobile: w < 600,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${sz}: ${e.message}`))
  await page.goto(`http://127.0.0.1:${PORT}/basecamp`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${label}-${sz}-home.png` })
  await page.click('[data-bc-menu]')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/${label}-${sz}-menu.png` })
  await page.click('.bcmenulist .bcmenuitem')
  await page.waitForSelector('[data-bc-board]', { timeout: 6000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/${label}-${sz}-project.png` })
  await ctx.close()
}
await browser.close()
server.close()
console.log(errors.length === 0 ? 'no page errors' : errors.join('\n'))
