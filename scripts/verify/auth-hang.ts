/**
 * Does the sign-in path END when the service behind it does not answer, and does it say where it stopped?
 *
 *   npm run verify:auth-hang                       # the page as it is in the working tree
 *   npm run verify:auth-hang -- --root=/some/copy  # a copy of web/studio (the baseline control, see below)
 *
 * Grant, 5 October 2026: "My actual login attempt hung indefinitely." The page's sign-in path made five kinds of request
 * with no deadline, and the boot sequence awaits the refresh exchange BEFORE it asks for the studio payload, so a stuck
 * Auth service left a blank loading screen for as long as the browser cared to wait.
 *
 * ## Why no existing suite saw it
 *
 * `verify:offline` hangs the studio payload and asserts the strip. Its fetch shim answers every URL that is not the
 * gateway with an empty 200, so the sign-in function was never asked to hang, and it signs in with the legacy office key,
 * which has no refresh at all. `verify:account-ui` answers the sign-in function itself ("the real endpoint is never
 * asked for an email"). A verification that looks somewhere other than where the person looks passes for the wrong reason.
 *
 * ## What is real and what is replaced
 *
 * REAL: the page, Chromium, the browser's own timeout behaviour, the page's storage. REPLACED: the sign-in function and
 * the gateway, by a route that can hang (the request stays open and nothing is ever sent back), answer 503, or answer
 * normally. Nothing here touches Supabase, a token or any production state: the address is `office.invalid`.
 *
 * ## The control that proves the detector can fail
 *
 * Run it against a copy of the page from before the fix:
 *
 *     git archive <commit before the fix> web/studio | tar -x -C /tmp/baseline
 *     npm run verify:auth-hang -- --root=/tmp/baseline/web/studio
 *
 * and the hang scenarios must go RED. A suite that has only ever been green has not shown it can fail.
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, type Page, type Route } from 'playwright'
import { namesAnOffice } from './lib/office-seam.ts'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const ROOT = arg('root') ?? 'web/studio'
const PORT = 4797
const HOST = 'hq-acceptance.test'
const BASE = `http://${HOST}:${PORT}`
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const server = createServer(async (rq, rs) => {
  const path = decodeURIComponent((rq.url ?? '/').split('?')[0] ?? '/')
  if (path === '/config.js') {
    rs.writeHead(200, { 'content-type': TYPES['.js'] ?? '' })
    rs.end('')
    return
  }
  let f = join(ROOT, path)
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  if (!existsSync(f) && extname(f) === '') f = join(ROOT, 'index.html')
  if (!existsSync(f)) {
    rs.writeHead(404)
    rs.end('not here')
    return
  }
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
  rs.end(await readFile(f))
})
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()))

const checks: boolean[] = []
const check = (what: string, detail: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

type Mode = 'ok' | 'hang' | 'down' | 'expired'
type World = {
  refresh: Mode
  link: Mode
  studio: 'ok' | 'hang' | 'no_office'
  create: Mode
}
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
}
const json = (route: Route, status: number, body: unknown): Promise<void> =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  })

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] })

type Held = { route: Route }
const open = async (
  world: World,
  session: { access: string; refresh: string; expiresInMs: number } | null,
): Promise<{
  page: Page
  requests: string[]
  errors: string[]
  close: () => Promise<void>
}> => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(namesAnOffice())
  if (session !== null) {
    await context.addInitScript(
      `try { localStorage.setItem('hq.session', ${JSON.stringify(
        JSON.stringify({
          access_token: session.access,
          refresh_token: session.refresh,
          expires_at: Date.now() + session.expiresInMs,
        }),
      )}) } catch (e) {}`,
    )
  }
  const held: Held[] = []
  const requests: string[] = []
  await context.route(/office\.invalid/, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    const url = new URL(req.url())
    let action = ''
    try {
      action = String((JSON.parse(req.postData() ?? '{}') as { action?: string }).action ?? '')
    } catch {
      action = ''
    }
    const section = url.searchParams.get('section') ?? ''
    const name = url.pathname.endsWith('/signin')
      ? `signin:${action}`
      : `hq-api:${section || action}`
    requests.push(name)
    const stop = (): Promise<void> => {
      held.push({ route })
      return Promise.resolve()
    }
    if (name === 'signin:refresh') {
      if (world.refresh === 'hang') return stop()
      if (world.refresh === 'down') return json(route, 503, { ok: false, reason: 'unavailable' })
      if (world.refresh === 'expired') return json(route, 200, { ok: false, reason: 'expired' })
      return json(route, 200, {
        ok: true,
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
      })
    }
    if (name === 'signin:link') {
      if (world.link === 'hang') return stop()
      return json(route, 200, { ok: true, said: 'Check your email for a link to sign in.' })
    }
    if (name === 'signin:whoami') return json(route, 200, { ok: true, email: 'a@b.invalid' })
    if (name === 'hq-api:studio') {
      if (world.studio === 'hang') return stop()
      if (world.studio === 'no_office')
        return json(route, 403, { error: 'no_office', can_create: true })
      return json(route, 403, { error: 'no_office', can_create: true })
    }
    if (name === 'hq-api:create_office') {
      if (world.create === 'hang') return stop()
      return json(route, 200, { result: { ok: true } })
    }
    return json(route, 200, {})
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  return {
    page,
    requests,
    errors,
    close: async () => {
      for (const h of held) await h.route.abort().catch(() => undefined)
      await context.close()
    },
  }
}

const bodyText = async (p: Page): Promise<string> => {
  const raw = await p
    .locator('body')
    .innerText()
    .catch(() => '')
  return raw.replace(/\s+/g, ' ')
}

/** Wait until the page text matches, or the deadline passes; returns the seconds it took, or null. */
const until = async (p: Page, re: RegExp, ms: number): Promise<number | null> => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (re.test(await bodyText(p))) return Math.round((Date.now() - t0) / 100) / 10
    await p.waitForTimeout(250)
  }
  return null
}
const stored = (p: Page): Promise<boolean> =>
  p.evaluate(() => {
    try {
      return localStorage.getItem('hq.session') !== null
    } catch {
      return false
    }
  })
type Step = { boundary?: string; outcome?: string }
const traceOf = (p: Page): Promise<Step[] | null> =>
  p.evaluate(() => {
    const t = (globalThis as { __hqTrace?: unknown }).__hqTrace
    return Array.isArray(t) ? (t as Step[]) : null
  })

const STOPPED = /did not answer|could not be reached/i

console.log(`auth path against ${ROOT}\n`)

// 1. A returning person: the stored session is nearly out, the refresh exchange never answers.
{
  console.log('1. returning person, session nearly out, the sign-in service never answers')
  const o = await open(
    { refresh: 'hang', link: 'ok', studio: 'ok', create: 'ok' },
    { access: 'old-access', refresh: 'old-refresh', expiresInMs: -1000 },
  )
  await o.page.goto(BASE)
  const secs = await until(o.page, STOPPED, 26_000)
  const trace = await traceOf(o.page)
  check(
    'the page ends the wait and says the service did not answer',
    secs === null ? 'still waiting after 26 s (no visible message)' : `after ${secs} s`,
    secs !== null,
  )
  const text = await bodyText(o.page)
  // SHOT=<dir> keeps a picture of what a person is left looking at, because words in a body are not a layout.
  if (process.env.SHOT !== undefined)
    await o.page.screenshot({ path: `${process.env.SHOT}/auth-stopped.png` })
  check(
    'it names the step it stopped at',
    /stopped at auth:refresh/.test(text) ? 'auth:refresh' : 'no boundary named',
    /stopped at auth:refresh/.test(text),
  )
  check(
    'a way to try again is offered',
    (await o.page.locator('[data-bc-retry-office]').count()) > 0 ? 'Try again present' : 'absent',
    (await o.page.locator('[data-bc-retry-office]').count()) > 0,
  )
  const kept = await stored(o.page)
  check('the session was NOT thrown away over an outage', String(kept), kept)
  check(
    'the trace records the stall at the right boundary',
    trace === null ? 'no trace' : JSON.stringify(trace.slice(-2)),
    trace?.some((t) => t.boundary === 'auth:refresh' && t.outcome === 'timeout') === true,
  )
  check('no page error', o.errors.join(' | ') || 'none', o.errors.length === 0)
  await o.close()
}

// 2. The same person, the service answers "unavailable" (5xx behind it).
{
  console.log('2. the sign-in service answers that it is unavailable')
  const o = await open(
    { refresh: 'down', link: 'ok', studio: 'ok', create: 'ok' },
    { access: 'old-access', refresh: 'old-refresh', expiresInMs: -1000 },
  )
  await o.page.goto(BASE)
  const secs = await until(o.page, STOPPED, 8_000)
  check('the page says so at once', secs === null ? 'no message' : `after ${secs} s`, secs !== null)
  check('the session is kept', String(await stored(o.page)), await stored(o.page))
  await o.close()
}

// 3. Control: a refresh that is genuinely REFUSED still signs the person out.
{
  console.log('3. control: the service says the session is expired')
  const o = await open(
    { refresh: 'expired', link: 'ok', studio: 'ok', create: 'ok' },
    { access: 'old-access', refresh: 'old-refresh', expiresInMs: -1000 },
  )
  await o.page.goto(BASE)
  await o.page.waitForTimeout(2500)
  check(
    'a real refusal clears the session (the fix did not turn expiry into an outage)',
    String(!(await stored(o.page))),
    !(await stored(o.page)),
  )
  await o.close()
}

// 4. Control: a valid session, the studio payload never answers (the deadline that already existed).
{
  console.log('4. control: valid session, the office never answers the studio payload')
  const o = await open(
    { refresh: 'ok', link: 'ok', studio: 'hang', create: 'ok' },
    { access: 'good-access', refresh: 'good-refresh', expiresInMs: 3_600_000 },
  )
  await o.page.goto(BASE)
  const secs = await until(o.page, /did not answer/i, 16_000)
  check(
    'the page says the office did not answer',
    secs === null ? 'never' : `after ${secs} s`,
    secs !== null,
  )
  await o.close()
}

// 5. The entry screen: asking for a link, the service never answers.
{
  console.log('5. asking for an email link, the sign-in service never answers')
  const o = await open({ refresh: 'ok', link: 'hang', studio: 'ok', create: 'ok' }, null)
  await o.page.goto(BASE)
  await o.page.waitForSelector('[data-bc-entry-form]', { timeout: 10_000 }).catch(() => undefined)
  const form = o.page.locator('[data-bc-entry-form]').first()
  await form.locator('[name=email]').fill('someone@example.invalid')
  await form.locator('button[type=submit]').click()
  const t0 = Date.now()
  let ended = false
  let said = ''
  while (Date.now() - t0 < 30_000) {
    said = (
      await form
        .locator('[data-bc-entry-said]')
        .innerText()
        .catch(() => '')
    ).trim()
    if (said !== '' && !/^Sending/.test(said)) {
      ended = true
      break
    }
    await o.page.waitForTimeout(250)
  }
  check(
    'the form stops saying Sending and says what happened',
    ended
      ? `after ${Math.round((Date.now() - t0) / 100) / 10} s: ${said.slice(0, 110)}`
      : 'still "Sending…" after 30 s',
    ended && STOPPED.test(said),
  )
  check(
    'the button works again',
    String(await form.locator('button[type=submit]').isEnabled()),
    await form.locator('button[type=submit]').isEnabled(),
  )
  await o.close()
}

// 6. Signed in with no office yet: the first-office call never answers.
{
  console.log('6. setting up the first office, the call never answers')
  const o = await open(
    { refresh: 'ok', link: 'ok', studio: 'no_office', create: 'hang' },
    { access: 'good-access', refresh: 'good-refresh', expiresInMs: 3_600_000 },
  )
  await o.page.goto(BASE)
  await o.page.waitForSelector('[data-bc-setup-form]', { timeout: 15_000 }).catch(() => undefined)
  const form = o.page.locator('[data-bc-setup-form]').first()
  const there = (await form.count()) > 0
  check('the set-up screen is reached (office resolution)', String(there), there)
  if (there) {
    await form.locator('[name=name]').fill('Disposable Office')
    await form.locator('button[type=submit]').click()
    const t0 = Date.now()
    let ended = false
    let said = ''
    while (Date.now() - t0 < 46_000) {
      said = (
        await form
          .locator('[data-bc-setup-said]')
          .innerText()
          .catch(() => '')
      ).trim()
      if (said !== '' && !/^Setting up/.test(said)) {
        ended = true
        break
      }
      await o.page.waitForTimeout(250)
    }
    check(
      'it stops saying Setting up and says what happened',
      ended
        ? `after ${Math.round((Date.now() - t0) / 100) / 10} s: ${said.slice(0, 110)}`
        : 'still waiting after 46 s',
      ended && STOPPED.test(said),
    )
  }
  await o.close()
}

await browser.close()
server.close()
const failed = checks.filter((c) => !c).length
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
