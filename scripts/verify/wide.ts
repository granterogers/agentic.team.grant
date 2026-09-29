/**
 * Find what is actually wider than the phone.
 *
 *   npx tsx scripts/verify/wide.ts
 *
 * `scripts/verify/studio.ts` reports "OVERFLOWS sideways" and stops there,
 * which leaves you guessing at every element on the page. This walks the tree
 * and prints the elements whose right edge is past the viewport, innermost
 * first — the innermost one is almost always the cause and the rest are its
 * ancestors carrying it.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4612
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.mjs': 'text/javascript; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
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

const FIND = `(() => {
  const w = document.documentElement.clientWidth
  const sw = document.documentElement.scrollWidth
  const out = []
  for (const el of document.querySelectorAll('*')) {
    // SVG children report their geometry ignoring the viewport that clips
    // them, and a horizontally scrollable container is overflowing on purpose.
    // Both are noise here; what matters is what pushes the DOCUMENT wider.
    if (el.ownerSVGElement !== null && el.ownerSVGElement !== undefined) continue
    let clipped = false
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll' || o === 'hidden') { clipped = true; break }
      if (getComputedStyle(p).position === 'fixed') { clipped = true; break }
    }
    if (clipped) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right <= w + 1 && r.left >= -1) continue
    const id = el.tagName.toLowerCase()
      + (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\\s+/).join('.') : '')
    out.push({ id, depth: (() => { let d = 0, p = el; while ((p = p.parentElement)) d++; return d })(),
               left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) })
  }
  out.sort((a, b) => b.depth - a.depth)
  return 'viewport ' + w + 'px, document ' + sw + 'px\\n' + out.slice(0, 14).map((o) => o.depth + '  ' + o.id + '  ' + o.width + 'px  ' + o.left + '→' + o.right).join('\\n')
    || 'nothing overflows (viewport ' + w + 'px, document ' + sw + 'px)'
})()`

const browser = await chromium.launch()
for (const tab of ['overview', 'team', 'documents', 'tasks', 'contacts', 'sources', 'settings']) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'] })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  console.log(`\n--- portfolio`)
  if (tab === 'overview') console.log(await page.evaluate(FIND))
  await page.locator('.project[data-open="legacy-coaching-course"]').click()
  await page.waitForTimeout(600)
  await page.locator(`[data-tab="${tab}"]`).click()
  await page.waitForTimeout(600)
  console.log(`--- project · ${tab}`)
  console.log(await page.evaluate(FIND))
  await ctx.close()
}
await browser.close()
server.close()
