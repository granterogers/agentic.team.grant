/**
 * #405 acceptance: the REAL Sign out control, four stages in ONE browser context (so residue could carry over).
 *   npx tsx scripts/p5/signout.ts                         # the local web/studio files
 *   PAGE=https://ai-team-hq.vercel.app npx tsx scripts/p5/signout.ts
 *   A  Grant in -> Sign out pressed -> nothing of Grant's left, signed-out page
 *   B  the second person in (same browser) -> Grant's data absent
 *   C  the second person out -> clean
 *   D  Grant in again -> the second person's data absent
 *   P  a phone-sized, touch context: the control is reachable, 44px, and works
 *   S  the stale-request fence: a Grant response that lands after sign-out is not drawn (with its control)
 * Every scan has a PLANTED CANARY control (it must see a canary before sign-out) and the device preferences must survive.
 * Nothing here sends a message or starts a job: it reads and signs in/out only.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { type BrowserContext, chromium, type Page } from 'playwright'
import {
  check,
  db,
  ENDPOINT,
  grantSession,
  results,
  SECOND_OFFICE,
  secondSession,
} from '../p4/lib.ts'

const ROOT = 'web/studio'
const PORT = 4793
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()))
const BASE = process.env.PAGE ?? `http://127.0.0.1:${PORT}`
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

const DEVICE_PREFS = ['studio.appearance', 'studio.rail', 'bc.compose']
const grantNames = (
  await rows(
    `select distinct name v from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and length(name) > 5`,
  )
).map((r) => String(r.v))
const secondNames = (
  await rows(
    `select distinct name v from public.projects where office_id = '${SECOND_OFFICE}' and not is_fixture and length(name) > 5`,
  )
).map((r) => String(r.v))

const errors: string[] = []
const staticShown = new Set<string>()
const second = await secondSession()
const grant = await grantSession()
const browser = await chromium.launch()
const open = async (phone = false): Promise<{ ctx: BrowserContext; page: Page }> => {
  const ctx = await browser.newContext(
    phone
      ? {
          viewport: { width: 390, height: 844 },
          hasTouch: true,
          isMobile: true,
          deviceScaleFactor: 2,
        }
      : { viewport: { width: 1440, height: 900 } },
  )
  await ctx.addInitScript(`window.HQ_API = ${JSON.stringify(ENDPOINT)}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  return { ctx, page }
}
const signInAs = async (page: Page, s: { access_token: string; refresh_token: string }) => {
  await page.goto('about:blank')
  const frag = `access_token=${encodeURIComponent(s.access_token)}&refresh_token=${encodeURIComponent(s.refresh_token)}&expires_in=3000`
  await page.goto(`${BASE}/#${frag}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForFunction("(localStorage.getItem('hq.session') || '') !== ''", undefined, {
    timeout: 30000,
  })
  await page.waitForSelector('[data-bc-signout]', { timeout: 90000 })
}

type Snap = {
  body: string
  local: string[]
  session: string[]
  dbs: string[]
  caches: string[]
  text: string
}
/** Everything the browser holds: DOM text, every storage key and value, IndexedDB names and contents, Cache storage. */
const snap = async (page: Page): Promise<Snap> =>
  (await page.evaluate(`(async () => {
    const dump = (s) => { try { return Object.keys(s).map((k) => k + '=' + s.getItem(k)) } catch { return [] } }
    let dbs = [], text = ''
    try {
      for (const d of await indexedDB.databases()) {
        dbs.push(d.name)
        const h = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
        for (const store of Array.from(h.objectStoreNames)) {
          const all = await new Promise((ok) => { const g = h.transaction(store, 'readonly').objectStore(store).getAll(); g.onsuccess = () => ok(g.result); g.onerror = () => ok([]) })
          text += ' ' + d.name + ':' + store + ':' + JSON.stringify(all, (k, v) => (v instanceof Blob ? '<blob>' : v))
        }
        h.close()
      }
    } catch {}
    let caches_ = []
    try { for (const cn of await caches.keys()) { caches_.push(cn); const c = await caches.open(cn); text += ' cache ' + cn + ' ' + (await c.keys()).map((r) => r.url).join(' ') } } catch {}
    return { body: (document.body.innerText || '').replace(/\\s+/g, ' '), local: dump(localStorage), session: dump(sessionStorage), dbs, caches: caches_, text }
  })()`)) as Snap
const everything = (n: Snap): string =>
  [n.body, ...n.local, ...n.session, n.dbs.join(' '), n.text].join('\n')

/** Plant canaries in every class of store, as a person's own work would be. */
const plant = async (page: Page, tag: string) => {
  await page.evaluate(`(async () => {
    localStorage.setItem('canary.${tag}.local', 'CANARY-${tag}-LOCAL')
    localStorage.setItem('studio.chat', JSON.stringify({ canary: [{ text: 'CANARY-${tag}-CHAT' }] }))
    sessionStorage.setItem('canary.${tag}.session', 'CANARY-${tag}-SESSION')
    await new Promise((ok) => { const r = indexedDB.open('canary-${tag}-db', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { const t = r.result.transaction('s', 'readwrite'); t.objectStore('s').put('CANARY-${tag}-IDB', 'k'); t.oncomplete = () => { r.result.close(); ok(1) } }; r.onerror = () => ok(0) })
    await new Promise((ok) => { const r = indexedDB.open('bc.notes', 1); r.onupgradeneeded = () => r.result.createObjectStore('notes'); r.onsuccess = () => { const t = r.result.transaction('notes', 'readwrite'); t.objectStore('notes').put('CANARY-${tag}-NOTE', 'm1'); t.oncomplete = () => { r.result.close(); ok(1) } }; r.onerror = () => ok(0) })
    const c = await caches.open('canary-${tag}-cache'); await c.put('/canary-${tag}', new Response('CANARY-${tag}-CACHE'))
  })()`)
}
const prefs = async (page: Page) => {
  await page.evaluate(
    `(() => { localStorage.setItem('studio.appearance', '{"scheme":"dark"}'); localStorage.setItem('studio.rail', 'open'); localStorage.setItem('bc.compose', 'c') })()`,
  )
}

const signedOutClean = async (page: Page, label: string, mustNotHave: string[], tag: string) => {
  await page.waitForFunction("(localStorage.getItem('hq.session') || '') === ''", undefined, {
    timeout: 30000,
  })
  await page.waitForTimeout(2500)
  const n = await snap(page)
  const all = everything(n)
  check(
    `${label}: hq.session and hq.token are gone`,
    !all.includes('hq.session=') && !all.includes('hq.token='),
  )
  check(
    `${label}: no canary survives in any store (${tag})`,
    !all.includes(`CANARY-${tag}`),
    [...n.local, ...n.session].map((l) => l.split('=')[0]).join(','),
  )
  // The page re-creates an EMPTY bc.notes when it boots (so the name alone is not residue); what matters is that it holds nothing.
  check(
    `${label}: no IndexedDB database holds anything (names: ${n.dbs.join(',') || 'none'})`,
    n.dbs.every((d) => !/canary/.test(d ?? '')) && !/bc\.notes:notes:\[[^\]]/.test(n.text),
  )
  check(`${label}: Cache storage is empty (${n.caches.join(',') || 'none'})`, n.caches.length === 0)
  const hits = mustNotHave.filter((x) => all.includes(x))
  check(
    `${label}: none of the previous person's names/data anywhere in the browser`,
    hits.length === 0,
    hits.join('|'),
  )
  const kept = DEVICE_PREFS.filter((k) => n.local.some((l) => l.startsWith(`${k}=`)))
  check(
    `${label}: device preferences survive (${kept.join(',')})`,
    kept.length === DEVICE_PREFS.length,
  )
  check(
    `${label}: the signed-out page is shown and offers no Sign out`,
    (await page.locator('[data-bc-signout]').count()) === 0,
  )
}

const press = async (page: Page) => {
  const b = page.locator('[data-bc-signout]').first()
  await b.waitFor({ state: 'visible', timeout: 30000 })
  await b.click({ force: true })
}

// the names an UNSIGNED page shows from its own invented prototype are not Grant's data; measure them, then subtract
{
  const { ctx, page } = await open()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(4000)
  const t = (await page.evaluate("document.body.innerText || ''")) as string
  for (const n of grantNames) if (t.includes(n)) staticShown.add(n)
  await ctx.close()
}
const realGrant = grantNames.filter((n) => !staticShown.has(n))
check(
  `setup: Grant has real project names the signed-out page does not show (${realGrant.length})`,
  realGrant.length > 0,
  realGrant.join('|'),
)
const grantShown = async (p: Page): Promise<string> => {
  await p
    .waitForFunction(
      `${JSON.stringify(realGrant)}.some((n) => (document.body.innerText || '').includes(n))`,
      undefined,
      { timeout: 60000 },
    )
    .catch(() => null)
  return everything(await snap(p))
}

// ============ the scan CAN FAIL: a control that must see the canaries it plants
{
  const { ctx, page } = await open()
  await signInAs(page, grant)
  await plant(page, 'PROBE')
  const all = await grantShown(page)
  const n = await snap(page)
  check(
    'CONTROL: the scan sees a canary in localStorage, sessionStorage, IndexedDB, bc.notes and Cache storage',
    ['LOCAL', 'SESSION', 'IDB', 'NOTE', 'CACHE'].every(
      (k) => all.includes(`CANARY-PROBE-${k}`) || (k === 'CACHE' && n.caches.length > 0),
    ),
    `${n.local.length} local, ${n.dbs.join(',')}, ${n.caches.join(',')}`,
  )
  check(
    "CONTROL: the scan sees Grant's own project names while Grant is signed in",
    realGrant.some((x) => all.includes(x)),
    '',
  )
  await ctx.close()
}

// ============ A, B, C, D in ONE context
const { ctx, page } = await open()

await signInAs(page, grant)
const grantIn = await grantShown(page)
await plant(page, 'A')
await prefs(page)
check(
  'A: Grant is signed in and his names are on the page (so their absence later means something)',
  realGrant.some((x) => grantIn.includes(x)),
)
await press(page)
await signedOutClean(page, 'A', [...realGrant, 'CANARY-A'], 'A')

await signInAs(page, second)
await page.waitForTimeout(4000)
const bIn = everything(await snap(page))
check(
  "B: the second person signs in, same browser; Grant's names are absent",
  realGrant.every((x) => !bIn.includes(x)),
  realGrant.filter((x) => bIn.includes(x)).join('|'),
)
check("B: no Grant canary in the second person's browser", !bIn.includes('CANARY-A'))
await plant(page, 'B')
await prefs(page)
await press(page)
await signedOutClean(
  page,
  'C',
  [...secondNames.filter((x) => !grantNames.includes(x)), 'CANARY-B'],
  'B',
)

await signInAs(page, grant)
const dIn = await grantShown(page)
check(
  "D: Grant signs in again; the second person's names and canary are absent",
  secondNames.filter((x) => !grantNames.includes(x)).every((x) => !dIn.includes(x)) &&
    !dIn.includes('CANARY-B'),
)
check(
  "D: Grant's own data is back (signing in again works)",
  realGrant.some((x) => dIn.includes(x)),
)
await press(page)
await signedOutClean(page, 'D-out', realGrant, 'D')
await ctx.close()

// ============ P: the phone
{
  const { ctx: pctx, page: phone } = await open(true)
  await signInAs(phone, second)
  const box = await phone.locator('[data-bc-signout]').first().boundingBox()
  check(
    `P: Sign out is on screen on a phone and at least 44px tall (${Math.round(box?.height ?? 0)}px)`,
    box !== null && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390,
  )
  await plant(phone, 'P')
  await prefs(phone)
  await press(phone)
  await signedOutClean(phone, 'P', ['CANARY-P'], 'P')
  await pctx.close()
}

// ============ S: the stale-request fence
{
  const run = async (signOutFirst: boolean): Promise<boolean> => {
    const { ctx: sctx, page: sp } = await open()
    let release: () => void = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    let armed = false
    await sp.route('**/hq-api?section=studio*', async (route) => {
      if (!armed) return route.continue()
      await held
      return route.continue()
    })
    // An unsigned page: its in-memory list holds only the invented prototype, so any real name in it came from the late response.
    await sp.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await sp.waitForTimeout(3000)
    armed = true
    const pending = sp
      .evaluate(`(async () => {
        const m = await import('./data.js')
        return String(await m.hydrate(window.HQ_API, ${JSON.stringify(grant.access_token)}).catch((e) => 'err:' + e.message))
      })()`)
      .catch(() => 'closed')
    await sp.waitForTimeout(1200)
    if (signOutFirst) {
      await sp.evaluate(
        `(async () => { const m = await import('./signout.js'); await m.signOut({ reload: false }) })()`,
      )
    }
    release()
    await pending
    await sp.waitForTimeout(2500)
    const inMemory = (await sp.evaluate(
      `(async () => { const m = await import('./data.js'); return JSON.stringify(m.PROJECTS.map((p) => p.name)) })()`,
    )) as string
    const text = `${inMemory}\n${everything(await snap(sp))}`
    await sctx.close()
    return grantNames.some((x) => text.includes(x))
  }
  const withoutFence = await run(false)
  const withSignOut = await run(true)
  check('S: CONTROL - with no sign-out a late Grant response IS drawn', withoutFence === true)
  check(
    'S: a Grant response that lands after sign-out is NOT drawn or stored',
    withSignOut === false,
  )
}

check('zero page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exitCode = failed.length === 0 ? 0 : 1
