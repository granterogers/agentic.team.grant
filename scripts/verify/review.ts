/*
 * The review bundle works on a host with NO rewrite rules.
 *
 * Served from a bare static server under a sub-path, which is the least
 * forgiving shape a bundle can be given: no /basecamp rewrite, no root, and no
 * knowledge of the app's routes. If it survives that, it survives a host.
 *
 * Every check is a property of the bundle rather than of a selector, because
 * the point is "does it work somewhere else", not "does it look the same".
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const ROOT = '.out/review'
const BASE = '/review-copy'
const PORT = 4675

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/*
  DELIBERATELY DUMB. No SPA fallback, no index resolution beyond a bare
  directory, no rewrites - because that is the thing being proved. A server
  that quietly serves index.html for a missing path would hide exactly the
  failure this check exists to catch.
*/
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  let p = decodeURIComponent(url.pathname)
  if (!p.startsWith(BASE)) {
    res.writeHead(404).end('not found')
    return
  }
  p = p.slice(BASE.length)
  if (p === '' || p === '/') p = '/index.html'
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''))
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
await new Promise<void>((ok) => {
  server.listen(PORT, '127.0.0.1', ok)
})
const url = (h = ''): string => `http://127.0.0.1:${String(PORT)}${BASE}/${h}`

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
const page = await ctx.newPage()
const thrown: string[] = []
const missing: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})
page.on('response', (r) => {
  if (r.status() === 404) missing.push(r.url().slice(-60))
})

/* --- it boots at the bundle root, with no path routing at all --- */
await page.goto(url(), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check(
  'the bundle boots from a sub-path with no rewrite rules',
  (await page.locator('#root').count()) === 1,
)
check('every asset it asks for is in the bundle', missing.length === 0, missing.join(' | '))
check('nothing was thrown on boot', thrown.length === 0, thrown.join(' | '))
check(
  'it opens ON the experimental experience rather than the default one',
  (await page.locator('[data-experience="basecamp"]').count()) === 1,
)
check(
  'and says it is a review copy',
  (await page.locator('body').innerText()).includes('Review copy'),
)

/*
  A FRAGMENT THE HOST OWNS IS NOT A ROUTE.

  The artifact host puts its own fragment on the page. The first version read
  whatever it found in the hash, so `#artifact-abc` matched no route and fell
  through to the DEFAULT studio - the review build opened on today's Team HQ,
  which is what Grant saw and reported. This is the check that would have
  caught it, and it is the reason the guard is a shape rather than a list.
*/
for (const foreign of ['#artifact-abc', '#section-2', '#']) {
  await page.goto(url(foreign), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  check(
    `a fragment the host owns (${foreign}) still opens the experiment`,
    (await page.locator('[data-experience="basecamp"]').count()) === 1,
    `it opened "${(
      await page
        .locator('h1')
        .first()
        .innerText()
        .catch(() => '?')
    ).slice(0, 40)}"`,
  )
}

/* --- it opens on the screen it exists to show --- */
await page.goto(url(), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check(
  'it opens ON the redesigned project home, not one click away',
  (await page.locator('.bcpanes').count()) === 1,
  `it opened "${(
    await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => '?')
  ).slice(0, 40)}"`,
)

/* --- the address is in the hash, and survives a reload --- */
await page.goto(url('#/basecamp'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.waitForSelector('[data-bc-go^="/basecamp/p/"]', { timeout: 8000 })
await page.locator('[data-bc-go^="/basecamp/p/"]').first().click()
await page.waitForTimeout(700)
const hash = (await page.evaluate('location.hash')) as string
const path = (await page.evaluate('location.pathname')) as string
check(
  'opening a project writes the address into the hash',
  hash.startsWith('#/basecamp/p/'),
  `hash "${hash}"`,
)
check('and leaves the page address alone', path === `${BASE}/`, `path "${path}"`)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check(
  'RELOADING A PROJECT ADDRESS COMES BACK TO THAT PROJECT',
  (await page.locator('.bcpanes').count()) === 1,
  'a reload landed somewhere else — which is the whole failure a path address has on a static host',
)

/* --- the parts a bundle most easily breaks --- */
await page.waitForSelector('.bcthumb', { timeout: 8000 })
await page.waitForSelector('.bcthumb .realpage', { timeout: 10_000 }).catch(() => null)
check(
  'the real document pages still render from inside the bundle',
  (await page.locator('.bcthumb .realpage').count()) >= 1,
  'pdf.js or the sample files did not travel',
)

const before = (await page.evaluate('location.hash')) as string
await page.locator('.bcmodhead h2 a').first().click()
await page.waitForTimeout(600)
check(
  'moving between tools works without a server',
  ((await page.evaluate('location.hash')) as string) !== before,
)
await page.goBack()
await page.waitForTimeout(600)
check('and Back comes back', ((await page.evaluate('location.hash')) as string) === before)

check('nothing was thrown while using it', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
if (fail > 0) process.exit(1)
