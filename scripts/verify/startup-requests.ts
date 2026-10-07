/**
 * What Team HQ asks the office when it opens, counted in a real browser against a fake gateway. LOCAL ONLY: nothing here
 * reaches production, holds a credential or needs a flag.
 *
 *   npm run verify:startup
 *
 * Why this exists (efficiency run, October 2026): a page load was about twenty gateway reads. A person who has signed in
 * and has no office yet got the same twenty, nearly all refused, and then kept polling; the Settings and Usage payloads
 * (ten reads) were made on every load and every refresh although most visits never open Settings; and the `thinking`
 * read was made twice on every load. None of that fails any other check, because a refused read nobody sees has no
 * overflow, no contrast and no dead control. This pins what a load costs as a COUNT, which is a structural property and
 * not a timing, so it does not flap.
 *
 * Scenarios, each asserted:
 *   1. an established office: every section is read at most once on load, and the set of sections is the one the page
 *      needs (so silence cannot satisfy it); the poll runs at its documented cadence;
 *   1b. the same office with Settings opened: the lazy payloads ARE read then (so lazy cannot mean never);
 *   2. a signed-in person with no office: ONE read (the studio payload that says so), then nothing, over a minute;
 *   3. the same person setting their office up: the reads and the poll START when the office exists.
 *
 * The fake gateway answers `office.test`; the page is pointed at it with `window.HQ_API`, the seam every harness here uses.
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join } from 'node:path'
import { chromium, type Page } from 'playwright'

/** What an established office's first load is allowed to read. Raising a number here is a decision, not a convenience. */
const EXPECTED_ON_LOAD = [
  'studio',
  'pulse',
  'portfolio_tasks',
  'lately',
  'unseen',
  'team_work',
  'thinking',
  'workspace',
] as const
/** What opening Settings adds. These are not read until something that draws them is drawn (needSettings in app.js). */
const EXPECTED_WHEN_SETTINGS_OPENS = [
  'slack_link',
  'channel_link',
  'conversation_channels',
  'studio_settings',
  'conversation_growth',
  'usage_overview',
] as const
const MAX_PER_SECTION_ON_LOAD = 1
/** The poll: pulse and thinking every twenty seconds while the tab is visible (`web/studio/pulse.js`, EVERY). */
const POLL_SECONDS = 20
const MINUTE_MS = 60_000

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

const server = createServer(async (rq, rs) => {
  let f = join('web/studio', decodeURIComponent((rq.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  // A dotless path is a route, as on the host.
  if (!existsSync(f) && extname(f) === '') f = join('web/studio', 'index.html')
  if (!existsSync(f)) {
    rs.writeHead(404)
    rs.end('not here')
    return
  }
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
  rs.end(await readFile(f))
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`

const browser = await chromium.launch()
const problems: string[] = []
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) problems.push(what)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Let a visible minute pass on the page's clock, one poll interval at a time with a real pause between. The watcher skips
 * a tick while the previous one is still in flight, so jumping the whole minute at once would count the guard and not the
 * cadence (the first version of this harness did exactly that and reported one poll where there are three).
 */
async function visibleMinute(page: Page): Promise<void> {
  for (let i = 0; i < MINUTE_MS / 1000 / POLL_SECONDS; i += 1) {
    await page.clock.runFor(POLL_SECONDS * 1000)
    await sleep(700)
  }
}

type Scenario = {
  /** Reads, in order, as `section` (or `POST <action>` for a write). */
  log: string[]
  page: Page
}

async function open(
  office: boolean,
  query = '',
  refuse = false,
  sample = false,
): Promise<Scenario> {
  // STARTUP_PROFILE=phone runs every scenario as an iPhone-sized touch device (the request counts must not depend on the form factor).
  const ctx = await browser.newContext(
    process.env.STARTUP_PROFILE === 'phone'
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 3,
        }
      : { viewport: { width: 1440, height: 900 } },
  )
  const page = await ctx.newPage()
  await page.clock.install()
  const log: string[] = []
  let exists = office
  await page.route('http://office.test/**', async (route) => {
    const req = route.request()
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    if (req.method() === 'POST') {
      const action = (JSON.parse(req.postData() ?? '{}') as { action?: string }).action ?? 'unknown'
      log.push(`POST ${action}`)
      if (action === 'create_office') exists = true
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        // whoami answers with the person's address, as the sign-in service does; the set-up screen re-asks until it has one.
        body: JSON.stringify(
          action === 'whoami'
            ? { ok: true, email: 'person@example.test' }
            : { result: { ok: true } },
        ),
      })
    }
    const section = url.searchParams.get('section') ?? url.pathname
    log.push(section)
    if (refuse) {
      return route.fulfill({
        status: 401,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'unauthorised' }),
      })
    }
    if (!exists) {
      return route.fulfill({
        status: 403,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'no_office', can_create: true }),
      })
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ data: section === 'studio' ? { projects: [] } : {} }),
    })
  })
  // A string, because these scripts are type-checked without the DOM library. A PERSON's session, as a second person
  // has one (the office key is Grant's legacy path, and it cannot create an office). Far from expiry on the page's own
  // clock, so the harness's fake clock never makes it refresh.
  await page.addInitScript(`
    window.HQ_API = 'http://office.test/hq-api'
    try {
      localStorage.setItem('hq.session', JSON.stringify({
        access_token: 'local-test-session',
        refresh_token: 'local-test-refresh',
        expires_at: Date.now() + 365 * 86400000,
        sample: ${String(sample)},
      }))
    } catch (e) {}
  `)
  await page.goto(origin + query)
  // Real time for the load itself: every read is issued within the first second or two.
  await sleep(4000)
  return { log, page }
}

const counts = (log: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const s of log) out[s] = (out[s] ?? 0) + 1
  return out
}
const show = (log: readonly string[]): string =>
  Object.entries(counts(log))
    .map(([k, n]) => `${k}${n > 1 ? ` x${String(n)}` : ''}`)
    .join(', ')

try {
  // ---- 1. an established office ---------------------------------------------------------------------------------------
  console.log('1. an established office')
  const a = await open(true)
  const load = [...a.log]
  console.log(`   on load: ${String(load.length)} requests: ${show(load)}`)
  const c = counts(load)
  check(
    Object.values(c).every((n) => n <= MAX_PER_SECTION_ON_LOAD),
    `no section is read more than ${String(MAX_PER_SECTION_ON_LOAD)} time on load (duplicates: ${
      Object.entries(c)
        .filter(([, n]) => n > MAX_PER_SECTION_ON_LOAD)
        .map(([k, n]) => `${k} x${String(n)}`)
        .join(', ') || 'none'
    })`,
  )
  check(
    [...EXPECTED_ON_LOAD].every((s) => (c[s] ?? 0) >= 1) &&
      Object.keys(c).length === EXPECTED_ON_LOAD.length,
    `the load reads exactly the ${String(EXPECTED_ON_LOAD.length)} sections the page needs (extra: ${
      Object.keys(c)
        .filter((k) => !(EXPECTED_ON_LOAD as readonly string[]).includes(k))
        .join(', ') || 'none'
    })`,
  )
  const before = a.log.length
  await visibleMinute(a.page)
  const poll = counts(a.log.slice(before))
  console.log(`   over a visible minute: ${show(a.log.slice(before))}`)
  const perMinute = MINUTE_MS / 1000 / POLL_SECONDS
  check(
    (poll.pulse ?? 0) >= perMinute - 1 && (poll.pulse ?? 0) <= perMinute + 1,
    `the poll asks for the pulse about ${String(perMinute)} times a minute (saw ${String(poll.pulse ?? 0)})`,
  )
  check(
    Object.keys(poll).every((k) => k === 'pulse' || k === 'thinking'),
    `and reads nothing else while the office has not changed (saw: ${show(a.log.slice(before)) || 'nothing'})`,
  )

  // ---- 1b. Settings opened ---------------------------------------------------------------------------------------------
  console.log('1b. the same office, Settings opened')
  const s = await open(true, '?settings=connections')
  const cs = counts(s.log)
  console.log(`   on load: ${String(s.log.length)} requests: ${show(s.log)}`)
  check(
    [...EXPECTED_WHEN_SETTINGS_OPENS].every((x) => (cs[x] ?? 0) >= 1),
    `opening Settings reads the ${String(EXPECTED_WHEN_SETTINGS_OPENS.length)} sections it draws (missing: ${
      [...EXPECTED_WHEN_SETTINGS_OPENS].filter((x) => (cs[x] ?? 0) < 1).join(', ') || 'none'
    })`,
  )
  check(
    Object.values(cs).every((n) => n <= MAX_PER_SECTION_ON_LOAD),
    `and still no section more than ${String(MAX_PER_SECTION_ON_LOAD)} time (duplicates: ${
      Object.entries(cs)
        .filter(([, n]) => n > MAX_PER_SECTION_ON_LOAD)
        .map(([k, n]) => `${k} x${String(n)}`)
        .join(', ') || 'none'
    })`,
  )

  // The fake gateway answers every Settings section with an empty payload, which the page cannot use, so the reads above FAILED.
  // A failed read is asked again only when a person closes Settings and opens it again (the pane says to), and never by a redraw:
  // the read's own completion redraws, so a retry on every call would send the six reads again and again while the office
  // cannot answer them (329 of each in a first draft of the retry). Waiting a while with the sheet open must send nothing.
  // (The reopen path is pinned by tests/web/lazy-settings-honesty.test.ts over the wired expressions; this harness has no
  // project, so it draws no rail to press, and driving the command bar for it was not worth what it adds.)
  const quiet = s.log.length
  await visibleMinute(s.page)
  const retriedAlone = s.log.slice(quiet).filter((x) => x !== 'pulse' && x !== 'thinking')
  check(
    retriedAlone.length === 0,
    `a failed Settings read does not retry by itself over a visible minute (saw ${show(retriedAlone) || 'nothing'})`,
  )

  // ---- 2. signed in, no office ----------------------------------------------------------------------------------------
  console.log('2. signed in, no office yet')
  const b = await open(false)
  console.log(`   on load: ${String(b.log.length)} requests: ${show(b.log)}`)
  const reads = b.log.filter((x) => !x.startsWith('POST'))
  const asks = b.log.filter((x) => x === 'POST whoami').length
  check(
    reads.length === 1 && reads[0] === 'studio',
    `exactly one office read, the studio payload that says so (saw ${String(reads.length)})`,
  )
  check(asks <= 1, `and the set-up screen asks who they are at most once (saw ${String(asks)})`)
  const idle = b.log.length
  await visibleMinute(b.page)
  check(
    b.log.length === idle,
    `and no more over a minute (saw ${String(b.log.length - idle)} more)`,
  )
  check(
    (await b.page.locator('body').innerText()).includes('set up your office'),
    'the page still tells them to set up their office',
  )

  // ---- 2a. a public Sample visitor (a guest session) -----------------------------------------------------------------------
  console.log('2a. a public Sample visitor')
  const g = await open(true, '', false, true)
  const cg = counts(g.log)
  console.log(`   on load: ${String(g.log.length)} requests: ${show(g.log)}`)
  check(
    Object.keys(cg).length === EXPECTED_ON_LOAD.length &&
      [...EXPECTED_ON_LOAD].every((x) => (cg[x] ?? 0) === 1),
    `a visitor's load reads exactly the ${String(EXPECTED_ON_LOAD.length)} sections, once each (saw: ${show(g.log)})`,
  )
  check(
    (await g.page.locator('body').innerText()).includes('Sample Office'),
    'and the page says it is the Sample Office (the visitor knows where they are)',
  )

  // ---- 2b. a credential the office refuses --------------------------------------------------------------------------------
  console.log('2b. a credential the office refuses')
  const r = await open(true, '', true)
  console.log(`   on load: ${String(r.log.length)} requests: ${show(r.log)}`)
  const rreads = r.log.filter((x) => !x.startsWith('POST'))
  check(
    rreads.length === 1 && rreads[0] === 'studio',
    `one read, the studio payload that is refused (saw ${String(rreads.length)}: ${rreads.join(', ')})`,
  )
  const ridle = r.log.length
  await visibleMinute(r.page)
  check(
    r.log.length === ridle,
    `and nothing over a minute (saw ${String(r.log.length - ridle)} more)`,
  )

  // ---- 3. the transition -----------------------------------------------------------------------------------------------
  console.log('3. setting the office up')
  const mark = b.log.length
  await b.page.fill('#bc-setup-name', 'Test Person')
  await b.page.click('[data-bc-setup-form] button[type=submit]')
  await sleep(4000)
  const after = b.log.slice(mark)
  console.log(`   after submitting: ${String(after.length)} requests: ${show(after)}`)
  check(after.includes('POST create_office'), 'the office is created')
  const opened = counts(after.filter((x) => !x.startsWith('POST')))
  for (const x of ['studio', 'lately', 'workspace', 'pulse'])
    check((opened[x] ?? 0) >= 1, `then the page reads ${x}`)
  const m2 = b.log.length
  await visibleMinute(b.page)
  const polled = counts(b.log.slice(m2))
  check(
    (polled.pulse ?? 0) >= 1,
    `and the poll runs (saw ${String(polled.pulse ?? 0)} pulse reads in a minute)`,
  )
  check(
    (await b.page.locator('body').innerText()).includes('Your office is ready'),
    'and the page shows the office, not the set-up screen',
  )
} finally {
  await browser.close()
  server.close()
}

console.log(
  problems.length === 0
    ? '\nstartup budget: PASS'
    : `\nstartup budget: ${String(problems.length)} FAIL`,
)
process.exitCode = problems.length === 0 ? 0 : 1
