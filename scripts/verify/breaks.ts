/**
 * Does the studio admit when it breaks?
 *
 *   npm run verify:breaks
 *
 * #218. Grant reported the studio entering a crashed state during ordinary
 * navigation. Three laps of every route with `pageerror` recorded threw
 * nothing, so the specific crash is not reproducible here - but the CLASS was
 * real and unguarded: `drawShell` assigns the markup and then wires sixty
 * handlers, so a throw partway through left a page that looked finished with
 * dead controls below the throw, and no route out but a reload the page never
 * suggested.
 *
 * `render` has a boundary now. This proves the boundary is not decorative, the
 * way section 11 of the UX QA standard asks: break it on purpose, watch it go
 * red, put it back, watch it go green.
 *
 * It EDITS `web/studio/app.js` and restores it in a `finally`. The synthetic
 * fault says so in its own message, and step 3 fails the run if the file did
 * not come back byte for byte. Nothing deliberately broken is ever committed.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const APP = 'web/studio/app.js'
const original = await readFile(APP, 'utf8')
const MARK = "function drawShell() {\n  const root = $('#root')"
if (!original.includes(MARK)) throw new Error('the shell painter moved; this proof is stale')

const ROOT = 'web/studio',
  PORT = 4637
const T: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}
const server = createServer(async (req, res) => {
  const p = (req.url ?? '/').split('?')[0] ?? '/'
  const f = join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''))
  try {
    const b = await readFile(f)
    res.writeHead(200, { 'content-type': T[extname(f)] ?? 'application/octet-stream' })
    res.end(b)
  } catch {
    res.writeHead(404)
    res.end('nope')
  }
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const run = async (label: string) => {
  const browser = await chromium.launch()
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage()
  await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  // The synthetic fault is on a project view, so open one.
  const card = page.locator('.project[data-open="legacy-coaching-course"]')
  if ((await card.count()) > 0) {
    await card.click()
    await page.waitForTimeout(700)
  }
  /*
    The measuring function is a STRING, for the reason `probe.ts` gives: this is
    a Node project with no `dom` lib, so a closure touching `document` fails to
    typecheck even though it only ever runs in the browser.
  */
  const seen = (await page.evaluate(`(() => ({
    broke: document.querySelectorAll('.broke').length,
    rail: document.querySelectorAll('.rail').length,
    home: [...document.querySelectorAll('.broke button')].map((b) => (b.textContent || '').trim()),
    why: (document.querySelector('.brokewhy') || {}).textContent
      ? document.querySelector('.brokewhy').textContent.slice(0, 60) : '',
  }))()`)) as { broke: number; rail: number; home: string[]; why: string }
  console.log(label.padEnd(26), JSON.stringify(seen))
  // And the way out has to work.
  if (seen.broke > 0) {
    await page.locator('.broke button').first().click()
    await page.waitForTimeout(600)
    const after = await page.evaluate(`(() => ({
      broke: document.querySelectorAll('.broke').length,
      rail: document.querySelectorAll('.rail').length,
      cards: document.querySelectorAll('.project').length,
    }))()`)
    console.log('  recovered ->'.padEnd(26), JSON.stringify(after))
  }
  await browser.close()
  return seen
}

try {
  const before = await run('1 healthy')
  if (before.broke !== 0) throw new Error('the page was already in the failure state')

  await writeFile(
    APP,
    original.replace(
      MARK,
      `${MARK}\n  if (state.view === 'project') throw new Error('SYNTHETIC #218 PROOF — not a real defect')`,
    ),
  )
  const during = await run('2 synthetic throw')
  if (during.broke !== 1) throw new Error('THE GUARD DID NOT CATCH — the boundary is decorative')
  if (during.rail !== 0) throw new Error('the failure state left the dead shell on screen')
} finally {
  await writeFile(APP, original)
}
const after = await run('3 restored')
if (after.broke !== 0 || after.rail !== 1) throw new Error('the file was not restored cleanly')
if (original !== (await readFile(APP, 'utf8'))) throw new Error('app.js was not restored')
console.log('verify:breaks passed — healthy, caught, recovered, restored')
server.close()
