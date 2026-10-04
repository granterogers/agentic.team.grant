/* Print boxes for selectors on a Team HQ project page. npx tsx scripts/verify/ux-probe.ts 1440x900 '.bchome' '.bcpanes' */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const [size = '1440x900', ...sels] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const PORT = 4740 + Math.floor(Math.random() * 50)
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const page = await (
  await browser.newContext({ viewport: { width: w ?? 1440, height: h ?? 900 } })
).newPage()
await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]').click()`)
await page.waitForTimeout(700)
for (const s of sels) {
  const r = await page.evaluate(
    `(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return null; const b = e.getBoundingClientRect(); const c = getComputedStyle(e); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), display: c.display, overflow: c.overflow, position: c.position } })()`,
  )
  console.log(s, JSON.stringify(r))
}
console.log(
  'doc scroll',
  await page.evaluate('[document.documentElement.scrollHeight, innerHeight]'),
)
await browser.close()
server.close()
