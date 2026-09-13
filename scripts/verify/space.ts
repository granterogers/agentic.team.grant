/**
 * Where the pixels actually go.
 *
 * Issue #85 asks for *"less decoration, less clutter"* and says, twice,
 * measure rather than squint. `npm run probe` prints one box at a time, which
 * is right when you already suspect an element; #85 is the opposite shape —
 * the question is which of forty boxes is spending the room, and reading the
 * stylesheet is how you convince yourself it is fine twice in a row.
 *
 * So this walks the real page and reports the ratios that decide the answer:
 *
 *   - how much of a panel is its header, per panel, on every tab;
 *   - whether the #108 fade is actually ON, per panel — the classes are
 *     toggled by `markPanelScroll`, and a fade whose class never lands looks
 *     identical to a fade that was never written;
 *   - the tallest run of empty page below the last content, and the empty run
 *     in the rail, which is what makes a screen feel sparse and cramped at the
 *     same time.
 *
 * Reporting only. It fails nothing — #85 is a critique pass, and a threshold
 * invented here would be a number nobody agreed to.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4614
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

/*
  Passed as a STRING for the same reason probe.ts does it: this project's
  tsconfig has no `dom` lib, so a closure touching `document` cannot typecheck
  even though it only ever runs in the browser.
*/
const PANELS = `(() => {
  const out = []
  for (const panel of document.querySelectorAll('.panel')) {
    const head = panel.querySelector(':scope > header')
    const wrap = panel.querySelector(':scope > .pbodywrap')
    if (head === null || wrap === null) continue
    const pr = panel.getBoundingClientRect()
    const hr = head.getBoundingClientRect()
    out.push({
      name: (head.textContent || '').trim().split('\\n')[0].slice(0, 28),
      panel: Math.round(pr.height),
      header: Math.round(hr.height),
      share: Math.round((hr.height / Math.max(1, pr.height)) * 100),
      below: Math.round(wrap.scrollHeight - wrap.clientHeight - wrap.scrollTop),
      clipped: wrap.scrollHeight - wrap.clientHeight > 4,
      more: panel.classList.contains('more'),
      above: panel.classList.contains('above'),
      fade: getComputedStyle(panel, '::after').opacity,
    })
  }
  return out
})()`

const EMPTY = `(() => {
  // The lowest painted pixel inside a container, ignoring the container's own
  // box. A container that is 900 tall whose deepest child ends at 500 is 400
  // of nothing, however the padding is written.
  const deepest = (root) => {
    let low = root.getBoundingClientRect().top
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.height === 0 || r.width === 0) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      if (r.bottom > low) low = r.bottom
    }
    return low
  }
  const measure = (sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { sel, height: Math.round(r.height), used: Math.round(deepest(el) - r.top),
             empty: Math.round(r.bottom - deepest(el)) }
  }
  return [measure('.rail'), measure('.main'), measure('.tabbody')].filter((x) => x !== null)
})()`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => {
  console.error(`THREW: ${e.message}`)
})
await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

console.log('\n─── portfolio ───')
for (const row of (await page.evaluate(EMPTY)) as {
  sel: string
  height: number
  used: number
  empty: number
}[]) {
  console.log(
    `  ${row.sel.padEnd(10)} ${String(row.height).padStart(5)}px tall · ${String(row.used).padStart(5)}px used · ${String(row.empty).padStart(5)}px empty`,
  )
}

await page.locator('.project[data-open="legacy-coaching-course"]').click()
await page.waitForTimeout(700)

for (const tab of ['overview', 'work', 'sources', 'team']) {
  const t = page.locator(`[data-tab="${tab}"]`)
  if ((await t.count()) === 0) continue
  await t.first().click()
  await page.waitForTimeout(600)
  console.log(`\n─── ${tab} ───`)
  for (const row of (await page.evaluate(EMPTY)) as {
    sel: string
    height: number
    used: number
    empty: number
  }[]) {
    console.log(
      `  ${row.sel.padEnd(10)} ${String(row.height).padStart(5)}px tall · ${String(row.used).padStart(5)}px used · ${String(row.empty).padStart(5)}px empty`,
    )
  }
  const panels = (await page.evaluate(PANELS)) as {
    name: string
    panel: number
    header: number
    share: number
    below: number
    clipped: boolean
    more: boolean
    above: boolean
    fade: string
  }[]
  for (const p of panels) {
    const says = p.clipped ? (p.more ? `fade on (opacity ${p.fade})` : 'CLIPPED, NO FADE') : '—'
    console.log(
      `  panel ${p.name.padEnd(28)} ${String(p.panel).padStart(4)}px · header ${String(p.header).padStart(3)}px (${String(p.share).padStart(2)}%) · ${String(p.below).padStart(4)}px below · ${says}`,
    )
  }
}

/*
  The phone, which is the harder half of #85.

  A desktop screen that spends 53px on a panel header is wasteful. A phone
  screen that spends its ENTIRE first viewport on chrome before one line of
  project content is a different complaint — the person has scrolled past
  everything the page says about itself and still not reached the project.

  So this asks one question and answers it in pixels: from the top of the
  scrolling page, how far down is the first piece of actual content, and what
  is stacked above it. `first` is the first element inside the board or the tab
  body that carries real words; everything above it is furniture by definition.
*/
const FURNITURE = `(() => {
  const doc = document.scrollingElement
  const top = doc.scrollTop
  const vh = window.innerHeight
  const first = document.querySelector('.panel > .pbodywrap > *, .tabbody .card, .tabbody li')
  const y = first === null ? null : Math.round(first.getBoundingClientRect().top + top)
  const above = []
  for (const sel of ['.phero', '.projhead', '.pbanner', '.tabhead', '.tabhead .t-lead',
                     '.headctl', '.tabs', '.topbar', '.phonebar', '.panel > header']) {
    const el = document.querySelector(sel)
    if (el === null) continue
    const r = el.getBoundingClientRect()
    if (r.height === 0) continue
    above.push({ sel, height: Math.round(r.height), y: Math.round(r.top + top) })
  }
  return { viewport: vh, firstContentAt: y,
           screensOfFurniture: y === null ? null : Math.round((y / vh) * 100) / 100,
           above: above.filter((a) => y === null || a.y < y) }
})()`

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})
const pp = await phone.newPage()
await pp.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
await pp.waitForTimeout(700)
await pp.locator('.project[data-open="legacy-coaching-course"]').first().click()
await pp.waitForTimeout(900)

const f = (await pp.evaluate(FURNITURE)) as {
  viewport: number
  firstContentAt: number | null
  screensOfFurniture: number | null
  above: { sel: string; height: number; y: number }[]
}
console.log('\n─── phone, project overview ───')
console.log(`  viewport ${String(f.viewport)}px`)
console.log(
  `  first content pixel at ${String(f.firstContentAt)}px — ${String(f.screensOfFurniture)} screens of furniture above it`,
)
for (const a of f.above) {
  console.log(`    ${a.sel.padEnd(22)} ${String(a.height).padStart(4)}px at y=${String(a.y)}`)
}

await browser.close()
await phone.close()
server.close()
