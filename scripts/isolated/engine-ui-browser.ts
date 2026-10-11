// biome-ignore-all lint/suspicious/noExplicitAny: SQL results and HTTP bodies are untyped
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The engine choice in the REAL Team HQ page, through the REAL gateway and voice door, on the isolated replica (Hermes, M6).
 * Local and isolated: no production, no network, no worker, no model, no Hermes.
 *
 *   npx tsx scripts/isolated/engine-ui-browser.ts <replica-db>
 *
 * Signed in as a real second person (not the Sample, not Grant). Each is proved beside a control, on a desktop and a phone:
 *   1. an office that has not been given Hermes sees NO engine control, in the dock or on the Chat page
 *   2. an office given Hermes with its host up sees the control with the team selected; choosing Hermes is remembered, and ONLY then
 *      does the page send `engine: 'hermes'`; the office records it on the message; a message with the team chosen sends no engine field
 *   3. with the host away the control says why, in words, beside the choice, and is reachable by keyboard; nothing is sent to the team
 *      in its place
 *   4. the thread labels the message "To Hermes", reads Hermes's answer as answered by Hermes, and does not show the notes it left
 *   5. on a phone nothing overflows sideways, the select is at least 44px tall and 16px type
 *   6. no page error. Screenshots are written to .out/engine-ui-*.png and are LOOKED AT by a person.
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
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string): Promise<Record<string, unknown>[]> => (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)
const run = Date.now().toString(36)
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const EMAIL = `engui-${run}@example.invalid`
const SESSION = `aaa.bbb.${'e'.repeat(70)}`
const PORT = 4659
const env = { HQ_API_TOKEN: 'isolated-hq-token', SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'isolated-anon', SIGNIN_ALLOWED_ORIGIN: `http://127.0.0.1:${String(PORT)}` }
await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(EMAIL)})`)
const OFFICE = String(json((await one(`select app.provision_person_office('Engine Person', ${lit(EMAIL)}, ${lit(`engui-${run}`)}) as r`)).r).office_id)
const made = json((await one(`select app.hq_create_project(${lit(OFFICE)}::uuid, ${lit(`Engine project ${run}`)}, 'upload', ${lit(`engui-${run}`)}, ${lit(`Engine project ${run}`)}, true) as v`)).v)
const PROJECT_ID = String(made.project_id)
const SLUG = String((await one(`select slug from public.projects where project_id = ${lit(PROJECT_ID)}::uuid`)).slug)

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

type Turn = { said: string; body: Record<string, unknown>; status: number }
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const openPage = async (viewport = DESKTOP) => {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 600 ? { hasTouch: true, isMobile: true } : {}) })
  const seen: { pageErrors: string[]; turns: Turn[] } = { pageErrors: [], turns: [] }
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
    if (isTurn && body !== undefined) {
      const b = JSON.parse(body) as Record<string, unknown>
      seen.turns.push({ said: String(b.said ?? ''), body: b, status: res.status })
    }
    return route.fulfill({ status: res.status, headers: { ...CORS, 'content-type': res.headers.get('content-type') ?? 'application/json' }, body: text })
  })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|gw\.invalid)/, (route) => route.abort())
  await ctx.addInitScript(`window.HQ_API = '${GW}/hq-api'; window.HQ_SIGNIN = '${GW}/signin'; window.HQ_VOICE = '${GW}/voice';`)
  await ctx.addInitScript(`try { localStorage.setItem('hq.session', JSON.stringify({ access_token: '${SESSION}', refresh_token: 'r', expires_at: Date.now() + 36e5 })) } catch {}`)
  // SABOTAGE (--sabotage=send | default | label): a defect put into the page's own source, which the checks below must then catch.
  const mode = process.argv.find((a) => a.startsWith('--sabotage='))?.slice('--sabotage='.length) ?? ''
  const edits: Record<string, [string, string, string]> = {
    send: ['**/chat.js', "...(engine === 'hermes' ? { engine: 'hermes' } : {}),", ''],
    default: ['**/engine.js', "stored()[slug] === 'hermes' ? 'hermes' : 'team'", "'hermes'"],
    label: ['**/app.js', "m.engine === 'hermes' ? ' · answered by Hermes' : ''", "''"],
  }
  const edit = edits[mode]
  if (edit !== undefined) {
    await ctx.route(edit[0], async (route) => {
      const res = await route.fetch()
      const text = await res.text()
      console.log(`sabotage ${mode}: ${text.includes(edit[1]) ? 'LANDED' : 'DID NOT LAND'}`)
      await route.fulfill({ response: res, body: text.replace(edit[1], edit[2]) })
    })
  }
  const page = await ctx.newPage()
  page.on('pageerror', (e) => seen.pageErrors.push(e.message.slice(0, 200)))
  return { page, seen, close: () => ctx.close() }
}
const load = async (page: Page, tab: string): Promise<void> => {
  await page.goto(`${APP}/p/${SLUG}/${tab}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bctop', { timeout: 20000 })
  await page.waitForSelector(tab === 'chat' ? '[data-composer]' : '[data-bc-dock]', { timeout: 20000 })
  await page.waitForTimeout(1500)
}
const openDock = async (page: Page): Promise<void> => {
  if ((await page.locator('.dock [data-docksay]').count()) === 0) await page.locator('[data-bc-dock]').first().click({ force: true })
  await page.waitForSelector('.dock [data-docksay]', { timeout: 10000 })
}
const picks = async (page: Page): Promise<number> => page.locator('[data-enginepick]').count()
const shot = async (page: Page, name: string): Promise<void> => { await page.screenshot({ path: `.out/engine-ui-${name}.png` }) }
const sendFromDock = async (page: Page, text: string): Promise<void> => {
  await page.evaluate(`((t) => { const b = document.querySelector('.dock [data-docksay]'); const f = document.querySelector('.dock [data-dockform]'); b.value = t; f.requestSubmit() })(${JSON.stringify(text)})`)
}
const engineOf = async (said: string): Promise<string | null> => {
  for (let i = 0; i < 20; i += 1) {
    const r = await rows(`select engine from public.inbound_commands where instruction = ${lit(said)} and office_id = ${lit(OFFICE)}::uuid`)
    if (r.length > 0) return String(r[0]?.engine)
    await new Promise((ok) => setTimeout(ok, 400))
  }
  return null
}
const overflowX = async (page: Page): Promise<number> => Number(await page.evaluate(`(() => { const w = window.innerWidth; let worst = 0; for (const el of document.querySelectorAll('.dock *, .composer *')) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > w + 1) worst = Math.max(worst, Math.round(r.right - w)) } return worst })()`))

try {
  mkdirSync('.out', { recursive: true })
  // ---- 1. an office that has not been given Hermes sees nothing ------------------------------------------------------
  await db.execute(`delete from public.system_config where key = ${lit(SETTING.offices)}`)
  const a = await openPage()
  await load(a.page, 'overview')
  await openDock(a.page)
  check('1a an office not given Hermes: the dock draws NO engine control', (await picks(a.page)) === 0)
  await a.page.goto(`${APP}/classic/`, { waitUntil: 'domcontentloaded' })
  await a.page.waitForTimeout(2500)
  check('1b ...and neither does the older studio at /classic, which keeps its own Chat page composer', (await picks(a.page)) === 0)
  check('1c no page error', a.seen.pageErrors.length === 0, a.seen.pageErrors.join(' | '))
  await a.close()

  // ---- 2. given Hermes, host up ----------------------------------------------------------------------------------------
  await db.execute(`insert into public.system_config (key, value, description) values (${lit(SETTING.offices)}, ${lit(JSON.stringify([OFFICE]))}::jsonb, 'engine ui browser proof') on conflict (key) do update set value = excluded.value`)
  await db.execute(`insert into public.system_config (key, value, description) values (${lit(SETTING.dailyRuns)}, '900'::jsonb, 'engine ui browser proof') on conflict (key) do update set value = excluded.value`)
  const creds = generateCredentials()
  const minted = json((await one(`select app.engine_mint_bridge(${lit(OFFICE)}::uuid, 'hermes', ${lit(`ui browser ${run}`)}, ${lit(creds.bridgeSha256)}, ${lit(creds.mcpSha256)}) r`)).r)
  const BRIDGE = String(minted.bridge_id)
  const fresh = async (): Promise<void> => { await db.execute(`update public.engine_bridges set last_seen_at = now(), healthy = true, unhealthy_reason = null where bridge_id = ${lit(BRIDGE)}::uuid`) }
  const away = async (): Promise<void> => { await db.execute(`update public.engine_bridges set last_seen_at = now() - interval '10 minutes' where bridge_id = ${lit(BRIDGE)}::uuid`) }
  await fresh()

  for (const [label, viewport] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
    const t = await openPage(viewport)
    await load(t.page, 'overview')
    await openDock(t.page)
    const sel = t.page.locator('.dock [data-engine]')
    // The control is drawn when the engine status read comes back; under load that is after the dock opens (a flake seen in about one full run in three on 11 October).
    await t.page.waitForSelector('.dock [data-engine]', { timeout: 10_000 }).catch(() => undefined)
    check(`2a ${label}: the dock draws the engine control, with the team selected`, (await picks(t.page)) === 1 && (await sel.inputValue()) === 'team')
    await shot(t.page, `${label}-dock-available`)
    const TEAM = `[engine ui ${run}] ${label} to the team`
    await sendFromDock(t.page, TEAM)
    check(`2b ${label}: with the team chosen the page sends NO engine field, and the office records team`, (await engineOf(TEAM)) === 'team' && !('engine' in (t.seen.turns.find((x) => x.said === TEAM)?.body ?? { engine: 1 })))
    await sel.selectOption('hermes')
    await t.page.waitForTimeout(500)
    const stored = await t.page.evaluate(`localStorage.getItem('studio.engine')`)
    check(`2c ${label}: choosing Hermes is remembered for this project (a convenience, in this browser)`, String(stored).includes(SLUG), String(stored))
    await openDock(t.page)
    const ph = await t.page.locator('.dock [data-docksay]').getAttribute('placeholder')
    check(`2c2 ${label}: with Hermes chosen the box says Message Hermes, so it is never a surprise which one is being written to`, ph === 'Message Hermes…', String(ph))
    const HERMES =`[engine ui ${run}] ${label} to Hermes`
    await sendFromDock(t.page, HERMES)
    check(`2d ${label}: ONLY now does the page send engine hermes, and the office records it on the message`, (await engineOf(HERMES)) === 'hermes' && t.seen.turns.find((x) => x.said === HERMES)?.body.engine === 'hermes' && t.seen.turns.find((x) => x.said === HERMES)?.status === 200)
    await t.page.waitForTimeout(800)
    const dockText = (await t.page.locator('.dock').first().innerText()).replace(/\s+/g, ' ')
    check(`2e ${label}: the thread says the message went to Hermes`, dockText.includes('To Hermes'), dockText.slice(-200))
    await shot(t.page, `${label}-dock-sent-to-hermes`)
    if (label === 'phone') check('2f phone: nothing in the dock or composer overflows the screen sideways', (await overflowX(t.page)) === 0, `${String(await overflowX(t.page))}px`)
    const box = await sel.boundingBox()
    const font = Number(await sel.evaluate(`(() => Number.parseFloat(getComputedStyle(document.querySelector('.dock [data-engine]')).fontSize))()`))
    check(`2g ${label}: the select is at least 44px tall and 16px type`, box !== null && box.height >= 44 && font >= 16, `${String(box?.height)}px, ${String(font)}px`)
    check(`2h ${label}: no page error`, t.seen.pageErrors.length === 0, t.seen.pageErrors.join(' | '))
    await t.close()
    await db.execute(`delete from public.inbound_commands where instruction like ${lit(`[engine ui ${run}] ${label}%`)} and false`) // kept: the rows are the evidence
  }

  // ---- 3. the host is away: the reason is shown, the choice is not taken from the person ------------------------------------
  await away()
  {
    const t = await openPage(PHONE)
    await t.page.addInitScript(`localStorage.setItem('studio.engine', JSON.stringify({ '${SLUG}': 'hermes' }))`)
    await load(t.page, 'overview')
    await openDock(t.page)
    const why = t.page.locator('.dock .enginewhy')
    const text = (await why.first().innerText().catch(() => '')).trim()
    check('3a with the host away the control says why, in words, beside the choice', text !== '' && /check|host|available|Hermes/i.test(text), text)
    const optionText = await t.page.locator('.dock [data-engine] option[value="hermes"]').innerText()
    check('3b the Hermes option is marked not available, and is still the person\'s selected choice (nothing switched it to the team)', optionText.includes('not available') && (await t.page.locator('.dock [data-engine]').inputValue()) === 'hermes', optionText)
    const describedBy = await t.page.locator('.dock [data-engine]').getAttribute('aria-describedby')
    check('3c the reason is tied to the control for a screen reader', describedBy !== null && (await t.page.locator(`#${describedBy}`).count()) === 1, String(describedBy))
    await t.page.locator('.dock [data-docksay]').focus()
    let focusedIsSelect = false
    for (let i = 0; i < 6 && !focusedIsSelect; i += 1) {
      await t.page.keyboard.press('Tab')
      focusedIsSelect = (await t.page.evaluate(`!!document.activeElement && document.activeElement.hasAttribute('data-engine')`)) === true
    }
    check('3d the control is reachable by keyboard from the composer', focusedIsSelect === true)
    await shot(t.page, 'phone-dock-host-away')
    const AWAY = `[engine ui ${run}] to hermes while away`
    await sendFromDock(t.page, AWAY)
    check('3e a message sent to an unavailable Hermes is recorded as Hermes\'s and nowhere else (the office, not the page, says why it was not run)', (await engineOf(AWAY)) === 'hermes')
    await t.close()
  }

  // ---- 4. the thread: an answer written by Hermes is labelled, the notes it left are not shown --------------------------------
  await fresh()
  const HJ = String((await one(`select job_id::text j from public.inbound_commands where instruction = ${lit(`[engine ui ${run}] desktop to Hermes`)} and office_id = ${lit(OFFICE)}::uuid`)).j)
  await db.execute(`select app.pause_job(${lit(HJ)}::uuid, 'dependency_wait', 'Hermes is working on it.', 'Waiting for Hermes to finish.', true, null, null)`)
  const opened = json((await one(`select app.engine_run_open(${lit(OFFICE)}::uuid, ${lit(HJ)}::uuid, 'hermes', ${lit(JSON.stringify({ input: 'q', instructions: 'You answer for the office.', conversation_history: [] }))}::jsonb) r`)).r)
  const NOTE = `Hermes is working on it. note-${run}`
  await db.execute(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic) values (${lit(HJ)}::uuid, ${lit(NOTE)}, 'medium', 'inferred', ${lit(JSON.stringify([`job:${HJ}`]))}::jsonb, true)`)
  const claim = json((await one(`select app.engine_run_claim(${lit(OFFICE)}::uuid, ${lit(BRIDGE)}::uuid) r`)).r)
  await fresh()
  await db.execute(`select app.engine_run_finish(${lit(OFFICE)}::uuid, ${lit(BRIDGE)}::uuid, ${lit(String(opened.run_id))}::uuid, ${String(claim.run?.claim_gen)}, 'completed', ${lit(JSON.stringify({ tools_started: 0, approvals_denied: 0, answer: 'x', model: 'proof', usage: { input_tokens: 5, output_tokens: 5 } }))}::jsonb)`)
  const ANSWER = `The deposit is unchanged. answer-${run}`
  await db.execute(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic) values (${lit(HJ)}::uuid, ${lit(ANSWER)}, 'medium', 'inferred', ${lit(JSON.stringify([`job:${HJ}`]))}::jsonb, false)`)
  for (const [label, viewport] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
    const t = await openPage(viewport)
    await load(t.page, 'overview')
    await openDock(t.page)
    await t.page.waitForSelector(`text=${ANSWER}`, { timeout: 15000 }).catch(() => undefined)
    const body = (await t.page.locator('.dock [data-dockthread]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    check(`4a ${label}: Hermes's answer is in the conversation and says it was answered by Hermes`, body.includes(ANSWER) && /answered by hermes/i.test(body), body.slice(-900))
    check(`4b ${label}: the note Hermes left while it worked is not shown`, !body.includes(`note-${run}`))
    const teamLabelled = (body.match(/answered by hermes/gi) ?? []).length
    check(`4c ${label}: exactly one answer is labelled, and the messages the person sent to the team are not`, teamLabelled === 1, String(teamLabelled))
    await shot(t.page, `${label}-dock-answered-by-hermes`)
    check(`4d ${label}: no page error`, t.seen.pageErrors.length === 0, t.seen.pageErrors.join(' | '))
    await t.close()
  }
} finally {
  await browser.close()
  server.close?.()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
void sha
process.exit(failed === 0 ? 0 : 1)
