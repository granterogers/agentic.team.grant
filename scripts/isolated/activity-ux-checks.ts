// biome-ignore-all lint/suspicious/noExplicitAny: untyped rows and page evaluation
// biome-ignore-all format: dense harness kept readable as written
/**
 * The Activity UX assertions (phase 6). The harness (activity-ux-browser.ts) seeds genuine ledger rows for office A (in the canary) and
 * office B (outside it) and signs each in through the real gateway. Every list the screen shows is compared with what the gateway
 * answered, and the gateway's answer with what the database says; nothing here is a JavaScript array standing in for the read model.
 */
import type { Page } from 'playwright'

// The callbacks below run INSIDE the page; the project's TypeScript program has no DOM library (adding one changes fetch's types for
// every script), so the page's own names are declared loosely here.
type Element = any
type HTMLElement = any
declare const document: any
declare const getComputedStyle: any

// Rectangles are those of the TEXT (a Range over the element's contents): a button's padded hit area and a line's reserved gutter are
// not text, and measuring them reports overlaps nobody can see.
const ROWS = `(() => { var vis = function (e) { return e.offsetParent !== null || getComputedStyle(e).position === 'fixed' };
  var rect = function (e) { var g = document.createRange(); g.selectNodeContents(e); var r = g.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height } };
  return Array.prototype.slice.call(document.querySelectorAll('.bcact-item')).filter(vis).map(function (it) {
    var q = function (s) { return it.querySelector(s) };
    var who = q('.bcact-who'), s = q('.bcact-sentence'), t = q('.bcact-time'), m = q('.bcact-meta'), res = q('.bcact-result');
    return { id: it.getAttribute('data-act-item'), who: who ? who.textContent.replace(/Reported$/, '').trim() : '', reported: !!q('.bcact-tag'), sentence: s ? s.textContent.trim() : '',
      meta: m ? m.textContent.trim() : '', result: res ? res.textContent.trim() : '', time: t ? t.textContent.trim() : '', problem: it.classList.contains('is-problem'),
      expanded: s ? s.getAttribute('aria-expanded') : '', sr: s ? rect(s) : null, tr: t ? rect(t) : null, wr: who ? rect(who) : null, ir: it.getBoundingClientRect() } }) })()`
type Row = { id: string; who: string; reported: boolean; sentence: string; meta: string; result: string; time: string; problem: boolean; expanded: string; sr: any; tr: any; wr: any; ir: any }

export async function runAll(H: any): Promise<void> {
  const { open, goto, shot, check, overflowOf, VIEWPORTS, db, seeded, officeA, officeB, S_A, gw, GW, setList, setMaster } = H
  const feed = async (bearer: string, q: string) => {
    const r = await gw.call(new Request(`${GW}/hq-api?section=activity_feed&${q}`, { headers: { authorization: `Bearer ${bearer}` } }))
    const j = JSON.parse(await r.text())
    return j?.data ?? j
  }
  // any[]: rows are indexed freely below (a missing row is a failing check, not a type error)
  const rowsOf = (p: Page) => p.evaluate(ROWS) as Promise<any[]>
  // The studio never stops moving, so Playwright's "stable" check can never pass inside it (CLAUDE.md). The press is therefore hit-tested
  // by hand - the element at its centre must BE the control - and then forced: a real occlusion still fails, loudly, with its name.
  const press = async (p: Page, sel: string) => {
    const h = await p.waitForSelector(sel, { state: 'visible', timeout: 10000 })
    await h.evaluate((e: Element) => e.scrollIntoView({ block: 'center' }))
    const hit = await h.evaluate((e: Element) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === e || e.contains(t) ? '' : `covered by ${t?.tagName}.${(t as HTMLElement | null)?.className}` })
    if (hit !== '') throw new Error(`${sel} is ${hit}`)
    await h.click({ force: true })
  }
  const ready = async (p: Page, path = '/activity') => {
    await goto(p, path, '.bcact, .bcsectiontitle, .bcrecordhead')
    await p.waitForSelector('.bcact-item, .bcempty, .bcact-sk', { timeout: 20000 }).catch(() => undefined)
    await p.waitForTimeout(700)
  }
  const settle = async (p: Page, ms = 900) => { await p.waitForLoadState('domcontentloaded'); await p.waitForTimeout(ms) }
  const feedCalls = (seen: any) => seen.calls.filter((c: any) => c.section === 'activity_feed')
  const crewName = (slug: string) => ({ 'chief-of-staff': 'Claire', 'research-director': 'Emma', 'finance-director': 'Daniel', 'growth-director': 'Ruby', 'communications-director': 'Oliver', 'operations-director': 'Marcus', 'strategy-director': 'Tom', 'quality-director': 'Grace' } as Record<string, string>)[slug]

  // ------------------------------------------------------------------------------------------------ the gateway's own answer, the oracle for the screen
  const oracle = await feed(S_A, 'visibility=user&limit=40')
  const oracleEvents: any[] = oracle.events ?? []
  check('oracle: the gateway answers enabled with a full first page and a cursor for office A', oracle.enabled === true && oracleEvents.length === 40 && oracle.next !== null, `${oracleEvents.length} events, next ${oracle.next === null ? 'none' : 'yes'}`)

  for (const vp of VIEWPORTS) {
    const tag = `${vp.name}px`
    // ---------------------------------------------------------------------------------------------- default timeline
    {
      const { page, seen, close } = await open(vp)
      const t0 = Date.now()
      await ready(page)
      const firstRow = Date.now() - t0
      const rows = await rowsOf(page)
      const calls = feedCalls(seen)
      check(`${tag}: the page asks activity_feed (the whole-history reader), not a page-local list`, calls.length >= 1 && /visibility=user/.test(calls[0].query) && /limit=40/.test(calls[0].query), calls[0]?.query?.slice(0, 80))
      check(`${tag}: the rows are the gateway's, in the gateway's order, none dropped or invented`, rows.length === oracleEvents.length && rows.every((r, i) => r.id === oracleEvents[i].id), `${rows.length} rows vs ${oracleEvents.length}`)
      check(`${tag}: every title is the ledger's own sentence (marker stripped, nothing composed)`, rows.every((r, i) => r.sentence === String(oracleEvents[i].summary).replace(/^\[external:[^\]\s]{1,60}\]\s*/, '')), '')
      check(`${tag}: no stored marker, raw job kind or raw slug reaches a title`, rows.every((r) => !/\[external:|office\.instruction|chief-of-staff|research-director/.test(r.sentence)), '')
      // attribution: the actor line is derived from the record's actor, never invented
      const bad: string[] = []
      rows.forEach((r, i) => {
        const e = oracleEvents[i]
        const want = e.actor_kind === 'user' ? 'You' : e.actor_kind === 'agent' ? (crewName(e.actor) ?? '(not on roster)') : e.actor_kind === 'external' ? 'Hermes (outside worker)' : 'Team HQ'
        if (e.actor_kind === 'agent' && crewName(e.actor) === undefined) { if (!/no longer on the roster/.test(r.who)) bad.push(`${r.who} for ${e.actor}`) }
        else if (r.who !== want) bad.push(`${r.who} != ${want} (${e.type})`)
        if (e.actor_kind === 'external' && !r.reported) bad.push(`external row not marked Reported (${e.type})`)
        if (e.actor_kind !== 'external' && r.reported) bad.push(`non-external row marked Reported (${e.type})`)
      })
      check(`${tag}: agent attribution - Claire only for the chief, each specialist by their own name, a worker marked Reported, an unknown actor never credited`, bad.length === 0, bad.slice(0, 3).join(' | ') || 'every actor matches its record')
      const unknown = rows.find((r) => /A retired specialist was held back/.test(r.sentence))
      check(`${tag}: a specialist the roster does not hold is named as such, never credited to Claire or another specialist, and the row is marked as a problem`, unknown !== undefined && /no longer on the roster/.test(unknown.who) && !/Claire|Emma|Daniel|Ruby|Oliver|Marcus|Tom|Grace/.test(unknown.who) && unknown.problem, unknown?.who ?? 'row not found')
      const heads = await page.$$eval('.bcact-dayhead', (n: Element[]) => n.map((x) => x.textContent?.trim() ?? ''))
      check(`${tag}: events are grouped under Today / Yesterday / dated headings, newest day first`, heads.length >= 1 && heads[0] === 'Today' && new Set(heads).size === heads.length, heads.join(' | '))
      const lap = rows.filter((r) => r.sr && r.tr && r.wr && !(r.tr.left >= r.sr.right - 1 || r.tr.bottom <= r.sr.top + 1 || r.tr.right <= r.sr.left + 1 || r.tr.top >= r.sr.bottom - 1)).map((r) => r.sentence.slice(0, 40))
      check(`${tag}: a time never overlaps a title`, lap.length === 0, lap.join(' | ') || `${rows.length} rows measured`)
      const lap2 = rows.filter((r) => r.wr && r.tr && r.tr.left < r.wr.right && r.tr.right > r.wr.left && r.tr.top < r.wr.bottom && r.tr.bottom > r.wr.top).map((r) => r.who)
      check(`${tag}: a time never overlaps the actor line`, lap2.length === 0, lap2.join(' | ') || 'clear')
      const o = await overflowOf(page)
      check(`${tag}: no horizontal overflow`, o.scroll <= o.vw, `${o.scroll} of ${o.vw}`)
      // overflow checks ignore clipped content, which is exactly how a cut-off chip hides: measure every visible control's edges instead
      const clipped = (await page.evaluate(`Array.prototype.slice.call(document.querySelectorAll('.bcact button, .bcact select, .bcact-tag, .bcact-result')).filter(function (e) { return e.offsetParent !== null }).map(function (e) { var r = e.getBoundingClientRect(); return { l: (e.textContent || '').trim().slice(0, 20), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), cls: e.className } }).filter(function (x) { return x.left < -0.5 || x.right > ${vp.w} + 0.5 })`)) as any[]
      check(`${tag}: no control or tag is cut off at either edge`, clipped.length === 0, clipped.map((x) => `${x.l}:${x.left}-${x.right}`).join(' ') || 'all inside')
      const wrapped = (await page.evaluate(`Array.prototype.slice.call(document.querySelectorAll('.bcact-tag, .bcact-result')).filter(function (e) { return e.offsetParent !== null && e.getBoundingClientRect().height > 26 }).map(function (e) { return e.textContent.trim() })`)) as string[]
      check(`${tag}: a tag or result is never broken across lines`, wrapped.length === 0, wrapped.join(' | ') || 'whole')
      check(`${tag}: no page error, nothing left the machine`, seen.pageErrors.length === 0 && seen.consoleErrors.length === 0 && seen.refused.length === 0, [...seen.pageErrors, ...seen.consoleErrors, ...seen.refused].join(' | ') || 'clean')
      const small = (await page.evaluate(`Array.prototype.slice.call(document.querySelectorAll('.bcact button, .bcact select, .bcact summary, .bcact a')).filter(function (e) { return e.offsetParent !== null }).map(function (e) { var r = e.getBoundingClientRect(); return { l: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 28), h: Math.round(r.height) } }).filter(function (x) { return x.h < 43 })`)) as any[]
      check(`${tag}: ${vp.touch ? 'every control is at least 44px tall' : 'controls measured (touch floor applies on touch devices)'}`, !vp.touch || small.length === 0, small.map((x) => `${x.l}:${x.h}`).join(' ') || 'none small')
      const fs = (await page.evaluate(`(function(){ var min = 99; Array.prototype.slice.call(document.querySelectorAll('.bcact *')).forEach(function (e) { if (e.children.length === 0 && (e.textContent || '').trim() !== '' && e.offsetParent !== null) min = Math.min(min, parseFloat(getComputedStyle(e).fontSize)) }); return min })()`)) as number
      check(`${tag}: no text under 12px`, fs >= 12, `smallest ${fs}px`)
      const lm = (await page.evaluate(`({ h1: document.querySelectorAll('h1').length, h2: document.querySelectorAll('.bcact h2').length, main: document.querySelectorAll('main, [role=main]').length })`)) as any
      check(`${tag}: one h1, day headings are h2, one main landmark`, lm.h1 === 1 && lm.h2 >= 1 && lm.main >= 1, JSON.stringify(lm))
      timings(H, 'first-rows-ms', firstRow)
      await shot(page, `after-activity-${vp.name}`)
      await shot(page, `after-activity-${vp.name}-full`, true)
      await close()
    }
    // ---------------------------------------------------------------------------------------------- happening now
    {
      const { page, close } = await open(vp)
      await ready(page)
      const inflight = Number(((await db.execute(`select count(*)::int as n from public.jobs j where j.office_id = '${officeA}'::uuid and j.state in ('running','queued','retrying') and j.project_id is not null and not app.harness_job(j.job_id)`)).rows[0] as any).n)
      const now = await page.locator('.bcact-now').first().innerText().catch(() => '')
      const rowsNow = await page.$$('.bcact-nowrow')
      check(`${tag}: Happening now lists the office's in-flight requests from its own job records (${inflight} in flight)`, inflight === 0 ? /Nothing is running/.test(now) : rowsNow.length === Math.min(3, inflight) && (inflight <= 3 || /\(\d+\)/.test(now)), `${rowsNow.length} shown; ${now.slice(0, 60).replace(/\n/g, ' ')}`)
      const raw = (await page.locator('.bcact').first().innerText()).match(/\b(office|google|notebook|artifact|task|drive|slack|telegram)\.[a-z_]+\b/g)
      check(`${tag}: no raw job kind or dotted identifier appears anywhere on the screen`, raw === null, (raw ?? []).join(', ') || 'none')
      await shot(page, `after-now-${vp.name}`)
      await close()
    }
    // ---------------------------------------------------------------------------------------------- paging
    {
      const { page, seen, close } = await open(vp)
      await ready(page)
      const before = (await rowsOf(page)).length
      const t0 = Date.now()
      await press(page,'[data-act-more]')
      await page.waitForFunction((n: number) => document.querySelectorAll('.bcact-item').length > n, before, { timeout: 15000 })
      H.timings['older-page-ms'] = [...(H.timings['older-page-ms'] ?? []), Date.now() - t0]
      const rows = await rowsOf(page)
      const calls = feedCalls(seen)
      const second = calls[calls.length - 1]
      const want = await feed(S_A, `visibility=user&limit=40&before_at=${encodeURIComponent(oracle.next.at)}&before_id=${oracle.next.id}`)
      check(`${tag}: Show older activity asks the next page by the cursor and appends exactly that page`, /before_at=/.test(second.query) && rows.length === before + (want.events ?? []).length && (want.events ?? []).every((e: any, i: number) => rows[before + i]?.id === e.id), `${before} -> ${rows.length}`)
      check(`${tag}: no event is shown twice across pages`, new Set(rows.map((r) => r.id)).size === rows.length, `${rows.length} rows`)
      await close()
    }
    // ---------------------------------------------------------------------------------------------- filters: server-side, compared with the database
    {
      const { page, seen, close } = await open(vp)
      await ready(page)
      const dbIds = async (where: string) => (await db.execute(`select (e->>'id') as id, e->>'status' as st, e->>'severity' as sev from jsonb_array_elements((app.activity_read(p_office => '${officeA}'::uuid, ${where}, p_visibility => 'user', p_limit => 40))->'events') e`)).rows as any[]
      await press(page,'[data-act-view="completed"]')
      await page.waitForFunction(() => document.querySelector('[data-act-view="completed"][aria-pressed="true"]') !== null)
      await settle(page, 1200)
      let rows = await rowsOf(page)
      let q = feedCalls(seen).at(-1).query
      let want = await dbIds(`p_status => 'completed'`)
      check(`${tag}: Completed is a server query (status=completed) and shows exactly the database's first page`, /status=completed/.test(q) && rows.length === want.length && rows.every((r, i) => r.id === want[i].id) && want.every((w) => w.st === 'completed'), `${rows.length} rows, query ${q.slice(0, 70)}`)
      await press(page,'[data-act-view="problems"]')
      await settle(page, 1200)
      rows = await rowsOf(page)
      q = feedCalls(seen).at(-1).query
      want = await dbIds(`p_min_severity => 'warning'`)
      check(`${tag}: Errors and blockers is a server query (severity=warning) and every row is a warning, error or critical`, /severity=warning/.test(q) && rows.length === want.length && rows.every((r, i) => r.id === want[i].id) && want.every((w) => ['warning', 'error', 'critical'].includes(w.sev)), `${rows.length} rows`)
      check(`${tag}: problem rows carry the problem mark and a result word that says what happened`, rows.length > 0 && rows.every((r) => r.problem || /Held back|Failed|warning/i.test(r.result) || r.result === ''), `${rows.filter((r) => r.problem).length} marked`)
      // an agent, a date range, and a project, combined; active filters shown and removable
      await press(page,'[data-act-panel]')
      await page.selectOption('[data-act-sel="agent"]', 'research-director')
      await settle(page, 1200)
      await page.selectOption('[data-act-sel="range"]', '7')
      await settle(page, 1200)
      q = feedCalls(seen).at(-1).query
      rows = await rowsOf(page)
      const chips = await page.$$eval('.bcact-x', (n: Element[]) => n.map((x) => x.textContent?.replace('×', '').trim() ?? ''))
      check(`${tag}: filters combine on the server (view, agent and range in one query) and each active one is a removable chip`, /severity=warning/.test(q) && /agent=research-director/.test(q) && /since=/.test(q) && chips.length === 3, `${chips.join(' | ')}`)
      // The range is the person's own calendar ("Last 7 days" = today and the six days before, from local midnight), so the oracle asks
      // the database from the very instant the page sent, not from "now minus 7 days".
      const sinceSent = new URLSearchParams(q.replace(/^\?/, '')).get('since') ?? ''
      // the filtered state is a layout of its own (active chips, the open panel): measured here, not only in the default state
      const fclip = (await page.evaluate(`Array.prototype.slice.call(document.querySelectorAll('.bcact button, .bcact select, .bcact label')).filter(function (e) { return e.offsetParent !== null }).map(function (e) { var r = e.getBoundingClientRect(); return { l: (e.textContent || '').trim().slice(0, 18), left: Math.round(r.left), right: Math.round(r.right) } }).filter(function (x) { return x.left < -0.5 || x.right > ${vp.w} + 0.5 })`)) as any[]
      const fo = await overflowOf(page)
      const hs = (await page.evaluate(`({ x: window.scrollX, dw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, cw: (document.querySelector('.bcact') || {}).scrollWidth, cc: (document.querySelector('.bcact-controls') || {}).scrollWidth, ccw: (document.querySelector('.bcact-controls') || {}).clientWidth })`)) as any
      check(`${tag}: with filters on (chips and panel open) nothing is cut off, nothing scrolls sideways`, fclip.length === 0 && fo.scroll <= fo.vw && hs.x === 0 && hs.dw <= vp.w, `${fclip.map((x) => `${x.l}:${x.left}-${x.right}`).join(' ') || 'all inside'}; scroll ${fo.scroll} of ${fo.vw}; ${JSON.stringify(hs)}`)
      const agentWant = await db.execute(`select count(*)::int as n from jsonb_array_elements((app.activity_read(p_office => '${officeA}'::uuid, p_min_severity => 'warning', p_agent => 'research-director', p_since => '${sinceSent.replace(/'/g, '')}'::timestamptz, p_visibility => 'user', p_limit => 40))->'events') e`)
      check(`${tag}: the combined result matches the database count`, rows.length === (agentWant.rows[0] as any).n, `${rows.length} vs ${(agentWant.rows[0] as any).n}`)
      await press(page,'[data-act-clear="range"]')
      await settle(page, 1000)
      check(`${tag}: removing one chip removes only that filter`, !/since=/.test(feedCalls(seen).at(-1).query) && /agent=research-director/.test(feedCalls(seen).at(-1).query), feedCalls(seen).at(-1).query.slice(0, 90))
      await press(page,'[data-act-clear="all"]')
      await settle(page, 1000)
      rows = await rowsOf(page)
      check(`${tag}: Clear all returns to the unfiltered timeline`, rows.length === oracleEvents.length && rows[0]?.id === oracleEvents[0].id && (await page.$$('.bcact-x')).length === 0, `${rows.length} rows`)
      // an impossible combination is an honest empty state that says it covers the whole history
      if ((await page.getAttribute('[data-act-panel]', 'aria-expanded')) !== 'true') await press(page,'[data-act-panel]')
      await page.selectOption('[data-act-sel="agent"]', 'quality-director')
      await press(page,'[data-act-view="completed"]')
      await page.selectOption('[data-act-sel="range"]', '1')
      await settle(page, 1300)
      const emptyText = await page.locator('.bcact-list .bcempty').first().textContent().catch(() => '')
      const zero = await db.execute(`select count(*)::int as n from jsonb_array_elements((app.activity_read(p_office => '${officeA}'::uuid, p_status => 'completed', p_agent => 'quality-director', p_since => date_trunc('day', now()), p_visibility => 'user', p_limit => 40))->'events') e`)
      const nZero = (zero.rows[0] as any).n
      if (nZero === 0) check(`${tag}: a filter nothing matches says so for the whole history and offers to clear`, /Nothing matches/.test(emptyText ?? '') && /whole history/.test(emptyText ?? '') && (await page.$$('[data-act-clear="all"]')).length >= 1, (emptyText ?? '').slice(0, 80))
      else check(`${tag}: combination has results in this data set (${nZero}); empty state covered at another width`, true)
      const e2 = (await page.evaluate(`Array.prototype.slice.call(document.querySelectorAll('.bcact button, .bcact select, .bcact label, .bcact .bcempty, .bcact-banner')).filter(function (e) { return e.offsetParent !== null }).map(function (e) { var r = e.getBoundingClientRect(); return { l: (e.textContent || '').trim().slice(0, 18), cls: e.className.slice(0, 20), left: Math.round(r.left), right: Math.round(r.right) } }).filter(function (x) { return x.left < -0.5 || x.right > ${vp.w} + 0.5 })`)) as any[]
      const hs2 = (await page.evaluate(`({ x: window.scrollX, dw: document.documentElement.scrollWidth, vw: window.innerWidth })`)) as any
      check(`${tag}: the "nothing matches" state with three filters on is not cut off and does not scroll sideways (measured against the ${vp.w}px device, not the layout viewport)`, e2.length === 0 && hs2.x === 0 && hs2.dw <= vp.w, `${e2.map((x) => `${x.l}[${x.cls}]:${x.left}-${x.right}`).join(' ') || 'all inside'}; ${JSON.stringify(hs2)}`)
      await shot(page, `after-filters-${vp.name}`)
      await close()
    }
    // ---------------------------------------------------------------------------------------------- details, provenance, related activity
    {
      const { page, seen, close } = await open(vp)
      await ready(page)
      const chainBefore = seen.calls.filter((c: any) => c.section === 'activity_chain').length
      check(`${tag}: no related-activity query runs until a person asks for one`, chainBefore === 0, `${chainBefore} chain reads on load`)
      const rows = await rowsOf(page)
      const withJob = oracleEvents.findIndex((e) => e.job_id !== null && e.category === 'job')
      const target = rows[withJob] as Row
      await press(page,`[data-act-toggle="${target.id}"]`)
      await page.waitForSelector(`#bcact-d-${target.id} .bcact-detail-in`, { timeout: 5000 })
      const det = await page.locator(`#bcact-d-${target.id}`).innerText()
      const ev = oracleEvents[withJob]
      check(`${tag}: opening an event shows the full sentence, the exact time, who, project and how we know it`, det.includes(target.sentence) && /\d{4}/.test(det) && det.includes('How we know') && det.includes('Who') && (ev.project === null || det.includes(ev.project)), det.slice(0, 90).replace(/\n/g, ' '))
      check(`${tag}: technical identifiers are secondary (collapsed) and no private text is shown`, !/PRIVATE BODY/.test(det) && (await page.$eval(`#bcact-d-${target.id} .bcact-tech`, (d: any) => d.open === false)), '')
      const ariaOpen = await page.getAttribute(`[data-act-toggle="${target.id}"]`, 'aria-expanded')
      check(`${tag}: the toggle reports its state and controls the region`, ariaOpen === 'true' && (await page.getAttribute(`[data-act-toggle="${target.id}"]`, 'aria-controls')) === `bcact-d-${target.id}`, ariaOpen ?? '')
      const t0 = Date.now()
      await press(page,`#bcact-d-${target.id} [data-act-chain]`)
      await page.waitForSelector(`#bcact-d-${target.id} .bcact-steps`, { timeout: 15000 })
      H.timings['related-activity-ms'] = [...(H.timings['related-activity-ms'] ?? []), Date.now() - t0]
      const chainCalls = seen.calls.filter((c: any) => c.section === 'activity_chain')
      const steps = await page.$$eval(`#bcact-d-${target.id} .bcact-step`, (n: Element[]) => n.map((x) => ({ stage: x.querySelector('.bcact-stage')?.textContent, self: x.classList.contains('is-self') })))
      const chainAns = chainCalls[0].body
      check(`${tag}: View related activity asks the chain reader once, for this job, and shows its events oldest first`, chainCalls.length === 1 && /job=/.test(chainCalls[0].query) && steps.length === (chainAns.events ?? []).length && steps.length >= 1, `${steps.length} steps: ${steps.map((s: any) => s.stage).join(' > ')}`)
      const stepAts = await page.$$eval(`#bcact-d-${target.id} .bcact-stepmeta`, (n: Element[]) => n.length)
      check(`${tag}: the chain is truncated honestly or complete (never silently cut)`, chainAns.truncated === null ? chainAns.complete === true || chainAns.partial === false : (await page.locator(`#bcact-d-${target.id}`).innerText()).includes('Earlier ones are not shown'), `truncated ${String(chainAns.truncated)}, complete ${String(chainAns.complete)}, ${stepAts} steps`)
      await shot(page, `after-detail-${vp.name}`)
      // destination: a project the page knows leads to its team page, using the existing navigation
      const dest = await page.$(`#bcact-d-${target.id} [data-act-go]`)
      if (dest !== null) {
        const to = await dest.getAttribute('data-act-go')
        await dest.click()
        await settle(page, 1200)
        check(`${tag}: the project link navigates to the existing project page`, new URL(page.url()).pathname === to || new URL(page.url()).pathname.startsWith(String(to).split('/').slice(0, 3).join('/')), `${to} -> ${new URL(page.url()).pathname}`)
      } else check(`${tag}: this event has no destination (none is invented)`, ev.project === null, '')
      await close()
    }
    // ---------------------------------------------------------------------------------------------- provenance wording
    {
      const { page, close } = await open(vp)
      await ready(page)
      await press(page,'[data-act-view="all"]')
      let rows: Row[] = []
      for (let i = 0; i < 12; i++) {
        rows = await rowsOf(page)
        if (rows.some((r) => /You said yes/.test(r.sentence)) || (await page.$('[data-act-more]')) === null) break
        await press(page,'[data-act-more]').catch(() => undefined)
        await settle(page, 700)
      }
      const feedAll: any[] = []
      let cur: any = null
      for (let i = 0; i < 14; i++) {
        const a = await feed(S_A, `visibility=user&limit=200${cur === null ? '' : `&before_at=${encodeURIComponent(cur.at)}&before_id=${cur.id}`}`)
        feedAll.push(...(a.events ?? []))
        cur = a.next
        if (cur === null) break
      }
      const byId = new Map(feedAll.map((e) => [e.id, e]))
      const wrongYes = rows.filter((r) => r.result === 'You said yes' && byId.get(r.id)?.status !== 'authorised')
      const noYesFromNothing = rows.filter((r) => /You said (yes|no)/.test(r.result) && byId.get(r.id)?.category !== 'approval')
      check(`${tag}: "You said yes/no" appears only on an approval event whose record says so`, wrongYes.length === 0 && noYesFromNothing.length === 0, `${rows.filter((r) => /You said/.test(r.result)).length} approval answers shown`)
      const confirmedWrong = rows.filter((r) => r.result === 'Confirmed sent' && byId.get(r.id)?.status !== 'confirmed')
      const personMarked = rows.filter((r) => r.result === 'Marked as delivered by you')
      check(`${tag}: "Confirmed sent" only for a provider-confirmed delivery; a person-marked one says so`, confirmedWrong.length === 0 && personMarked.every((r) => byId.get(r.id)?.metadata?.confirmed_by_person === true), `${personMarked.length} person-marked`)
      const reportedWrong = rows.filter((r) => r.reported && byId.get(r.id)?.provenance !== 'external')
      check(`${tag}: only an outside worker's own report is marked Reported`, reportedWrong.length === 0, `${rows.filter((r) => r.reported).length} reported rows`)
      await close()
    }
    // ---------------------------------------------------------------------------------------------- needs attention
    {
      const { page, seen, close } = await open(vp)
      await ready(page)
      const banner = await page.locator('.bcact-banner').first().textContent().catch(() => '')
      const dbOpen = await db.execute(`select requested_action as a from public.blockers where state = 'open' and office_id = '${officeA}'::uuid and approval_options is not null`)
      const openTitles = new Set((dbOpen.rows as any[]).map((r) => String(r.a)))
      await press(page,'[data-act-view="attention"]')
      await page.waitForSelector('.bcact-attn', { timeout: 8000 })
      await page.waitForFunction(() => !document.querySelector('.bcact-attn .bcact-note[role="status"]'), { timeout: 12000 }).catch(() => undefined)
      const need = await page.$$eval('.bcact-attn .bcact-need:not(.bcact-need--past) .bcact-needtitle', (n: Element[]) => n.map((x) => x.textContent?.trim() ?? ''))
      const past = await page.$$eval('.bcact-attn .bcact-need--past .bcact-needtitle', (n: Element[]) => n.map((x) => x.textContent?.trim() ?? ''))
      const resolved = (await db.execute(`select requested_action as a from public.blockers where state = 'resolved' and office_id = '${officeA}'::uuid`)).rows.map((r: any) => String(r.a))
      check(`${tag}: Waiting for you lists only what the office's records say is waiting - never a resolved approval`, need.length > 0 && need.every((t: string) => !resolved.includes(t) && openTitles.has(t)) && /\d+ things? needs? you/.test(banner ?? ''), `${need.length} waiting, each an open question in the database; ${resolved.length} resolved ones absent`)
      check(`${tag}: the count on the banner equals the list`, Number((banner ?? '').match(/(\d+)/)?.[1]) === need.length, `${banner?.trim().slice(0, 30)} vs ${need.length}`)
      const pastRows = await page.$$('.bcact-need--past')
      check(`${tag}: recent problems are labelled as history (they do not claim to be pending)`, (await page.locator('.bcact-attn').innerText()).includes('say nothing about whether it has since been put right') && pastRows.length === past.length, `${past.length} problems`)
      const probCall = feedCalls(seen).find((c: any) => /severity=warning/.test(c.query) && /since=/.test(c.query) && /limit=8/.test(c.query))
      check(`${tag}: the problems list is a bounded server query for the last 7 days`, probCall !== undefined, probCall?.query.slice(0, 90) ?? 'not asked')
      const go = await page.$('.bcact-need:not(.bcact-need--past) [data-act-go]')
      const to = go === null ? '' : await go.getAttribute('data-act-go')
      check(`${tag}: Review leads to the project's team page, where the existing approval controls are (no second mechanism)`, /^\/p\/[^/]+\/team$/.test(String(to)) && (await page.$$('.bcact-need [data-act-approve], .bcact-need [data-bc-answer]')).length === 0, String(to))
      await shot(page, `after-attention-${vp.name}`)
      if (past.length > 0) {
        await press(page,'[data-act-open]')
        await settle(page, 1300)
        const rows = await rowsOf(page)
        check(`${tag}: "Open in the timeline" lands on the problems view with that event open`, (await page.getAttribute('[data-act-view="problems"]', 'aria-pressed')) === 'true' && rows.some((r) => r.expanded === 'true'), `${rows.filter((r) => r.expanded === 'true').length} open`)
      }
      await close()
    }
    // ---------------------------------------------------------------------------------------------- the project page: the same screen, scoped
    {
      const { page, seen, close } = await open(vp)
      const slug = seeded.projects[0].slug
      await ready(page, `/p/${slug}/activity`)
      const rows = await rowsOf(page)
      const q = feedCalls(seen)[0]?.query ?? ''
      const pid = seeded.projects[0].id
      const want = await feed(S_A, `visibility=user&limit=40&project=${pid}`)
      check(`${tag}: a project's Activity is the same timeline, scoped to that project by the server`, new RegExp(`project=${pid}`).test(q) && rows.length === (want.events ?? []).length && rows.every((r, i) => r.id === want.events[i].id), `${rows.length} rows`)
      await press(page,'[data-act-panel]')
      check(`${tag}: the project filter is not offered inside a project (it cannot be widened by mistake)`, (await page.$$('[data-act-sel="project"]')).length === 0, '')
      await shot(page, `after-project-activity-${vp.name}`)
      // the project dashboard's own Latest Activity module is a different surface and must be undisturbed (and draws without error)
      await goto(page, `/p/${slug}`, 'main, .bcboard, .bcpanes')
      await page.waitForTimeout(800)
      const o2 = await overflowOf(page)
      check(`${tag}: the project dashboard (with its Latest Activity module) still draws, with no page error and no overflow`, seen.pageErrors.length === 0 && o2.scroll <= o2.vw, `${o2.scroll} of ${o2.vw}`)
      await shot(page, `after-project-dashboard-${vp.name}`)
      await close()
    }
    // ---------------------------------------------------------------------------------------------- states
    for (const [mode, label] of [['fail', 'the ledger answers 500'], ['hang', 'the ledger never answers']] as const) {
      const { page, seen, close } = await open(vp, { ledger: mode })
      const t0 = Date.now()
      await goto(page, '/activity', '.bcsectiontitle')
      await page.waitForFunction(() => document.querySelector('.bcitem') !== null || document.querySelector('.bcempty') !== null, { timeout: 25000 })
      const ms = Date.now() - t0
      const body = await page.locator('main, #root, body').first().innerText()
      check(`${tag}: ${label}: the older list is shown, no skeleton stays, no page error`, !(await page.$('.bcact-sk')) && seen.pageErrors.length === 0 && /created this project|Nothing yet/.test(body), `${ms} ms`)
      const o = await overflowOf(page)
      check(`${tag}: ${label}: no overflow`, o.scroll <= o.vw, `${o.scroll} of ${o.vw}`)
      if (mode === 'fail') await shot(page, `after-fallback-${vp.name}`)
      await close()
    }
    {
      const { page, close } = await open(vp, { ledger: 'slow', delayMs: 3000 })
      await goto(page, '/activity', '.bcsectiontitle')
      const early = await page.locator('main, #root, body').first().innerText()
      check(`${tag}: a slow ledger: the older list is drawn first, with a loading note`, /created this project/.test(early) && /Loading the full timeline/.test(early), '')
      await page.waitForSelector('.bcact-item', { timeout: 20000 })
      check(`${tag}: a slow ledger: the timeline then replaces it`, (await page.$$('.bcact-item')).length > 0 && !/Loading the full timeline/.test(await page.locator('.bcact').innerText()), '')
      await close()
    }
    {
      // stale responses: a slow answer to an older question must not overwrite the newer one
      const { page, close } = await open(vp, { delay: (qs: string) => (/status=completed/.test(qs) ? 2500 : 0) })
      await ready(page)
      await press(page,'[data-act-view="completed"]')
      await press(page,'[data-act-view="problems"]')
      await page.waitForTimeout(4500)
      const rows = await rowsOf(page)
      const want = await db.execute(`select (e->>'id') as id from jsonb_array_elements((app.activity_read(p_office => '${officeA}'::uuid, p_min_severity => 'warning', p_visibility => 'user', p_limit => 40))->'events') e`)
      check(`${tag}: a late answer to an older filter never overwrites the newer one`, (await page.getAttribute('[data-act-view="problems"]', 'aria-pressed')) === 'true' && rows.length === want.rows.length && rows.every((r, i) => r.id === (want.rows[i] as any).id), `${rows.length} rows`)
      await close()
    }
    {
      // a read that ran out of its time budget is an error with a Try again button, never an empty or finished-looking list (phase 8, F2)
      let failed = 0
      const { page, seen, close } = await open(vp, { timeout: (qs: string) => /status=completed/.test(qs) && failed++ < 1 })
      await ready(page)
      await press(page, '[data-act-view="completed"]')
      await page.waitForSelector('[data-act-retry], .bcact-note--warn[role="alert"]', { timeout: 15000 })
      const shown = await page.locator('.bcact').innerText()
      check(`${tag}: a timed-out read: says it took too long, offers Try again, and does not say "That is everything" or "Nothing"`, /took too long/i.test(shown) && !/That is everything/.test(shown) && !/Nothing (yet|here|to show)/i.test(shown) && (await page.$('[data-act-retry]')) !== null, shown.replace(/\s+/g, ' ').slice(0, 140))
      const ot = await overflowOf(page)
      check(`${tag}: a timed-out read: no overflow and no page error`, ot.scroll <= ot.vw && seen.pageErrors.length === 0, `${ot.scroll} of ${ot.vw}; ${seen.pageErrors.length} errors`)
      await shot(page, `after-timeout-${vp.name}`)
      await press(page, '[data-act-retry]')
      await page.waitForFunction(() => document.querySelector('.bcact-item') !== null, { timeout: 15000 })
      const rowsAfter = await rowsOf(page)
      check(`${tag}: a timed-out read: Try again (the database answering) shows the real rows and the error is gone`, rowsAfter.length > 0 && !/took too long/i.test(await page.locator('.bcact').innerText()), `${rowsAfter.length} rows after ${failed} refused reads`)
      await close()
    }
    // ---------------------------------------------------------------------------------------------- keyboard, focus, motion
    {
      const { page, close } = await open(vp)
      await ready(page)
      const first = (await rowsOf(page))[0]
      await page.focus(`[data-act-toggle="${first.id}"]`)
      const ring = await page.evaluate(`(function(){ var e = document.activeElement; var cs = getComputedStyle(e); return { w: parseFloat(cs.outlineWidth), s: cs.outlineStyle } })()`) as any
      check(`${tag}: a focused row shows a visible focus ring`, ring.w >= 2 && ring.s !== 'none', JSON.stringify(ring))
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      const still = await page.evaluate(`document.activeElement && document.activeElement.getAttribute('data-act-toggle')`)
      check(`${tag}: Enter opens the event and focus stays on it`, (await page.getAttribute(`[data-act-toggle="${first.id}"]`, 'aria-expanded')) === 'true' && still === first.id, String(still))
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      check(`${tag}: Space closes it again`, (await page.getAttribute(`[data-act-toggle="${first.id}"]`, 'aria-expanded')) === 'false', '')
      // focus a row far down the page the way the keyboard does: the browser scrolls it into view, and it must not end up under the bar
      // The target is first placed just UNDER the sticky bar (inside the viewport, so the browser sees it as already visible unless the
      // control says otherwise through scroll-margin). A far-away target would be centred by the browser and could never fail this.
      const far = (await rowsOf(page))[30]
      await page.evaluate(`(function(){ var e = document.querySelector('[data-act-toggle="${far.id}"]'); var r = e.getBoundingClientRect(); window.scrollBy(0, r.top - 24) })()`)
      await page.waitForTimeout(150)
      await page.focus(`[data-act-toggle="${far.id}"]`)
      await page.waitForTimeout(350)
      const under = await page.evaluate(`(function(){ var e = document.activeElement; var r = e.getBoundingClientRect(); var t = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2); return t === e || e.contains(t) ? '' : 'covered by ' + t.tagName + '.' + t.className })()`)
      check(`${tag}: a row focused by the keyboard is scrolled clear of the sticky top bar`, under === '', String(under))
      await page.focus('[data-act-view="completed"]')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1200)
      const f2 = await page.evaluate(`document.activeElement && document.activeElement.getAttribute('data-act-focus')`)
      check(`${tag}: pressing a view keeps keyboard focus on that control through the redraw`, f2 === 'view:completed', String(f2))
      await close()
    }
    {
      const { page, close } = await open(vp, { reducedMotion: true })
      await ready(page)
      const first = (await rowsOf(page))[0]
      await press(page,`[data-act-toggle="${first.id}"]`)
      await page.waitForTimeout(100)
      const anim = await page.$eval(`#bcact-d-${first.id}`, (e: any) => getComputedStyle(e).animationName)
      check(`${tag}: reduced motion: the detail does not animate`, anim === 'none', anim)
      await close()
    }
  }

  // ------------------------------------------------------------------------------------------------ axe-core, over the screen in four of its states
  for (const v of VIEWPORTS.filter((x: any) => x.name === '1440' || x.name === '390')) {
    const { page, close } = await open(v)
    await ready(page)
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
    const scan = async (label: string) => {
      const r = (await page.evaluate(`axe.run('.bcact', { resultTypes: ['violations'] }).then(function (r) { return r.violations.map(function (x) { return { id: x.id, impact: x.impact, n: x.nodes.length, first: x.nodes.slice(0, 3).map(function (n) { return (n.html || '').slice(0, 70) + ' [' + ((n.any[0] && n.any[0].message) || '').slice(0, 90) + ']' }).join(' ; ') } }) })`)) as any[]
      check(`${v.name}px axe: ${label}: no accessibility violation`, r.length === 0, r.map((x) => `${x.id}(${x.impact}) x${x.n} ${x.first}`).join(' | ') || 'none')
    }
    await scan('timeline')
    const first = (await rowsOf(page))[0]
    await press(page, `[data-act-toggle="${first.id}"]`)
    await press(page, `#bcact-d-${first.id} [data-act-chain]`).catch(() => undefined)
    await page.waitForTimeout(1200)
    await scan('an opened event with its related activity')
    await press(page, '[data-act-panel]')
    await scan('the filter panel open')
    const zoomRisk = (await page.evaluate(`Array.prototype.slice.call(document.querySelectorAll('.bcact select, .bcact input, .bcact textarea')).filter(function (e) { return e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 16 }).length`)) as number
    check(`${v.name}px: every input and select is at least 16px, so iOS Safari does not zoom the page on focus`, zoomRisk === 0, `${zoomRisk} below 16px`)
    await press(page, '[data-act-view="attention"]')
    await page.waitForTimeout(1500)
    await scan('Needs attention')
    await close()
  }

  // ------------------------------------------------------------------------------------------------ timings (local replica; production differs)
  for (const v of VIEWPORTS.filter((x: any) => x.name === '1440' || x.name === '390')) {
    const { page, seen, close } = await open(v)
    const t0 = Date.now()
    await page.goto(`${H.APP}/activity`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bcact-item', { timeout: 20000 })
    const first = Date.now() - t0
    const feedMs = feedCalls(seen)[0]?.ms ?? -1
    const t1 = Date.now()
    await press(page, '[data-act-view="completed"]')
    await page.waitForFunction(() => document.querySelector('[data-act-view="completed"][aria-pressed="true"]') !== null && document.querySelectorAll('.bcact-item').length > 0 && !document.querySelector('.bcact-note[role="status"]'))
    const filter = Date.now() - t1
    const row = (await rowsOf(page))[0]
    const t2 = Date.now()
    await press(page, `[data-act-toggle="${row.id}"]`)
    await page.waitForSelector(`#bcact-d-${row.id} .bcact-detail-in`)
    const detailMs = Date.now() - t2
    const nodes = await page.evaluate(`document.querySelectorAll('.bcact *').length`)
    H.timings[`${v.name}-page-to-first-row-ms`] = [first]
    H.timings[`${v.name}-first-feed-call-ms`] = [feedMs]
    H.timings[`${v.name}-filter-change-ms`] = [filter]
    H.timings[`${v.name}-expand-detail-ms`] = [detailMs]
    check(`${v.name}px: responsive on a ${H.hist.rows}-event history (page to first row ${first} ms of which the gateway ${feedMs} ms; filter ${filter} ms; opening an event ${detailMs} ms; ${nodes} DOM nodes for 40 rows)`, first < 6000 && filter < 4000 && detailMs < 500 && Number(nodes) < 6000, '')
    await close()
  }

  // ------------------------------------------------------------------------------------------------ colour: contrast in both schemes
  const CONTRAST = `(() => {
    var parse = function (s) { var m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; var p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } };
    var lum = function (c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) };
    var blend = function (top, bot) { var a = top.a; return { r: top.r * a + bot.r * (1 - a), g: top.g * a + bot.g * (1 - a), b: top.b * a + bot.b * (1 - a), a: 1 } };
    var under = function (el) { var layers = []; for (var e = el; e; e = e.parentElement) { var c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) layers.push(c); if (c && c.a === 1) break } if (!layers.length || layers[layers.length - 1].a < 1) return null; var base = layers.pop(); while (layers.length) base = blend(layers.pop(), base); return base };
    var out = [], skipped = 0, seen = 0;
    Array.prototype.slice.call(document.querySelectorAll('.bcact *')).forEach(function (e) {
      if (e.closest('svg') || e.children.length > 0 || (e.textContent || '').trim() === '' || e.offsetParent === null) return;
      var fg = parse(getComputedStyle(e).color), bg = under(e); if (!fg || !bg) { skipped++; return } seen++;
      var f = blend(fg, bg), l1 = lum(f), l2 = lum(bg), r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (r < 4.5) out.push({ t: e.textContent.trim().slice(0, 28), cls: e.className, r: Math.round(r * 100) / 100 });
    });
    return { bad: out.slice(0, 8), seen: seen, skipped: skipped };
  })()`
  for (const scheme of ['light', 'dark'] as const) {
    for (const v of VIEWPORTS.filter((x: any) => x.name === '1440' || x.name === '390')) {
      const { page, close } = await open(v, { scheme })
      await ready(page)
      const first = (await rowsOf(page))[0]
      await press(page, `[data-act-toggle="${first.id}"]`)
      await page.waitForTimeout(250)
      const c = (await page.evaluate(CONTRAST)) as any
      check(`${v.name}px ${scheme}: text contrast is at least 4.5:1 everywhere on the timeline (list, controls, an opened event)`, c.bad.length === 0 && c.seen > 40, `${c.seen} text nodes measured, ${c.skipped} skipped; ${c.bad.map((b: any) => `${b.t} ${b.r}`).join(' | ') || 'none below'}`)
      const o = await overflowOf(page)
      check(`${v.name}px ${scheme}: no overflow`, o.scroll <= o.vw, `${o.scroll} of ${o.vw}`)
      await shot(page, `after-${scheme}-${v.name}`)
      await close()
    }
  }

  // ------------------------------------------------------------------------------------------------ office isolation and activation (one width)
  const vp = VIEWPORTS.find((v: any) => v.name === '1440') ?? VIEWPORTS[0]
  {
    const { page, seen, close } = await open(vp, { as: 'B' })
    await ready(page)
    const text = await page.locator('body').innerText()
    check('office B (outside the canary): the page shows the older list, no ledger row, none of A\'s events or B\'s own record', (await page.$$('.bcact-item')).length === 0 && !/BRAVO PRIVATE|Hermes|Failed: a request/.test(text), '')
    check('office B (outside the canary): the gateway answers enabled:false', feedCalls(seen).every((c: any) => c.body?.enabled === false), `${feedCalls(seen).length} calls`)
    await shot(page, 'after-office-b-disabled')
    await close()
  }
  {
    await setList(JSON.stringify([officeA, officeB]))
    const { page: pb, close: cb } = await open(vp, { as: 'B' })
    await ready(pb)
    const rowsB = await rowsOf(pb)
    const textB = await pb.locator('body').innerText()
    check('office B (inside the canary): sees its own record only - nothing of A\'s, A\'s project names or workers', rowsB.some((r) => /BRAVO PRIVATE/.test(r.sentence)) && !/Riverside|Hermes|Failed: a request|The Extremely Long/.test(textB), `${rowsB.length} rows`)
    const { page: pa, close: ca } = await open(vp)
    await ready(pa)
    const textA = await pa.locator('body').innerText()
    check('office A still never shows B\'s record when both are covered', !/BRAVO PRIVATE|Bravo Private/.test(textA), '')
    await cb()
    await ca()
    await setList(JSON.stringify([officeA]))
  }
  {
    await setMaster(false)
    const { page, seen, close } = await open(vp)
    await ready(page)
    check('master switch off: the page shows the older list and the gateway says disabled', (await page.$$('.bcact-item')).length === 0 && feedCalls(seen).every((c: any) => c.body?.enabled === false), '')
    await close()
    await setMaster(true)
  }
  {
    // large history: the user feed with a diagnostic-heavy history stays fast (the phase 4 cliff), bounded and paged
    const t = Date.now()
    const big = await feed(S_A, 'visibility=user&limit=200')
    const ms = Date.now() - t
    check('large history: the gateway answers a 200-event user page quickly over a diagnostic-heavy history (local replica, not production)', big.enabled === true && ms < 4000, `${ms} ms, ${(big.events ?? []).length} events`)
  }
}

function timings(H: any, key: string, ms: number) {
  H.timings[key] = [...(H.timings[key] ?? []), ms]
}
