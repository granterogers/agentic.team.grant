// biome-ignore-all lint/suspicious/noExplicitAny: untyped rows and page evaluation
// biome-ignore-all format: dense harness kept readable as written
/**
 * The Activity UX (phase 6) in a real browser, through the real gateway, over genuine ledger rows in a disposable replica.
 *
 *   bash scripts/isolated/activity-ux-browser.sh [--shots=<dir>] [--only=1440,768,390,320] [--baseline]
 *
 * Two offices are signed in: A (the operator's, in the canary) and B (a provisioned person, OUTSIDE it). Local only; the page is whatever
 * web/studio the working directory holds, so the same harness photographs the page before (--baseline) and after the change.
 */
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { seedAppearance } from '../verify/seed-appearance.ts'
import { serveStudio } from '../verify/serve-studio.ts'
import { seedLedger } from './activity-ui-seed.ts'
import { seedCycles, seedExternal, seedHistory } from './activity-ux-seed.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const dbName = process.argv[2] ?? 'ux_led'
const shotsDir = arg('shots')
const ONLY = arg('only')
const BASELINE = process.argv.includes('--baseline')
const db = await isolated(dbName)
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any
let failed = 0
let total = 0
export const check = (name: string, ok: boolean, detail = '') => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const timings: Record<string, number[]> = {}
const timed = async <T>(label: string, f: () => Promise<T>): Promise<T> => {
  const t = Date.now()
  const r = await f()
  timings[label] = [...(timings[label] ?? []), Date.now() - t]
  return r
}

// ---- two offices ----------------------------------------------------------------------------------------------------------------
const email = String((await one(`select email from public.office_members where kind = 'person' and owner_key = 'grant' limit 1`).catch(() => ({ email: '' }))).email ?? '')
const A_EMAIL = email !== '' ? email : 'operator-ux@example.invalid'
const B_EMAIL = `ux-b-${run}@example.com`
await db.execute(`insert into auth.users (id, email) select gen_random_uuid(), ${lit(A_EMAIL)} where not exists (select 1 from auth.users where email = ${lit(A_EMAIL)})`)
await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(B_EMAIL)})`)
await db.execute(`update public.offices set state = 'disabled', disabled_at = now() where kind = 'sample' and state = 'active'`)
const S_A = `aaa.bbb.${'o'.repeat(70)}`
const S_B = `aaa.bbb.${'p'.repeat(70)}`
const officeA = String((await one(`select app.operator_office() as o`)).o)
const officeB = String(json((await one(`select app.provision_person_office('Person B', ${lit(B_EMAIL)}, ${lit(`uxb-${run}`)}) as r`)).r).office_id)
const setList = (v: string | null) =>
  v === null
    ? db.execute(`delete from public.system_config where key = 'activity.ledger_offices'`)
    : db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', ${lit(v)}::jsonb, 'harness') on conflict (key) do update set value = excluded.value`)
const setMaster = (on: boolean) => db.execute(`update public.system_config set value = '${on}'::jsonb where key = 'activity.ledger_enabled'`)
await setMaster(true)
await setList(JSON.stringify([officeA]))

// ---- genuine rows ---------------------------------------------------------------------------------------------------------------
const seeded = await seedLedger(db, run)
const HISTORY = Number(arg('history') ?? 400)
const cyc = await seedCycles(db, seeded, run, Number(arg('cycles') ?? 60), 9)
console.log(`     cycles: ${JSON.stringify(cyc)}`)
const hist = await seedHistory(db, officeA, run, seeded.projects.map((p) => p.id), HISTORY, 9)
await seedExternal(db, officeA, run, (seeded.projects[0] as { id: string }).id)
const mkB = async (n: string) => String(json((await one(`select app.hq_create_project(${lit(officeB)}::uuid, ${lit(n)}, 'upload', ${lit(`${n}-${run}`.toLowerCase())}, ${lit(n)}, true) as v`)).v).project_id)
const projB = await mkB('Bravo Private')
// B's own record is written while B is covered (an uncovered office's writes are refused: fail closed), then B is taken OUT of the
// canary again, so the gateway must answer disabled for B although its record exists in the database.
await setList(JSON.stringify([officeA, officeB]))
await db.execute(`select app.record_activity(p_office => ${lit(officeB)}::uuid, p_event_type => 'budget.threshold_reached', p_idempotency_key => ${lit(`b-${run}`)}, p_actor_kind => 'system', p_actor => 'office', p_summary => 'BRAVO PRIVATE EVENT', p_project_id => ${lit(projB)}::uuid)`)
await setList(JSON.stringify([officeA]))
const bRows = Number((await one(`select count(*) as c from public.activity_events where office_id = ${lit(officeB)}::uuid`)).c)
check('seeded: office B holds its own ledger record in the database, and is outside the allowlist', bRows >= 1 && JSON.stringify(json((await one(`select value as v from public.system_config where key = 'activity.ledger_offices'`)).v)) === JSON.stringify([officeA]), `${bRows} row(s)`)
console.log(`     seeded: office A ${officeA.slice(0, 8)} (canary), office B ${officeB.slice(0, 8)} (outside); history ${hist.rows} rows over ${hist.days} days`)

// ---- gateway, page, browser -----------------------------------------------------------------------------------------------------
const env = { HQ_API_TOKEN: 'isolated-hq-token', SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'isolated-anon', SIGNIN_ALLOWED_ORIGIN: 'http://127.0.0.1:4657' }
const authUsers = { [S_A]: A_EMAIL, [S_B]: B_EMAIL }
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })
const signin = await startEdge({ db, edgeFile: 'supabase/functions/signin/index.ts', env, authUsers })
const GW = 'https://gw.invalid/functions/v1'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const server = await serveStudio(4657)
const APP = 'http://127.0.0.1:4657'
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
const VIEWPORTS = [
  { name: '1440', w: 1440, h: 900, touch: false },
  { name: '768', w: 768, h: 1024, touch: true },
  { name: '390', w: 390, h: 844, touch: true },
  { name: '320', w: 320, h: 640, touch: true },
].filter((v) => ONLY === undefined || ONLY.split(',').includes(v.name))

export type Mode = { as?: 'A' | 'B'; ledger?: 'normal' | 'slow' | 'fail' | 'hang'; delayMs?: number; delay?: (query: string) => number; reducedMotion?: boolean; scheme?: 'light' | 'dark' }
const open = async (vp: (typeof VIEWPORTS)[number], m: Mode = {}) => {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: vp.touch, isMobile: vp.touch, reducedMotion: m.reducedMotion ? 'reduce' : 'no-preference', colorScheme: m.scheme ?? 'light' })
  const seen = { pageErrors: [] as string[], consoleErrors: [] as string[], calls: [] as { section: string; query: string; ms: number; status: number; body: any }[], refused: [] as string[] }
  await ctx.route(`${GW}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const fn = url.pathname.split('/').pop() ?? ''
    const edge = fn === 'signin' ? signin : fn === 'hq-api' ? gw : null
    if (edge === null) return route.fulfill({ status: 404, headers: CORS, body: '{"error":"not served here"}' })
    const section = url.searchParams.get('section') ?? ''
    const isLedger = /^activity_/.test(section)
    if (isLedger && m.ledger === 'hang') return new Promise(() => undefined)
    if (isLedger && m.ledger === 'fail') return route.fulfill({ status: 500, headers: CORS, body: '{"error":"ledger unavailable"}' })
    if (isLedger && m.ledger === 'slow') await new Promise((r) => setTimeout(r, m.delayMs ?? 2500))
    if (isLedger && m.delay !== undefined) {
      const wait = m.delay(url.search)
      await new Promise((r) => setTimeout(r, wait))
    }
    const t0 = Date.now()
    const body = req.postData() ?? undefined
    const res = await edge.call(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(body === undefined ? {} : { body }) }))
    const text = await res.text()
    if (isLedger) { let j: any = null; try { j = JSON.parse(text) } catch { /* not json */ } seen.calls.push({ section, query: url.search, ms: Date.now() - t0, status: res.status, body: j?.data ?? j }) }
    return route.fulfill({ status: res.status, headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' }, body: text })
  })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|gw\.invalid)/, (route) => { seen.refused.push(route.request().url()); return route.abort() })
  // The scheme is asked for the way a person does, through the stored preference (the media query alone decides nothing in the studio).
  // SABOTAGE (proves the checks can go red): --sabotage-replace=<served file>::<old>::<new> rewrites a served file in flight.
  const sab = arg('sabotage-replace')
  if (sab !== undefined) {
    // several replacements are separated by ~~ (a second defence hides the first unless BOTH are removed)
    const edits = sab.split('~~').map((p) => p.split('::') as [string, string, string])
    for (const file of [...new Set(edits.map((e) => e[0]))]) {
      await ctx.route(`**/${file}`, async (route) => {
        const res = await route.fetch()
        let text = await res.text()
        for (const [, from, to] of edits.filter((e) => e[0] === file)) {
          console.log(text.includes(from ?? '\0') ? `     SABOTAGE APPLIED to ${file}` : `     SABOTAGE DID NOT APPLY to ${file}`)
          text = text.replace(from ?? '', () => to ?? '')
        }
        await route.fulfill({ response: res, body: text })
      })
    }
  }
  await ctx.addInitScript(seedAppearance(m.scheme ?? 'light'))
  await ctx.addInitScript(`window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin';`)
  await ctx.addInitScript(`try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${m.as === 'B' ? S_B : S_A}', refresh_token: 'r', expires_at: Date.now() + 36e5 })) } catch {}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => seen.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (x) => { if (x.type() === 'error') seen.consoleErrors.push(x.text().slice(0, 200)) })
  return { page, seen, close: () => ctx.close() }
}
const goto = async (page: Page, path: string, ready = 'main, .bcsectiontitle') => {
  await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(ready, { timeout: 20000 })
  await page.waitForTimeout(1800)
}
const shot = async (page: Page, name: string, full = false) => {
  if (shotsDir === undefined) return
  await mkdir(shotsDir, { recursive: true })
  await page.screenshot({ path: `${shotsDir}/${name}.png`, fullPage: full })
}
// Measured against the DEVICE's width (the context viewport), never window.innerWidth: a phone widens its layout viewport to fit whatever
// overflows, so innerWidth reads 964 on a 390px device with the defect live and a check against it can never fail.
const overflowOf = (page: Page) => page.evaluate(`(() => { var vw = ${page.viewportSize()?.width ?? 0}, worst = 0; Array.prototype.slice.call(document.body.querySelectorAll('*')).forEach(function (e) { if (e.closest('svg')) return; var r = e.getBoundingClientRect(); if (r.width === 0 || r.right <= vw + 1) return; for (var p = e; p && p !== document.body; p = p.parentElement) { var cs = getComputedStyle(p); if (cs.position === 'fixed' || /(auto|scroll|hidden|clip)/.test(cs.overflowX)) return } worst = Math.max(worst, Math.round(r.right)) }); return { vw: vw, scroll: Math.max(document.documentElement.scrollWidth, worst) } })()`) as Promise<{ vw: number; scroll: number }>

export const H = { db, one, json, check, timed, timings, open, goto, shot, overflowOf, VIEWPORTS, seeded, hist, officeA, officeB, projB, S_A, S_B, gw, APP, GW, setList, setMaster, run, shotsDir }

try {
  if (BASELINE) {
    // the page as it is, before any change: the full Activity page, the project's Activity tool and the project dashboard module
    for (const vp of VIEWPORTS) {
      const { page, seen, close } = await open(vp)
      await goto(page, '/activity')
      await shot(page, `baseline-activity-${vp.name}`)
      await shot(page, `baseline-activity-${vp.name}-full`, true)
      const slug = (seeded.projects[0] as { slug: string }).slug
      await goto(page, `/p/${slug}/activity`)
      await shot(page, `baseline-project-activity-${vp.name}`)
      await goto(page, `/p/${slug}`)
      await shot(page, `baseline-project-dashboard-${vp.name}`, true)
      const o = await overflowOf(page)
      check(`baseline ${vp.name}: captured (page errors ${seen.pageErrors.length}, overflow ${o.scroll} of ${o.vw})`, true)
      await close()
    }
  } else {
    const { runAll } = await import('./activity-ux-checks.ts')
    await runAll(H)
  }
} finally {
  await browser.close()
  server.close?.()
  await db.end()
}
console.log(failed === 0 ? `\nall ${total} checks passed` : `\n${failed} of ${total} check(s) FAILED`)
for (const [k, v] of Object.entries(timings)) console.log(`     timing ${k}: n=${v.length} median ${[...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]} ms, max ${Math.max(...v)} ms`)
process.exit(failed === 0 ? 0 : 1)
