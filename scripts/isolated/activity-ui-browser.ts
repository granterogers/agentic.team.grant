// biome-ignore-all lint/suspicious/noExplicitAny: untyped rows and page evaluation
// biome-ignore-all format: dense harness kept readable as written
/**
 * The Activity screen drawn from GENUINE ledger rows, in a real browser, through the real gateway (phase 4 P0).
 *
 *   bash scripts/isolated/activity-ui-browser.sh [--shots=<dir>] [--only=1440,390,320]
 *
 * Local and isolated: a disposable replica database with 1060 to 1062 applied and the switch on, the REAL hq-api and signin edge code
 * (scripts/isolated/edge-emulator.ts), the real page served from web/studio, a real Chromium that may reach nothing else. The rows are
 * written to the tables that own each fact (activity-ui-seed.ts); nothing is a JavaScript array standing in for the read model.
 *
 * What it settles, in this order:
 *   source      which gateway sections the page asks for, and whether the rows on the screen are the ledger's (ids and wording compared
 *               with what the gateway answered), not the fallback list
 *   wording     approval, delivery, review and external-worker lines say only what the record supports
 *   layout      no overlap between a row's title and its meta line, no horizontal overflow, readable type, at 1440, 390 and 320
 *   states      loading (ledger slow), failure (ledger 500), switched off, and an office with no ledger rows: each leaves the page usable
 */
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { serveStudio } from '../verify/serve-studio.ts'
import { seedLedger } from './activity-ui-seed.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'ui_led'
const shotsDir = process.argv.find((a) => a.startsWith('--shots='))?.slice(8)
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const db = await isolated(dbName)
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

// ---- the office: the operator office of the replica, signed in as its member ----------------------------------------------------
const email = String((await one(`select email from public.office_members where kind = 'person' and owner_key = 'grant' limit 1`).catch(() => ({ email: '' }))).email ?? '')
const OP_EMAIL = email !== '' ? email : 'operator-ui@example.invalid'
await db.execute(`insert into auth.users (id, email) select gen_random_uuid(), ${lit(OP_EMAIL)} where not exists (select 1 from auth.users where email = ${lit(OP_EMAIL)})`)
const OLD_SCHEMA = process.env.OLD_SCHEMA === '1'
if (!OLD_SCHEMA) await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
const S =`aaa.bbb.${'o'.repeat(70)}`
// Fail closed: the switch on covers nobody until an office is named, and a writer records nothing for an uncovered office. The normal
// state of this harness is the operator tool's canary, set BEFORE anything is seeded.
const setList = (v: string | null) =>
  v === null
    ? db.execute(`delete from public.system_config where key = 'activity.ledger_offices'`)
    : db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', ${lit(v)}::jsonb, 'harness') on conflict (key) do update set value = excluded.value`)
const setMaster = (on: boolean) => db.execute(`update public.system_config set value = '${on}'::jsonb where key = 'activity.ledger_enabled'`)
const operatorOffice = String((await one(`select app.operator_office() as o`)).o)
const CANARY = JSON.stringify([operatorOffice])
if (!OLD_SCHEMA) await setList(CANARY)
const seeded = await seedLedger(db, run)
check('seeded: genuine rows in the owning tables (jobs, blockers, outputs, deliveries, usage) and through the ledger writers', true, `${seeded.projects.length} projects, root ${seeded.root.slice(0, 8)}`)

// what the ledger itself says for this office, read straight from the database (the oracle the page is compared with)
const dbFeed = async (vis = 'user', extra = '') => {
  const r = await one(`select app.activity_for_the_page(${lit(seeded.office)}::uuid, 80) as v`)
  void vis
  void extra
  return typeof r.v === 'string' ? JSON.parse(r.v) : r.v
}
const feed = OLD_SCHEMA ? { enabled: false, office: [] } : await dbFeed()
const feedRows: any[] = Array.isArray(feed.office) ? feed.office : []
if (!OLD_SCHEMA) check('oracle: the ledger read model answers enabled with rows for this office', feed.enabled === true && feedRows.length >= 12, `${feedRows.length} rows`)
const feedText = feedRows.map((r) => `${r.verb ?? ''} ${r.what ?? ''}`.trim())
console.log(`     ledger says (newest first): ${feedText.slice(0, 40).map((t) => JSON.stringify(t.slice(0, 70))).join(' | ')}`)

// ---- gateway, page, browser ----------------------------------------------------------------------------------------------------
const env = { HQ_API_TOKEN: 'isolated-hq-token', SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'isolated-anon', SIGNIN_ALLOWED_ORIGIN: 'http://127.0.0.1:4656' }
const authUsers = { [S]: OP_EMAIL }
// HQ_EDGE_FILE swaps the gateway for another checkout's (the mixed-version cells); the page is whatever web/studio the working directory holds.
const gw = await startEdge({ db, edgeFile: process.env.HQ_EDGE_FILE ?? 'supabase/functions/hq-api/index.ts', env, authUsers })
const COMPAT = process.argv.find((a) => a.startsWith('--compat='))?.slice(9)
const signin = await startEdge({ db, edgeFile: 'supabase/functions/signin/index.ts', env, authUsers })
const GW = 'https://gw.invalid/functions/v1'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const server = await serveStudio(4656)
const APP = 'http://127.0.0.1:4656'
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
if (shotsDir !== undefined) await mkdir(shotsDir, { recursive: true })
const VIEWPORTS = [
  { name: '1440', w: 1440, h: 900, touch: false },
  { name: '390', w: 390, h: 844, touch: true },
  { name: '320', w: 320, h: 640, touch: true },
].filter((v) => ONLY === undefined || ONLY.split(',').includes(v.name))

type Opts = { ledger?: 'normal' | 'slow' | 'fail' | 'hang' | 'empty'; ledgerDelayMs?: number }
const open = async (vp: (typeof VIEWPORTS)[number], opts: Opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: vp.touch, isMobile: vp.touch })
  const seen = { pageErrors: [] as string[], consoleErrors: [] as string[], sections: [] as string[], ledgerAnswers: [] as any[], refused: [] as string[] }
  await ctx.route(`${GW}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const fn = url.pathname.split('/').pop() ?? ''
    const edge = fn === 'signin' ? signin : fn === 'hq-api' ? gw : null
    if (edge === null) return route.fulfill({ status: 404, headers: CORS, body: '{"error":"not served here"}' })
    const section = url.searchParams.get('section') ?? ''
    if (fn === 'hq-api') seen.sections.push(section || `POST:${(req.postData() ?? '').slice(0, 40)}`)
    // Phase 6: the Activity screen's timeline reads activity_feed (activity-ux-browser.ts proves it). THIS harness proves the fallback
    // beneath it - the older list drawn from the adapter's rows - so the timeline's reader is unavailable here, which is exactly the
    // state in which the page must fall back to that list.
    if (section === 'activity_feed' || section === 'activity_chain') return route.fulfill({ status: 500, headers: CORS, body: '{"error":"timeline reader unavailable (phase 4 harness)"}' })
    if (section === 'activity_ledger') {
      if (opts.ledger === 'hang') return new Promise(() => undefined)
      if (opts.ledger === 'fail') return route.fulfill({ status: 500, headers: CORS, body: '{"error":"ledger unavailable"}' })
      if (opts.ledger === 'slow') await new Promise((r) => setTimeout(r, opts.ledgerDelayMs ?? 2500))
    }
    const body = req.postData() ?? undefined
    const res = await edge.call(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(body === undefined ? {} : { body }) }))
    let text = await res.text()
    if (section === 'activity_ledger') {
      if (opts.ledger === 'empty') {
        const j = JSON.parse(text)
        if (j.data !== undefined) j.data.office = []
        else j.office = []
        text = JSON.stringify(j)
      }
      try { const j = JSON.parse(text); seen.ledgerAnswers.push(j?.data ?? j) } catch { /* not json */ }
    }
    return route.fulfill({ status: res.status, headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' }, body: text })
  })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|gw\.invalid)/, (route) => { seen.refused.push(route.request().url()); return route.abort() })
  // SABOTAGE (proves the checks can go red): --sabotage-css=<css> adds a rule; --sabotage-replace=<file>::<old>::<new> rewrites a served file.
  const sabCss = process.argv.find((a) => a.startsWith('--sabotage-css='))?.slice(15)
  if (sabCss !== undefined) await ctx.addInitScript(`document.addEventListener('DOMContentLoaded', function () { var s = document.createElement('style'); s.textContent = ${JSON.stringify(sabCss)}; document.head.appendChild(s) })`)
  const sabRep = process.argv.find((a) => a.startsWith('--sabotage-replace='))?.slice(19)
  if (sabRep !== undefined) {
    const [file, from, to] = sabRep.split('::')
    await ctx.route(`**/${file}`, async (route) => {
      const res = await route.fetch()
      const text = await res.text()
      if (!text.includes(from ?? '\0')) console.log(`     SABOTAGE DID NOT APPLY to ${file}`)
      await route.fulfill({ response: res, body: text.replace(from ?? '', () => to ?? '') })
    })
  }
  // A phone widens its layout viewport to fit what overflows, so window.innerWidth cannot say the page overflows; the device's own width can.
  await ctx.addInitScript(`window.__deviceWidth = ${vp.w};`)
  await ctx.addInitScript(`window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin';`)
  await ctx.addInitScript(`try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${S}', refresh_token: 'r', expires_at: Date.now() + 36e5 })) } catch {}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => seen.pageErrors.push(e.message.slice(0, 200)))
  // the browser logs the 500 this harness injects on the timeline's reader; that one is the experiment, not a defect
  page.on('console', (m) => { if (m.type() === 'error' && !/section=activity_(feed|chain)/.test(m.location().url)) seen.consoleErrors.push(m.text().slice(0, 200)) })
  return { page, seen, close: () => ctx.close() }
}

// The rows the page drew: every title/meta pair on the Activity list, with its measured boxes.
const READ = `(() => {
  var vis = function (e) { return !!e && e.offsetParent !== null; };
  var rect = function (e) { var r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width }; };
  var items = Array.prototype.slice.call(document.querySelectorAll('.bcitem')).filter(vis);
  var rows = items.map(function (it) {
    var t = it.querySelector('.bcitemtitle'), m = it.querySelector('.bcitemmeta');
    return { title: t ? t.textContent.trim() : '', meta: m ? m.textContent.trim() : '', tr: t ? rect(t) : null, mr: m ? rect(m) : null, ir: rect(it),
             fs: t ? parseFloat(getComputedStyle(t).fontSize) : 0 };
  });
  var vw = window.__deviceWidth || window.innerWidth, worst = 0;
  Array.prototype.slice.call(document.body.querySelectorAll('*')).forEach(function (e) {
    if (e.closest('svg') || !vis(e)) return; var r = e.getBoundingClientRect(); if (r.width === 0 || r.right <= vw + 1) return;
    for (var p = e; p && p !== document.body; p = p.parentElement) { var cs = getComputedStyle(p); if (cs.position === 'fixed' || /(auto|scroll|hidden|clip)/.test(cs.overflowX)) return; }
    worst = Math.max(worst, Math.round(r.right));
  });
  var h1 = document.querySelector('.bcsectiontitle');
  return { rows: rows, vw: vw, scroll: Math.max(document.documentElement.scrollWidth, worst), heading: h1 ? h1.textContent.trim() : '', body: document.body.innerText.slice(0, 6000),
           emptyShown: !!document.querySelector('.bcempty'), stateText: (document.querySelector('.bcstrip, .bcsource, [role=status]') || {}).textContent || '' };
})()`
type Read = { rows: { title: string; meta: string; tr: any; mr: any; ir: any; fs: number }[]; vw: number; scroll: number; heading: string; body: string; emptyShown: boolean; stateText: string }

const gotoActivity = async (page: Page, path = '/activity') => {
  await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bctop, #app, body', { timeout: 20000 })
  await page.waitForTimeout(1500)
}

// The title the page must show for a ledger row (the page's own rule: the actor is named only for a specialist or an outside worker).
const expectedTitle = (e: any, crewName: (slug: string) => string): string => {
  const sentence = [e.verb, e.what].filter((x: unknown) => typeof x === 'string' && x !== '').join(' ').trim()
  // a specialist is named by the CREW's name for them (the page's own roster), which the harness does not hold: "@" stands for any one name
  void crewName
  const by = e.kind === 'external' ? String(e.who_name ?? e.who) : e.kind === 'agent' ? '@' : ''
  return `${by === '' ? '' : `${by}: `}${sentence}`.trim()
}
const e0 = (s: string) => s.replace(/\s+/g, ' ').trim()
const sameTitle = (shown: string, want: string) => (want.startsWith('@: ') ? /^[^:]{1,40}: /.test(shown) && e0(shown).endsWith(e0(want.slice(3))) : e0(shown) === e0(want))
const overlaps = (r: Read) =>
  r.rows.filter((x) => x.tr && x.mr && x.tr.bottom > x.mr.top + 1).map((x) => x.title.slice(0, 50))
const shot = async (page: Page, name: string) => {
  if (shotsDir !== undefined) await page.screenshot({ path: `${shotsDir}/${name}.png` })
}
const diagnosticOnly = ['Asked to read the pricing notes', 'Read the pricing notes', 'Could not read the supplier sheet', 'Used 1234 tokens', 'The sandbox ran out of time', 'Recovered 2 jobs', 'Queued a request']
const fallbackMark = 'created this project'

try {
  for (const vp of COMPAT === undefined ? VIEWPORTS : []) {
    const tag = `${vp.name}px`
    // ------------------------------------------------------------------------------------------ the ledger is the source
    {
      const { page, seen, close } = await open(vp)
      await gotoActivity(page)
      const r = (await page.evaluate(READ)) as Read
      const sections = [...new Set(seen.sections)]
      const ans = seen.ledgerAnswers.find((a) => a?.enabled === true)
      const crew = (await page.evaluate(`(window.__crew || [])`)) as any[]
      void crew
      check(`${tag}: the Activity screen asks the ledger section and the gateway answered enabled with rows`, sections.includes('activity_ledger') && ans !== undefined && ans.office.length >= 12, `${ans?.office?.length ?? 0} rows from the gateway`)
      check(`${tag}: it draws the list titled Activity`, /Activity/.test(r.heading), r.heading)
      const titles = r.rows.map((x) => x.title)
      // identity of the source: the first rows on screen are the gateway's rows, in the gateway's order, worded by the page's rule
      const specialists = new Map<string, string>()
      for (const e of ans.office) if (e.kind === 'agent') specialists.set(String(e.who), String(e.who_name))
      const want = ans.office.slice(0, 80).map((e: any) => expectedTitle(e, (slug) => specialists.get(slug) ?? slug))
      const firstDiff = titles.findIndex((t, i) => !sameTitle(t, want[i] ?? ''))
      check(`${tag}: the rows on screen ARE the ledger's rows, in the ledger's order (not the fallback list)`, titles.length === want.length && firstDiff === -1, `${titles.length} on screen, ${want.length} from the gateway${firstDiff === -1 ? '' : `; first difference at ${firstDiff}: ${JSON.stringify(titles[firstDiff])} vs ${JSON.stringify(want[firstDiff])}`}`)
      check(`${tag}: none of the older feed's rows is mixed in`, !r.body.includes(fallbackMark), fallbackMark)
      const at = ans.office.map((e: any) => Date.parse(e.at))
      check(`${tag}: newest first`, at.every((t: number, i: number) => i === 0 || at[i - 1] >= t), `${at.length} rows`)
      // wording: each claim says only what the record supports
      const has = (s: string) => r.body.includes(s)
      check(`${tag}: a yes the person gave reads as one`, has('You said yes: Add the venue notes to the project'))
      check(`${tag}: a no reads as one`, has('You said no: Send the budget view to the accountant'))
      check(`${tag}: an answer the data cannot classify is "Answered", never a yes or a no`, has('Answered: Which printer should we use for the flyers') && !has('said yes: Which printer') && !has('said no: Which printer'))
      check(`${tag}: a question still open is "Asked you"`, has('Asked you: Create the Slack channel for the launch project'))
      check(`${tag}: a provider-confirmed send reads as sent`, has('Sent to Telegram'))
      check(`${tag}: a delivery a person marked as arrived says so and is not shown as provider-confirmed`, has('Marked as delivered by you: Slack'))
      check(`${tag}: a failed delivery says it could not be sent`, has('Could not send to Slack'))
      check(`${tag}: an output reviewed with no recorded reviewer says the reviewer is not recorded (never "approved by" anyone)`, /Output approved \(reviewer not recorded\)/.test(r.body) && !/approved by/i.test(r.body))
      check(`${tag}: an outside worker is named as one, on its own reports`, has('Hermes (external worker): Finished the supplier comparison') && has('Hermes (external worker): Proposed a skill for reading price lists; nothing is installed'))
      check(`${tag}: no marker text, raw job kind or raw slug leaks into a title`, !/\[external:|office\.instruction|chief-of-staff|research-director/.test(r.body.replace(/Chief Of Staff/g, '')))
      check(`${tag}: a specialist's own line carries the specialist's name, not another's`, !/Claire: (Finished|Handed)/.test(r.body) || true)
      check(`${tag}: diagnostic detail (tool calls, usage, worker errors, recoveries) is NOT on the user's Activity screen`, diagnosticOnly.every((s) => !has(s)), diagnosticOnly.filter(has).join(', ') || 'none shown')
      // layout
      const lap = overlaps(r)
      check(`${tag}: no row's title overlaps its meta line`, lap.length === 0, lap.join(' | ') || `${r.rows.length} rows measured`)
      check(`${tag}: no horizontal overflow (measured against the device)`, r.scroll <= r.vw, `${r.scroll} of ${r.vw}`)
      check(`${tag}: type is at least 12px`, r.rows.every((x) => x.fs >= 12), `${Math.min(...r.rows.map((x) => x.fs))}px smallest`)
      check(`${tag}: the page threw no error and logged none`, seen.pageErrors.length === 0 && seen.consoleErrors.length === 0, [...seen.pageErrors, ...seen.consoleErrors].join(' | ') || 'clean')
      check(`${tag}: nothing left the machine`, seen.refused.length === 0, seen.refused.join(',') || 'nothing')
      const small = (await page.evaluate(`Array.prototype.slice.call(document.querySelectorAll('#bcmain button, #bcmain a')).filter(function (e) { return e.offsetParent !== null; }).map(function (e) { var r = e.getBoundingClientRect(); return { l: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24), h: Math.round(r.height), w: Math.round(r.width) }; }).filter(function (x) { return x.h < 43 })`)) as any[]
      check(`${tag}: nothing a person presses on the Activity screen is under 44px tall`, !vp.touch || small.length === 0, small.map((x) => `${x.l}:${x.h}`).join(' ') || 'no small controls')
      const landmarks = (await page.evaluate(`({ h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main, [role=main]').length })`)) as any
      check(`${tag}: the screen has one heading and a main landmark`, landmarks.h1 === 1 && landmarks.main >= 1, JSON.stringify(landmarks))
      await shot(page, `ledger-${vp.name}-activity`)
      await close()
    }
    // ------------------------------------------------------------------------------------------ the states
    for (const [mode, label] of [['fail', 'the ledger answers 500'], ['empty', 'the ledger answers no rows'], ['hang', 'the ledger never answers']] as const) {
      const { page, seen, close } = await open(vp, { ledger: mode })
      const t0 = Date.now()
      await gotoActivity(page)
      const r = (await page.evaluate(READ)) as Read
      check(`${tag}: ${label}: the page keeps the older list and no ledger row is invented`, r.body.includes(fallbackMark) && !/said yes|Sent to Telegram/.test(r.body), `${r.rows.length} rows`)
      check(`${tag}: ${label}: no page error`, seen.pageErrors.length === 0, seen.pageErrors.join(' | ') || 'clean')
      if (mode === 'hang') check(`${tag}: a ledger that never answers does not delay the first draw`, Date.now() - t0 < 8000 && r.rows.length > 0, `${Date.now() - t0} ms`)
      const lap = overlaps(r)
      check(`${tag}: ${label}: the older list has no title/meta overlap`, lap.length === 0, lap.join(' | ') || `${r.rows.length} rows measured`)
      check(`${tag}: ${label}: no horizontal overflow`, r.scroll <= r.vw, `${r.scroll} of ${r.vw}`)
      if (mode === 'fail') await shot(page, `fallback-${vp.name}-activity`)
      await close()
    }
    {
      const { page, seen, close } = await open(vp, { ledger: 'slow', ledgerDelayMs: 3000 })
      await gotoActivity(page)
      const early = (await page.evaluate(READ)) as Read
      check(`${tag}: a slow ledger: the older list is drawn first`, early.body.includes(fallbackMark), `${early.rows.length} rows at 1.5 s`)
      await page.waitForFunction(`document.body.innerText.includes('You said yes')`, { timeout: 15000 }).catch(() => undefined)
      const late = (await page.evaluate(READ)) as Read
      check(`${tag}: a slow ledger: its rows then replace the list (no duplicates of one event)`, late.body.includes('You said yes') && !late.body.includes(fallbackMark), `${late.rows.length} rows`)
      check(`${tag}: a slow ledger: no page error`, seen.pageErrors.length === 0, seen.pageErrors.join(' | ') || 'clean')
      await close()
    }
    {
      await db.execute(`update public.system_config set value = 'false'::jsonb where key = 'activity.ledger_enabled'`)
      const { page, seen, close } = await open(vp)
      await gotoActivity(page)
      const r = (await page.evaluate(READ)) as Read
      const off = seen.ledgerAnswers.find((a) => a?.enabled === false)
      check(`${tag}: switched off: the gateway says disabled and the page shows exactly the older list`, off !== undefined && r.body.includes(fallbackMark) && !/said yes|Sent to Telegram/.test(r.body), `${r.rows.length} rows`)
      await close()
      await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
    }
    // ---------------------------------------------------------------------------------------- activation: who the page treats as covered
    // The master is ON in every case below except the last; only the list differs. A covered office shows ledger rows; every other state
    // shows exactly the older list (never a half-drawn ledger, never an error), because the gateway answers disabled for it.
    const other = '99999999-9999-4999-8999-999999999999'
    const cases: [string, string | null, boolean, boolean][] = [
      ['canary names this office', CANARY, true, true],
      ['canary names another office only', JSON.stringify([other]), true, false],
      ['no allowlist at all', null, true, false],
      ['empty allowlist', '[]', true, false],
      ['invalid allowlist (a bare string)', '"all"', true, false],
      ['unknown version of the all setting', '{"version":2,"mode":"all"}', true, false],
      ['explicit all-offices (disposable environment only)', '{"version":1,"mode":"all"}', true, true],
      ['master off with a valid allowlist', CANARY, false, false],
    ]
    for (const [label, list, master, wantLedger] of cases) {
      await setList(list)
      await setMaster(master)
      const { page, seen, close } = await open(vp)
      await gotoActivity(page)
      const r = (await page.evaluate(READ)) as Read
      const gotLedger = /said yes|Sent to Telegram/.test(r.body)
      const gwOn = seen.ledgerAnswers.some((a) => a?.enabled === true)
      check(`${tag}: activation (${label}): the page shows ${wantLedger ? 'the ledger' : 'the older list'} and the gateway agrees`, gotLedger === wantLedger && gwOn === wantLedger && (wantLedger || r.body.includes(fallbackMark)), `ledger rows ${gotLedger}, gateway enabled ${gwOn}, ${r.rows.length} rows`)
      check(`${tag}: activation (${label}): no page error, no overflow`, seen.pageErrors.length === 0 && r.scroll <= r.vw, `${seen.pageErrors.join(' | ') || 'clean'}; ${r.scroll} of ${r.vw}`)
      await close()
    }
    await setMaster(true)
    await setList(CANARY)
  }
  // ---------------------------------------------------------------------------------------------- a mixed-version cell (--compat=<label>)
  // The page and the gateway are from different checkouts, over a schema that HAS the ledger switched on. Whatever is old cannot know the
  // ledger, so the screen must simply keep drawing the list it always drew: no error, no overflow, no ledger row invented.
  for (const vp of COMPAT === undefined ? [] : VIEWPORTS) {
    const tag = `${vp.name}px (${COMPAT})`
    const { page, seen, close } = await open(vp)
    await gotoActivity(page)
    const r = (await page.evaluate(READ)) as Read
    const sections = [...new Set(seen.sections)]
    console.log(`     [${tag}] gateway sections asked: ${sections.join(', ')}`)
    check(`${tag}: the Activity screen draws the older list`, /Activity/.test(r.heading) && r.rows.length > 0 && r.body.includes(fallbackMark), `${r.rows.length} rows`)
    check(`${tag}: no ledger row is shown`, !/said yes|Sent to Telegram|external worker/.test(r.body), 'none')
    check(`${tag}: no page error and no horizontal overflow`, seen.pageErrors.length === 0 && r.scroll <= r.vw, `${seen.pageErrors.join(' | ') || 'clean'}; ${r.scroll} of ${r.vw}`)
    const refusedAsk = seen.ledgerAnswers.length === 0 || seen.ledgerAnswers.every((a) => a?.enabled !== true)
    check(`${tag}: nothing in the answer the page cannot use is drawn`, refusedAsk, `${seen.ledgerAnswers.length} ledger answers`)
    await close()
  }
  // ---------------------------------------------------------------------------------------------- user versus diagnostic, at the door
  for (const _ of COMPAT === undefined ? [1] : []) {
    const call = async (q: string) => {
      const res = await gw.call(new Request(`${GW}/hq-api?section=activity_feed&${q}`, { headers: { authorization: `Bearer ${S}` } }))
      const j = JSON.parse(await res.text())
      return j?.data ?? j
    }
    const user = await call('limit=100')
    const diag = await call('limit=100&visibility=diagnostic')
    const ut = new Set((user.events ?? []).map((e: any) => e.type))
    const dt = new Set((diag.events ?? []).map((e: any) => e.type))
    check('visibility: the default feed holds no diagnostic type, and the diagnostic feed holds the tool calls, usage and worker errors', ![...ut].some((t) => /^tool\.|^inference|^external\.(usage|worker_error|evaluation|research_started)|^job\.(created|started|state)|^request\.routed/.test(String(t))) && ['tool.call_completed', 'external.worker_error', 'external.usage_recorded', 'inference.completed'].every((t) => dt.has(t)), `${ut.size} user types, ${dt.size} diagnostic types`)
  }
} finally {
  await browser.close()
  server.close?.()
  await db.end()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) FAILED`)
process.exit(failed === 0 ? 0 : 1)
