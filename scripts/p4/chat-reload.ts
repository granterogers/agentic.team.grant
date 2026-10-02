/**
 * P4 closure: the persisted answer, rendered after a FRESH load, found by identity - not by page text or timing.
 *   npx tsx scripts/p4/chat-reload.ts            # one loop
 * The loop:
 *   1. the second person, signed in, in a clean browser context, types a message in the real Team HQ composer and presses Send
 *   2. the durable identifier is read from the canonical row (inbound_commands.job_id for that exact instruction)
 *   3. completion is decided ONLY by backend state: every job in the request's tree is terminal and the root is `complete`
 *      (an explicit deadline; a timeout is reported as a timeout and fails the run)
 *   4. the answer is the persisted `public.outputs` row - the same table `app.conversation_history` reads to draw an
 *      "answered" bubble - of the last job in the tree to complete with an output; never an event, log, DOM or progress text
 *   5. asserted: it belongs to the second office, to a job in THIS request's tree, is non-empty, is not a progress message
 *      (the job is complete and the body is not the "handed this on" hand-off sentence), and the product's own reader
 *      (the gateway's conversation section) returns it under that output id to the second person and to nobody else
 *   6. the page is fully reloaded, and ALSO opened in a brand-new context with empty storage (so an optimistic local copy
 *      cannot satisfy the check)
 *   7. the bubble is found by its output id (data-message-id), and its text must EQUAL the canonical answer after a
 *      presentation-only normalisation (markdown markers, list numerals, whitespace) - never a substring
 *   8. NEGATIVE CONTROLS, in this process and never committed: an impossible expected value, and the expected value of
 *      ANOTHER earlier answer, must each make the same assertion go red; then the real value must go green
 *   9. Grant's data absent (ids, names, address) from DOM, localStorage, sessionStorage, IndexedDB contents, Cache storage;
 *      zero page errors
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
  read,
  results,
  SECOND_OFFICE,
  secondSession,
} from './lib.ts'

const ROOT = 'web/studio'
const PORT = 4791
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
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))
const TERMINAL = ['complete', 'failed', 'cancelled']
const COMPLETION_DEADLINE_MS = 8 * 60_000

const second = await secondSession()
const grant = await grantSession()
const personal = String(
  (
    await rows(
      `select project_id::text v from public.projects where office_id = '${SECOND_OFFICE}' and slug = 'personal'`,
    )
  )[0]?.v,
)

/** Presentation-only: what markdown rendering changes. Nothing semantic is removed. */
const norm = (s: string): string =>
  s
    .replace(/\r/g, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/gm, '')
    .replace(/[‐-―‑]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

// ---- Grant's strings, for the absence scan
const grantNames = (
  await rows(
    `select distinct name v from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and length(name) > 5`,
  )
).map((r) => String(r.v))
const grantIds = (
  await rows(
    `select project_id::text v from public.projects where office_id = app.operator_office() and not is_fixture union select document_id::text from public.documents where office_id = app.operator_office() union select job_id::text from public.jobs where office_id = app.operator_office() and created_at > now() - interval '30 days'`,
  )
).map((r) => String(r.v))
const grantEmail = String(
  (await rows(`select email v from public.office_members where owner_key = 'grant' limit 1`))[0]?.v,
)

const errors: string[] = []
const browser = await chromium.launch()
const open = async (): Promise<{ ctx: BrowserContext; page: Page }> => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(`window.HQ_API = ${JSON.stringify(ENDPOINT)}`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  return { ctx, page }
}
const adopt = async (page: Page): Promise<void> => {
  await page.goto('about:blank')
  const frag = `access_token=${encodeURIComponent(second.access_token)}&refresh_token=${encodeURIComponent(second.refresh_token)}&expires_in=3000`
  await page.goto(`${BASE}/#${frag}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForFunction("(localStorage.getItem('hq.session') || '') !== ''", undefined, {
    timeout: 30000,
  })
}

// the static strings a signed-out browser shows from the page's own prototype code (measured, then subtracted)
const staticShown = new Set<string>()
{
  const { ctx, page } = await open()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const t = (await page.evaluate("document.body.innerText || ''")) as string
  for (const n of grantNames) if (t.includes(n)) staticShown.add(n)
  await ctx.close()
}

type Snap = { body: string; stored: string }
const snap = async (page: Page): Promise<Snap> =>
  (await page.evaluate(`(async () => {
    const dump = (s) => { try { return Object.keys(s).map((k) => k + '=' + s.getItem(k)).join('\\n') } catch { return '' } }
    let extra = ''
    try {
      for (const d of await indexedDB.databases()) {
        const h = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
        for (const store of Array.from(h.objectStoreNames)) {
          const all = await new Promise((ok) => { const g = h.transaction(store, 'readonly').objectStore(store).getAll(); g.onsuccess = () => ok(g.result); g.onerror = () => ok([]) })
          extra += ' ' + d.name + ':' + store + ':' + JSON.stringify(all, (k, v) => (v instanceof Blob ? '<blob>' : v))
        }
        h.close()
      }
    } catch {}
    try { for (const cn of await caches.keys()) { const c = await caches.open(cn); extra += ' cache ' + cn + ' ' + (await c.keys()).map((r) => decodeURIComponent(r.url)).join(' ') } } catch {}
    return { body: (document.body.innerText || '').replace(/\\s+/g, ' '), stored: dump(localStorage) + '\\n' + dump(sessionStorage) + extra }
  })()`)) as Snap
const grantHits = (n: Snap): string[] => {
  const all = `${n.body}\n${n.stored}`
  return [
    ...grantNames.filter((x) => all.includes(x) && !staticShown.has(x)),
    ...grantIds.filter((x) => all.includes(x)),
    ...(all.toLowerCase().includes(grantEmail.toLowerCase()) ? ['<grant email>'] : []),
  ]
}

/** The assertion under test: the bubble with THIS output id exists in the page and its text equals the expected answer. */
const renderedEquals = async (
  page: Page,
  outputId: string,
  expected: string,
): Promise<{ found: boolean; equal: boolean; text: string }> => {
  const text = (await page
    .evaluate(
      `(() => { const b = document.querySelector('.bcsaid[data-message-id=${JSON.stringify(outputId)}] .bcsaidtext'); return b ? b.innerText : null })()`,
    )
    .catch(() => null)) as string | null
  if (text === null) return { found: false, equal: false, text: '' }
  return { found: true, equal: norm(text) === norm(expected), text }
}

// ================= 1. clean state, authenticated, real composer
const { ctx, page } = await open()
await adopt(page)
const clean = await snap(page)
check(
  'clean state: the browser started with no chat thread stored',
  !clean.stored.includes('studio.chat='),
  clean.stored
    .split('\n')
    .map((l) => l.split('=')[0])
    .join(','),
)
await page.goto(`${BASE}/p/personal/chat`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForSelector('#bc-say', { timeout: 90000 })
const said = `p4 reload proof ${Date.now().toString(36)}: in one short sentence, what is on my task list right now?`
await page.fill('#bc-say', said)
await page.getByRole('button', { name: 'Send', exact: true }).click()
console.log(`   sent through the composer: ${said.slice(0, 60)}`)

// ================= 2. the durable identifier
const quoted = said.replace(/'/g, "''")
let command: Record<string, unknown> | undefined
// the command row is written first and the job is linked to it a moment later: wait for BOTH
for (let i = 0; i < 120 && (command === undefined || command.job === null); i++) {
  await sleep(1500)
  command = (
    await rows(
      `select command_id::text cmd, job_id::text job, office_id::text off, project_id::text proj from public.inbound_commands where instruction = '${quoted}'`,
    )
  )[0]
}
check(
  '2. the request is recorded: command and job ids exist in the canonical rows',
  command?.cmd !== undefined && command?.job !== null && command?.job !== undefined,
  JSON.stringify(command),
)
check(
  "2. ...in the second person's office and the Personal project",
  command?.off === SECOND_OFFICE && command?.proj === personal,
)
if (command?.job === null || command?.job === undefined) {
  console.log('\nTIMEOUT: the request never got a job. Reported as a failure, never as a pass.')
  await browser.close()
  server.close()
  process.exit(1)
}
const rootJob = String(command.job)

// ================= 3. completion from canonical state only
const treeSql = `with recursive t as (select * from public.jobs where job_id = '${rootJob}' union select c.* from public.jobs c join t on c.parent_job_id = t.job_id) select job_id::text, state::text, office_id::text off, kind, created_at, parent_job_id::text parent from t`
const started = Date.now()
let tree = await rows(treeSql)
while (
  Date.now() - started < COMPLETION_DEADLINE_MS &&
  !(tree.length > 0 && tree.every((j) => TERMINAL.includes(String(j.state))))
) {
  await sleep(4000)
  tree = await rows(treeSql)
}
const settled = tree.length > 0 && tree.every((j) => TERMINAL.includes(String(j.state)))
check(
  `3. the request's whole job tree reached a terminal state (${tree.length} job(s), ${Math.round((Date.now() - started) / 1000)}s)`,
  settled,
  settled
    ? JSON.stringify(tree.map((j) => `${j.kind}:${j.state}`))
    : `TIMEOUT after ${COMPLETION_DEADLINE_MS / 1000}s: ${JSON.stringify(tree.map((j) => `${j.kind}:${j.state}`))}`,
)
if (!settled) {
  console.log('\nTIMEOUT: reported as a failure, never as a pass.')
  await browser.close()
  server.close()
  process.exit(1)
}
check(
  '3. the root job is complete (not failed or cancelled)',
  tree.find((j) => j.job_id === rootJob)?.state === 'complete',
)
check(
  '3. every job of the tree is in the second office',
  tree.every((j) => j.off === SECOND_OFFICE),
)

// ================= 4. the canonical persisted answer
const outs = await rows(
  `select o.output_id::text oid, o.job_id::text job, o.body b, o.created_at, j.state::text jstate, j.office_id::text off from public.outputs o join public.jobs j using (job_id) where o.job_id in (${tree.map((j) => `'${String(j.job_id)}'`).join(',')}) order by o.created_at`,
)
const final = outs.filter((o) => o.jstate === 'complete').at(-1)
check(
  '4. a persisted output row exists for the request',
  outs.length >= 1 && final !== undefined,
  `${outs.length} output row(s)`,
)
const expected = String(final?.b ?? '')
const outputId = String(final?.oid)
console.log(`   canonical answer (output ${outputId.slice(0, 8)}): ${norm(expected).slice(0, 220)}`)
// ================= 5. assertions about that row
check("5. it belongs to the second person's office", final?.off === SECOND_OFFICE)
check(
  "5. it belongs to a job in THIS request's tree",
  tree.some((j) => j.job_id === final?.job),
)
check('5. it is non-empty', norm(expected).length > 10, `${norm(expected).length} chars`)
check(
  '5. it is the final completed output, not intermediate progress (its job is complete and it is the last output to land)',
  final?.jstate === 'complete' && outs.at(-1)?.oid === final?.oid,
)
check(
  '5. ...and not the hand-off sentence',
  !/handed this on|will come back with what/i.test(expected),
  norm(expected).slice(0, 80),
)
const conv = await read(second.access_token, 'conversation', `&id=${personal}`)
const items =
  (
    JSON.parse(conv.text) as {
      data?: { message_id: string; kind: string; body: string; job: string }[]
    }
  ).data ?? []
const theirs = items.find((m) => m.message_id === outputId)
check(
  "5. the product's own reader returns that output, as an answered message, to the second person",
  theirs?.kind === 'answered' && norm(theirs.body) === norm(expected),
)
const gConv = await read(grant.access_token, 'conversation', `&id=${personal}`)
check(
  '5. ...and the same project id asked as Grant returns nothing of it',
  !gConv.text.includes(outputId) && !gConv.text.includes('p4 reload proof'),
)

// ================= 6-7. full reload, same context, then a brand-new context
const verdicts: { where: string; r: { found: boolean; equal: boolean; text: string } }[] = []
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('#bc-say', { timeout: 40000 })
await page
  .waitForSelector(`.bcsaid[data-message-id=${JSON.stringify(outputId)}]`, { timeout: 60000 })
  .catch(() => null)
verdicts.push({
  where: 'the same context, after a full reload',
  r: await renderedEquals(page, outputId, expected),
})
const afterReload = await snap(page)
const fresh = await open()
await adopt(fresh.page)
await fresh.page.goto(`${BASE}/p/personal/chat`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await fresh.page
  .waitForSelector(`.bcsaid[data-message-id=${JSON.stringify(outputId)}]`, { timeout: 60000 })
  .catch(() => null)
verdicts.push({
  where: 'a brand-new context with empty storage',
  r: await renderedEquals(fresh.page, outputId, expected),
})
const freshSnap = await snap(fresh.page)
for (const v of verdicts) {
  check(`7. ${v.where}: the answered bubble with the canonical output id is rendered`, v.r.found)
  check(
    `7. ${v.where}: its text EQUALS the canonical answer (presentation-normalised, not a substring)`,
    v.r.equal,
    v.r.found && !v.r.equal ? `got: ${norm(v.r.text).slice(0, 100)}` : '',
  )
}
const sample = await fresh.page.evaluate(
  "document.body.innerText.includes('This is an example conversation')",
)
check('7. the example/sample conversation is not what rendered', sample === false)

// ================= 8. negative controls: the SAME assertion must be able to go red
const impossible = `IMPOSSIBLE-${Date.now()} this answer was never produced`
const red1 = await renderedEquals(fresh.page, outputId, impossible)
check(
  '8. NEGATIVE CONTROL: an impossible expected value makes the assertion RED',
  red1.found && !red1.equal,
)
const earlier = (
  await rows(
    `select o.body b from public.outputs o join public.jobs j using (job_id) where j.office_id = '${SECOND_OFFICE}' and o.output_id::text <> '${outputId}' and length(o.body) > 40 order by o.created_at desc limit 1`,
  )
)[0]
check(
  '8. NEGATIVE CONTROL: an earlier answer (another output of the same person) as the expected value is RED',
  earlier !== undefined && !(await renderedEquals(fresh.page, outputId, String(earlier?.b))).equal,
)
const wrongId = await renderedEquals(fresh.page, '00000000-0000-4000-8000-000000000000', expected)
check(
  '8. NEGATIVE CONTROL: the right text under a wrong output id is RED (not found)',
  !wrongId.found && !wrongId.equal,
)
const green = await renderedEquals(fresh.page, outputId, expected)
check('8. RESTORED: the real expected value is GREEN again', green.found && green.equal)

// ================= 9. Grant absent, storage clean, no page errors
for (const [label, n] of [
  ['the reloaded page', afterReload],
  ['the fresh context', freshSnap],
] as [string, Snap][]) {
  check(
    `9. nothing of Grant's in ${label} (DOM, localStorage, sessionStorage, IndexedDB contents, Cache storage)`,
    grantHits(n).length === 0,
    JSON.stringify(grantHits(n)),
  )
}
const stored = JSON.parse(
  (await page.evaluate("localStorage.getItem('hq.session')")) as string,
) as { access_token: string }
const sub = (
  JSON.parse(Buffer.from(stored.access_token.split('.')[1] ?? '', 'base64url').toString()) as {
    sub?: string
  }
).sub
const want = (
  JSON.parse(Buffer.from(second.access_token.split('.')[1] ?? '', 'base64url').toString()) as {
    sub?: string
  }
).sub
check("9. the browser holds the second person's session (and not Grant's)", sub === want)
check('9. zero page errors', errors.length === 0, JSON.stringify([...new Set(errors)].slice(0, 3)))
await page.screenshot({ path: '.out/p4-chat-reload.png' }).catch(() => null)
await ctx.close()
await fresh.ctx.close()
await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(
  `\n${results.length - failed.length}/${results.length} ok${failed.length === 0 ? '' : ` — FAILED: ${failed.map((f) => f.what).join(' | ')}`}`,
)
process.exitCode = failed.length === 0 ? 0 : 1
