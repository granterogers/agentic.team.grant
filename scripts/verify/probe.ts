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

/*
  PHONE=1 measures a real phone, not a narrow desktop.

  Section 25 of the UX QA standard: *"Width does not equal touch."* A 390px
  viewport with a mouse gets the desktop's hover rules and the desktop's touch
  targets, and this repository has already read 50x29 off a control that is
  58x52 in a real touch context. `hasTouch` and `isMobile` are what make the
  coarse-pointer media queries apply, so a measurement taken without them
  describes a device nobody owns.
*/
const phone = process.env.PHONE === '1'
const browser = await chromium.launch()
const ctx = await browser.newContext(
  phone
    ? {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' +
          ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      }
    : { viewport: { width: 1440, height: 900 } },
)
const page = await ctx.newPage()
page.on('pageerror', (e) => {
  console.error(`THREW: ${e.message}`)
})
await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('.project[data-open="legacy-coaching-course"]').click()
await page.waitForTimeout(700)
await page.locator(`[data-tab="${tab}"]`).click()
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

/* KIDS: every child of a container, so you can see who is eating the row. */
const KIDS = (sel: string) => `(() => {
  const p = document.querySelector(${JSON.stringify(sel)})
  if (p === null) return ${JSON.stringify(sel)} + ' — MISSING'
  return [...p.children].map((el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return '   ' + el.tagName.toLowerCase() + '.' + (el.className || '(none)')
      + \`  \${Math.round(r.width)}×\${Math.round(r.height)} at \${Math.round(r.x)}\`
      + \`  flex:\${cs.flex} pos:\${cs.position} y:\${Math.round(r.y)} disp:\${cs.display}\`
  }).join(String.fromCharCode(10))
})()`

for (const sel of selectors) {
  if (sel.endsWith(' >')) {
    console.log(`${sel.slice(0, -2)} children:`)
    console.log(await page.evaluate(KIDS(sel.slice(0, -2))))
  } else console.log(await page.evaluate(MEASURE(sel)))
}

await browser.close()
server.close()
