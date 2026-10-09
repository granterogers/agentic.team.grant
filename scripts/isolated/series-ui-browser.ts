/**
 * A recurring reminder in the REAL Team HQ page: ticking one off completes that time only, and stopping the series is its
 * own, separate press (owner decision of 7 October 2026, migration 1051 here, 1034 as authored), drawn on main's Team HQ
 * My Tasks surface of 9 October. The real hq-api and signin edge code answer from the isolated replica; the page is the
 * working tree's; a PERSON session is stored the way combined-browser.ts stores one. Local and isolated: no production,
 * no network.
 *
 *   npx tsx scripts/isolated/series-ui-browser.ts <replica-db> [--sabotage-stop] [--dump]
 *
 * What is proved, on a desktop and a phone, each beside a control:
 *   1. My Tasks lists the series ("repeats") and an ordinary task beside it, and only the series offers Stop repeating;
 *   2. ticking the series off in the page leaves the row OPEN in the database with a recorded completion and the reminder
 *      moved on, and the ordinary task becomes done (so the tick works and the series' survival is not a dead tick);
 *   3. the first press of Stop repeating changes NOTHING (it asks again), the second cancels exactly that series in the
 *      database and nothing else, the page sent exactly one stop action, and a fresh load no longer offers it;
 *   4. no page error and no refused gateway request.
 * SABOTAGE (`--sabotage-stop`): the gateway refuses the stop action, so the checks that read the DATABASE must go red; this
 * is what proves the proof does not read the page's own "Stopped." message. `--dump` prints what the page draws and exits.
 */
import { chromium } from 'playwright'
import { serveStudio } from '../verify/serve-studio.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'bq'
const SABOTAGE = process.argv.includes('--sabotage-stop')
const DUMP = process.argv.includes('--dump')
const db = await isolated(dbName)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const json = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const run = Date.now().toString(36)

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const EMAIL = `series-${run}@example.invalid`
const SESSION = `aaa.bbb.${'s'.repeat(70)}`
const PORT = 4657
const env = {
  HQ_API_TOKEN: 'isolated-hq-token',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: `http://127.0.0.1:${String(PORT)}`,
}
await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(EMAIL)})`)
const OFFICE = String(
  json(
    (
      await one(
        `select app.provision_person_office('Series Person', ${lit(EMAIL)}, ${lit(`series-${run}`)}) as r`,
      )
    ).r,
  ).office_id,
)
const O = `${lit(OFFICE)}::uuid`
/** The office's own today: the page's Today list is read on the office clock, not UTC. */
const TODAY = `(timezone(app.office_timezone(${O}), now()))::date`

/**
 * A reminder SERIES made with the real writers: NO due date (a repeating task with a due date is a different thing, which
 * makes its next copy when ticked), a reminder that is DUE NOW (the Today list holds a reminder whose time has come, so the
 * proof does not depend on the hour it runs or on the office's clock), and a repeat that runs from done.
 */
const mkSeries = async (title: string): Promise<string> => {
  const at = String((await one(`select (now() - interval '1 minute')::text as t`)).t)
  const made = json(
    (
      await one(
        `select app.my_task_add(${O}, ${lit(title)}, '', null, ${lit(at)}::timestamptz) as v`,
      )
    ).v,
  )
  const set = json(
    (
      await one(
        `select app.my_task_set(${O}, ${lit(String(made.id))}, p_repeat_every => interval '7 days', p_repeat_from => 'done') as v`,
      )
    ).v,
  )
  if (set.ok !== true) throw new Error(`could not make a series: ${JSON.stringify(set)}`)
  return String(made.id)
}
const mkPlain = async (title: string): Promise<string> =>
  String(
    json((await one(`select app.my_task_add(${O}, ${lit(title)}, '', ${TODAY}, null) as v`)).v).id,
  )

const stateOf = async (
  id: string,
): Promise<{ state: string; remind: string | null; completed: string | null }> => {
  const r = await one(
    `select state, remind_at::text as remind, last_completed_for::text as completed from public.tasks where task_id = ${lit(id)}::uuid`,
  )
  return {
    state: String(r.state),
    remind: r.remind === null ? null : String(r.remind),
    completed: r.completed === null ? null : String(r.completed),
  }
}

const authUsers: Record<string, string> = { [SESSION]: EMAIL }
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })
const signin = await startEdge({
  db,
  edgeFile: 'supabase/functions/signin/index.ts',
  env,
  authUsers,
})
const GW = 'https://gw.invalid/functions/v1'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}
const server = await serveStudio(PORT)
const APP = `http://127.0.0.1:${String(PORT)}`
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })

type Seen = { pageErrors: string[]; bad: string[]; stopCalls: number }
const openPage = async (vp: { w: number; h: number; touch: boolean }) => {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: vp.touch,
    isMobile: vp.touch,
  })
  const seen: Seen = { pageErrors: [], bad: [], stopCalls: 0 }
  await ctx.route(`${GW}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const fn = url.pathname.split('/').pop() ?? ''
    const edge = fn === 'signin' ? signin : fn === 'hq-api' ? gw : null
    if (edge === null)
      return route.fulfill({ status: 404, headers: CORS, body: '{"error":"not served here"}' })
    const body = req.postData() ?? undefined
    if (/reminder_series_stop/.test(`${url.search}${body ?? ''}`)) {
      seen.stopCalls += 1
      if (SABOTAGE) {
        return route.fulfill({
          status: 500,
          headers: { ...CORS, 'content-type': 'application/json' },
          body: '{"error":"sabotage: the stop action is refused"}',
        })
      }
    }
    const res = await edge.call(
      new Request(req.url(), {
        method: req.method(),
        headers: req.headers(),
        ...(body === undefined ? {} : { body }),
      }),
    )
    return route.fulfill({
      status: res.status,
      headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' },
      body: await res.text(),
    })
  })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|gw\.invalid)/, (route) => route.abort())
  await ctx.addInitScript(`window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin';`)
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${SESSION}', refresh_token: 'r', expires_at: Date.now() + 36e5 })) } catch {}`,
  )
  const page = await ctx.newPage()
  page.on('pageerror', (e) => seen.pageErrors.push(e.message.slice(0, 200)))
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(GW))
      seen.bad.push(`${r.status()} ${r.url().replace(GW, '')}`.slice(0, 160))
  })
  return { page, seen, close: () => ctx.close() }
}

try {
  const VIEWPORTS = [
    { name: 'desktop 1440', w: 1440, h: 900, touch: false },
    { name: 'phone 390', w: 390, h: 844, touch: true },
  ]
  for (const vp of VIEWPORTS) {
    // Each leg has its own series and ordinary task, so one leg's stop cannot stand in for the other's.
    // Two series: one is ticked, one is stopped. After a tick the next reminder is a week away, so it leaves the Today list
    // (the only list Team HQ's My Tasks draws) and cannot be stopped from there until it is due again; that is checked, not hidden.
    const ticked = await mkSeries(`Weekly review A ${vp.name} ${run}`)
    const series = await mkSeries(`Weekly review B ${vp.name} ${run}`)
    const plain = await mkPlain(`Plain task ${vp.name} ${run}`)
    const { page, seen, close } = await openPage(vp)
    try {
      await page.goto(`${APP}/tasks`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.bctop', { timeout: 20000 })
      if (DUMP) {
        await page.waitForTimeout(3000)
        console.log(
          JSON.stringify({
            text: (await page.locator('#bcmain').innerText()).slice(0, 600),
            ids: await page.evaluate(
              `Array.from(document.querySelectorAll('[data-bc-mytick],[data-bc-mystopseries]')).map(function (e) { return e.getAttribute('data-bc-mytick') || ('stop:' + e.getAttribute('data-bc-mystopseries')) })`,
            ),
          }),
        )
        break
      }
      await page.waitForSelector(`[data-bc-mytick="${series}"]`, { timeout: 20000 })
      check(
        `${vp.name}: My Tasks lists the reminder series and the ordinary task`,
        (await page.locator(`[data-bc-mytick="${plain}"]`).count()) === 1,
      )
      check(
        `${vp.name}: the series offers Stop repeating`,
        (await page.locator(`[data-bc-mystopseries="${series}"]`).count()) === 1,
      )
      check(
        `${vp.name}: control: the ordinary task does not`,
        (await page.locator(`[data-bc-mystopseries="${plain}"]`).count()) === 0,
      )
      check(
        `${vp.name}: the series row says it repeats`,
        /repeats/i.test(
          await page
            .locator(`[data-bc-mytick="${series}"]`)
            .first()
            .evaluate((e) => e.closest('.bcitem')?.textContent ?? ''),
        ),
      )

      // Stop repeating is a 44px control on a phone like every other press.
      const box = await page.locator(`[data-bc-mystopseries="${series}"]`).first().boundingBox()
      check(
        vp.touch
          ? `${vp.name}: Stop repeating is at least 44px to touch`
          : `${vp.name}: Stop repeating is a real, sized control (the 44px floor is for touch)`,
        box !== null && box.width >= 43.5 && box.height >= (vp.touch ? 43.5 : 24),
        JSON.stringify(box),
      )

      // 2. tick the ordinary task and series A. A stays open with a later reminder; the ordinary task becomes done.
      const before = await stateOf(ticked)
      const beforeStop = await stateOf(series)
      await page.locator(`[data-bc-mytick="${plain}"]`).first().check({ force: true })
      await page.locator(`[data-bc-mytick="${ticked}"]`).first().check({ force: true })
      await page.waitForTimeout(2000)
      const afterSeries = await stateOf(ticked)
      const afterPlain = await stateOf(plain)
      check(
        `${vp.name}: ticking the ordinary task completes it (the tick is live)`,
        afterPlain.state === 'done',
        afterPlain.state,
      )
      check(
        `${vp.name}: ticking the series completes that time only: still open, a completion recorded, the reminder moved on`,
        afterSeries.state !== 'done' &&
          afterSeries.state !== 'cancelled' &&
          afterSeries.completed !== null &&
          afterSeries.remind !== null &&
          afterSeries.remind !== before.remind,
        JSON.stringify({ before: before.remind, after: afterSeries }),
      )

      // 3. Stop repeating on series B. Reload first so the page holds the office's answer, not its own memory.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.bctop', { timeout: 20000 })
      const stopBtn = page.locator(`[data-bc-mystopseries="${series}"]`).first()
      const stillOffered = await stopBtn
        .waitFor({ timeout: 6000 })
        .then(() => true)
        .catch(() => false)
      check(`${vp.name}: series B is still on the list and stoppable after a reload`, stillOffered)
      // The honest limit, stated as a check so it cannot drift: a ticked series is a week away and is not on Today's list.
      check(
        `${vp.name}: series A, ticked, is no longer on Today's list (its next reminder is a week away)`,
        (await page.locator(`[data-bc-mytick="${ticked}"]`).count()) === 0,
      )
      if (stillOffered) {
        await stopBtn.click({ force: true })
        await page.waitForTimeout(500)
        const afterFirst = await stateOf(series)
        check(
          `${vp.name}: the first press changes nothing and asks again`,
          afterFirst.state === beforeStop.state &&
            seen.stopCalls === 0 &&
            /again/i.test((await stopBtn.textContent()) ?? ''),
          JSON.stringify({ afterFirst, calls: seen.stopCalls }),
        )
        await stopBtn.click({ force: true })
        await page.waitForTimeout(2500)
        const stopped = await stateOf(series)
        check(
          `${vp.name}: the second press cancels that series in the database`,
          stopped.state === 'cancelled',
          JSON.stringify(stopped),
        )
        check(
          `${vp.name}: the page sent exactly one stop action`,
          seen.stopCalls === 1,
          String(seen.stopCalls),
        )
        const other = await stateOf(plain)
        check(
          `${vp.name}: nothing else was touched (the ordinary task is as it was)`,
          other.state === 'done',
          other.state,
        )
        const due = await one(
          `select count(*)::int as c from app.reminders_due(${O}, interval '400 days') x where x::text like ${lit(`%${series}%`)}`,
        )
        check(
          `${vp.name}: a stopped series is not due again`,
          Number(due.c) === 0,
          `rows naming it: ${String(due.c)}`,
        )
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.bctop', { timeout: 20000 })
        await page.waitForTimeout(1500)
        check(
          `${vp.name}: a fresh load no longer offers to stop it`,
          (await page.locator(`[data-bc-mystopseries="${series}"]`).count()) === 0,
        )
      }
      check(`${vp.name}: no page error`, seen.pageErrors.length === 0, seen.pageErrors.join(' | '))
      const realErrors = seen.bad.filter((b) => !SABOTAGE || !/reminder_series_stop/.test(b))
      check(
        `${vp.name}: no refused gateway request`,
        realErrors.length === 0,
        realErrors.join(' | '),
      )
    } finally {
      await close()
    }
  }
} finally {
  await browser.close()
  server.close()
  await db.end()
}

console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exitCode = failed === 0 ? 0 : 1
