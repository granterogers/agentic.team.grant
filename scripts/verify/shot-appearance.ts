// biome-ignore-all lint/suspicious/noExplicitAny: browser objects
// biome-ignore-all format: capture script
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const OUT = process.env.OUT ?? '.out/sprint/looks'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(4712)
const browser = await chromium.launch()
for (const scheme of ['dark', 'light']) for (const look of ['original', 'silver', 'forest', 'graphite']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(`try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: 'slate', texture: 'concrete', scheme: '${scheme}', density: 'comfortable', look: '${look}', glass: 'rich', depth: 'soft' })) } catch {}`)
  const page = await ctx.newPage()
  const errs: string[] = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto('http://127.0.0.1:4712/basecamp', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  const slug = (await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`)) as string
  await page.goto(`http://127.0.0.1:4712${slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]'); await page.waitForTimeout(600)
  await page.locator('[data-bc-menu]').first().click({ force: true }); await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${scheme}-${look}-menu.png` })
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.locator('[data-bc-settings]').first().click({ force: true })
  await page.waitForSelector('#settings .stg'); await page.locator('#settings [data-setting="appearance"]').click({ force: true }); await page.waitForTimeout(500)
  if (look === 'original') await page.screenshot({ path: `${OUT}/${scheme}-appearance.png`, fullPage: false })
  console.log(scheme, look, errs.join('|') || 'ok')
  await ctx.close()
}
await browser.close(); server.close(); process.exit(0)
