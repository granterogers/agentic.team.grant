/**
 * P4 step 6: Team HQ in a real browser, as two real people.
 *   npx tsx scripts/p4/browser.ts
 * The page is served from web/studio (the files deploy:hq publishes) and talks to the REAL deployed gateway. A person is
 * signed in by the same hand-off the magic link ends with: the session arrives in the URL fragment and the page's own
 * adopt() takes it. (The mail hop is not exercised; nothing may claim it is.)
 *
 *   1. a clean browser holds nothing and offers a way in
 *   2. the second person alone: their own project, none of Grant's names, ids, storage
 *   3. Grant alone, in another context: his projects, none of the second person's objects
 *   4. both at once in isolated contexts, reloaded in parallel
 *   5. SESSION SWITCHING on one browser, both directions, with and without a sign-out: DOM, localStorage, sessionStorage,
 *      IndexedDB, Cache storage and service workers all scanned for the OTHER person's strings
 * Every scan has a positive control (the scan must find the person's OWN strings where it should).
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { type BrowserContext, chromium, type Page } from 'playwright'
import { check, db, ENDPOINT, grantSession, results, type Session, secondSession } from './lib.ts'

const ROOT = 'web/studio'
const PORT = 4781
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
const BASE = `http://127.0.0.1:${PORT}`

const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const second = await secondSession()
const grant = await grantSession()
const subOf = (s: Session): string =>
  String(
    (
      JSON.parse(Buffer.from(s.access_token.split('.')[1] ?? '', 'base64url').toString()) as {
        sub?: string
      }
    ).sub,
  )
const grantNames = (
  await rows(
    `select distinct name v from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and length(name) > 5 order by 1`,
  )
).map((r) => String(r.v))
const grantIds = (
  await rows(
    `select project_id::text v from public.projects where office_id = app.operator_office() and not is_fixture`,
  )
).map((r) => String(r.v))
const grantEmail = String(
  (await rows(`select email v from public.office_members where owner_key='grant' limit 1`))[0]?.v,
)
const secondStrings = ['Personal', 'Kevin', 'P4 canary note', 'p4-personal', 'p4-second-person']
console.log(
  `${grantNames.length} of Grant's project names, ${grantIds.length} ids used as canaries`,
)
check('the browser scans have canaries to look for', grantNames.length >= 3)

const errors: string[] = []
const browser = await chromium.launch()
const open = async (): Promise<{ ctx: BrowserContext; page: Page }> => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(`window.HQ_API = ${JSON.stringify(ENDPOINT)}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  return { ctx, page }
}
const settle = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      "document.querySelector('.bcnotlive') === null && (document.body.innerText || '').length > 200",
      undefined,
      { timeout: 45000 },
    )
    .catch(() => null)
  await page.waitForTimeout(2500)
}
const adopt = async (page: Page, s: Session, path = '/'): Promise<void> => {
  // A magic link opens as a NAVIGATION, never as a fragment change on a page already open: going from `/` to `/#...` is a
  // same-document jump that never runs adopt(). Leave the document first, as a click on a link in a mail does.
  await page.goto('about:blank')
  const frag = `access_token=${encodeURIComponent(s.access_token)}&refresh_token=${encodeURIComponent(s.refresh_token)}&expires_in=3000`
  await page.goto(`${BASE}${path}#${frag}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await settle(page)
}

type Snap = {
  body: string
  stored: string
  session: string
  idb: string[]
  caches: string[]
  workers: number
  url: string
}
const snap = async (page: Page): Promise<Snap> =>
  (await page.evaluate(`(async () => {
    const dump = (s) => { try { return Object.keys(s).map((k) => k + '=' + s.getItem(k)).join('\\n') } catch { return '' } }
    let idb = []; try { idb = (await indexedDB.databases()).map((d) => d.name) } catch {}
    let caches_ = []; try { caches_ = await caches.keys() } catch {}
    let workers = 0; try { workers = (await navigator.serviceWorker.getRegistrations()).length } catch {}
    const idbText = []
    // CONTENTS, not just names: a database called bc.notes proves nothing about what is in it.
    for (const name of idb) {
      idbText.push(name)
      try {
        const handle = await new Promise((ok, no) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
        for (const store of Array.from(handle.objectStoreNames)) {
          const all = await new Promise((ok) => { const g = handle.transaction(store, 'readonly').objectStore(store).getAll(); const k = handle.transaction(store, 'readonly').objectStore(store).getAllKeys(); g.onsuccess = () => { k.onsuccess = () => ok({ values: g.result, keys: k.result }); k.onerror = () => ok({ values: g.result, keys: [] }) }; g.onerror = () => ok({ values: [], keys: [] }) })
          idbText.push(store + ':' + JSON.stringify(all, (kk, v) => (v instanceof Blob ? '<blob ' + v.size + '>' : v)))
        }
        handle.close()
      } catch {}
    }
    // Cache storage CONTENTS too (request urls), and the cache names.
    try { for (const cn of await caches.keys()) { const c = await caches.open(cn); idbText.push('cache ' + cn + ': ' + (await c.keys()).map((r) => { try { return decodeURIComponent(r.url) } catch { return r.url } }).join(' ')) } } catch {}
    return { body: (document.body.innerText || '').replace(/\\s+/g, ' '), stored: dump(localStorage) + '\\n' + dump(sessionStorage), session: localStorage.getItem('hq.session') || '', idb: idbText, caches: caches_, workers, url: location.href }
  })()`)) as Snap
const textOf = (n: Snap): string =>
  `${n.body}\n${n.stored}\n${n.idb.join(' ')}\n${n.caches.join(' ')}`
const sessionSub = (n: Snap): string => {
  try {
    const s = JSON.parse(n.session) as { access_token: string }
    return String(
      (
        JSON.parse(Buffer.from(s.access_token.split('.')[1] ?? '', 'base64url').toString()) as {
          sub?: string
        }
      ).sub,
    )
  } catch {
    return ''
  }
}
// STATIC strings: what the page's own code shows to ANYBODY, signed in or not (the invented-projects prototype in
// data.js names look-alike projects). They are code, shipped to every visitor, so they are subtracted by measuring a
// signed-out browser - never by a list written here.
const staticShown = new Set<string>()
const grantHits = (n: Snap): string[] => [
  ...grantNames.filter((x) => textOf(n).includes(x) && !staticShown.has(x)),
  ...grantIds.filter((x) => textOf(n).includes(x)),
  ...(textOf(n).toLowerCase().includes(grantEmail.toLowerCase()) ? ['<grant email>'] : []),
]
const secondHits = (n: Snap): string[] =>
  secondStrings.filter((x) => textOf(n).includes(x) && !staticShown.has(x))

// ---- 1. a clean browser
{
  const { ctx, page } = await open()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(3000)
  const n = await snap(page)
  check('1. a clean browser holds no session', n.session === '')
  for (const x of [...grantNames, ...secondStrings]) if (textOf(n).includes(x)) staticShown.add(x)
  const sampleSource = (
    await Promise.all(['data.js', 'app.js'].map((f) => readFile(join(ROOT, f), 'utf8')))
  ).join('\n')
  const notInCode = [...staticShown].filter((x) => !sampleSource.includes(x))
  console.log(
    `   a signed-out browser shows ${staticShown.size} of these strings from the page's own prototype code: ${JSON.stringify([...staticShown])}`,
  )
  check(
    "1. every string a signed-out browser shows is in the page's own code, not fetched from the office",
    notInCode.length === 0,
    JSON.stringify(notInCode),
  )
  await ctx.close()
}

// ---- 2. the second person alone
const A = await open()
await adopt(A.page, second)
let a = await snap(A.page)
check('2. the second person is signed in as themselves', sessionSub(a) === subOf(second))
check(
  '2. the page shows their own project (positive control)',
  a.body.includes('Personal'),
  a.body.slice(0, 100),
)
check(
  "2. and nothing of Grant's - DOM, localStorage, sessionStorage, IndexedDB, caches",
  grantHits(a).length === 0,
  JSON.stringify(grantHits(a)),
)
check('2. the session left the address bar', !a.url.includes('access_token'))
await A.page.screenshot({ path: '.out/p4-second-home.png' }).catch(() => null)
for (const route of [
  '/tasks',
  '/activity',
  '/search',
  '/p/personal/overview',
  '/p/personal/tasks',
]) {
  await A.page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await settle(A.page)
  const r = await snap(A.page)
  check(
    `2. ${route} is theirs and clean`,
    grantHits(r).length === 0 && sessionSub(r) === subOf(second),
    `${r.body.length} chars`,
  )
}
console.log(
  `   second person storage keys: ${a.stored
    .split('\n')
    .map((l) => l.split('=')[0])
    .filter(Boolean)
    .join(
      ', ',
    )}; idb=${JSON.stringify(a.idb)} caches=${JSON.stringify(a.caches)} workers=${a.workers}`,
)

// ---- 3. Grant alone, another context
const B = await open()
await adopt(B.page, grant)
let b = await snap(B.page)
check('3. Grant is signed in as himself', sessionSub(b) === subOf(grant))
check(
  '3. the page shows his projects (positive control)',
  grantNames.filter((x) => b.body.includes(x)).length >= 2,
  `${grantNames.filter((x) => b.body.includes(x)).length} of his names`,
)
check(
  "3. and none of the second person's objects",
  secondHits(b).length === 0,
  JSON.stringify(secondHits(b)),
)
await B.page.screenshot({ path: '.out/p4-grant-home.png' }).catch(() => null)
for (const route of ['/tasks', '/activity', '/search']) {
  await B.page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await settle(B.page)
  const r = await snap(B.page)
  check(
    `3. Grant's ${route} shows none of the second person's objects`,
    secondHits(r).length === 0,
    JSON.stringify(secondHits(r)),
  )
}

// ---- 4. both at once
let mixed = 0
for (let i = 0; i < 3; i++) {
  await Promise.all([
    A.page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }),
    B.page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }),
  ])
  await Promise.all([settle(A.page), settle(B.page)])
  a = await snap(A.page)
  b = await snap(B.page)
  if (
    grantHits(a).length > 0 ||
    secondHits(b).length > 0 ||
    sessionSub(a) !== subOf(second) ||
    sessionSub(b) !== subOf(grant)
  )
    mixed++
}
check(
  '4. three parallel reloads in two isolated contexts never mixed the two',
  mixed === 0,
  `${mixed} mixed`,
)
await A.ctx.close()
await B.ctx.close()

// ---- 5. one browser, two people, both directions
for (const variant of ['without a sign-out', 'with the storage cleared']) {
  for (const [firstWho, nextWho, label] of [
    [grant, second, 'Grant then the second person'],
    [second, grant, 'the second person then Grant'],
  ] as [Session, Session, string][]) {
    const { ctx, page } = await open()
    await adopt(page, firstWho)
    await page
      .waitForFunction(
        `(${JSON.stringify(firstWho === grant ? grantNames.filter((x) => !staticShown.has(x)) : ['Personal'])}).some((s) => (document.body.innerText || '').includes(s))`,
        undefined,
        { timeout: 50000 },
      )
      .catch(() => null)
    const first = await snap(page)
    const firstIsGrant = firstWho === grant
    // positive control: the first person's own strings are on the page / in storage
    check(
      `5. (${variant}) ${label}: the first session shows its own data`,
      firstIsGrant ? grantHits(first).length > 0 : secondHits(first).length > 0,
    )
    if (variant === 'with the storage cleared') {
      await page.evaluate('(() => { localStorage.clear(); sessionStorage.clear() })()')
    }
    await adopt(page, nextWho)
    // wait for the new person's own data to arrive rather than for a fixed pause: a data fetch that is slow is not a leak
    await page
      .waitForFunction(
        `(${JSON.stringify(nextWho === grant ? grantNames.filter((x) => !staticShown.has(x)) : ['Personal'])}).some((s) => (document.body.innerText || '').includes(s))`,
        undefined,
        { timeout: 50000 },
      )
      .catch(() => null)
    let after = await snap(page)
    const ownShown = (n: Snap): boolean =>
      nextWho === grant ? grantHits(n).length > 0 : n.body.includes('Personal')
    if (!ownShown(after)) {
      // one reload, and SAY so: a page that needs a reload to show the new person's data is slow, not leaking
      console.log(`   (${variant}, ${label}: own data not shown after 50s; reloading once)`)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await settle(page)
      after = await snap(page)
    }
    const nextIsGrant = nextWho === grant
    check(
      `5. (${variant}) ${label}: the browser now holds the new person's session only`,
      sessionSub(after) === subOf(nextWho),
    )
    const stale = nextIsGrant ? secondHits(after) : grantHits(after)
    check(
      `5. (${variant}) ${label}: nothing of the previous person survives in DOM or any storage`,
      stale.length === 0,
      JSON.stringify(stale),
    )
    check(
      `5. (${variant}) ${label}: the new person's own data is shown (positive control)`,
      nextIsGrant ? grantHits(after).length > 0 : secondHits(after).length > 0,
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)
    const reload = await snap(page)
    check(
      `5. (${variant}) ${label}: still clean after a reload`,
      (nextIsGrant ? secondHits(reload) : grantHits(reload)).length === 0 &&
        sessionSub(reload) === subOf(nextWho),
    )
    await ctx.close()
  }
}

// ---- a refused session must not leave the page showing the last person's data
{
  const { ctx, page } = await open()
  await adopt(page, second)
  await page.evaluate(
    `(() => { const s = JSON.parse(localStorage.getItem('hq.session')); s.access_token = s.access_token.slice(0, -6) + 'AAAAAA'; localStorage.setItem('hq.session', JSON.stringify(s)) })()`,
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const n = await snap(page)
  // A damaged ACCESS token beside a valid REFRESH token is legitimately recovered by the page (it refreshes, as it should);
  // what must never happen is that the page keeps showing data under a session that is not the second person's.
  const recovered = n.session !== '' && sessionSub(n) === subOf(second)
  check(
    'a corrupted access token is either refused (signed out) or refreshed as the SAME person, and never shows anyone else',
    (n.session === '' || recovered) && grantHits(n).length === 0,
    `session held: ${n.session !== ''}, same person: ${recovered}`,
  )
  // and a session whose refresh token is ALSO gone is refused outright
  await page.evaluate(
    `(() => { const raw = localStorage.getItem('hq.session'); if (!raw) return; const s = JSON.parse(raw); s.access_token = s.access_token.slice(0, -6) + 'BBBBBB'; s.refresh_token = 'not-a-refresh-token'; s.expires_at = 0; localStorage.setItem('hq.session', JSON.stringify(s)) })()`,
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page
    .waitForFunction("(localStorage.getItem('hq.session') || '') === ''", undefined, {
      timeout: 20000,
    })
    .catch(() => null)
  const dead = await snap(page)
  check(
    'a session with no usable token at all is cleared and the page shows no data',
    dead.session === '' && grantHits(dead).length === 0 && secondHits(dead).length === 0,
    `session held: ${dead.session !== ''}`,
  )
  await ctx.close()
}

// ---- 6. Team Chat and Claire: moved to scripts/p4/chat-reload.ts (persisted answer by identity, full reload, controls).
// The version that stood here read the answer partly from page text and could not prove persisted rendering.

// ---- DETECTOR CONTROLS (sabotage): stale client state surviving an account switch must make this scan go RED.
// Each kind of storage gets a planted Grant string while Grant is signed in; after the switch to the second person the
// scan has to find it. A detector that stays green here cannot be trusted over the product.
{
  const canary = grantNames.find((x) => !staticShown.has(x)) ?? ''
  const plants: [string, string][] = [
    [
      'localStorage',
      `localStorage.setItem('bc.stale.projects', JSON.stringify(['${canary.replace(/'/g, "\\'")}']))`,
    ],
    [
      'sessionStorage',
      `sessionStorage.setItem('bc.stale.projects', '${canary.replace(/'/g, "\\'")}')`,
    ],
    [
      'IndexedDB',
      `await new Promise((ok) => { const r = indexedDB.open('stale.db', 1); r.onupgradeneeded = () => { r.result.createObjectStore('s') }; r.onsuccess = () => { const t = r.result.transaction('s', 'readwrite'); t.objectStore('s').put({ project: '${canary.replace(/'/g, "\\'")}' }, 'k'); t.oncomplete = () => { r.result.close(); ok(1) } } })`,
    ],
    [
      'Cache storage',
      `await (async () => { const c = await caches.open('stale-cache'); await c.put('/stale/' + encodeURIComponent('${canary.replace(/'/g, "\\'")}'), new Response('x')) })()`,
    ],
  ]
  for (const [kind, code] of plants) {
    const { ctx, page } = await open()
    await adopt(page, grant)
    await page.evaluate(`(async () => { ${code} })()`)
    await adopt(page, second)
    const n = await snap(page)
    check(
      `CONTROL: stale ${kind} state planted before an account switch is FLAGGED by the scan`,
      canary !== '' && grantHits(n).length > 0,
      `looked for ${canary.slice(0, 20)}`,
    )
    await ctx.close()
  }
}

console.log(
  `page errors: ${errors.length}${errors.length > 0 ? ` ${JSON.stringify([...new Set(errors)].slice(0, 5))}` : ''}`,
)
await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
