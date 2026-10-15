/**
 * Capture every section of Global Settings, at four widths, into .out/settings-<label>/.
 *   npx tsx scripts/p5/settings-shots.ts <label> [tab ...]
 * Local files only (a static server over web/studio): no call to the office is made, so the page draws its own example
 * data - which is what a capture of this page has always shown. Per section and width it writes two images: what the
 * person sees first (<vp>-<tab>.png) and the whole section unclipped (<vp>-<tab>-full.png). It prints page errors and
 * anything that scrolls sideways, and records the computed size of every button, field and switch so a sizing audit is a
 * table rather than a feeling. It passes or fails nothing; the critique is done by opening the images.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, type Page } from 'playwright'

const label = process.argv[2] ?? 'before'
const only = process.argv.slice(3)
const TABS = [
  'team',
  'behaviour',
  'requests',
  'memory',
  'connections',
  'channels',
  'appearance',
  'models',
  'help',
]
const VIEWPORTS = [
  { name: 'wide', width: 1680, height: 1000, touch: false },
  { name: 'laptop', width: 1280, height: 800, touch: false },
  { name: 'tablet', width: 820, height: 1100, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true },
]
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  try {
    const body = await readFile(
      join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, '')),
    )
    res.writeHead(200, {
      'content-type':
        TYPES[extname(path) === '' ? '.html' : extname(path)] ?? 'application/octet-stream',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4797, '127.0.0.1', () => r()))

const out = `.out/settings-${label}`
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const errors: string[] = []
const sizes: Record<string, string[]> = {}

const UNCLIP = `
  #settings.page { position: static !important; height: auto !important; overflow: visible !important; }
  #settings .stg { height: auto !important; display: block !important; }
  #settings .stg-body { display: grid !important; height: auto !important; }
  #settings .stg-main, #settings .stg-nav { overflow: visible !important; height: auto !important; }
  html, body, #root { overflow: visible !important; height: auto !important; }
  #root { display: none !important; }
`

const open = async (page: Page, tab: string, phone: boolean) => {
  await page.locator('[data-bc-settings]').first().click({ force: true })
  await page.waitForSelector('#settings .stg-navitem', { timeout: 15000 })
  if (phone) {
    // a phone opens at the list of sections; capture it, then drill in
    await page.locator(`#settings [data-setting="${tab}"]`).click({ force: true })
  } else {
    await page.locator(`#settings [data-setting="${tab}"]`).click({ force: true })
  }
  await page.waitForTimeout(500)
}

for (const vp of VIEWPORTS) {
  const phone = vp.name === 'phone'
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: phone,
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${vp.name}: ${String(e.message).slice(0, 160)}`))
  await page.goto('http://127.0.0.1:4797/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-settings]', { timeout: 30000 })
  await page.waitForTimeout(1500)
  if (phone && (only.length === 0 || only.includes('index'))) {
    await page.locator('[data-bc-settings]').first().click({ force: true })
    await page.waitForSelector('#settings .stg-navitem', { timeout: 15000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/${vp.name}-index.png` })
    await page.locator('#settings [data-stg-back]').click({ force: true })
  }
  for (const tab of TABS.filter((t) => only.length === 0 || only.includes(t))) {
    await open(page, tab, phone)
    const m = (await page.evaluate(`(() => {
      const root = document.querySelector('#settings')
      const main = root.querySelector('.stg-main')
      const wide = Math.max(main ? main.scrollWidth - main.clientWidth : 0, document.documentElement.scrollWidth - window.innerWidth)
      const rows = []
      for (const el of root.querySelectorAll('button, input, select, textarea, a.st-btn')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        rows.push((el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '')) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + getComputedStyle(el).fontSize)
      }
      return { wide, rows }
    })()`)) as { wide: number; rows: string[] }
    if (m.wide > 1) errors.push(`${vp.name}/${tab}: scrolls sideways by ${m.wide}px`)
    sizes[`${vp.name}/${tab}`] = m.rows
    await page.screenshot({ path: `${out}/${vp.name}-${tab}.png` })
    const style = await page.addStyleTag({ content: UNCLIP })
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${out}/${vp.name}-${tab}-full.png`, fullPage: true })
    await style.evaluate((n) => {
      if (n instanceof Element) n.remove()
    })
    // leave settings so the next section opens from a known place
    await page.locator('#settings [data-stg-back]').click({ force: true })
    if (phone && (await page.locator('#settings').isVisible()))
      await page.locator('#settings [data-stg-back]').click({ force: true })
    await page.waitForTimeout(150)
  }
  await ctx.close()
}
writeFileSync(`${out}/sizes.json`, JSON.stringify(sizes, null, 1))
await browser.close()
server.close()
console.log(`captured to ${out}`)
for (const e of errors) console.log(`  ! ${e}`)
