// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/* Close-up captures at 2x density of the parts of the board where polish shows: a module, the toolbar, the menu. Captures only. */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
const PORT = 4702
const OUT = process.argv[3] ?? '.out/aesthetic-detail'
const PALETTE = process.argv[2] ?? 'slate'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const browser = await chromium.launch()
for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' })
  await ctx.addInitScript(
    `try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: '${PALETTE}', texture: 'concrete', own: null, ownName: '', scheme: '${scheme}', density: 'comfortable' })) } catch {}`,
  )
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${String(PORT)}/basecamp`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  const slug = (await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`)) as string
  await page.goto(`http://127.0.0.1:${String(PORT)}${slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/${scheme}-top-left.png`, clip: { x: 0, y: 0, width: 800, height: 420 } })
  await page.screenshot({ path: `${OUT}/${scheme}-top-right.png`, clip: { x: 700, y: 90, width: 740, height: 330 } })
  await page.screenshot({ path: `${OUT}/${scheme}-modules.png`, clip: { x: 0, y: 580, width: 800, height: 320 } })
  await ctx.close()
}
await browser.close()
server.close()
