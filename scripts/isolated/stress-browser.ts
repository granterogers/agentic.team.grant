/**
 * Team HQ under REALISTIC SYNTHETIC DATA volumes, in a real browser, through the REAL gateway code, on the isolated replica
 * (staging validation, 10 October 2026). Local and isolated: no production, no network, nothing is sent to anybody.
 *
 *   npx tsx scripts/isolated/stress-browser.ts <replica-db> [--shots=<dir>] [--only=<viewport,...>]
 *
 * WHAT IS REAL: a person office provisioned by the product's own function, six projects (one with a 100-character name), 140
 * to-dos on the busy project (160-character titles, overdue, due today, future and done), 12 events with overlaps and an all-day
 * one, 36 documents of different types, 28 contacts with long names and roles, a personal list of 70 items with repeating
 * reminders; every read goes through supabase/functions/hq-api/index.ts answered from the replica.
 * WHAT IS NOT: the project CONVERSATION. `conversation_history` hides any command that did not come through a production door
 * (harness_job), by design, so a conversation cannot be seeded from a migration or a script. The `conversation` section is
 * therefore answered by this script with 90 generated messages (several agents, long answers, lists): that proves how a long
 * thread is PRESENTED, not that the office stored one. Every screenshot says which it is.
 *
 * What is asserted, at each viewport: the board, every maximised module, My Tasks, the project menu, the chat dock, Settings and
 * Search draw with no page error, no horizontal overflow (measured against the DEVICE width), no finding from the surface audit
 * (clipped text, off-edge boxes, 12px floor, 44px touch targets on a phone), a scrolling list actually scrolls, and the long
 * names are kept readable (not zero width). CONTROL: a planted 900px element must be flagged by the same overflow measure.
 */
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { auditScript } from '../verify/lib/surface-audit.ts'
import { serveStudio } from '../verify/serve-studio.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'bq'
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice('--shots='.length) ?? ''
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
/* The appearance the run is drawn in: --look=original|silver|forest|graphite and --glass=off|soft|rich (default Original, Soft). */
const LOOK =
  process.argv.find((a) => a.startsWith('--look='))?.slice('--look='.length) ?? 'original'
const GLASS = process.argv.find((a) => a.startsWith('--glass='))?.slice('--glass='.length) ?? 'soft'
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

/* ---- the office and its data -------------------------------------------------------------------------------------------- */
const EMAIL = `stress-${run}@example.invalid`
const SESSION = `aaa.bbb.${'s'.repeat(70)}`
const authUsers: Record<string, string> = { [SESSION]: EMAIL }
const env = {
  HQ_API_TOKEN: 'isolated-hq-token',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: 'http://127.0.0.1:4656',
}
await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(EMAIL)})`)
const OFFICE = String(
  json(
    (
      await one(
        `select app.provision_person_office('Stress Person', ${lit(EMAIL)}, ${lit(`stress-${run}`)}) as r`,
      )
    ).r,
  ).office_id,
)

const NAMES = [
  `Riverside launch ${run}`,
  `Autumn campaign ${run}`,
  `The Extremely Long Legacy Coaching Course Programme For Senior Leadership And Their Teams ${run}`,
  `Café & Co. rebrand ${run}`,
  `Q4 board pack ${run}`,
  `Hiring: ops lead ${run}`,
]
const projects: { id: string; slug: string; name: string }[] = []
for (const name of NAMES) {
  const r = json(
    (
      await one(
        `select app.hq_create_project(${lit(OFFICE)}::uuid, ${lit(name)}, 'upload', ${lit(`st-${run}-${name.toLowerCase().replace(/\W+/g, '-').slice(0, 30)}`)}, ${lit(name)}, true) as v`,
      )
    ).v,
  )
  const id = String(r.project_id)
  const slug = String(
    (await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug,
  )
  projects.push({ id, slug, name })
}
const busy = projects[0] as { id: string; slug: string; name: string }

const LONG =
  'Reconcile the venue contract, the catering minimums and the accessibility requirements with the revised guest list before the Friday sign-off, and confirm who is chasing the insurer'
for (let i = 0; i < 140; i++) {
  const title =
    i % 7 === 0
      ? `${LONG} (${i})`
      : i % 3 === 0
        ? `Follow up with supplier number ${i}`
        : `Task ${i}: ${['Draft', 'Review', 'Book', 'Send', 'Chase', 'Approve'][i % 6]} the thing`
  const day = (i % 21) - 8
  await db.execute(
    `select app.task_add(p_office => ${lit(OFFICE)}::uuid, p_project => ${lit(busy.id)}::uuid, p_title => ${lit(title)}, p_due_on => (current_date + ${day})::date, p_added_by => 'harness')`,
  )
}
await db.execute(
  `select app.hq_task_state(${lit(OFFICE)}, task_id::text, 'done', 'stress fixture', 'harness')
     from public.tasks where office_id = ${lit(OFFICE)}::uuid and project_id = ${lit(busy.id)}::uuid and seq % 5 = 0`,
)
for (const p of projects.slice(1)) {
  for (let i = 0; i < 6; i++)
    await db.execute(
      `select app.task_add(p_office => ${lit(OFFICE)}::uuid, p_project => ${lit(p.id)}::uuid, p_title => ${lit(`Item ${i} for ${p.name.slice(0, 24)}`)}, p_due_on => (current_date + ${i - 2})::date, p_added_by => 'harness')`,
    )
}
const events: [string, string, string, boolean][] = [
  ['Kick-off', '1 day', '1 day 1 hour', false],
  ['Venue walk-through with the catering and AV teams', '1 day', '1 day 2 hours', false],
  ['Supplier call', '1 day 30 minutes', '1 day 90 minutes', false],
  ['Board dry run', '2 days', '2 days 3 hours', false],
  ['All-hands', '3 days', '3 days 1 hour', false],
  ['Team offsite (all day)', '4 days', '5 days', true],
  ['Invoice cut-off', '0 days 2 hours', '0 days 3 hours', false],
  ['1:1 with Sam', '0 days 2 hours', '0 days 2 hours 30 minutes', false],
  ['Press embargo lifts', '6 days', '6 days 1 hour', false],
  ['Retro', '7 days', '7 days 1 hour', false],
  ['Planning', '8 days', '8 days 2 hours', false],
  ['Launch day', '9 days', '9 days 12 hours', false],
]
for (const [t, s, e, all] of events)
  await db.execute(
    `select app.hq_event_add(${lit(OFFICE)}::uuid, ${lit(busy.slug)}, ${lit(t)}, now() + interval ${lit(s)}, now() + interval ${lit(e)}, ${all})`,
  )
const KINDS: [string, string, string][] = [
  ['pdf', 'application/pdf', 'Venue contract signed'],
  [
    'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Run of show',
  ],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Budget v7'],
  ['png', 'image/png', 'Floor plan'],
  ['md', 'text/markdown', 'Meeting notes'],
  [
    'pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'Sponsor deck',
  ],
]
for (let i = 0; i < 36; i++) {
  const k = KINDS[i % KINDS.length] as [string, string, string]
  await db.execute(
    `insert into public.documents (office_id, project_id, title, origin, state, mime_type, doc_type, byte_size, storage_path)
     values (${lit(OFFICE)}::uuid, ${lit(busy.id)}::uuid, ${lit(`${k[2]} ${i}${i % 9 === 0 ? ' - the final, final, reviewed-by-legal version for the board' : ''}.${k[0]}`)}, 'yours', 'approved', ${lit(k[1])}, ${lit(k[0])}, ${(i + 1) * 12345}, ${lit(`stress/${run}/doc-${i}.${k[0]}`)})`,
  )
}
for (let i = 0; i < 28; i++)
  await db.execute(
    `select app.hq_contact_add(${lit(OFFICE)}::uuid, ${lit(busy.slug)}, ${lit(i % 5 === 0 ? `Dr. Alexandria Montgomery-Featherstonehaugh ${i}` : `Contact ${i}`)}, ${lit(i % 4 === 0 ? 'Head of Partnerships and Strategic Alliances, EMEA' : 'Supplier')}, ${lit(`Org ${i}`)}, ${lit(`c${i}@example.invalid`)}, null, null, null, null, null)`,
  )
for (let i = 0; i < 70; i++) {
  const r = json(
    (
      await one(
        `select app.my_task_add(${lit(OFFICE)}::uuid, ${lit(i % 6 === 0 ? `${LONG} (personal ${i})` : `Personal item ${i}`)}, '', (current_date + ${(i % 15) - 6})::date) as v`,
      )
    ).v,
  )
  if (i % 9 === 0 && r.id !== undefined)
    await db.execute(
      `select app.my_task_set(${lit(OFFICE)}::uuid, ${lit(String(r.id))}, null, now() + interval '2 hours', interval '7 days')`,
    )
}
const counts = await one(
  `select (select count(*) from public.tasks where office_id = ${lit(OFFICE)}::uuid) as tasks,
          (select count(*) from public.documents where office_id = ${lit(OFFICE)}::uuid) as docs`,
)
check(
  'the replica holds the stress office',
  Number(counts.tasks) >= 200 && Number(counts.docs) === 36 && projects.length === 6,
  JSON.stringify(counts),
)

/* ---- the gateway, the page and a generated conversation -------------------------------------------------------------------- */
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
const AGENTS = [
  ['chief-of-staff', 'Claire'],
  ['strategy-director', 'Tom'],
  ['research-director', 'Emma'],
  ['finance-director', 'Daniel'],
  ['communications-director', 'Oliver'],
] as const
const conversation = Array.from({ length: 90 }, (_, i) => {
  const at = new Date(Date.now() - (90 - i) * 17 * 60_000).toISOString()
  if (i % 2 === 0)
    return {
      message_id: `m${i}`,
      kind: 'said',
      at,
      from: 'you',
      name: 'Stress Person',
      body:
        i % 8 === 0
          ? `${LONG}. Can you also tell me what is late and who has it?`
          : `Question ${i}: where are we on the venue?`,
      surface: 'teamhq',
      spoken: i % 10 === 0,
    }
  const [slug, name] = AGENTS[i % AGENTS.length] as readonly [string, string]
  const body =
    i % 6 === 1
      ? `Here is where things stand:\n\n1. The venue contract is signed.\n2. Catering minimums are agreed at 80 guests.\n3. The accessibility review is outstanding, and the insurer has not replied.\n\n${LONG}.`
      : `Two things are late: the supplier invoice and the sponsor deck. ${'The detail runs on for a while so that the bubble has to wrap. '.repeat(i % 5 === 3 ? 6 : 1)}`
  return {
    message_id: `m${i}`,
    kind: 'answered',
    at,
    from: slug,
    name,
    body,
    confidence: 'moderate',
    evidence: 'retrieved',
    deterministic: false,
    job: `j${i}`,
    delivery: 'sent',
    undelivered: 0,
  }
})

const server = await serveStudio(4656)
/* --base=<url> draws a HOSTED copy of the page (an isolated preview) over the same local replica: only the page's own host is reachable, the office is still answered here. */
const BASE = process.argv.find((a) => a.startsWith('--base='))?.slice('--base='.length)
const APP = BASE ?? 'http://127.0.0.1:4656'
const BASE_HOST = BASE === undefined ? '' : new URL(BASE).host.replace(/\./g, '\\.')
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
if (SHOTS !== '') await mkdir(SHOTS, { recursive: true })
const VIEWPORTS = [
  { name: '1440', w: 1440, h: 900, touch: false },
  { name: '390', w: 390, h: 844, touch: true },
  { name: '360', w: 360, h: 740, touch: true },
  { name: '430', w: 430, h: 932, touch: true },
].filter((v) => ONLY === undefined || ONLY.split(',').includes(v.name))

const open = async (vp: (typeof VIEWPORTS)[number], scheme: 'dark' | 'light') => {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: vp.touch,
    isMobile: vp.touch,
  })
  const errors: string[] = []
  const bad: string[] = []
  await ctx.route(`${GW}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const fn = url.pathname.split('/').pop() ?? ''
    if (
      fn === 'hq-api' &&
      req.method() === 'GET' &&
      url.searchParams.get('section') === 'conversation'
    )
      return route.fulfill({
        status: 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify({ data: conversation }),
      })
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
    if (res.status >= 400) bad.push(`${res.status} ${fn} ${url.searchParams.get('section') ?? ''}`)
    return route.fulfill({
      status: res.status,
      headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' },
      body: text,
    })
  })
  await ctx.route(
    new RegExp(
      `^https?:\\/\\/(?!127\\.0\\.0\\.1|gw\\.invalid${BASE_HOST === '' ? '' : `|${BASE_HOST}`})`,
    ),
    (route) => route.abort(),
  )
  await ctx.addInitScript(`window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin';
    try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${SESSION}', refresh_token: 'r', expires_at: Date.now() + 36e5 }));
      localStorage.setItem('studio.appearance', JSON.stringify({ palette: 'slate', texture: 'concrete', own: null, ownName: '', scheme: '${scheme}', density: 'comfortable', look: '${LOOK}', glass: '${GLASS}', depth: 'soft' })) } catch {}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  return { ctx, page, errors, bad }
}

const widest = (page: Page): Promise<{ right: number; vw: number }> =>
  page.evaluate(`(() => {
    const vw = screen.width, doc = document.documentElement
    let worst = 0
    for (const e of document.body.querySelectorAll('*')) {
      if (e.closest('svg') || e.offsetParent === null) continue
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.right <= vw + 1) continue
      let clipped = getComputedStyle(e).position === 'fixed'
      for (let p = e.parentElement; p && p !== document.body && !clipped; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.position === 'fixed' || /(auto|scroll|hidden|clip)/.test(cs.overflowX)) clipped = true
      }
      if (!clipped) worst = Math.max(worst, Math.round(r.right))
    }
    return { right: Math.max(doc.scrollWidth, worst), vw }
  })()`) as Promise<{ right: number; vw: number }>

const settle = (page: Page, ms = 700): Promise<void> => page.waitForTimeout(ms)

for (const vp of VIEWPORTS) {
  for (const scheme of ['dark', 'light'] as const) {
    const tag = `${vp.name}-${scheme}`
    const { ctx, page, errors, bad } = await open(vp, scheme)
    const seen = async (
      name: string,
      expect: string,
      kind: 'real' | 'generated' = 'real',
    ): Promise<void> => {
      await settle(page, 600)
      const opened =
        expect === '' ||
        (await page
          .locator(expect)
          .first()
          .isVisible()
          .catch(() => false))
      if (!opened) {
        if (SHOTS !== '') await page.screenshot({ path: `${SHOTS}/FAILED-${tag}-${name}.png` })
        return check(`${tag} ${name}: opened`, false, `no visible ${expect}`)
      }
      const a = (await page.evaluate(auditScript())) as { out: string[] }
      const w = await widest(page)
      check(`${tag} ${name}: no audit finding`, a.out.length === 0, a.out.slice(0, 3).join(' | '))
      check(
        `${tag} ${name}: no horizontal overflow`,
        w.right <= w.vw + 1,
        `${String(w.right)} of ${String(w.vw)}`,
      )
      if (SHOTS !== '')
        await page.screenshot({ path: `${SHOTS}/${kind}-${tag}-${name.replace(/\W+/g, '-')}.png` })
    }
    const go = async (p: string): Promise<void> => {
      await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }).catch(() => null)
      // The office answers a populated project slower than an empty one: wait for it rather than photograph "Connecting".
      await page
        .waitForFunction(
          "!document.body.innerText.includes('Connecting to your office')",
          undefined,
          { timeout: 40000 },
        )
        .catch(() => null)
      await settle(page, 900)
    }
    await go(`/p/${busy.slug}`)
    await seen('board-busy-project', '.bcstage')
    for (const m of ['tasks', 'schedule', 'documents', 'contacts', 'activity']) {
      await go(`/p/${busy.slug}`)
      const btn = page
        .locator(
          `.bcstage [data-mod="${m}"] [data-bc-expand], .bcstage [data-mod="${m}"] [data-expand]`,
        )
        .first()
      if ((await btn.count()) === 0) {
        check(`${tag} maximised ${m}: control found`, false, 'no expand control')
        continue
      }
      await btn.click({ force: true }).catch(() => null)
      await seen(`maximised-${m}`, '.bcexp .bcexpbox')
      if (m === 'schedule') {
        // A busy month: no chip is squeezed (text cut through), and every "+N more" is the day's real remainder.
        const bad = (await page.evaluate(`(() => {
          const out = []
          for (const box of document.querySelectorAll('.bcexp .bccal2chips')) {
            const chips = [...box.querySelectorAll('.bccal2chip')].filter((c) => !c.hidden)
            for (const c of chips) if (c.clientHeight < 17 || c.scrollHeight > c.clientHeight + 1) out.push('squeezed chip ' + c.clientHeight + 'px')
            const more = box.querySelector('.bccal2more')
            const total = Number(box.dataset.total) || 0
            const shown = more && !more.hidden ? Number((more.textContent.match(/\\d+/) || [0])[0]) : 0
            if (total - chips.length !== shown) out.push('count ' + shown + ' for ' + (total - chips.length) + ' hidden')
          }
          return out
        })()`)) as string[]
        check(
          `${tag} maximised schedule: no squeezed chip, honest "+N more"`,
          bad.length === 0,
          bad.slice(0, 3).join(' | '),
        )
      }
      if (m === 'tasks') {
        const scrolls = (await page.evaluate(
          `(() => { const b = document.querySelector('.bcexp .bcexpbox'); const o = document.querySelector('.bcexp'); const s = [o, b, ...b.querySelectorAll('*')].find((e) => e && e.scrollHeight > e.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)); if (!s) { window.scrollTo(0, 400); return window.scrollY > 0 ? 'true' : 'none' } s.scrollTop = 400; return String(s.scrollTop > 0) })()`,
        )) as string
        check(`${tag} maximised tasks: the long list scrolls`, scrolls === 'true', scrolls)
      }
      await page.keyboard.press('Escape')
    }
    await go('/tasks')
    await seen('my-tasks-70-items', '.bcsectiontitle')
    await go('/search')
    await seen('search', '.bcmain')
    await go(`/p/${busy.slug}`)
    const menu = page.locator('[data-bc-menu]').first()
    if ((await menu.count()) > 0) {
      await menu.click({ force: true }).catch(() => null)
      await seen('project-menu-six-projects', '.bcmenupanel, .bcmenu')
    }
    await page.keyboard.press('Escape')
    await go(`/p/${busy.slug}`)
    const dock = page.locator('[data-bc-dock]:visible').first()
    if ((await dock.count()) > 0) {
      await dock.click({ force: true }).catch(() => null)
      await page.waitForSelector('#dock [data-docksay]', { timeout: 8000 }).catch(() => null)
      await seen('chat-dock-90-messages-GENERATED', '#dock .thread', 'generated')
      if (vp.touch) {
        // A soft keyboard EMULATED by shrinking the viewport while the composer holds focus (this is Chromium, not iOS Safari: the
        // layout viewport really changes here, where iOS keeps it and moves the visual one). The composer and Send must stay on
        // screen and the newest message must not be hidden behind the composer.
        await page.locator('#dock [data-docksay]').first().focus()
        const full = page.viewportSize() ?? { width: vp.w, height: vp.h }
        const kb = Math.round(full.height * 0.55)
        await page.setViewportSize({ width: full.width, height: kb })
        await settle(page, 700)
        const geo = (await page.evaluate(`(() => {
          const box = document.querySelector('#dock [data-docksay]').getBoundingClientRect()
          const send = document.querySelector('#dock [data-dockform] button[type=submit]').getBoundingClientRect()
          const msgs = [...document.querySelectorAll('#dock .thread > *')].filter((e) => e.getBoundingClientRect().height > 0)
          const last = msgs[msgs.length - 1]?.getBoundingClientRect()
          return { vh: window.innerHeight, boxTop: Math.round(box.top), boxBottom: Math.round(box.bottom), sendBottom: Math.round(send.bottom), lastBottom: last ? Math.round(last.bottom) : -1 }
        })()`)) as {
          vh: number
          boxTop: number
          boxBottom: number
          sendBottom: number
          lastBottom: number
        }
        check(
          `${tag} keyboard (emulated): the composer and Send stay on screen`,
          geo.boxTop >= 0 && geo.boxBottom <= geo.vh + 1 && geo.sendBottom <= geo.vh + 1,
          JSON.stringify(geo),
        )
        check(
          `${tag} keyboard (emulated): the newest message is not behind the composer`,
          geo.lastBottom <= geo.boxTop + 1,
          JSON.stringify(geo),
        )
        if (SHOTS !== '')
          await page.screenshot({ path: `${SHOTS}/generated-${tag}-chat-keyboard-emulated.png` })
        await page.setViewportSize(full)
        await settle(page, 400)
      }
    } else check(`${tag} chat dock: control found`, false, 'no dock')
    // The long project name must keep a readable header (not squeezed to nothing).
    await go(`/p/${(projects[2] as { slug: string }).slug}`)
    const nameBox = (await page.evaluate(
      `(() => { const e = document.querySelector('.bcjumpname'); if (!e) return -1; return Math.round(e.getBoundingClientRect().width) })()`,
    )) as number
    check(
      `${tag} the 100-character project name keeps a readable header`,
      nameBox >= 60,
      `${String(nameBox)}px`,
    )
    await seen('board-long-project-name', '.bcstage')
    await go('/')
    await go(`/p/${busy.slug}`)
    // The chat dock is remembered as open across a load and, on a phone, covers the page: close it first, as a person would.
    await page
      .locator(
        'button[aria-label="Close the conversation"], button[title="Close the conversation"]',
      )
      .first()
      .click({ force: true })
      .catch(() => null)
    await settle(page, 400)
    await page
      .locator('[data-bc-settings]')
      .first()
      .click({ force: true })
      .catch(() => null)
    await page.waitForSelector('#settings .stg', { timeout: 6000 }).catch(() => null)
    await seen('settings', '#settings .stg')
    check(
      `${tag} no page error and no refused gateway request`,
      errors.length === 0 && bad.length === 0,
      [...errors, ...bad].slice(0, 3).join(' | '),
    )
    if (vp.name === '1440' && scheme === 'dark') {
      // CONTROL: the overflow measure must flag a planted 900px-wide element.
      await go(`/p/${busy.slug}`)
      await page.evaluate(
        `(() => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;top:0;width:3000px;height:20px'; d.id = 'planted'; document.body.appendChild(d) })()`,
      )
      const w = await widest(page)
      check(
        'CONTROL: a planted 3000px element is measured as overflow',
        w.right > w.vw + 1,
        `${String(w.right)} of ${String(w.vw)}`,
      )
    }
    await ctx.close()
  }
}

await browser.close()
server.close()
await db.end()
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
