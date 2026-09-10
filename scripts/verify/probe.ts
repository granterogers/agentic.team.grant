/**
 * Measure, rather than squint.
 *
 *   npx tsx scripts/verify/probe.ts '<selector>' ['<selector>' …]
 *
 * A capture shows that a layout is wrong. It does not say which box is the
 * wrong size, and reading the CSS back to yourself is how you convince
 * yourself it is right twice in a row. This drives the same page the capture
 * script does, opens a project's Team tab, and prints the computed box of
 * whatever you ask for.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4611
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

const tab = process.env.TAB ?? 'team'
const selectors = process.argv.slice(2)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => {
  console.error(`THREW: ${e.message}`)
})
await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('.project[data-open="legacy-coaching-course"]').click()
await page.waitForTimeout(700)
await page.locator(`[role="tab"][data-tab="${tab}"]`).click()
await page.waitForTimeout(700)

/*
  The measuring function is passed as a STRING, not a closure.

  `tsconfig` here has no `dom` lib — this is a Node project — so a closure
  referencing `document` fails to typecheck even though it only ever runs in the
  browser. `scripts/verify/studio.ts` already takes the string form for its
  overflow check, and matching it keeps one convention rather than adding a
  `lib` entry that would let real DOM mistakes past `tsc` everywhere else.
*/
const MEASURE = (sel: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (el === null) return ${JSON.stringify(sel)} + ' — MISSING'
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return ${JSON.stringify(sel)} + ' — ' + Math.round(r.width) + '×' + Math.round(r.height)
    + ' at ' + Math.round(r.x) + ',' + Math.round(r.y)
    + '  display:' + cs.display + ' position:' + cs.position + ' overflow:' + cs.overflow
})()`

for (const sel of selectors) {
  console.log(await page.evaluate(MEASURE(sel)))
}

await browser.close()
server.close()
