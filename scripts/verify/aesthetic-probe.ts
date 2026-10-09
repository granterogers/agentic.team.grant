// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4703
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`http://127.0.0.1:${String(PORT)}/basecamp`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
const slug = (await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`)) as string
await page.goto(`http://127.0.0.1:${String(PORT)}${slug}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(600)
const y = Number(process.argv[2] ?? 172)
console.log(
  await page.evaluate(`[...document.querySelectorAll('body *')].map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { cls: String(e.className).slice(0, 40), top: Math.round(r.top), bottom: Math.round(r.bottom), bb: c.borderBottomWidth, bt: c.borderTopWidth, w: Math.round(r.width) } }).filter((o) => (Math.abs(o.bottom - ${String(y)}) < 4 && o.bb !== '0px') || (Math.abs(o.top - ${String(y)}) < 4 && o.bt !== '0px')).map((o) => JSON.stringify(o)).join('\\n')`),
)
await browser.close()
server.close()
