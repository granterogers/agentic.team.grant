// biome-ignore-all lint/suspicious/noExplicitAny: SQL results and HTTP bodies are untyped
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The proposal card a person reads before keeping a procedure Hermes found or wrote, in the REAL Team HQ page through the REAL gateway
 * and voice door, on the isolated replica (Hermes, M8). Local and isolated: no production, no network, no model, no Hermes.
 *
 *   npx tsx scripts/isolated/engine-skill-card-browser.ts <replica-db> [--sabotage=procedure|dialog|escape]
 *
 * Signed in as a real second person. Proved, on a desktop and a phone:
 *   1. the card names where the procedure came from, says it is not in use, and holds the procedure behind a control that a keyboard can open;
 *   2. the procedure is shown as TEXT: markup inside it is not interpreted (a hostile specimen planted by an attacker with table access is
 *      shown escaped, and its press is refused by the office);
 *   3. Accept asks in the procedure's own words (not the rule's), writes ONE skill, and the card leaves the waiting list;
 *   4. Decline asks, writes nothing, and the same procedure is not proposed again;
 *   5. nothing overflows sideways on a phone, controls are 44px, no page error. Screenshots are written to .out/engine-skill-*.png.
 */
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import { generateCredentials } from '../../src/engines/hermes/credentials.ts'
import { SETTING } from '../../src/engines/hermes/timing.ts'
import { serveStudio } from '../verify/serve-studio.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'bq')
const MODE = process.argv.find((a) => a.startsWith('--sabotage='))?.slice('--sabotage='.length) ?? ''
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, any>> => (await db.execute(sql)).rows[0] as Record<string, any>
const rows = async (sql: string): Promise<Record<string, any>[]> => (await db.execute(sql)).rows as Record<string, any>[]
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)
const jsonLit = (v: unknown): string => `${lit(JSON.stringify(v))}::jsonb`
const run = Date.now().toString(36)
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const EMAIL = `engcard-${run}@example.invalid`
const SESSION = `aaa.bbb.${'f'.repeat(70)}`
const PORT = 4660
const env = { HQ_API_TOKEN: 'isolated-hq-token', SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'isolated-anon', SIGNIN_ALLOWED_ORIGIN: `http://127.0.0.1:${String(PORT)}` }
await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(EMAIL)})`)
const OFFICE = String(json((await one(`select app.provision_person_office('Card Person', ${lit(EMAIL)}, ${lit(`engcard-${run}`)}) as r`)).r).office_id)
const PROJECT = String(json((await one(`select app.hq_create_project(${lit(OFFICE)}::uuid, ${lit(`Card project ${run}`)}, 'upload', ${lit(`engcard-${run}`)}, ${lit(`Card project ${run}`)}, true) as v`)).v).project_id)
const SLUG = String((await one(`select slug from public.projects where project_id = ${lit(PROJECT)}::uuid`)).slug)

const authUsers: Record<string, string> = { [SESSION]: EMAIL }
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })
const signin = await startEdge({ db, edgeFile: 'supabase/functions/signin/index.ts', env, authUsers })
const voice = await startEdge({ db, edgeFile: 'supabase/functions/voice/index.ts', env, authUsers })
const GW = 'https://gw.invalid/functions/v1'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
const server = await serveStudio(PORT)
const APP = `http://127.0.0.1:${String(PORT)}`
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })

// ---- the office's side: Hermes on, learning on, a finished run for each card -----------------------------------------------------------------------------------------
await db.execute(`insert into public.system_config (key, value, description) values (${lit(SETTING.offices)}, ${jsonLit([OFFICE])}, 'skill card proof') on conflict (key) do update set value = excluded.value`)
await db.execute(`insert into public.system_config (key, value, description) values (${lit(SETTING.dailyRuns)}, '900'::jsonb, 'skill card proof') on conflict (key) do update set value = excluded.value`)
await db.execute(`insert into public.system_config (key, value, description) values ('engine.hermes.learning_offices', ${jsonLit([OFFICE])}, 'skill card proof') on conflict (key) do update set value = excluded.value`)
await db.execute(`insert into public.system_config (key, value, description) values ('engine.hermes.skill_proposals_per_day', '10'::jsonb, 'skill card proof') on conflict (key) do update set value = excluded.value`)
const creds = generateCredentials()
const BRIDGE = String(json((await one(`select app.engine_mint_bridge(${lit(OFFICE)}::uuid, 'hermes', ${lit(`card ${run}`)}, ${lit(creds.bridgeSha256)}, ${lit(creds.mcpSha256)}) r`)).r).bridge_id)
const fresh = async (): Promise<void> => { await db.execute(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where bridge_id = ${lit(BRIDGE)}::uuid`) }
await fresh()

/** One page visit as a signed-in person; the page reads the replica through the real gateway. */
const openPage = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 600 ? { hasTouch: true, isMobile: true } : {}) })
  const seen = { pageErrors: [] as string[], turns: [] as { said: string; status: number }[] }
  await ctx.route(`${GW}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const isTurn = url.pathname.endsWith('/voice/turn')
    const fn = isTurn ? 'voice' : (url.pathname.split('/').pop() ?? '')
    const edge = fn === 'signin' ? signin : fn === 'hq-api' ? gw : fn === 'voice' ? voice : null
    if (edge === null) return route.fulfill({ status: 404, headers: CORS, body: '{"error":"not served here"}' })
    const body = req.postData() ?? undefined
    const res = await edge.call(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(body === undefined ? {} : { body }) }))
    const text = await res.text()
    if (isTurn && body !== undefined) seen.turns.push({ said: String(JSON.parse(body).said ?? ''), status: res.status })
    return route.fulfill({ status: res.status, headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' }, body: text })
  })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|gw\.invalid)/, (route) => route.abort())
  await ctx.addInitScript(`window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin'; window.HQ_VOICE = '${GW}/voice';`)
  await ctx.addInitScript(`try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${SESSION}', refresh_token: 'r', expires_at: Date.now() + 36e5 })) } catch {}`)
  const edits: Record<string, [string, string, string]> = {
    procedure: ['**/app.js', "${esc(k.procedure ?? '')}", ''],
    dialog: ['**/app.js', "title: 'Keep this procedure?'", "title: 'Make this a standing rule?'"],
    escape: ['**/app.js', "${esc(k.procedure ?? '')}", "${k.procedure ?? ''}"],
  }
  const edit = edits[MODE]
  if (edit !== undefined) {
    await ctx.route(edit[0], async (route) => {
      const res = await route.fetch()
      const text = await res.text()
      console.log(`sabotage ${MODE}: ${text.includes(edit[1]) ? 'LANDED' : 'DID NOT LAND'}`)
      await route.fulfill({ response: res, body: text.replace(edit[1], () => edit[2]) })
    })
  }
  const page = await ctx.newPage()
  page.on('pageerror', (e) => seen.pageErrors.push(e.message.slice(0, 200)))
  return { page, seen, close: () => ctx.close() }
}
const shot = async (page: Page, name: string): Promise<void> => { await page.screenshot({ path: `.out/engine-skill-${name}.png` }) }

/** A job from a real message sent in the page's own dock to Hermes, then a finished run on it with the served calls recorded. */
const finishedRun = async (said: string, steps: [string, string | null][]): Promise<{ job: string; runId: string }> => {
  const { page, seen, close } = await openPage()
  try {
    await page.addInitScript(`localStorage.setItem('studio.engine', JSON.stringify({ '${SLUG}': 'hermes' }))`)
    await page.goto(`${APP}/p/${SLUG}/overview`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-bc-dock]', { timeout: 20000 })
    if ((await page.locator('.dock [data-docksay]').count()) === 0) await page.locator('[data-bc-dock]').first().click({ force: true })
    await page.waitForSelector('.dock [data-docksay]', { timeout: 10000 })
    await page.evaluate(`((t) => { const b = document.querySelector('.dock [data-docksay]'); const f = document.querySelector('.dock [data-dockform]'); b.value = t; f.requestSubmit() })(${JSON.stringify(said)})`)
    for (let i = 0; i < 30 && seen.turns.length === 0; i += 1) await page.waitForTimeout(300)
  } finally { await close() }
  const job = String((await one(`select job_id::text j from public.inbound_commands where instruction = ${lit(said)} and office_id = ${lit(OFFICE)}::uuid`)).j)
  await db.execute(`select app.pause_job(${lit(job)}::uuid, 'dependency_wait', 'Hermes is working on it.', 'Waiting for Hermes to finish.', true, null, null)`)
  const opened = json((await one(`select app.engine_run_open(${lit(OFFICE)}::uuid, ${lit(job)}::uuid, 'hermes', ${jsonLit({ input: said, instructions: 'You answer for the office.', conversation_history: [] })}) r`)).r)
  await fresh()
  const claim = json((await one(`select app.engine_run_claim(${lit(OFFICE)}::uuid, ${lit(BRIDGE)}::uuid) r`)).r)
  let n = 0
  for (const [tool, domain] of steps) await db.execute(`select app.engine_record_call(${lit(OFFICE)}::uuid, ${lit(opened.run_id)}::uuid, ${lit(tool)}, 'served', ${lit(sha(`${tool}${String(++n)}${said}`))}, ${domain === null ? 'null' : lit(domain)}, true, 40, 'CARD-RESULT', null)`)
  await db.execute(`select app.engine_run_finish(${lit(OFFICE)}::uuid, ${lit(BRIDGE)}::uuid, ${lit(opened.run_id)}::uuid, ${String(claim.run.claim_gen)}, 'completed', ${jsonLit({ tools_started: steps.length, approvals_denied: 0, answer: 'Done.', model: 'proof', usage: { input_tokens: 5, output_tokens: 5 } })}) r`)
  await db.execute(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic) values (${lit(job)}::uuid, ${lit(`Answer for ${said}`)}, 'medium', 'inferred', ${jsonLit([`job:${job}`])}, false)`)
  return { job, runId: String(opened.run_id) }
}

mkdirSync('.out', { recursive: true })
try {
  const observed = await finishedRun(`Card question one ${run}`, [['search_documents', 'documents'], ['read_document', 'documents'], ['list_tasks', 'tasks']])
  const authored = await finishedRun(`Card question two ${run}`, [['list_events', null]])
  await db.execute(`select app.raise_suggestions(${lit(OFFICE)}::uuid, 12)`)
  const proposal = json((await one(`select app.engine_propose_skill(${lit(OFFICE)}::uuid, ${lit(BRIDGE)}::uuid, ${lit(authored.runId)}::uuid, ${jsonLit({ name: 'Check the plan first', when: 'A question on this project about dates or cost', procedure: 'Open the project plan first and note the dates.\nThen look at the budget notes and say which figure the answer rests on.', tools: ['db.read'], dropped: ['Hermes also used its terminal, which the team does not have.'] })}) r`)).r)
  check('0 (setup) one observed and one Hermes-written proposal are waiting', typeof proposal.suggestion_id === 'string' && (await rows(`select 1 from public.suggestions where office_id = ${lit(OFFICE)}::uuid and kind = 'engine.skill' and state = 'open'`)).length === 2, JSON.stringify(proposal))
  // A hostile specimen planted by somebody with table access: markup in the procedure. It must be shown as text, and its press refused.
  const evilProcedure = 'Open the plan first. <img src=x onerror="window.__pwned=1"> <b id="evilbold">bold</b> then say so for the person to read.'
  const evilKey = String((await one(`select app.engine_skill_key(${lit(evilProcedure)}, ${lit(PROJECT)}::uuid) k`)).k)
  const evilOffer = { name: 'Planted markup', when: 'A question on this project about dates', procedure: evilProcedure, scope: 'project', project_id: PROJECT, tools: ['db.read'], from_job: observed.job, source: 'hermes_authored', run_id: observed.runId, dropped: [] }
  await db.execute(`insert into public.suggestions (office_id, project_id, kind, subject_ref, body, offer_kind, offer_args) values (${lit(OFFICE)}::uuid, ${lit(PROJECT)}::uuid, 'engine.skill', ${lit(evilKey)}, 'Hermes wrote a procedure for this project called "Planted markup". It is not in use, and will not be unless you keep it. Read it first.', 'teach_skill', ${jsonLit(evilOffer)})`)

  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    const t = await openPage(viewport)
    await t.page.goto(`${APP}/?settings=connections`, { waitUntil: 'domcontentloaded' })
    await t.page.waitForSelector('#settings', { timeout: 20000 })
    await t.page.waitForTimeout(1200)
    // On a phone the page opens on one section; the list of sections is one press back.
    if (label === 'phone') { await t.page.locator('[data-stg-back]').first().click({ force: true }); await t.page.waitForTimeout(500) }
    await t.page.locator('#settings').getByText('Requests', { exact: true }).first().click({ force: true })
    await t.page.waitForTimeout(1500)
    const cards = t.page.locator('#settings .st-case', { hasText: 'Hermes' })
    check(`1a ${label}: the proposals are in Waiting for your decision, with their kind named`, (await cards.count()) >= 3 && (await t.page.locator('#settings').innerText()).includes('a procedure from Hermes'), String(await cards.count()))
    const first = t.page.locator('#settings .st-case', { hasText: 'Check the plan first' }).first()
    const text = (await first.innerText()).replace(/\s+/g, ' ')
    check(`1b ${label}: the card says it is not in use and that no tool or permission is granted`, /not in use/.test(text) && /no tool and no permission/.test(text), text.slice(0, 240))
    check(`1c ${label}: and says where it came from (written by Hermes, not checked)`, /Written by Hermes, not checked by anyone/.test(text), text.slice(0, 200))
    const summary = first.locator('summary')
    await summary.focus()
    await t.page.keyboard.press('Enter')
    const open = await first.locator('details').evaluate((d: any) => d.open)
    check(`1d ${label}: the procedure opens from the keyboard (Enter on the control)`, open === true)
    const opened = (await first.innerText()).replace(/\s+/g, ' ')
    check(`1e ${label}: opened, it shows when it applies, the procedure, the tool it names and what was left out`, /Open the project plan first/.test(opened) && /dates or cost/.test(opened) && /It names/.test(opened) && /terminal/.test(opened), opened.slice(0, 300))
    if (label === 'phone') {
      const over = Number(await t.page.evaluate(`(() => { const w = window.innerWidth; let worst = 0; for (const el of document.querySelectorAll('#settings .st-case *')) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > w + 1) worst = Math.max(worst, Math.round(r.right - w)) } return worst })()`))
      check('1f phone: nothing in a card overflows the screen sideways', over === 0, `${String(over)}px`)
      const sb = await summary.boundingBox()
      check('1g phone: the control that opens the procedure is at least 44px tall', sb !== null && sb.height >= 44, String(sb?.height))
    }
    await shot(t.page, `${label}-card-open`)
    const evil = t.page.locator('#settings .st-case', { hasText: 'Planted markup' }).first()
    await evil.locator('summary').click({ force: true })
    const shown = (await evil.locator('.st-skillproc').innerText())
    check(`2a ${label}: markup inside a procedure is shown as text, not interpreted (no element made from it, nothing ran)`, shown.includes('<img src=x') && shown.includes('<b id="evilbold">') && (await t.page.locator('#evilbold').count()) === 0 && (await t.page.evaluate(`window.__pwned === undefined`)) === true, shown.slice(0, 120))
    check(`2b ${label}: no page error`, t.seen.pageErrors.length === 0, t.seen.pageErrors.join(' | '))
    await t.close()
  }

  // Accept and Decline, driven as a person (desktop).
  const t = await openPage()
  await t.page.goto(`${APP}/?settings=connections`, { waitUntil: 'domcontentloaded' })
  await t.page.waitForSelector('#settings', { timeout: 20000 })
  await t.page.waitForTimeout(1200)
  await t.page.locator('#settings').getByText('Requests', { exact: true }).first().click({ force: true })
  await t.page.waitForTimeout(1500)
  const acceptCard = t.page.locator('#settings .st-case', { hasText: 'Check the plan first' }).first()
  await acceptCard.getByRole('button', { name: 'Accept' }).click({ force: true })
  await t.page.waitForTimeout(600)
  const dialog = (await t.page.locator('.stg-confirm').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('3a Accept asks in the procedure\'s own words: keep it, project only, no tool or permission, withdraw any time', /Keep this procedure\?/.test(dialog) && /on this project/.test(dialog) && /no tool and no permission/.test(dialog) && /withdraw it/.test(dialog), dialog.slice(0, 260))
  await shot(t.page, 'desktop-accept-dialog')
  await t.page.locator('.stg-confirm').getByRole('button', { name: 'Keep it' }).click({ force: true }).catch(() => undefined)
  await t.page.waitForTimeout(1800)
  const skills = await rows(`select s.skill_id::text id, s.from_job::text from_job, s.authored_by, (select array_agg(tool) from public.skill_tools k where k.skill_id = s.skill_id) tools from public.skills_live s where exists (select 1 from public.skills o where o.skill_id = s.skill_id and o.office_id = ${lit(OFFICE)}::uuid) and s.name = 'Check the plan first'`)
  check('3b pressing Keep it writes ONE skill, attributed to the person, linked to the run\'s job, naming its tool', skills.length === 1 && skills[0]?.from_job === authored.job && JSON.stringify(skills[0]?.tools) === '["db.read"]', JSON.stringify(skills))
  const afterText = (await t.page.locator('#settings').innerText()).replace(/\s+/g, ' ')
  check('3c the card has left Waiting for your decision', !/Hermes wrote a procedure for this project called "Check the plan first"/.test(afterText.split('Earlier')[0] ?? afterText), afterText.slice(0, 120))
  // The observed card: Decline.
  const observedCard = t.page.locator('#settings .st-case', { hasText: 'Hermes answered a question' }).first()
  await observedCard.getByRole('button', { name: 'Decline' }).click({ force: true })
  await t.page.waitForTimeout(600)
  const dialog2 = (await t.page.locator('.stg-confirm').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('4a Decline asks in the procedure\'s own words and says the same procedure will not be proposed again', /Decline this procedure\?/.test(dialog2) && /will not be proposed again/.test(dialog2), dialog2.slice(0, 200))
  await t.page.locator('.stg-confirm').getByRole('button', { name: 'Decline' }).click({ force: true }).catch(() => undefined)
  await t.page.waitForTimeout(1800)
  const declined = await rows(`select state, dismissals from public.suggestions where office_id = ${lit(OFFICE)}::uuid and kind = 'engine.skill' and offer_args ->> 'source' = 'observed'`)
  const skillsAfter = await rows(`select 1 from public.skills where office_id = ${lit(OFFICE)}::uuid and from_job = ${lit(observed.job)}::uuid`)
  check('4b Decline records it and writes no skill', declined.length === 1 && declined[0]?.state === 'dismissed' && skillsAfter.length === 0, JSON.stringify(declined))
  // The planted hostile card: Accept is refused by the office, and the page says so.
  const evilCard = t.page.locator('#settings .st-case', { hasText: 'Planted markup' }).first()
  await evilCard.getByRole('button', { name: 'Accept' }).click({ force: true })
  await t.page.waitForTimeout(500)
  await t.page.locator('.stg-confirm').getByRole('button', { name: 'Keep it' }).click({ force: true }).catch(() => undefined)
  await t.page.waitForTimeout(1800)
  check('5 the planted hostile procedure is refused on the press and no skill is written for it', (await rows(`select 1 from public.skills where office_id = ${lit(OFFICE)}::uuid and name = 'Planted markup'`)).length === 0 && (await rows(`select state from public.suggestions where office_id = ${lit(OFFICE)}::uuid and subject_ref = ${lit(evilKey)}`))[0]?.state === 'open')
  await shot(t.page, 'desktop-after-decisions')
  check('6 no page error', t.seen.pageErrors.length === 0, t.seen.pageErrors.join(' | '))
  await t.close()
} finally {
  await browser.close()
  server.close?.()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exit(failed === 0 ? 0 : 1)
