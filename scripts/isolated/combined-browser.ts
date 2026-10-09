/**
 * The COMBINED product in a real browser: the Team HQ page, the REAL hq-api and signin edge functions, and the isolated
 * replica, with a PERSON office and the public SAMPLE office side by side. Local and isolated: no production, no network.
 *
 *   create a database from the replayed candidate (createdb bq template cand), then
 *   npx tsx scripts/isolated/combined-browser.ts <replica-db> [--shots=<dir>] [--only=<viewport>]
 *
 * Why it exists. The Sample integration and the Team HQ UX work were each browser-checked on their own: the Sample against the
 * deployed office, Team HQ against a prototype with no office behind it. Neither ever drew the Team HQ shell over the Sample
 * office through the merged gateway, and the one local suite that gave the page a writer by storing a made-up token
 * (verify:phone-header) measures a fiction the Sample's failed-read rule (#426) now correctly refuses. This draws the real
 * thing: a stored session for a real office, answered by the real gateway code against real rows.
 *
 * What is asserted, at 1440, 1280, 1024, 900, 768 and 390x844 (touch) plus the narrow phones 320, 360 and 430, and again with
 * reduced motion, as a PERSON and as a SAMPLE visitor: the shell draws, the projects the office holds are the ones named, no
 * page error, no horizontal overflow (measured against the DEVICE's width), the header keeps the project's name (70px at the
 * narrowest) and its 44px touch targets on a phone; a person signs out, a visitor leaves the sample and is told they are in
 * one; and the guest's refusal is the SENTENCE, and nothing was written. This is objective regression testing only: it does
 * not judge the look, and it closes neither HQ-VIS-001 nor HQ-VIS-003.
 *
 * Proving it can fail (each goes red, restored it goes green): `--sabotage-css=body{min-width:700px}` (overflow),
 * `--sabotage-css=.bcjumpname{display:none!important}` (the name), `--sabotage-bar` (the sample banner), with `--only=390`
 * or `--only=1440` to keep it short.
 */
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { serveStudio } from '../verify/serve-studio.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'bq'
const shotsArg = process.argv.find((a) => a.startsWith('--shots='))?.slice('--shots='.length)
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

// ---- the replica: a person office and the sealed sample office, each with projects, to-dos, an event and a document -------
const PERSON_EMAIL = `person-${run}@example.invalid`
const GUEST_EMAIL = `sample-${run}@example.invalid`
const S_PERSON = `aaa.bbb.${'p'.repeat(70)}`
const S_GUEST = `aaa.bbb.${'v'.repeat(70)}`
const authUsers: Record<string, string> = { [S_PERSON]: PERSON_EMAIL, [S_GUEST]: GUEST_EMAIL }
const env = {
  HQ_API_TOKEN: 'isolated-hq-token',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: 'http://127.0.0.1:4655',
}

await db.execute(
  `update public.offices set state = 'disabled', disabled_at = now() where kind = 'sample' and state = 'active'`,
)
for (const e of [PERSON_EMAIL, GUEST_EMAIL]) {
  await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(e)})`)
}
const PERSON_OFFICE = String(
  json(
    (
      await one(
        `select app.provision_person_office('Alex Person', ${lit(PERSON_EMAIL)}, ${lit(`person-${run}`)}) as r`,
      )
    ).r,
  ).office_id,
)
const SAMPLE_OFFICE = String(
  json(
    (
      await one(
        `select app.provision_sample_office('Sample Office', ${lit(GUEST_EMAIL)}, ${lit(`sample-${run}`)}) as r`,
      )
    ).r,
  ).office_id,
)

const seed = async (office: string, names: string[]): Promise<{ slug: string; name: string }[]> => {
  const made: { slug: string; name: string }[] = []
  for (const name of names) {
    const r = json(
      (
        await one(
          `select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`cb-${run}-${name.toLowerCase().replace(/\W+/g, '-')}`)}, ${lit(name)}, true) as v`,
        )
      ).v,
    )
    const id = String(r.project_id)
    const slug = String(
      (await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug,
    )
    for (const [i, t] of ['Draft the brief', 'Book the venue', 'Send the invoice'].entries()) {
      await db.execute(
        `select app.task_add(p_office => ${lit(office)}::uuid, p_project => ${lit(id)}::uuid, p_title => ${lit(`${t} (${name})`)},
           p_due_on => (current_date + ${i * 3 - 1})::date, p_added_by => 'harness')`,
      )
    }
    await db.execute(
      `select app.hq_event_add(${lit(office)}::uuid, ${lit(slug)}, ${lit(`Kick-off for ${name}`)}, now() + interval '1 day', now() + interval '1 day 1 hour')`,
    )
    await db.execute(
      `insert into public.documents (office_id, project_id, title, origin, state) values (${lit(office)}::uuid, ${lit(id)}::uuid, ${lit(`${name} plan`)}, 'yours', 'approved')`,
    )
    made.push({ slug, name })
  }
  return made
}
const PERSON_PROJECTS = await seed(PERSON_OFFICE, [
  `Riverside launch ${run}`,
  `Autumn campaign ${run}`,
  `The Extremely Long Legacy Coaching Course Programme For Senior Leadership ${run}`,
])
const SAMPLE_PROJECTS = await seed(SAMPLE_OFFICE, [`Harvest Lane ${run}`, `Winter market ${run}`])
await db.execute(`select app.sample_office_open(${lit(SAMPLE_OFFICE)}::uuid, false)`)
check(
  'the replica holds both offices (a person with three projects, the sealed sample with two)',
  PERSON_PROJECTS.length === 3 && SAMPLE_PROJECTS.length === 2,
)

// ---- the real gateway code, answered from the replica ------------------------------------------------------------------
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })
const signin = await startEdge({
  db,
  edgeFile: 'supabase/functions/signin/index.ts',
  env,
  authUsers,
})
const writes = { guestRefused: 0, guestAccepted: 0 }
const GW = 'https://gw.invalid/functions/v1'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

const server = await serveStudio(4655)
const APP = 'http://127.0.0.1:4655'
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
if (shotsArg !== undefined) await mkdir(shotsArg, { recursive: true })

const SABOTAGE_CSS = process.argv
  .find((a) => a.startsWith('--sabotage-css='))
  ?.slice('--sabotage-css='.length)
const SABOTAGE_BAR = process.argv.includes('--sabotage-bar')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
const ALL_VIEWPORTS: { name: string; w: number; h: number; touch: boolean }[] = [
  { name: '1440', w: 1440, h: 900, touch: false },
  { name: '1280', w: 1280, h: 800, touch: false },
  { name: '1024', w: 1024, h: 768, touch: false },
  { name: '900', w: 900, h: 700, touch: false },
  { name: '768', w: 768, h: 1024, touch: false },
  { name: '390', w: 390, h: 844, touch: true },
  // the narrowest phones, where the project's name once shrank to nothing (P5): the header property verify:phone-header
  // measured against an office that was not there, measured here against the real one
  { name: '320', w: 320, h: 640, touch: true },
  { name: '360', w: 360, h: 740, touch: true },
  { name: '430', w: 430, h: 932, touch: true },
]
const VIEWPORTS = ONLY === undefined ? ALL_VIEWPORTS : ALL_VIEWPORTS.filter((v) => v.name === ONLY)

type Seen = {
  pageErrors: string[]
  consoleErrors: string[]
  badResponses: string[]
  refused: string[]
}

const open = async (
  vp: (typeof VIEWPORTS)[number],
  who: 'person' | 'sample',
  reducedMotion: boolean,
): Promise<{ page: Page; seen: Seen; close: () => Promise<void> }> => {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: vp.touch,
    isMobile: vp.touch,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  })
  const seen: Seen = { pageErrors: [], consoleErrors: [], badResponses: [], refused: [] }
  await ctx.route(`${GW}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const fn = url.pathname.split('/').pop() ?? ''
    const edge = fn === 'signin' ? signin : fn === 'hq-api' ? gw : null
    if (edge === null)
      return route.fulfill({ status: 404, headers: CORS, body: '{"error":"not served here"}' })
    const body = req.postData() ?? undefined
    const res = await edge.call(
      new Request(req.url(), {
        method: req.method(),
        headers: req.headers(),
        ...(body === undefined ? {} : { body }),
      }),
    )
    const text = await res.text()
    if (fn === 'hq-api' && req.method() === 'POST') {
      if (res.status === 403 && /sample_readonly/.test(text)) writes.guestRefused += 1
      else if (who === 'sample' && res.status === 200 && !/"sample_say"/.test(body ?? ''))
        writes.guestAccepted += 1
    }
    return route.fulfill({
      status: res.status,
      headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' },
      body: text,
    })
  })
  // anything else off the machine (fonts, avatars, analytics) is refused, never forwarded
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|gw\.invalid)/, (route) => {
    seen.refused.push(route.request().url())
    return route.abort()
  })
  await ctx.addInitScript(`window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin';`)
  // SABOTAGE (proves the checks below can go red): break the page on purpose and read what fails.
  if (SABOTAGE_CSS !== undefined) {
    await ctx.addInitScript(
      `document.addEventListener('DOMContentLoaded', function () { var s = document.createElement('style'); s.textContent = ${JSON.stringify(SABOTAGE_CSS)}; document.head.appendChild(s) })`,
    )
  }
  if (SABOTAGE_BAR) {
    await ctx.route('**/bc/account.js', async (route) => {
      const res = await route.fetch()
      const text = (await res.text()).replace(
        'export const sampleBar = () =>',
        "export const sampleBar = () => '' ; const unusedBar = () =>",
      )
      await route.fulfill({ response: res, body: text })
    })
  }
  if (who === 'person') {
    await ctx.addInitScript(
      `try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${S_PERSON}', refresh_token: 'r', expires_at: Date.now() + 36e5 })) } catch {}`,
    )
  }
  const page = await ctx.newPage()
  page.on('pageerror', (e) => seen.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (m) => {
    if (m.type() === 'error') seen.consoleErrors.push(m.text().slice(0, 200))
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(GW))
      seen.badResponses.push(`${r.status()} ${r.url().replace(GW, '')}`.slice(0, 160))
  })
  return { page, seen, close: () => ctx.close() }
}

const MEASURE = `(() => {
  var vis = function (e) { return !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'; };
  var box = function (s) { var e = document.querySelector(s); if (!vis(e)) return null; var r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
  var top = document.querySelector('.bctop');
  var controls = top ? Array.prototype.slice.call(top.querySelectorAll('button')).filter(vis).map(function (b) { var r = b.getBoundingClientRect(); return { l: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }) : [];
  var so = document.querySelector('.bcsignout');
  var text = so ? so.querySelector('.bcsotext') : null;
  var running = (document.getAnimations ? document.getAnimations() : []).filter(function (a) { try { return a.playState === 'running' && a.effect.getTiming().iterations === Infinity; } catch (e) { return false; } }).length;
  // The widest right edge of anything a person can see and that is not inside its own scroller or fixed layer. The page may
  // clip its own overflow (overflow-x on body), which makes scrollWidth say nothing, so the elements are asked directly.
  var wideRight = function () {
    var vw = window.innerWidth, worst = 0, els = document.body.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.closest('svg') || !vis(e)) continue;
      var r = e.getBoundingClientRect();
      if (r.width === 0 || r.right <= vw + 1) continue;
      var clipped = getComputedStyle(e).position === 'fixed';
      for (var p = e.parentElement; p && p !== document.body && !clipped; p = p.parentElement) {
        var cs = getComputedStyle(p);
        if (cs.position === 'fixed' || /(auto|scroll|hidden|clip)/.test(cs.overflowX)) clipped = true;
      }
      if (!clipped) worst = Math.max(worst, Math.round(r.right));
    }
    return worst;
  };
  return {
    scroll: Math.max(document.documentElement.scrollWidth, wideRight()), vw: window.innerWidth,
    top: !!top, main: (document.querySelector('#bcmain') || {}).innerText ? document.querySelector('#bcmain').innerText.length : 0,
    name: box('.bcjumpname'), controls: controls,
    leaveShown: !!so && vis(so), leaveText: text ? text.textContent.trim() : '', leaveTextVisible: !!text && vis(text),
    leaveLabel: so ? (so.getAttribute('aria-label') || '') : '',
    sampleBar: !!document.querySelector('.bcsamplebar') && vis(document.querySelector('.bcsamplebar')),
    sampleText: (document.querySelector('.bcsamplebar') || {}).innerText || '',
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, running: running,
    body: document.body.innerText.slice(0, 4000),
    // The project list lives in the hamburger menu (ADR-0068: the canvas has no portfolio). The panel is in the page even
    // while it is closed, so its text is read directly; innerText of a hidden element would be empty.
    menu: ((document.getElementById('bc-menu') || {}).textContent || '').replace(/\\s+/g, ' ').slice(0, 4000),
  };
})()`
type M = {
  scroll: number
  vw: number
  top: boolean
  main: number
  name: { w: number; h: number; right: number } | null
  controls: { l: string; w: number; h: number }[]
  leaveShown: boolean
  leaveText: string
  leaveTextVisible: boolean
  leaveLabel: string
  sampleBar: boolean
  sampleText: string
  reduce: boolean
  running: number
  body: string
  menu: string
}

const settle = async (page: Page, who: 'person' | 'sample'): Promise<void> => {
  if (who === 'sample') {
    // a visitor enters the way a visitor does: one press on the entry screen
    await page.waitForSelector('[data-bc-sample-start]', { timeout: 20000 })
    await page.click('[data-bc-sample-start]')
  }
  await page.waitForSelector('.bctop', { timeout: 20000 })
  await page.waitForTimeout(900)
}

try {
  const ROUTES = (who: 'person' | 'sample'): { path: string; label: string }[] => {
    const p = (who === 'person' ? PERSON_PROJECTS : SAMPLE_PROJECTS)[0]?.slug ?? ''
    return [
      { path: '/', label: 'home' },
      { path: `/p/${p}/overview`, label: 'project overview' },
      { path: `/p/${p}/tasks`, label: 'to-dos' },
      { path: `/p/${p}/schedule`, label: 'schedule' },
      { path: `/p/${p}/documents`, label: 'docs & files' },
      { path: `/p/${p}/chat`, label: 'chat' },
      { path: '/tasks', label: 'my tasks' },
      { path: '/activity', label: 'activity' },
    ]
  }
  for (const who of ['person', 'sample'] as const) {
    const names = (who === 'person' ? PERSON_PROJECTS : SAMPLE_PROJECTS).map((x) => x.name)
    const otherNames = (who === 'person' ? SAMPLE_PROJECTS : PERSON_PROJECTS).map((x) => x.name)
    for (const reduced of [false, true]) {
      for (const vp of VIEWPORTS) {
        if (reduced && vp.name !== '1440' && vp.name !== '390') continue
        const tag = `${who} ${vp.name}${reduced ? ' reduced-motion' : ''}`
        const { page, seen, close } = await open(vp, who, reduced)
        try {
          // A visitor arrives the way one does: on the entry screen (which a local address only draws when asked for).
          await page.goto(`${APP}/${who === 'sample' ? '?welcome' : ''}`, {
            waitUntil: 'domcontentloaded',
          })
          await settle(page, who)
          const m = (await page.evaluate(MEASURE)) as M
          const home = `${m.body} ${m.menu}`
          check(
            `${tag}: the shell draws and the office's own projects are named (in the menu)`,
            m.top && m.menu.length > 0 && names.every((n) => m.menu.includes(n.slice(0, 24))),
            `${m.main} chars, menu ${m.menu.length} chars`,
          )
          check(
            `${tag}: the OTHER office's projects are nowhere on the page`,
            otherNames.every((n) => !home.includes(n.slice(0, 24))),
          )
          check(
            `${tag}: the page's invented example office is not showing`,
            !/Legacy Coaching Course(?! Programme)/.test(home) ||
              (who === 'person' && home.includes('Legacy Coaching Course Programme')),
          )
          // Against the DEVICE's width, not the page's own: a phone widens its layout viewport to fit what overflows, after
          // which innerWidth agrees with the overflow and a comparison against it can never fail.
          check(
            `${tag}: no horizontal overflow`,
            Math.max(m.scroll, m.vw) <= vp.w,
            `${m.scroll} / ${m.vw} of ${vp.w}`,
          )
          if (who === 'person') {
            check(
              `${tag}: a person signs out (the control is there)`,
              m.leaveShown && /sign out/i.test(m.leaveLabel),
              m.leaveLabel,
            )
            check(`${tag}: and no sample banner is drawn`, !m.sampleBar)
          } else {
            check(
              `${tag}: a visitor is told they are in the Sample Office, with a way to create their own`,
              m.sampleBar &&
                /Sample Office/.test(m.sampleText) &&
                /made-up|not saved/.test(m.sampleText),
              m.sampleText.replace(/\s+/g, ' ').slice(0, 90),
            )
            check(
              `${tag}: and leaves it (Leave sample, not Sign out)`,
              m.leaveShown && /leave the sample/i.test(m.leaveLabel),
              m.leaveLabel,
            )
          }
          if (vp.touch) {
            check(
              `${tag}: every header control is 44px to touch`,
              m.controls.length >= 4 && m.controls.every((c) => c.h >= 43.5),
              m.controls.map((c) => `${c.l}:${c.h}`).join(' '),
            )
            check(`${tag}: the leave control is an icon on a phone`, !m.leaveTextVisible)
          }
          if (reduced) {
            check(`${tag}: the page reads reduced motion`, m.reduce)
            check(
              `${tag}: no infinite animation is running`,
              m.running === 0,
              `${m.running} running`,
            )
          }
          for (const r of ROUTES(who)) {
            await page.goto(`${APP}${r.path}`, { waitUntil: 'domcontentloaded' })
            if (who === 'sample') {
              const entry = await page.$('[data-bc-sample-start]')
              if (entry !== null) await settle(page, who)
            }
            await page.waitForSelector('.bctop', { timeout: 20000 })
            await page.waitForTimeout(700)
            const rm = (await page.evaluate(MEASURE)) as M
            check(
              `${tag} ${r.label}: draws something and does not overflow`,
              rm.main > 40 && Math.max(rm.scroll, rm.vw) <= vp.w,
              `${rm.main} chars, ${rm.scroll}/${rm.vw} of ${vp.w}`,
            )
            if (r.label === 'project overview') {
              check(
                `${tag} ${r.label}: the project keeps its name on screen`,
                (rm.name?.w ?? 0) >= (vp.touch ? 40 : 100) && (rm.name?.right ?? 9999) <= vp.w,
                JSON.stringify(rm.name),
              )
              if (vp.touch)
                check(
                  `${tag} ${r.label}: the name is at least 70px so it can be read`,
                  (rm.name?.w ?? 0) >= 70,
                  String(rm.name?.w),
                )
            }
            if (
              shotsArg !== undefined &&
              !reduced &&
              (r.label === 'home' || r.label === 'project overview')
            )
              await page.screenshot({
                path: `${shotsArg}/${who}-${vp.name}-${r.label.replace(/\W+/g, '-')}.png`,
              })
          }
          // a project whose name is 110 characters long still shows it, and the header still fits (person office only: its third project)
          if (who === 'person' && !reduced) {
            const long = PERSON_PROJECTS[2]?.slug ?? ''
            await page.goto(`${APP}/p/${long}/overview`, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('.bcjumpname', { timeout: 20000 })
            await page.waitForTimeout(500)
            const lm = (await page.evaluate(MEASURE)) as M
            check(
              `${tag}: a very long project name is still shown and the header fits`,
              (lm.name?.w ?? 0) >= 40 &&
                (lm.name?.right ?? 9999) <= vp.w &&
                Math.max(lm.scroll, lm.vw) <= vp.w &&
                lm.controls.every((c) => c.h >= (vp.touch ? 43.5 : 20)),
              JSON.stringify(lm.name),
            )
          }
          check(
            `${tag}: no page error and no console error`,
            seen.pageErrors.length === 0 &&
              seen.consoleErrors.filter((c) => !/Failed to load resource|status of 40[34]/.test(c))
                .length === 0,
            [...seen.pageErrors, ...seen.consoleErrors].slice(0, 3).join(' | '),
          )
          if (who === 'person')
            check(
              `${tag}: no gateway request was refused`,
              seen.badResponses.length === 0,
              seen.badResponses.slice(0, 4).join(' | '),
            )
        } catch (e) {
          check(
            `${tag}: ran to the end`,
            false,
            e instanceof Error ? e.message.slice(0, 200) : String(e),
          )
        } finally {
          await close()
        }
      }
    }
  }

  // ---- the sample is read-only, and says so in a sentence ------------------------------------------------------------
  {
    const { page, close } = await open(VIEWPORTS[0] as (typeof VIEWPORTS)[number], 'sample', false)
    try {
      await page.goto(`${APP}/?welcome`, { waitUntil: 'domcontentloaded' })
      await settle(page, 'sample')
      const before = (await one(
        `select (select count(*) from public.tasks where office_id = ${lit(SAMPLE_OFFICE)}::uuid) as t, (select count(*) from public.projects where office_id = ${lit(SAMPLE_OFFICE)}::uuid) as p`,
      )) as { t: string; p: string }
      const probe = (await page.evaluate(`(async () => {
        var s = JSON.parse(localStorage.getItem('hq.session') || '{}');
        var out = {};
        for (var a of ['task_add', 'create_project', 'rename_project', 'document_upload', 'approve_tool']) {
          var r = await fetch('${GW}/hq-api', { method: 'POST', headers: { authorization: 'Bearer ' + s.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ action: a, args: {} }) });
          var b = await r.json().catch(function () { return {}; });
          out[a] = { status: r.status, error: b.error, message: b.message };
        }
        return out;
      })()`)) as Record<string, { status: number; error?: string; message?: string }>
      check(
        "a guest's changes are refused with the sentence, never a code alone",
        Object.values(probe).every(
          (x) =>
            x.status === 403 &&
            x.error === 'sample_readonly' &&
            /sample office, so changes are not saved/.test(x.message ?? ''),
        ),
        JSON.stringify(Object.fromEntries(Object.entries(probe).map(([k, v]) => [k, v.status]))),
      )
      const after = (await one(
        `select (select count(*) from public.tasks where office_id = ${lit(SAMPLE_OFFICE)}::uuid) as t, (select count(*) from public.projects where office_id = ${lit(SAMPLE_OFFICE)}::uuid) as p`,
      )) as { t: string; p: string }
      check(
        'and nothing was written to the sample office',
        before.t === after.t && before.p === after.p,
        `${before.t}/${before.p} -> ${after.t}/${after.p}`,
      )
      check(
        'the gateway refused every guest change the page tried (counted at the door)',
        writes.guestRefused >= 5 && writes.guestAccepted === 0,
        `refused ${writes.guestRefused}, accepted ${writes.guestAccepted}`,
      )
    } finally {
      await close()
    }
  }

  // ---- a person's own change goes through, and is the person's alone ------------------------------------------------
  {
    const { page, close } = await open(VIEWPORTS[0] as (typeof VIEWPORTS)[number], 'person', false)
    try {
      await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' })
      await settle(page, 'person')
      const title = `Written by the person ${run}`
      const slug = PERSON_PROJECTS[0]?.slug ?? ''
      const r = (await page.evaluate(`(async () => {
        var s = JSON.parse(localStorage.getItem('hq.session') || '{}');
        var res = await fetch('${GW}/hq-api', { method: 'POST', headers: { authorization: 'Bearer ' + s.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'task_add', args: { p_project: '${slug}', p_title: '${title}' } }) });
        return { status: res.status, body: await res.json().catch(function () { return {}; }) };
      })()`)) as { status: number; body: Record<string, unknown> }
      const mine = (
        await one(
          `select count(*)::int as n from public.tasks where title = ${lit(title)} and office_id = ${lit(PERSON_OFFICE)}::uuid`,
        )
      ).n
      const theirs = (
        await one(
          `select count(*)::int as n from public.tasks where title = ${lit(title)} and office_id <> ${lit(PERSON_OFFICE)}::uuid`,
        )
      ).n
      check(
        "CONTROL: a person's own to-do is accepted by the same gateway, and lands in their office only",
        r.status === 200 && mine === 1 && theirs === 0,
        `http ${r.status}; mine ${mine}, elsewhere ${theirs}`,
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
