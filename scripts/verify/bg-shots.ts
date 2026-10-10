// biome-ignore-all lint/suspicious/noExplicitAny: browser objects
// biome-ignore-all format: capture script
/* Material captures (ADR-0072): each preset at 1x and 2x, at rest and after a pan and a zoom, across the bar/board edge. Captures only. */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const OUT = process.env.OUT ?? '.out/bg'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(4720)
const browser = await chromium.launch()
const ids = (process.env.IDS ?? 'walnut,linen,paper,slate,leather').split(',')
for (const dpr of [1, 2]) for (const id of ids) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr })
  await ctx.addInitScript(`localStorage.setItem('studio.appearance', JSON.stringify({ palette: 'slate', texture: 'concrete', scheme: 'dark', density: 'comfortable' }))`)
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:4720/basecamp'); await page.waitForTimeout(500)
  const slug = (await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`)) as string
  await page.evaluate(`localStorage.setItem('bc.stage.${slug.split('/').pop()}', JSON.stringify({ mods: null, zoom: 1, pan: { x: 0, y: 0 }, layouts: {}, postits: [], gone: {}, seeded: true, bg: { id: '${id}', mode: 'tile', scale: 1, intensity: 1, tint: 0, at: 1 } }))`)
  await page.goto('http://127.0.0.1:4720' + slug); await page.waitForSelector('[data-bc-board]'); await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/${id}-${dpr}x-rest.png`, clip: { x: 0, y: 0, width: 760, height: 330 } })
  await page.mouse.move(1200, 700); await page.mouse.down(); await page.mouse.move(1130, 660, { steps: 5 }); await page.mouse.up()
  await page.mouse.wheel(0, 300); await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${id}-${dpr}x-panned.png`, clip: { x: 0, y: 0, width: 760, height: 330 } })
  await ctx.close()
}
await browser.close(); server.close(); process.exit(0)
