import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'
const PORT = 4777
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(`http://127.0.0.1:${PORT}/`)
await page.waitForTimeout(500)
const slug = await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`)
await page.goto(`http://127.0.0.1:${PORT}${slug}/documents`)
await page.waitForSelector('.bcdocfilter')
await page.waitForTimeout(500)
await page.locator('.bcdocs--wall [data-bc-doc]', { hasText: 'WS01' }).locator('[data-bc-doc-open]').click()
await page.waitForSelector('.bcdocgrid')
await page.waitForTimeout(2500)
await page.screenshot({ path: '.out/ux-docs-05-pdf.png' })
console.log(await page.locator('.bcdocpreview').innerHTML().then((h) => h.slice(0, 300)))
await browser.close(); server.close()
