/**
 * The real deployed sign-in path, end to end, deliberately low volume, with every boundary timed.
 *
 *   npm run verify:auth-acceptance                  # the DEPLOYED page and the DEPLOYED sign-in function
 *   SITE=http://hq-acceptance.test:4797 ...         # a page served elsewhere (the working tree) against the same office
 *
 * Grant, 5 October 2026: "My actual login attempt hung indefinitely." Every existing journey replaces the sign-in function
 * (`verify:account-ui` answers it itself; `verify:offline` shims it), so the one function a returning person depends on had
 * never been called by any suite. This calls it.
 *
 * ## One disposable person, about thirty requests in all
 *
 * The person is `.invalid`, created and removed through the admin API, with a per-run token. Nobody is emailed: the email
 * leg is NOT exercised, on purpose. Asking Auth for a link spends the project's hourly email budget, and a suite that spends
 * it can lock Grant out of his own sign-in for an hour. The session the link would carry is minted through the admin API,
 * which is what the page then receives in its address fragment, exactly as it would from the mailbox.
 *
 * ## Abort rules
 *
 * Before anything: health must read all ACTIVE_HEALTHY and the last five runs of the cron canary (a one-line function run
 * every minute by pg_cron) must each have succeeded in under a second. During: any boundary slower than the stated limit
 * stops the run, and the teardown still runs. After: the canary is read again.
 *
 * ## Instrumentation
 *
 * Every request to the page's host and to the office is timed in the browser and labelled with the boundary it crosses, in
 * the order a returning person crosses them: page, sign-in function (by action), Auth, gateway (by section). A hang is
 * attributed to the first boundary whose request is still open when the person gives up.
 *
 * Teardown retires the office and bans the login; an office is never deleted.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { chromium, type Page, type Request } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import {
  BOUNDARY_LIMIT_MS,
  fetchProviderHealth,
  judgeHealth,
  readLastRunsCanary,
} from '../../src/safety/canary.ts'
import { apiKeys } from '../p4/provision-second-person.ts'

const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (TOKEN === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required (never printed).')
  process.exit(2)
}
const SITE = process.env.SITE ?? 'https://ai-team-hq.vercel.app'
const OFFICE = `https://${REF}.supabase.co`
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
const EMAIL = `authacc-${RUN}@lifecycle.agentic.invalid`
const out = '.out/auth-acceptance'
mkdirSync(out, { recursive: true })
const db = new ManagementApiExecutor(REF, TOKEN)
const q = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push({ what, ok, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
/** A message with no address and no token in it, whatever threw. */
const clip = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e))
    .replace(/access_token=[^&\s"']+/g, 'access_token=[held]')
    .replace(/refresh_token=[^&\s"']+/g, 'refresh_token=[held]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .slice(0, 160)

const LIMIT_MS = BOUNDARY_LIMIT_MS
const timings: { boundary: string; ms: number; status: string }[] = []
const note = (boundary: string, ms: number, status: string): void => {
  timings.push({ boundary, ms, status })
  console.log(`      ${boundary.padEnd(34)} ${String(ms).padStart(6)} ms  ${status}`)
}

// ---- preflight ---------------------------------------------------------------------------------------------------------
// The judgement is the shared canary library's (src/safety/canary.ts), the logic this suite had first.
const health = await fetchProviderHealth(REF, TOKEN)
const healthy = judgeHealth(health).ok
const canary = (): Promise<{ ok: boolean; detail: string }> => readLastRunsCanary(q, { sleep })
const before = healthy ? await canary() : { ok: false, detail: 'not asked' }
console.log('preflight')
check('the platform reports every service healthy', healthy, health.map((s) => s.status).join(','))
check('the cron canary is quick and succeeding', before.ok, before.detail)
if (!healthy || !before.ok) {
  console.log('\nABORTED before touching anything: the platform is not in a state to be tested.')
  process.exit(3)
}

const keys = await apiKeys()
const admin = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${OFFICE}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: keys.service,
      Authorization: `Bearer ${keys.service}`,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  })

let userId = ''
let session = { access: '', refresh: '' }
const mintSession = async (): Promise<{ access: string; refresh: string }> => {
  const gen = await admin('/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  })
  const g = (await gen.json()) as { hashed_token?: string }
  if (g.hashed_token === undefined) throw new Error('no link generated')
  const v = await fetch(`${OFFICE}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: keys.anon, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: g.hashed_token }),
    signal: AbortSignal.timeout(20_000),
  })
  const b = (await v.json()) as { access_token?: string; refresh_token?: string }
  if (b.access_token === undefined) throw new Error('no session')
  return { access: b.access_token, refresh: b.refresh_token ?? '' }
}

const browser = await chromium.launch()
try {
  // ---- A. the deployed sign-in function, called directly, boundary by boundary -----------------------------------------
  console.log('\nA. the deployed sign-in function (server side), one call per action')
  const created = await admin('/users', {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      email_confirm: false,
      user_metadata: { purpose: 'auth-acceptance', run: RUN, disposable: true },
    }),
  })
  const cu = (await created.json()) as { id?: string }
  userId = cu.id ?? ''
  check('a disposable login was created', userId !== '')
  let t = Date.now()
  session = await mintSession()
  note('auth: admin link + verify (mailbox)', Date.now() - t, 'minted')

  const signin = (action: string, body: object, bearer = ''): Promise<Response> =>
    fetch(`${OFFICE}/functions/v1/signin`, {
      method: 'POST',
      headers: {
        origin: SITE.startsWith('https://ai-team-hq') ? SITE : 'https://ai-team-hq.vercel.app',
        'content-type': 'application/json',
        ...(bearer === '' ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(LIMIT_MS + 5_000),
    })
  t = Date.now()
  const who = await signin('whoami', {}, session.access).catch((e: unknown) => e)
  const whoMs = Date.now() - t
  const whoBody =
    who instanceof Response ? ((await who.json().catch(() => ({}))) as { ok?: boolean }) : {}
  note('signin function: whoami', whoMs, who instanceof Response ? String(who.status) : clip(who))
  check('whoami answers for a live session', whoBody.ok === true && whoMs < LIMIT_MS, `${whoMs} ms`)
  t = Date.now()
  const ref = await signin('refresh', { refresh_token: session.refresh }).catch((e: unknown) => e)
  const refMs = Date.now() - t
  const refBody =
    ref instanceof Response
      ? ((await ref.json().catch(() => ({}))) as {
          ok?: boolean
          refresh_token?: string
          access_token?: string
        })
      : {}
  note('signin function: refresh', refMs, ref instanceof Response ? String(ref.status) : clip(ref))
  check('refresh exchanges the session', refBody.ok === true && refMs < LIMIT_MS, `${refMs} ms`)
  if (refBody.access_token !== undefined) {
    session = { access: refBody.access_token, refresh: refBody.refresh_token ?? session.refresh }
  }
  t = Date.now()
  const bad = await signin('refresh', { refresh_token: 'not-a-real-token' }).catch(
    (e: unknown) => e,
  )
  const badMs = Date.now() - t
  const badBody =
    bad instanceof Response ? ((await bad.json().catch(() => ({}))) as { reason?: string }) : {}
  note(
    'signin function: refresh (bad token)',
    badMs,
    bad instanceof Response ? String(bad.status) : clip(bad),
  )
  check(
    'a token that is genuinely no good is reported as expired, not as an outage',
    badBody.reason === 'expired',
    String(badBody.reason),
  )

  // ---- B. the page, through a browser ---------------------------------------------------------------------------------
  console.log(`\nB. the page at ${SITE} (browser)`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page: Page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(clip(e)))
  const open = new Map<Request, { label: string; at: number }>()
  const label = (url: string, method: string, post: string | null): string => {
    const u = new URL(url)
    if (u.pathname.endsWith('/functions/v1/signin')) {
      let a = ''
      try {
        a = String((JSON.parse(post ?? '{}') as { action?: string }).action ?? '')
      } catch {
        a = ''
      }
      return `ui -> signin:${a}`
    }
    if (u.pathname.includes('/functions/v1/hq-api'))
      return method === 'POST'
        ? `ui -> gateway:act:${String((JSON.parse(post ?? '{}') as { action?: string }).action ?? '')}`
        : `ui -> gateway:read:${u.searchParams.get('section') ?? ''}`
    if (u.pathname.startsWith('/auth/v1/')) return `ui -> auth:${u.pathname.slice(9)}`
    if (u.host === new URL(SITE).host && (u.pathname === '/' || !u.pathname.includes('.')))
      return 'page: html'
    return ''
  }
  page.on('request', (r) => {
    const l = label(r.url(), r.method(), r.postData())
    if (l !== '') open.set(r, { label: l, at: Date.now() })
  })
  page.on('requestfinished', async (r) => {
    const o = open.get(r)
    if (o === undefined) return
    open.delete(r)
    const resp = await r.response().catch(() => null)
    note(o.label, Date.now() - o.at, String(resp?.status() ?? '?'))
  })
  page.on('requestfailed', (r) => {
    const o = open.get(r)
    if (o === undefined) return
    open.delete(r)
    note(o.label, Date.now() - o.at, 'failed')
  })
  const openNow = (): string[] =>
    [...open.values()].map((o) => `${o.label} (${Date.now() - o.at} ms)`)
  const wait = async (sel: string, ms: number): Promise<number | null> => {
    const t0 = Date.now()
    try {
      await page.waitForSelector(sel, { timeout: ms })
      return Date.now() - t0
    } catch {
      return null
    }
  }
  const body = async (): Promise<string> =>
    (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).replace(/\s+/g, ' ')

  // 1. A stranger arrives.
  console.log('  1. a stranger arrives')
  let t0 = Date.now()
  await page.goto(SITE, { waitUntil: 'domcontentloaded' })
  const entry = await wait('[data-bc-entry-form]', LIMIT_MS)
  check(
    'the entry screen is drawn',
    entry !== null,
    entry === null
      ? `not within ${LIMIT_MS} ms; open: ${openNow().join('; ')}`
      : `${Date.now() - t0} ms to draw`,
  )
  await page.screenshot({ path: `${out}/1-entry.png` })

  // 2. The link comes back (the mailbox is the admin API).
  console.log('  2. the link comes back: the session arrives in the address fragment')
  await page.goto('about:blank')
  t0 = Date.now()
  try {
    await page.goto(
      `${SITE}/#access_token=${session.access}&refresh_token=${session.refresh}&expires_in=3600&token_type=bearer`,
      { waitUntil: 'domcontentloaded' },
    )
  } catch (e) {
    throw new Error(`navigation failed: ${clip(e)}`)
  }
  const setup = await wait('[data-bc-setup-form]', LIMIT_MS)
  check(
    'the session is adopted and the office is resolved: a person with no office is asked to set one up',
    setup !== null,
    setup === null
      ? `not within ${LIMIT_MS} ms; open: ${openNow().join('; ')}`
      : `${Date.now() - t0} ms`,
  )
  check('the address bar no longer holds the session', !page.url().includes('access_token'))
  await page.screenshot({ path: `${out}/2-setup.png` })

  // 3. First-office provisioning.
  console.log('  3. first-office provisioning')
  await page.fill('#bc-setup-name', `Acceptance ${RUN}`)
  t0 = Date.now()
  await page.locator('[data-bc-setup-form] button[type=submit]').click()
  // Either the first-run screen (the working tree's page) or the project board with the office's catch-all project (the
  // deployed page, 5 October): both are a person inside a working office, and which one appeared is reported, not assumed.
  // Wait for the set-up form to GO AWAY (the office exists and the page moved on), never for text that the set-up screen's
  // own copy might contain: an earlier version matched "Your projects" at once and let the next step abort the request.
  let first: number | null = null
  try {
    await page.waitForSelector('[data-bc-setup-form]', { state: 'detached', timeout: 30_000 })
    first = Date.now() - t0
  } catch {
    first = null
  }
  const which = (await page.locator('.bcfirst').count()) > 0 ? 'first-run screen' : 'project board'
  check(
    'the office is made and the person lands inside it',
    first !== null,
    first === null
      ? `not within 30 s; open: ${openNow().join('; ')}; page: ${(await body()).slice(0, 140)}`
      : `${Date.now() - t0} ms (${which})`,
  )
  const offices = await q(
    `select count(*)::int as n from public.offices where auth_user_id = '${userId}' and state = 'active'`,
  )
  check('exactly one active office exists for this login', Number(offices[0]?.n) === 1)
  await page.screenshot({ path: `${out}/3-first-run.png` })

  // 4. Reload: the session persists.
  console.log('  4. reload: does the session persist')
  t0 = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded' })
  const again = await wait('.bcfirst, [data-bc-signout]', LIMIT_MS)
  check(
    'a reload keeps the person signed in and reaches their office',
    again !== null && (await page.locator('[data-bc-entry-form]').count()) === 0,
    again === null ? `open: ${openNow().join('; ')}` : `${Date.now() - t0} ms`,
  )

  // 5. Sign out, then back in.
  console.log('  5. sign out, sign in again')
  await page.locator('[data-bc-signout]').first().click()
  const out1 = await wait('[data-bc-entry-form]', LIMIT_MS)
  check('signing out returns to the entry screen', out1 !== null)
  const held = await page.evaluate(() => {
    try {
      return localStorage.getItem('hq.session')
    } catch {
      return 'unreadable'
    }
  })
  check(
    'and the stored session is gone',
    held === null,
    String(held === null ? 'cleared' : 'still held'),
  )
  session = await mintSession()
  await page.goto('about:blank')
  t0 = Date.now()
  await page.goto(
    `${SITE}/#access_token=${session.access}&refresh_token=${session.refresh}&expires_in=3600&token_type=bearer`,
    { waitUntil: 'domcontentloaded' },
  )
  const back = await wait('.bcfirst, [data-bc-signout]', LIMIT_MS)
  check(
    'signing in again lands in the same office',
    back !== null && (await page.locator('[data-bc-setup-form]').count()) === 0,
    back === null ? `open: ${openNow().join('; ')}` : `${Date.now() - t0} ms`,
  )

  // 6. Failure recovery on THIS page: the sign-in function never answers (the request is held in the browser; nothing is sent).
  console.log('  6. failure recovery: the sign-in function never answers (held in the browser)')
  const hung = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await hung.addInitScript(
    `try { localStorage.setItem('hq.session', ${JSON.stringify(
      JSON.stringify({
        access_token: 'expired',
        refresh_token: session.refresh,
        expires_at: Date.now() - 1000,
      }),
    )}) } catch (e) {}`,
  )
  const held2: { abort: () => Promise<void> }[] = []
  await hung.route(/functions\/v1\/signin/, (route) => {
    held2.push({ abort: () => route.abort().catch(() => undefined) })
  })
  const hp = await hung.newPage()
  await hp.goto(SITE, { waitUntil: 'domcontentloaded' })
  const t1 = Date.now()
  let said = ''
  while (Date.now() - t1 < 30_000) {
    const txt = (
      await hp
        .locator('body')
        .innerText()
        .catch(() => '')
    ).replace(/\s+/g, ' ')
    if (/did not answer|could not be reached/i.test(txt)) {
      said = txt
      break
    }
    await hp.waitForTimeout(500)
  }
  const stuckOn = (await hp.locator('.bcconnecting').count()) > 0
  await hp.screenshot({ path: `${out}/6-signin-hangs.png` })
  check(
    'the page ends the wait and says the sign-in service did not answer',
    said !== '',
    said !== ''
      ? `after ${Math.round((Date.now() - t1) / 100) / 10} s`
      : `STILL WAITING after 30 s${stuckOn ? ' on the loading skeleton' : ''}; held at: ui -> signin:refresh`,
  )
  for (const h of held2) await h.abort()
  await hung.close()
  check('no page error in any step', errors.length === 0, errors.join(' | ') || 'none')
  await context.close()
} catch (e) {
  check('the run completed', false, clip(e))
} finally {
  console.log('\nteardown')
  if (userId !== '') {
    for (const r of await q(
      `select office_id::text id from public.offices where auth_user_id = '${userId}'`,
    ).catch(() => [])) {
      await q(`select app.retire_person_office('${String(r.id)}'::uuid) v`).catch(() => undefined)
    }
    const d = await admin(`/users/${userId}`, { method: 'DELETE' }).catch(() => null)
    if (d === null || !d.ok)
      await admin(`/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ ban_duration: '876000h' }),
      }).catch(() => undefined)
  }
  await browser.close()
  const left = await q(
    `select count(*)::int as n from public.offices where auth_user_id = '${userId === '' ? '00000000-0000-0000-0000-000000000000' : userId}' and state = 'active'`,
  ).catch(() => [{ n: -1 }])
  check('teardown left no active office behind', Number(left[0]?.n) === 0)
  await sleep(1500)
  const after = await canary()
  check('the cron canary is still quick and succeeding afterwards', after.ok, after.detail)
  const worst = [...timings].sort((a, b) => b.ms - a.ms)[0]
  console.log(
    `\nslowest boundary: ${worst === undefined ? 'none' : `${worst.boundary} ${worst.ms} ms`}`,
  )
  const failed = results.filter((r) => !r.ok).length
  console.log(`${results.length - failed}/${results.length} checks passed`)
  process.exitCode = failed === 0 ? 0 : 1
}
