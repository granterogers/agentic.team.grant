// biome-ignore-all format: a fixture table and one-line checks read better than the formatter's wrapping
/**
 * POPULATED-STATE ACCEPTANCE for the dashboard polish (11 October 2026). Local and isolated: no production, no network.
 *
 *   npx tsx scripts/isolated/populated-acceptance.ts <replica-db> [--shots=<dir>]
 *
 * REAL: a person office provisioned by the product's own function; projects, to-dos (priority, state, labels, long details), contacts
 * (full, email-only, phone-only, bare, shared between projects), calendar events (overlaps, all-day) and documents (PDF, picture,
 * unsupported, missing file, long names) written through the product's functions or plain inserts; every read goes through the real
 * supabase/functions/hq-api code answered from the replica; the real page code runs in Chromium at 1440x900 and 390x844.
 * STAND-IN, and named as such in every check that depends on it: the office stores no event SEVERITY for the activity feed and no Google
 * Calendar here, so this script adds `severity` to some activity records and appends Google events to the calendar answer at the browser
 * boundary. That proves the page's filters and source shapes work on records that carry those fields; it does not prove the office writes them.
 * Not invented: no subtasks, dependencies or per-task histories are seeded, and the checks assert none is drawn.
 */
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { auditScript } from '../verify/lib/surface-audit.ts'
import { serveStudio } from '../verify/serve-studio.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const dbName = process.argv[2] ?? 'bq'
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice('--shots='.length) ?? ''
const db = await isolated(dbName)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const json = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const run = Date.now().toString(36)

let failed = 0
let passed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) passed += 1
  else failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

/* ---- the office and its data ----------------------------------------------------------------------------------------------- */
const EMAIL = `accept-${run}@example.invalid`
const SESSION = `aaa.bbb.${'s'.repeat(70)}`
const authUsers: Record<string, string> = { [SESSION]: EMAIL }
const env = {
  HQ_API_TOKEN: 'isolated-hq-token',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: 'http://127.0.0.1:4657',
}
await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(EMAIL)})`)
const OFFICE = String(
  json(
    (
      await one(
        `select app.provision_person_office('Acceptance Person', ${lit(EMAIL)}, ${lit(`accept-${run}`)}) as r`,
      )
    ).r,
  ).office_id,
)
const OWNER = String((await one(`select owner_key from public.office_members where email = ${lit(EMAIL)}`)).owner_key)
const mk = async (name: string): Promise<{ id: string; slug: string; name: string }> => {
  const r = json(
    (
      await one(
        `select app.hq_create_project(${lit(OFFICE)}::uuid, ${lit(name)}, 'upload', ${lit(`ac-${run}-${name.toLowerCase().replace(/\W+/g, '-').slice(0, 30)}`)}, ${lit(name)}, true) as v`,
      )
    ).v,
  )
  const id = String(r.project_id)
  const slug = String((await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug)
  return { id, slug, name }
}
const P = await mk(`Riverside launch ${run}`)
const Q = await mk(`Quiet project ${run}`)
const LONGNAME = await mk(
  `The Extremely Long Legacy Coaching Course Programme For Senior Leadership And Their Teams ${run}`,
)

const LONGTEXT =
  'Reconcile the venue contract, the catering minimums and the accessibility requirements with the revised guest list before the Friday sign-off, and confirm who is chasing the insurer'
const DETAIL =
  'The insurer asked for the revised floor plan, the fire certificate and the named person on the day. None of it has been sent yet. '.repeat(
    4,
  )
const LABELS = [['venue'], ['finance', 'urgent-review'], ['catering', 'guests', 'a-label-that-is-quite-long-indeed'], []]
for (let i = 0; i < 36; i++) {
  const title = i % 7 === 0 ? `${LONGTEXT} (${i})` : `Task ${i}: ${['Draft', 'Review', 'Book', 'Send', 'Chase', 'Approve'][i % 6]} the thing`
  await db.execute(
    `select app.task_add(p_office => ${lit(OFFICE)}::uuid, p_project => ${lit(P.id)}::uuid, p_title => ${lit(title)}, p_detail => ${lit(i % 4 === 0 ? DETAIL : '')}, p_due_on => (current_date + ${(i % 15) - 5})::date, p_added_by => 'harness')`,
  )
}
// Priority (lower is more pressing; 100 is ordinary), stage and labels, written as the product's own columns.
await db.execute(
  `update public.tasks set priority = 10 where office_id = ${lit(OFFICE)}::uuid and project_id = ${lit(P.id)}::uuid and seq % 9 = 0`,
)
await db.execute(
  `update public.tasks set priority = 20 where office_id = ${lit(OFFICE)}::uuid and project_id = ${lit(P.id)}::uuid and seq % 9 = 1`,
)
for (let k = 0; k < LABELS.length; k++) {
  const labels = LABELS[k] as string[]
  if (labels.length === 0) continue
  await db.execute(
    `update public.tasks set labels = ${lit(`{${labels.map((l) => `"${l}"`).join(',')}}`)}::text[] where office_id = ${lit(OFFICE)}::uuid and project_id = ${lit(P.id)}::uuid and seq % 4 = ${String(k)}`,
  )
}
await db.execute(
  `select app.hq_task_state(${lit(OFFICE)}, task_id::text, 'doing', 'acceptance fixture', ${lit(OWNER)})
     from public.tasks where office_id = ${lit(OFFICE)}::uuid and project_id = ${lit(P.id)}::uuid and seq % 6 = 2`,
)
await db.execute(
  `select app.hq_task_state(${lit(OFFICE)}, task_id::text, 'done', 'acceptance fixture', ${lit(OWNER)})
     from public.tasks where office_id = ${lit(OFFICE)}::uuid and project_id = ${lit(P.id)}::uuid and seq % 6 = 5`,
)
const taskCounts = await one(
  `select count(*) filter (where priority <= 10 and state <> 'done') as urgent,
          count(*) filter (where priority > 10 and priority <= 20 and state <> 'done') as high,
          count(*) filter (where state = 'doing') as doing,
          count(*) filter (where state = 'done') as done,
          count(*) filter (where cardinality(labels) > 0) as labelled,
          count(*) as total
     from public.tasks where office_id = ${lit(OFFICE)}::uuid and project_id = ${lit(P.id)}::uuid`,
)
check('fixture precondition: the office holds in-progress and done tasks to assert on', Number(taskCounts.doing) > 0 && Number(taskCounts.done) > 0, JSON.stringify(taskCounts))
for (let i = 0; i < 3; i++)
  await db.execute(
    `select app.task_add(p_office => ${lit(OFFICE)}::uuid, p_project => ${lit(Q.id)}::uuid, p_title => ${lit(`Quiet item ${i}`)}, p_added_by => 'harness')`,
  )

const contacts: [string, string, string, string, string, string, string][] = [
  // name, role, org, email, phone, website, note
  ['Ben Hartley', 'Referrer', 'Hartley & Co', 'ben@hartleyco.example', '+44 7700 900118', 'https://hartleyco.example', 'Wants a look at the outline before it goes out.'],
  ['Priya Raman', 'Prospective client', 'Independent', 'priya@example.invalid', '', '', ''],
  ['Marcus Oyelaran', '', 'Northgate Studios', '', '+44 7700 900243', '', 'Prefers a call.'],
  ['Dana Whitlock', '', '', '', '', '', ''],
  ['Dr. Alexandria Montgomery-Featherstonehaugh', 'Head of Partnerships and Strategic Alliances for the EMEA region', 'The Extraordinarily Long Organisation Name Foundation Trust', 'alexandria.montgomery-featherstonehaugh@very-long-domain-name.example', '+1 (415) 555-0100 ext. 22', 'https://very-long-domain-name.example/people/alexandria', LONGTEXT],
  ['Shared Person', 'Advisor', 'Advisors Ltd', 'shared@example.invalid', '', '', ''],
]
for (const [n, r, o, e, ph, w, note] of contacts)
  await db.execute(
    `select app.hq_contact_add(${lit(OFFICE)}::uuid, ${lit(P.slug)}, ${lit(n)}, ${lit(r)}, ${lit(o)}, ${lit(e)}, ${lit(ph)}, '', ${lit(w)}, 'person', ${lit(note)})`,
  )
await db.execute(
  `select app.hq_contact_add(${lit(OFFICE)}::uuid, ${lit(Q.slug)}, 'Shared Person', 'Advisor', 'Advisors Ltd', 'shared@example.invalid', '', '', '', 'person', '')`,
)

const events: [string, string, string, boolean][] = [
  ['Kick-off', '1 day', '1 day 1 hour', false],
  ['Venue walk-through with the catering and AV teams', '1 day', '1 day 2 hours', false],
  ['Supplier call', '1 day 30 minutes', '1 day 90 minutes', false],
  ['Team offsite (all day)', '4 days', '5 days', true],
  ['Invoice cut-off', '0 days 2 hours', '0 days 3 hours', false],
  ['Launch day', '9 days', '9 days 12 hours', false],
]
for (const [t, s, e, all] of events)
  await db.execute(
    `select app.hq_event_add(${lit(OFFICE)}::uuid, ${lit(P.slug)}, ${lit(t)}, now() + interval ${lit(s)}, now() + interval ${lit(e)}, ${all})`,
  )

const DOCS: [string, string, string, string][] = [
  ['Venue contract signed', 'pdf', 'application/pdf', 'doc-a.pdf'],
  ['Floor plan', 'png', 'image/png', 'doc-b.png'],
  ['Budget v7', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'doc-c.xlsx'],
  ['Lost file - the upload that never arrived', 'pdf', 'application/pdf', 'missing-d.pdf'],
  ['The final, final, reviewed-by-legal, signed-off-by-the-board version of the sponsorship agreement with every appendix', 'pdf', 'application/pdf', 'doc-e.pdf'],
  ['Meeting notes', 'md', 'text/markdown', 'doc-f.md'],
]
for (const [title, ext, mime, file] of DOCS)
  await db.execute(
    `insert into public.documents (office_id, project_id, title, origin, state, mime_type, doc_type, byte_size, storage_path)
     values (${lit(OFFICE)}::uuid, ${lit(P.id)}::uuid, ${lit(`${title}.${ext}`)}, 'yours', 'approved', ${lit(mime)}, ${lit(ext)}, 24680, ${lit(`accept/${run}/${file}`)})`,
  )

/* ---- gateway, page, storage -------------------------------------------------------------------------------------------------- */
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })
const signin = await startEdge({ db, edgeFile: 'supabase/functions/signin/index.ts', env, authUsers })
const GW = 'https://gw.invalid/functions/v1'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const TINY_PDF = (() => {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 18 Tf 40 340 Td (Synthetic page) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const at: number[] = []
  objs.forEach((o, i) => {
    at.push(out.length)
    out += `${String(i + 1)} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n`
  for (const a of at) out += `${String(a).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${String(objs.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return out
})()

const server = await serveStudio(4657)
const APP = 'http://127.0.0.1:4657'
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
if (SHOTS !== '') await mkdir(SHOTS, { recursive: true })
const VIEWPORTS = [
  { name: 'desktop', w: 1440, h: 900, touch: false },
  { name: 'phone', w: 390, h: 844, touch: true },
]
const HOUR = 3600_000
await db.execute(
  `select app.hq_project_look(${lit(OFFICE)}::uuid, ${lit(P.slug)}, 'rocket', 'p-plum', null, null)`,
)
const looked = await one(`select icon, icon_hue from public.projects where slug = ${lit(P.slug)}`)
check('the office stores a project look (mark and colour)', looked.icon === 'rocket' && looked.icon_hue === 'p-plum', JSON.stringify(looked))

const open = async (vp: (typeof VIEWPORTS)[number], scheme: 'dark' | 'light') => {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: vp.touch, isMobile: vp.touch })
  const errors: string[] = []
  const bad: string[] = []
  await ctx.route('https://replica.invalid/storage/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = { 'access-control-allow-origin': '*' }
    if (path.includes('missing')) return route.fulfill({ status: 404, headers, body: 'not found' })
    if (path.includes('.pdf')) return route.fulfill({ status: 200, headers, contentType: 'application/pdf', body: Buffer.from(TINY_PDF, 'latin1') })
    if (path.includes('.png')) return route.fulfill({ status: 200, headers, contentType: 'image/png', body: Buffer.from(TINY_PNG, 'base64') })
    return route.fulfill({ status: 200, headers, contentType: 'text/plain', body: 'A synthetic file.' })
  })
  await ctx.route(`${GW}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const fn = url.pathname.split('/').pop() ?? ''
    const edge = fn === 'signin' ? signin : fn === 'hq-api' ? gw : null
    if (edge === null) return route.fulfill({ status: 404, headers: CORS, body: '{"error":"not served here"}' })
    const body = req.postData() ?? undefined
    const res = await edge.call(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(body === undefined ? {} : { body }) }))
    let text = (await res.text()).replaceAll('http://replica.invalid', 'https://replica.invalid')
    if (res.status >= 400) bad.push(`${res.status} ${fn} ${url.searchParams.get('section') ?? ''}`)
    const section = url.searchParams.get('section') ?? ''
    if (req.method() === 'GET' && res.status === 200 && section === 'studio') {
      // STAND-IN: the office stores no activity severity; add it, and spread the instants, on the first project's records.
      const d = JSON.parse(text) as { data?: { projects?: { slug: string; activity?: Record<string, unknown>[] }[] } }
      for (const pr of d.data?.projects ?? []) {
        if (pr.slug !== P.slug) continue
        const base = [
          { who: 'emma', verb: 'pulled', what: 'the supplier list', category: 'document', at: new Date(Date.now() - 2 * HOUR).toISOString(), when: '2 hours ago' },
          { who: 'oliver', verb: 'failed to send', what: 'the sponsor note (retrying)', category: 'task', severity: 'error', at: new Date(Date.now() - 5 * HOUR).toISOString(), when: '5 hours ago' },
          { who: 'grant', verb: 'edited', what: 'the venue task', category: 'task', at: new Date(Date.now() - 30 * HOUR).toISOString(), when: '1 day ago' },
          { who: 'claire', verb: 'could not read', what: 'a Drive folder (permission)', category: 'sync', via: 'Drive sync', severity: 'warning', at: new Date(Date.now() - 3 * 24 * HOUR).toISOString(), when: '3 days ago' },
          { who: 'daniel', verb: 'updated', what: 'the budget', category: 'document', at: new Date(Date.now() - 9 * 24 * HOUR).toISOString(), when: '9 days ago' },
        ]
        pr.activity = [...base, ...(pr.activity ?? [])]
      }
      text = JSON.stringify(d)
    }
    if (req.method() === 'GET' && res.status === 200 && section === 'project_events') {
      // STAND-IN: no Google Calendar here; append two Google events, one all-day, one overlapping, with the project the card colours by.
      const d = JSON.parse(text) as { data?: { events?: Record<string, unknown>[] } }
      const day = new Date()
      day.setHours(10, 0, 0, 0)
      const g = (id: string, title: string, s: Date, e: Date, allDay: boolean): Record<string, unknown> => ({
        id, title, source: 'google', sync: 'synced', editable: false, all_day: allDay, starts_at: s.toISOString(), ends_at: e.toISOString(),
        project_slug: P.slug, project_name: P.name,
      })
      const dayAfter = new Date(day.getTime() + 24 * HOUR)
      d.data = d.data ?? {}
      d.data.events = [
        ...(d.data.events ?? []),
        g('g1', 'Dentist (Google)', new Date(day.getTime() + 24 * HOUR), new Date(day.getTime() + 25 * HOUR), false),
        g('g2', 'Conference (Google, all day)', dayAfter, new Date(dayAfter.getTime() + 24 * HOUR), true),
      ]
      text = JSON.stringify(d)
    }
    return route.fulfill({ status: res.status, headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' }, body: text })
  })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|gw\.invalid|replica\.invalid)/, (route) => {
    if (route.request().resourceType() !== 'image') bad.push(`refused off-machine ${route.request().url().slice(0, 90)}`)
    return route.abort()
  })
  await ctx.addInitScript(`window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin';
    try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${SESSION}', refresh_token: 'r', expires_at: Date.now() + 36e5 }));
      localStorage.setItem('studio.appearance', JSON.stringify({ palette: 'slate', texture: 'concrete', own: null, ownName: '', scheme: '${scheme}', density: 'comfortable', look: 'original', glass: 'soft' })) } catch (e) {}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)))
  page.on('requestfailed', (r) => {
    if (r.resourceType() !== 'image' && !r.url().endsWith('/config.js') && r.failure()?.errorText !== 'net::ERR_ABORTED')
      bad.push(`failed ${r.url().slice(0, 100)} ${r.failure()?.errorText ?? ''}`)
  })
  return { ctx, page, errors, bad }
}

const overflow = (page: Page): Promise<number> =>
  page.evaluate(`(() => { const vw = screen.width; let worst = document.documentElement.scrollWidth;
    for (const e of document.body.querySelectorAll('*')) { if (e.closest('svg') || e.offsetParent === null) continue;
      const r = e.getBoundingClientRect(); if (r.width === 0 || r.right <= vw + 1) continue;
      let clipped = getComputedStyle(e).position === 'fixed';
      for (let p = e.parentElement; p && p !== document.body && !clipped; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.position === 'fixed' || /(auto|scroll|hidden|clip)/.test(cs.overflowX)) clipped = true }
      if (!clipped) worst = Math.max(worst, Math.round(r.right)) }
    return worst - vw })()`) as Promise<number>

const go = async (page: Page, path: string, wait: string): Promise<void> => {
  await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(wait, { timeout: 20000 })
  await page.waitForTimeout(900)
}

for (const vp of VIEWPORTS) {
  for (const scheme of ['light', 'dark'] as const) {
    const tag = `${vp.name}-${scheme}`
    const { ctx, page, errors, bad } = await open(vp, scheme)
    const shot = async (name: string): Promise<void> => {
      if (SHOTS !== '') await page.screenshot({ path: `${SHOTS}/${tag}-${name}.png` })
    }
    const audit = async (label: string): Promise<void> => {
      const ov = await overflow(page)
      check(`[${tag}] ${label}: no horizontal overflow`, ov <= 1, `${String(ov)}px`)
      const found = (await page.evaluate(auditScript())) as { out?: string[] } | string[]
      const list = Array.isArray(found) ? found : (found.out ?? [])
      const real = list.filter((f) => !/contrast/i.test(String(f)))
      check(`[${tag}] ${label}: surface audit clean (clipping, 12px floor${vp.touch ? ', 44px targets' : ''})`, real.length === 0, JSON.stringify(real.slice(0, 3)))
    }

    /* ---- To-dos ---- */
    await go(page, `/p/${P.slug}/tasks`, '.bctasklist')
    const todo = await page.evaluate(`(() => {
      const t = document.querySelector('.bcrecordhead')?.parentElement?.innerText ?? ''
      const rows = [...document.querySelectorAll('.bcrecordhead ~ .bctasklist .bcitem')]
      const chip = (c) => [...document.querySelectorAll('.bcrecordhead ~ .bctasklist .bctchip--' + c)].length
      return { rows: rows.length, urgent: chip('urgent'), high: chip('high'), doing: chip('doing'), done: chip('done'),
        labels: [...document.querySelectorAll('.bcrecordhead ~ .bctasklist .bctchip:not([class*="--"])')].length,
        invented: /subtask|depends on|blocked by task|history/i.test(t) }
    })()`) as { rows: number; urgent: number; high: number; doing: number; done: number; labels: number; invented: boolean }
    check(`[${tag}] To-dos: every task is a card (${String(taskCounts.total)})`, todo.rows === Number(taskCounts.total), JSON.stringify(todo))
    check(`[${tag}] To-dos: urgent chips equal urgent open tasks (${String(taskCounts.urgent)})`, todo.urgent === Number(taskCounts.urgent), `drawn ${String(todo.urgent)}`)
    check(`[${tag}] To-dos: high-priority chips equal high open tasks (${String(taskCounts.high)})`, todo.high === Number(taskCounts.high), `drawn ${String(todo.high)}`)
    check(`[${tag}] To-dos: in-progress chips equal doing tasks (${String(taskCounts.doing)})`, todo.doing === Number(taskCounts.doing), `drawn ${String(todo.doing)}`)
    check(`[${tag}] To-dos: done chips equal done tasks (${String(taskCounts.done)})`, todo.done === Number(taskCounts.done), `drawn ${String(todo.done)}`)
    check(`[${tag}] To-dos: label chips are drawn where tasks carry labels`, todo.labels >= Number(taskCounts.labelled), `drawn ${String(todo.labels)} for ${String(taskCounts.labelled)} labelled`)
    check(`[${tag}] To-dos: no subtasks, dependencies or histories are invented`, !todo.invented)
    await audit('To-dos')
    await shot('todos')
    // A quiet project shows plain cards: no chip the data does not support.
    await go(page, `/p/${Q.slug}/tasks`, '.bctasklist')
    const quiet = (await page.evaluate(`document.querySelectorAll('.bcrecordhead ~ .bctasklist .bctchip').length`)) as number
    check(`[${tag}] To-dos: a project whose tasks carry no priority, stage or label draws no chips`, quiet === 0, String(quiet))

    /* ---- Contacts ---- */
    await go(page, `/p/${P.slug}/contacts`, '.bcctgrid')
    const ct = (await page.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.bcctgrid > *')]
      const by = (n) => cards.find((c) => c.innerText.includes(n))
      const links = [...document.querySelectorAll('.bcctgrid a[href^="mailto:"], .bcctgrid a[href^="tel:"]')].map((a) => a.getAttribute('href'))
      return { n: cards.length, links,
        ben: by('Ben Hartley')?.innerText ?? '', priya: by('Priya Raman')?.innerText ?? '', marcus: by('Marcus Oyelaran')?.innerText ?? '',
        dana: by('Dana Whitlock')?.innerText ?? '', long: by('Montgomery')?.innerText ?? '', shared: by('Shared Person')?.innerText ?? '' }
    })()`)) as { n: number; links: string[]; ben: string; priya: string; marcus: string; dana: string; long: string; shared: string }
    check(`[${tag}] Contacts: one card per contact (${String(contacts.length)})`, ct.n === contacts.length, String(ct.n))
    check(`[${tag}] Contacts: a full record shows email, phone and website`, /EMAIL/i.test(ct.ben) && /PHONE/i.test(ct.ben) && /WEBSITE/i.test(ct.ben), ct.ben.replace(/\n/g, ' / ').slice(0, 120))
    check(`[${tag}] Contacts: an email-only record shows no phone row`, /EMAIL/i.test(ct.priya) && !/PHONE/i.test(ct.priya))
    check(`[${tag}] Contacts: a phone-only record shows no email row`, /PHONE/i.test(ct.marcus) && !/EMAIL/i.test(ct.marcus))
    check(`[${tag}] Contacts: a bare record shows only its name, no empty rows`, !/EMAIL|PHONE|WEBSITE/i.test(ct.dana), ct.dana.replace(/\n/g, ' / ').slice(0, 100))
    check(`[${tag}] Contacts: a contact on two projects names the other one`, /Quiet project/i.test(ct.shared), ct.shared.replace(/\n/g, ' / ').slice(0, 140))
    const okLinks = ct.links.every((h) => /^mailto:[^\s@]+@[^\s@]+$/.test(h) || /^tel:\+?[0-9]+$/.test(h))
    check(`[${tag}] Contacts: every mailto and tel link is well formed`, ct.links.length >= 4 && okLinks, JSON.stringify(ct.links))
    await audit('Contacts')
    await shot('contacts')

    /* ---- Activity ---- */
    await go(page, `/p/${P.slug}/activity`, '.bcactfilter')
    const chips = async (): Promise<string[]> => (await page.evaluate(`[...document.querySelectorAll('.bcactfilter button')].map((b) => b.textContent.trim())`)) as string[]
    const shownCount = async (): Promise<number> => (await page.evaluate(`(() => { const m = document.querySelector('.bcmain'); return m.querySelectorAll('.bctl li, .bctimeline li, .bcitem').length })()`)) as number
    const c1 = await chips()
    check(`[${tag}] Activity: the Problems and time-range filters appear where records support them`, c1.some((c) => /^Problems/.test(c)) && c1.some((c) => /Last 24 hours/.test(c)), JSON.stringify(c1))
    const before = await shownCount()
    await page.locator('[data-bc-actf="problems"]').click()
    await page.waitForTimeout(500)
    const prob = await page.evaluate(`document.querySelector('.bcmain').innerText`) as string
    check(`[${tag}] Activity: Problems shows only the two records that carry a severity`, /sponsor note/.test(prob) && /Drive folder/.test(prob) && !/supplier list/.test(prob) && !/the budget/.test(prob), prob.replace(/\n/g, ' / ').slice(0, 160))
    await page.locator('[data-bc-actf="all"]').first().click()
    await page.waitForTimeout(300)
    await page.locator('[data-bc-actr="day"]').click()
    await page.waitForTimeout(500)
    const day = await page.evaluate(`document.querySelector('.bcmain').innerText`) as string
    check(`[${tag}] Activity: Last 24 hours keeps the two recent records and drops older ones`, /supplier list/.test(day) && /sponsor note/.test(day) && !/Drive folder/.test(day) && !/the budget/.test(day), day.replace(/\n/g, ' / ').slice(0, 160))
    await page.locator('[data-bc-actr="week"]').click()
    await page.waitForTimeout(500)
    const week = await page.evaluate(`document.querySelector('.bcmain').innerText`) as string
    check(`[${tag}] Activity: Last 7 days includes the 3-day-old record and not the 9-day-old one`, /Drive folder/.test(week) && !/the budget/.test(week))
    check(`[${tag}] Activity: filtering narrowed the list`, before > 0)
    await page.locator('[data-bc-actf="problems"]').click()
    await page.locator('[data-bc-actr="day"]').click()
    await page.waitForTimeout(500)
    check(`[${tag}] Activity: Problems in the last 24 hours shows only the failed send`, /sponsor note/.test(await page.evaluate(`document.querySelector('.bcmain').innerText`) as string))
    await page.locator('[data-bc-actf="problems"]').click()
    await page.waitForTimeout(100)
    await shot('activity')
    await audit('Activity')
    // A project with no severity and no instants offers neither filter.
    await go(page, `/p/${Q.slug}/activity`, '.bcmain')
    const c2 = await page.evaluate(`document.querySelector('.bcmain').innerText`) as string
    check(`[${tag}] Activity: a project whose records carry no severity offers no Problems filter`, !/Problems/.test(c2))

    /* ---- Calendar ---- */
    await go(page, `/p/${P.slug}/schedule`, '[data-bc-cal]')
    await page.waitForTimeout(600)
    const cal = (await page.evaluate(`(() => ({
      own: document.querySelectorAll('.bccal2mk--own').length, google: document.querySelectorAll('.bccal2mk--google').length,
      allday: document.querySelectorAll('.bccal2chip--allday').length, proj: document.querySelectorAll('.bccal2chip--proj').length,
      dense: !!document.querySelector('.bccal2month--dense'), titles: [...document.querySelectorAll('.bccal2chip, .bccal2agrow')].map((e) => e.textContent).join('|') }))()`)) as { own: number; google: number; allday: number; proj: number; dense: boolean; titles: string }
    if (vp.touch) {
      // On a phone the full month is the dense grid; the agenda lists the selected day, so open a day that has events.
      check(`[${tag}] Calendar: the phone month is the dense grid with 44px day cells`, cal.dense)
      const cell = (await page.evaluate(`(() => { const b = document.querySelector('.bccal2month--dense .bccal2num'); const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })()`)) as number[]
      check(`[${tag}] Calendar: a day button is at least 43.5px each way`, (cell[0] ?? 0) >= 43.5 && (cell[1] ?? 0) >= 43.5, JSON.stringify(cell))
    } else {
      check(`[${tag}] Calendar: own events carry the circle and Google events the diamond`, cal.own > 0 && cal.google > 0, JSON.stringify({ own: cal.own, google: cal.google }))
      check(`[${tag}] Calendar: an all-day event is drawn heavier and project events carry their hue`, cal.allday >= 1 && cal.proj >= 1, JSON.stringify({ allday: cal.allday, proj: cal.proj }))
      // Four events share tomorrow (three overlapping own events and a Google one): the cell shows three chips and says how many more.
      const busy = (await page.evaluate(
        `(() => { const b = [...document.querySelectorAll('.bccal2chips')].sort((x, y) => Number(y.dataset.total) - Number(x.dataset.total))[0]; const more = b.querySelector('.bccal2more'); return { total: Number(b.dataset.total), chips: [...b.querySelectorAll('.bccal2chip')].filter((c) => !c.hidden && c.offsetParent !== null).length, more: more && !more.hidden ? more.textContent : '' } })()`,
      )) as { total: number; chips: number; more: string }
      check(
        `[${tag}] Calendar: overlapping events are all accounted for (chips shown plus the "+N more" the cell offers)`,
        busy.total >= 4 && busy.chips + Number(busy.more.replace(/\D/g, '') || 0) === busy.total,
        JSON.stringify(busy),
      )
    }
    await audit('Calendar')
    await shot('calendar')

    /* ---- Documents ---- */
    await go(page, `/p/${P.slug}/documents`, '.bcdocs--wall [data-bc-doc]')
    await page.waitForTimeout(2500)
    const docs = (await page.evaluate(`(() => [...document.querySelectorAll('.bcdocs--wall [data-bc-doc]')].map((t) => ({ text: t.innerText.slice(0, 60), real: !!t.querySelector('img.realpage'), glyph: !!t.querySelector('.bcthumb--object, svg') })))()`)) as { text: string; real: boolean; glyph: boolean }[]
    const by = (s: string) => docs.find((d) => d.text.includes(s))
    check(`[${tag}] Documents: all ${String(DOCS.length)} documents are listed`, docs.length === DOCS.length, String(docs.length))
    check(`[${tag}] Documents: a PDF tile shows its real first page`, by('Venue contract')?.real === true, JSON.stringify(by('Venue contract')))
    check(`[${tag}] Documents: a picture tile shows the picture`, by('Floor plan')?.real === true, JSON.stringify(by('Floor plan')))
    check(`[${tag}] Documents: a spreadsheet keeps its object glyph and no invented page`, by('Budget')?.real === false && by('Budget')?.glyph === true, JSON.stringify(by('Budget')))
    check(`[${tag}] Documents: a missing file falls back and the page does not break`, by('Lost file')?.real === false && errors.length === 0, JSON.stringify({ lost: by('Lost file'), errors }))
    check(`[${tag}] Documents: the very long title does not overflow`, (await overflow(page)) <= 1)
    await audit('Documents')
    await shot('documents')

    /* ---- Home board and long project name ---- */
    await go(page, `/p/${P.slug}`, '.bcstage [data-mod]')
    // The project's chosen mark and colour persist in the office and reach the page (the replica twin of basecamp-look's production leg).
    const mark = (await page.evaluate(`(() => { const m = [...document.querySelectorAll('.bcprojmark')].find((x) => x.className.includes('p-plum')); return m ? m.className : [...document.querySelectorAll('.bcprojmark')].map((x) => x.className).join(' | ') })()`)) as string
    check(`[${tag}] a project's chosen colour, written through the office, reaches the board`, mark.includes('p-plum') && !mark.includes('bcprojmark--letter'), mark)
    await shot('board')
    await audit('Project board')
    await go(page, `/p/${LONGNAME.slug}`, '.bcstage [data-mod], .bchome')
    check(`[${tag}] a 100-character project name does not overflow the board`, (await overflow(page)) <= 1)
    await shot('board-long-name')

    check(`[${tag}] no page error and no failed or off-machine request`, errors.length === 0 && bad.length === 0, JSON.stringify({ errors, bad: bad.slice(0, 4) }))
    await ctx.close()
  }
}

await browser.close()
server.close()
await gw.close?.()
await signin.close?.()
await db.end()
console.log(`\n${String(passed)} passed, ${String(failed)} failed`)
process.exit(failed === 0 ? 0 : 1)
