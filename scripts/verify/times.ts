/**
 * A time on the page stays true while the page is open.
 *
 *   npm run verify:times
 *
 * Issue #153. The words themselves are pinned by `tests/studio/when.test.ts`,
 * which walks every boundary in a millisecond. This is the other risk, and the
 * one a unit test cannot see: **whether the re-render is actually wired**.
 *
 * `when.js` could be perfect and `pulse.js` could never call it, and every
 * capture, every layout check and every unit test would pass — because a page
 * that renders the right words once looks identical to a page that renders them
 * for ever. The only way to tell is to leave a real browser open, move time
 * forward, and read the same element again.
 *
 * ## How the clock is moved
 *
 * `Date.now` is shifted by a skew the test controls, installed before any of
 * the page's own script runs. Not Playwright's clock API: that also freezes
 * `setInterval`, and `pulse`'s twenty-second timer firing is precisely the
 * thing under test. So real time passes at its real speed and only the ANSWER
 * to "what time is it" moves — which is exactly the situation being simulated,
 * a page that has been open for two hours.
 *
 * The suite therefore takes about half a minute, and waiting is the assertion.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const PORT = 4625
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

const studio = (
  (await db.execute('select app.hq_studio(app.sole_person_office()) as d')).rows[0] as {
    d: { projects: { slug: string; layout: unknown; activity: unknown; contacts: unknown }[] }
  }
).d
const subject = studio.projects[0]
if (subject === undefined) {
  console.error('the office has no active dashboard project')
  process.exit(2)
}

/*
  One activity row, thirty seconds old, and the layout forced to show only the
  activity panel.

  Thirty seconds because it is the far side of no boundary: it reads "just now",
  and every later reading in this suite crosses a different unit. A row planted
  at, say, 59 minutes would flip to "1 hour ago" from the passage of real time
  alone, and the check would pass without the skew doing anything.
*/
const PLANTED = new Date(Date.now() - 30_000).toISOString()
subject.activity = [
  { who: 'claire', verb: 'planted', what: 'a time', when: 'never', at: PLANTED, detail: null },
]
subject.layout = [{ id: 'activity', x: 0, y: 0, w: 3, h: 320 }]

const server = createServer(async (request, response) => {
  let file = join('web/studio', decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  // A dotless path is a route, as on the host (#382: the older studio is under /classic).
  if (!existsSync(file) && extname(file) === '') file = join('web/studio', 'index.html')
  if (!existsSync(file)) {
    response.writeHead(404)
    response.end('not here')
    return
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  response.end(await readFile(file))
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const crashes: string[] = []
page.on('pageerror', (e) => crashes.push(e.message.slice(0, 140)))

// The page has to know which office it belongs to before its first line

// runs, or the shim below never sees a URL with hq-api in it. ADR-0048.

await page.addInitScript(namesAnOffice())

await page.addInitScript(`
  // The clock the page sees. Real time still passes at its real speed — only
  // the answer to "what time is it" moves — so pulse's own interval, which is
  // the thing under test, keeps firing normally.
  window.__SKEW = 0;
  const RealDate = Date;
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + (window.__SKEW || 0);
  window.Date = new Proxy(RealDate, {
    construct: (t, a) => (a.length === 0 ? new t(Date.now()) : new t(...a)),
  });

  window.__SECTIONS = ${JSON.stringify({ studio })};
  try { localStorage.setItem('hq.token', 'verify-times'); } catch (e) {}
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('hq-api')) {
      const section = /section=([a-z_]+)/.exec(url);
      if (section) {
        return new Response(JSON.stringify({ data: window.__SECTIONS[section[1]] ?? {} }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ result: { ok: true } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
`)

console.log('\nverify:times\n')

await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2_000)
await page.evaluate(`document.querySelector('[data-open]')?.click()`)
await page.waitForTimeout(1_500)
/*
  And ASK for the panels, because the Overview has not been the board since #25
  made it the project map — and on a phone it is the panels again since #278.
  The planted activity row lives in an `activity` PANEL, so without this the
  suite read a map, found no `time` element, and reported the relative-time
  machinery missing. Five of its six checks were red against a feature that
  works, and nothing noticed because this suite is not in the gate: CLAUDE.md,
  *"a suite not in the gates for a change is a suite that will be red and
  unnoticed."*
*/
await page.locator('[data-overview="panels"]').first().click({ force: true })
await page.waitForSelector('[data-panel]', { timeout: 20_000 })
await page.waitForTimeout(1_200)

const rel = 'time[data-rel][datetime]'
const read = async (): Promise<{ text: string; when: string; title: string }> =>
  (await page.evaluate(`
    (() => {
      const e = document.querySelector('${rel}');
      return e === null ? { text: '', when: '', title: '' }
        : { text: e.textContent, when: e.getAttribute('datetime'), title: e.getAttribute('title') };
    })()
  `)) as { text: string; when: string; title: string }

const first = await read()

check(
  'a time is rendered as a real time element carrying its instant',
  first.when === '' ? 'no <time data-rel> on the page' : first.when,
  first.when === new Date(PLANTED).toISOString(),
)
check(
  'and the exact date is on it, so the words are never the only truth',
  first.title || 'no title',
  first.title.includes('September') && first.title.includes('2026'),
)
check(
  'the words are made in the browser, not taken from the payload',
  `${first.text} (the payload said "never")`,
  first.text === 'just now',
)

/*
  Now the page has been open for two hours, as far as it knows, and NOTHING has
  changed in the office — no new payload, no write, no navigation. This is the
  exact situation the Issue describes.
*/
await page.evaluate('window.__SKEW = 2 * 60 * 60 * 1000')

const stillStale = await read()
check(
  'CONTROL: moving the clock alone changes nothing',
  stillStale.text,
  stillStale.text === 'just now',
)

/*
  One pulse tick. Twenty seconds plus a margin, and the waiting IS the
  assertion — there is no way to ask "is it wired" that does not involve
  letting the timer fire.
*/
console.log('  … waiting 24s for one pulse tick')
await page.waitForTimeout(24_000)

const after = await read()
check(
  'a pulse tick re-makes the words with no fetch and no redraw',
  `${first.text} → ${after.text}`,
  after.text === '2 hours ago',
)
check('and the instant on the element is untouched', after.when, after.when === first.when)

/*
  The other half of "no second timer": nothing else is ticking. If `when.js` had
  installed its own interval, killing pulse would leave the times updating
  anyway — which would work, and would be a leak nobody notices until a tab has
  been open overnight.
*/
await page.evaluate(`
  /*
    An ABSOLUTE path. The studio pushes a deep link for the open project, so
    the document URL is /p/<slug>/<tab> by the time this runs and './pulse.js'
    resolved to /p/pulse.js — which 404s, and the suite died on
    "Failed to fetch dynamically imported module" after its assertions rather
    than during them, so the message pointed at the import and not at the
    navigation that moved it.
  */
  (async () => { const p = await import('/pulse.js'); p.stop(); })()
`)
await page.waitForTimeout(500)
await page.evaluate('window.__SKEW = 5 * 60 * 60 * 1000')
await page.waitForTimeout(24_000)
const frozen = await read()
check(
  'and there is no second timer: stopping the watcher stops the clock',
  `${after.text} → ${frozen.text} (skew moved to 5 hours)`,
  frozen.text === '2 hours ago',
)

check('no uncaught JavaScript', crashes.join(' | ') || 'none', crashes.length === 0)

await browser.close()
server.close()

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
