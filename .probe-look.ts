import { chromium } from 'playwright'
import { serveStudio } from './scripts/verify/serve-studio.ts'
const inPage = (b: string): string => `(() => { ${b} })()`
const PORT = 4695
const server = await serveStudio(PORT)
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
await ctx.addInitScript(`try { localStorage.setItem('hq.token', 'probe-local-only') } catch {}`)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.goto(`http://127.0.0.1:${PORT}/basecamp`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-go^="/basecamp/p/"]')
const slug = (await page.evaluate(inPage(`return document.querySelector('[data-bc-go^="/basecamp/p/"]').dataset.bcGo`))) as string
await page.goto(`http://127.0.0.1:${PORT}${slug}/settings`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const tabs = await page.locator('[data-setpane]').allInnerTexts()
console.log('panes offered:', tabs.join(' | '))
if ((await page.locator('[data-setpane="project"]').count()) > 0) {
  await page.locator('[data-setpane="project"]').click(); await page.waitForTimeout(900)
}
console.log(JSON.stringify(await page.evaluate(inPage(`const p = document.querySelector('.setproj')
  return { pane: p === null ? 'ABSENT' : (p.textContent||'').replace(/\\s+/g,' ').slice(0,260),
    openLook: document.querySelectorAll('[data-open-look]').length,
    readonlyNotes: (p ? (p.textContent||'').match(/Read-only/g) || [] : []).length }`)), null, 1))
await browser.close(); server.close(); process.exit(0)
