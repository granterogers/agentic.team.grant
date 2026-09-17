/**
 * The studio can be linked to (#157).
 *
 *   npm run verify:routes
 *
 * Grant's third pick, and his reason: *"the one people notice ten times a day
 * without ever reporting it."*
 *
 * ## The server here mimics the host, deliberately
 *
 * `vercel.json` rewrites every extension-less path to `index.html`. A test
 * server that 404s those would prove nothing about the product and everything
 * about the test server — so this one does the same rewrite, and the ONE thing
 * it cannot prove is that the real rewrite is correct. `deploy:hq` fetches a
 * deep link after every deploy for exactly that half.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4648
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  // The rewrite, in one line, same rule as the host: anything without a dot in
  // it is the application, not a file.
  const wants = path === '/' || !path.includes('.') ? 'index.html' : path.replace(/^\//, '')
  try {
    const body = await readFile(join(ROOT, wants))
    res.writeHead(200, { 'content-type': TYPES[extname(wants)] ?? 'application/octet-stream' })
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

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))
const base = `http://127.0.0.1:${String(PORT)}`

console.log('#157 — the studio can be linked to\n')

// --- the address follows the screen ----------------------------------------
{
  await page.goto(`${base}/`)
  await page.waitForSelector('.rail', { timeout: 20_000 })
  await page.waitForTimeout(2200)
  check(
    'the portfolio is the root',
    new URL(page.url()).pathname,
    new URL(page.url()).pathname === '/',
  )

  await page.locator('.homego[data-open], .project[data-open]').first().click({ force: true })
  await page.waitForTimeout(1200)
  const onProject = new URL(page.url()).pathname
  check('opening a project puts it in the address', onProject, /^\/p\/[a-z0-9-]+$/.test(onProject))

  await page.locator('[data-tab="tasks"]').first().click({ force: true })
  await page.waitForTimeout(1000)
  const onTasks = new URL(page.url()).pathname
  check('and so does the tab', onTasks, onTasks.endsWith('/tasks'))
}

// --- and the screen follows the address -------------------------------------
{
  const deep = new URL(page.url()).pathname
  await page.goto(`${base}${deep}`)
  await page.waitForSelector('.rail', { timeout: 20_000 })
  await page.waitForTimeout(2400)
  const tab = await page.evaluate(
    `document.querySelector('[data-tab][aria-current="page"], [data-tab].on')?.getAttribute('data-tab') ?? ''`,
  )
  check(
    'a bookmarked tab opens on that tab, not on the portfolio',
    `${deep} opened ${String(tab) || '(nothing)'}`,
    String(tab) === 'tasks',
  )
}

// --- Back stays inside the studio -------------------------------------------
{
  await page.goto(`${base}/`)
  await page.waitForSelector('.rail')
  await page.waitForTimeout(2200)
  await page.locator('.homego[data-open], .project[data-open]').first().click({ force: true })
  await page.waitForTimeout(1200)
  await page.locator('[data-tab="documents"]').first().click({ force: true })
  await page.waitForTimeout(1000)
  const before = new URL(page.url()).pathname
  await page.goBack()
  await page.waitForTimeout(1200)
  const after = new URL(page.url()).pathname
  check(
    'Back moves within the studio rather than leaving it',
    `${before} then ${after}`,
    after !== before && (await page.locator('.rail').count()) > 0,
  )
  /*
    The SHELL, not a guess at what the previous screen contains.

    A first draft looked for the map, the board or the gallery — and Back landed
    on Tasks, which has none of the three. It reported that the studio was gone
    from a screen the studio was plainly drawing. "Still the studio" means the
    rail and the main region are there.
  */
  const shell = await page.locator('.rail').count()
  const main = await page.locator('.main, main').count()
  check(
    'and it is still the studio on the screen',
    `rail ${String(shell)}, main ${String(main)}`,
    shell > 0 && main > 0,
  )
}

// --- a link that has outlived its project -----------------------------------
{
  /*
    A project can be archived, and a bookmark to it must not look like a broken
    product. The issue says so: an unknown route lands on the portfolio.
  */
  await page.goto(`${base}/p/a-project-that-never-existed/tasks`)
  await page.waitForSelector('.rail', { timeout: 20_000 })
  await page.waitForTimeout(2400)
  const home = await page.locator('.homerow, .homego, .board').count()
  check(
    'a link to a project that is gone lands on the portfolio, not on nothing',
    home > 0 ? 'the home board' : 'A BLANK PAGE',
    home > 0,
  )
  check(
    'and nothing threw on the way',
    errors.length === 0 ? 'none' : errors.slice(0, 2).join(' · '),
    errors.length === 0,
  )
}

await browser.close()
server.close()
const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)
