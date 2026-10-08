/*
 * Captures a named Team HQ route for the current project. Passes and fails nothing.
 *   npx tsx scripts/verify/ux-shots3.ts <label> <route-suffix> [WxH] [dark]
 * Example: npx tsx scripts/verify/ux-shots3.ts settings /settings 1440x900
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const [label = 'shot', suffix = '', size = '1440x900', scheme = 'light'] = process.argv.slice(2)
const [w = 1440, h = 900] = size.split('x').map(Number)
await mkdir('.out/ux', { recursive: true })
const server = await serveStudio(4656)
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
if (scheme === 'dark') {
  await ctx.addInitScript("try { localStorage.setItem('studio.appearance', JSON.stringify({ scheme: 'dark' })) } catch {}")
}
const page = await ctx.newPage()
const errs: string[] = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto('http://127.0.0.1:4656/', { waitUntil: 'domcontentloaded' })
await page.click('[data-bc-menu]')
await page.locator('.bcmenulist .bcmenuitem').first().click()
await page.waitForSelector('[data-bc-board]')
const path = new URL(page.url()).pathname
if (suffix !== '') {
  await page.goto(`http://127.0.0.1:4656${path}${suffix}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
}
for (const sel of (process.env.CLICKS ?? '').split(';').filter((x) => x !== '')) {
  await page.locator(sel).first().click({ force: true })
  await page.waitForTimeout(500)
}
await page.screenshot({ path: `.out/ux/${label}-${w}x${h}.png` })
console.log(errs.join(' | ') || 'no errors')
await browser.close()
server.close()
