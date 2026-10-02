/**
 * Functional and accessibility checks for Global Settings, against local files only (no call to the office).
 *   npx tsx scripts/p5/settings-qa.ts
 * Per section, on a desktop and a phone profile: no sideways scroll, no console error, no visible "Basecamp",
 * every control at least 40px (44px on touch), every text run at least 12px and 4.5:1 against the surface behind it
 * (3:1 at 18px+), a labelled accessible name on every control. Then three interactions: the accent swatch changes the
 * real accent token and survives a reload, Tab reaches the first control from the section list, and Back closes it.
 * Prints findings and exits 1 if any.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, type Page } from 'playwright'

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
await new Promise<void>((r) => server.listen(4798, '127.0.0.1', () => r()))

const problems: string[] = []
const note = (m: string) => problems.push(m)

const AUDIT = `(() => {
  const root = document.querySelector('#settings')
  const out = { control: [], text: [], name: [], basecamp: /basecamp/i.test(root.innerText) }
  const parse = (c) => { const m = c.match(/[\\d.]+/g) || []; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] } }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const surface = (el) => {
    let layers = []
    for (let n = el; n; n = n.parentElement) {
      if (getComputedStyle(n).backgroundImage !== 'none') return null
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c.a > 0) { layers.push(c); if (c.a >= 1) break }
    }
    let base = { r: 10, g: 20, b: 25, a: 1 }
    for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a), a: 1 }
    return base
  }
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const seen = new Set()
  for (const el of root.querySelectorAll('button, input, select, textarea, a[href], summary')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || el.closest('[hidden]')) continue
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || '').trim()
    if (!label && el.getAttribute('aria-labelledby') === null) out.name.push(el.tagName + '.' + String(el.className).split(' ')[0])
    out.control.push({ n: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' ' + label.slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) })
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const t = walker.currentNode
    const txt = (t.textContent || '').trim()
    const el = t.parentElement
    if (!txt || !el || el.closest('[hidden]') || el.closest('script,style')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue
    const fg = parse(cs.color)
    // an initial is a fallback drawn under a portrait and over a tint chosen per person; judged by eye in the capture
    if (el.closest('.face')) continue
    const bg = surface(el)
    const size = parseFloat(cs.fontSize)
    if (bg === null) {
      // painted over an image or gradient: size can still be judged, contrast cannot
      if (size < 12) out.text.push('small ' + size + 'px: ' + txt.slice(0, 40))
      continue
    }
    const bold = +cs.fontWeight >= 700
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
    const disabled = el.closest('[disabled],[aria-disabled="true"]') !== null
    const eff = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 }
    const rt = ratio(eff, bg)
    const key = txt.slice(0, 30) + size
    if (seen.has(key)) continue
    seen.add(key)
    if (size < 12) out.text.push('small ' + size + 'px: ' + txt.slice(0, 40))
    else if (!disabled && rt < need) out.text.push(rt.toFixed(2) + ':1 need ' + need + ' ' + size + 'px: ' + txt.slice(0, 40))
  }
  out.wide = Math.max(document.documentElement.scrollWidth - innerWidth, 0)
  return out
})()`

const open = async (page: Page, tab: string) => {
  await page.locator('[data-bc-settings]').first().click({ force: true })
  await page.waitForSelector('#settings .stg-navitem', { timeout: 15000 })
  await page.locator(`#settings [data-setting="${tab}"]`).click({ force: true })
  await page.waitForTimeout(400)
}
// Settings redraws itself when a section finishes loading, which can replace the button mid-press; press again
// and say so, rather than swallowing the reason.
const back = async (page: Page) => {
  for (let i = 0; i < 4; i++) {
    try {
      await page.locator('#settings [data-stg-back]:visible').first().click({ timeout: 4000 })
      return
    } catch (e) {
      note(`(retry ${i + 1}) pressing Back: ${String((e as Error).message).split('\n')[0]}`)
      await page.waitForTimeout(300)
    }
  }
}
const leave = async (page: Page) => {
  await back(page)
  await page.waitForTimeout(250)
  if (await page.locator('#settings').isVisible()) await back(page)
  await page.waitForTimeout(250)
}

const browser = await chromium.launch()
for (const vp of [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => note(`${vp.name}: page error ${e.message.slice(0, 120)}`))
  await page.goto('http://127.0.0.1:4798/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-settings]', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const floor = vp.touch ? 44 : 40
  for (const tab of TABS) {
    await open(page, tab)
    const r = (await page.evaluate(AUDIT)) as {
      control: { n: string; w: number; h: number }[]
      text: string[]
      name: string[]
      basecamp: boolean
      wide: number
    }
    if (r.wide > 1) note(`${vp.name}/${tab}: scrolls sideways by ${r.wide}px`)
    if (r.basecamp) note(`${vp.name}/${tab}: the word Basecamp is visible`)
    for (const n of r.name) note(`${vp.name}/${tab}: control with no accessible name: ${n}`)
    for (const c of r.control.filter((x) => x.h < floor && !/switch|swatch|dot/.test(x.n)))
      note(`${vp.name}/${tab}: ${c.n} is ${c.w}x${c.h}, under ${floor}px tall`)
    for (const t of r.text) note(`${vp.name}/${tab}: ${t}`)
    await leave(page)
  }

  // the accent swatch writes the real token and keeps it across a reload
  await open(page, 'appearance')
  const before = await page.evaluate(
    `getComputedStyle(document.documentElement).getPropertyValue('--bc-accent').trim()`,
  )
  await page.locator('#settings [data-palette-pick="clay"]').click({ force: true })
  await page.waitForTimeout(300)
  const after = (await page.evaluate(
    `getComputedStyle(document.querySelector('[data-experience]') || document.documentElement).getPropertyValue('--bc-accent').trim()`,
  )) as string
  if (after === before || after === '')
    note(`${vp.name}: choosing Coral did not change the accent (${before} -> ${after})`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-settings]', { timeout: 30000 })
  await page.waitForTimeout(1000)
  const kept = (await page.evaluate(
    `getComputedStyle(document.querySelector('[data-experience]') || document.documentElement).getPropertyValue('--bc-accent').trim()`,
  )) as string
  if (kept !== after) note(`${vp.name}: the accent did not survive a reload (${after} -> ${kept})`)
  await page.evaluate(`localStorage.clear()`)

  // keyboard: Tab from the section list reaches a control inside the section, Back closes
  await open(page, 'team')
  await page.locator('#settings [data-setting="team"]').focus()
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const inMain = await page.evaluate(`!!document.activeElement?.closest('#settings .stg-main')`)
    // body is the edge of the document (focus passing to the browser's own controls), not the page behind
    if (
      await page.evaluate(
        `document.activeElement !== document.body && !document.activeElement?.closest('#settings')`,
      )
    ) {
      note(`${vp.name}: Tab left Settings for the page hidden behind it`)
      break
    }
    if (inMain) break
    if (i === 39) note(`${vp.name}: Tab never reached the section content`)
  }
  await leave(page)
  if (await page.locator('#settings').isVisible()) note(`${vp.name}: Back did not close Settings`)
  await ctx.close()
}
await browser.close()
server.close()

if (problems.length === 0) {
  console.log('settings-qa: no findings')
} else {
  console.log(`settings-qa: ${problems.length} finding(s)`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exitCode = 1
}
