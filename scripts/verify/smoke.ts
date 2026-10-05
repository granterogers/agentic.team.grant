/**
 * Does the page render at all?
 *
 *   npm run smoke
 *
 * A single stray line of markup left in a JavaScript file makes the whole
 * module fail to parse, and a module that fails to parse renders NOTHING. That
 * happened while splitting Settings into tabs, and the way it announced itself
 * was a capture run timing out after ten minutes on a selector that could not
 * exist — with the actual cause, `Unexpected token '<'`, nowhere in the output.
 *
 * This asks the only question that matters first: did the shell render, and did
 * anything throw? It takes about three seconds. Run it before `npm run shots`,
 * always.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4613
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

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const thrown: string[] = []
page.on('pageerror', (e) => thrown.push(e.message))

await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

/*
  Every route, because a view that throws only throws once you reach it. The
  Settings tabs are included: five of the six did not exist an hour ago, and a
  renderer that references an undefined helper is silent until it is called.
*/
const steps: [string, string][] = [
  ['rail', '.rail'],
  ['portfolio', '.project'],
]
const failures: string[] = []

/*
  The #218 boundary catches a render throw, which means `pageerror` no longer
  sees one.

  That is the boundary working, and it made this suite worse at its own job: a
  panel renderer that threw used to surface here as an uncaught error, and now
  it surfaces as a tidy apology screen and a selector that does not resolve
  thirty seconds later. The first time it happened the message was "waiting for
  locator('.project[data-open=...]')", four steps from the cause.

  So the failure state is checked for explicitly, everywhere, and it prints the
  message the boundary captured - which names the real fault in one line.
*/
const notBroken = async (where: string): Promise<void> => {
  const broke = await page.locator('.broke').count()
  if (broke === 0) return
  const why = await page.locator('.brokewhy').first().textContent()
  failures.push(`${where}: the studio drew its failure state — ${String(why ?? '').trim()}`)
}

await notBroken('first paint')
/*
  Stop here if the shell did not draw. Everything below clicks something, and a
  click against a page that is not there times out after thirty seconds and
  reports the selector rather than the reason.
*/
if (failures.length > 0) {
  console.error(`smoke FAILED\n  ${failures.join('\n  ')}`)
  await browser.close()
  server.close()
  process.exit(1)
}
for (const [what, sel] of steps) {
  const n = await page.locator(sel).count()
  if (n === 0) failures.push(`${what}: no ${sel}`)
}

await page.locator('.project[data-open="legacy-coaching-course"]').click()
await page.waitForTimeout(700)

// Activity is no longer a section (#222) - the panel on Overview replaced it.
for (const tab of ['overview', 'team', 'documents', 'tasks', 'contacts', 'sources', 'settings']) {
  await page.locator(`[data-tab="${tab}"]`).click()
  await page.waitForTimeout(250)
  if ((await page.locator('.tabbody').count()) === 0) failures.push(`section ${tab}: empty`)
  await notBroken(`section ${tab}`)
}

await page.locator('[data-settings]').first().click()
await page.waitForTimeout(400)
for (const tab of ['team', 'behaviour', 'connections', 'channels', 'models', 'appearance']) {
  await page.locator(`[data-setting="${tab}"]`).click()
  await page.waitForTimeout(250)
  if ((await page.locator('#settings .stg-col').count()) === 0)
    failures.push(`settings ${tab}: empty`)
}

await browser.close()
server.close()

for (const t of thrown) console.error(`THREW: ${t}`)
for (const f of failures) console.error(`EMPTY: ${f}`)

if (thrown.length > 0 || failures.length > 0) {
  console.error(
    `\nsmoke FAILED — ${String(thrown.length)} thrown, ${String(failures.length)} empty`,
  )
  process.exit(1)
}
console.log('smoke passed — every route renders, nothing thrown')
