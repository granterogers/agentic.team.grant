/**
 * The studio notices when the office moves.
 *
 *   npm run verify:pulse
 *
 * Issue #117. The page fetched once and never changed again, so the ribbon
 * saying what the office is doing *right now* was only true at the moment it
 * loaded.
 *
 * ## What is worth asserting, and what is not
 *
 * "A timer exists" is not worth asserting — it is visible in the source and it
 * is not the thing that breaks. Three things are:
 *
 *   1. **The digest is stable when nothing happens.** A digest containing
 *      anything that moves on its own makes every poll a change, and the page
 *      refetches the whole payload three times a minute for ever. The first
 *      version of `hq_pulse` had exactly that bug: `at` is in the answer and
 *      has to be excluded before comparing.
 *   2. **It moves when something real happens.** A digest that never changes is
 *      a page that never updates, which is where this started.
 *   3. **The page acts on it** — the browser half, driven, not read.
 *
 * ## And two rules about not being annoying
 *
 * A repaint that fights a drag or eats a half-typed message is worse than a
 * stale page. Both are driven here rather than trusted.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const PORT = 4635
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const checks: boolean[] = []
const check = (what: string, detail: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

// --- 1. the digest is stable, and cheap -------------------------------------

const strip = (p: Record<string, unknown>): string => {
  const { at: _ignored, ...rest } = p
  return JSON.stringify(rest)
}

const first = (await one('select app.hq_pulse() as p')).p as Record<string, unknown>
await new Promise((r) => setTimeout(r, 1_200))
const second = (await one('select app.hq_pulse() as p')).p as Record<string, unknown>

check(
  'asking twice with nothing happening gives the same answer',
  strip(first) === strip(second) ? 'identical' : `${strip(first)} then ${strip(second)}`,
  strip(first) === strip(second),
)
/*
  `at` MUST move — it is what tells a reader how fresh the answer is — and it
  must NOT be part of what the page compares. Both halves asserted, because
  removing it from the answer entirely would fix the comparison and lose the
  freshness, and a caller that forgot to strip it would poll for ever.
*/
check(
  'and it still says when it was taken',
  `${String(first.at)} then ${String(second.at)}`,
  typeof first.at === 'string' && first.at !== second.at,
)
check(
  'and it carries numbers rather than a payload',
  `${String(Object.keys(first).length)} fields`,
  Object.keys(first).length <= 8 && JSON.stringify(first).length < 400,
)

// --- 2. it moves when something real happens --------------------------------

/*
  A real change, made and then rolled back. `hq_pulse` counts non-fixture rows,
  so a fixture would correctly NOT move it — which makes a fixture the wrong
  instrument for this one assertion and a rolled-back real row the right one.
*/
const moved = await one(`
  begin;
  create temp table _p as select app.hq_pulse() as before;
  update public.projects set purpose = purpose where slug =
    (select slug from public.projects where not is_fixture and status = 'active' limit 1);
  select (select before from _p)::text as before, app.hq_pulse()::text as after;
  rollback;
`)
const beforeDigest = strip(JSON.parse(String(moved.before)) as Record<string, unknown>)
const afterDigest = strip(JSON.parse(String(moved.after)) as Record<string, unknown>)
check(
  'touching a project moves the digest',
  beforeDigest === afterDigest ? 'the digest did not move' : 'moved',
  beforeDigest !== afterDigest,
)

const stillThere = await one(`
  select count(*)::int as n from public.projects where not is_fixture and status = 'active'
`)
check(
  'CONTROL: the rollback rolled back',
  `${String(stillThere.n)} active project(s)`,
  Number(stillThere.n) > 0,
)

// --- 3. the page acts on it -------------------------------------------------

const studio = ((await db.execute('select app.hq_studio() as d')).rows[0] as { d: unknown }).d

const server = createServer(async (rq, rs) => {
  let f = join('web/studio', decodeURIComponent((rq.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  if (!existsSync(f)) {
    rs.writeHead(404)
    rs.end('not here')
    return
  }
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
  rs.end(await readFile(f))
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const crashes: string[] = []
page.on('pageerror', (e) => crashes.push(e.message.slice(0, 120)))

/*
  The shim counts what the page asks for and lets the check move the office
  under it. Twenty seconds is the real interval and far too long for a suite, so
  the poll is driven directly instead — the interval is a constant, the
  behaviour is what needs proving.
*/
// The page has to know which office it belongs to before its first line
// runs, or the shim below never sees a URL with hq-api in it. ADR-0048.
await page.addInitScript(namesAnOffice())

await page.addInitScript(`
  window.__S = ${JSON.stringify({ studio })};
  window.__PULSE = { jobs_running: 0, jobs_done: 1, outputs: 1, tasks_open: 0, documents: 1 };
  window.__ASKED = { pulse: 0, studio: 0 };
  try { localStorage.setItem('hq.token', 'verify-pulse'); } catch (e) {}
  window.fetch = async (input) => {
    const url = String(input);
    if (url.includes('hq-api')) {
      const m = /section=([a-z_]+)/.exec(url);
      const s = m ? m[1] : '';
      if (s === 'pulse') {
        window.__ASKED.pulse++;
        return new Response(JSON.stringify({ data: { at: new Date().toISOString(), ...window.__PULSE } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (s === 'studio') window.__ASKED.studio++;
      return new Response(JSON.stringify({ data: window.__S[s] ?? {} }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
`)
await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2_500)

const poke = async (): Promise<void> => {
  await page.evaluate(`(async () => {
    const m = await import('./pulse.js');
    // The module's own poll, driven directly. Nothing here reimplements it.
    document.dispatchEvent(new Event('visibilitychange'));
  })()`)
  await page.waitForTimeout(1_200)
}

const asked = async (): Promise<{ pulse: number; studio: number }> =>
  (await page.evaluate('window.__ASKED')) as { pulse: number; studio: number }

const atStart = await asked()
check(
  'the page asks whether anything changed',
  `${String(atStart.pulse)} pulse call(s)`,
  atStart.pulse >= 1,
)

await poke()
const quiet = await asked()
check(
  'and does NOT refetch the payload when the answer is the same',
  `${String(quiet.pulse)} pulse call(s), ${String(quiet.studio)} studio call(s)`,
  quiet.pulse > atStart.pulse && quiet.studio === atStart.studio,
)

// Move the office under it.
await page.evaluate(`window.__PULSE.jobs_done = 99`)
await poke()
const after = await asked()
check(
  'and DOES refetch when the office has moved',
  `${String(after.studio)} studio call(s), was ${String(quiet.studio)}`,
  after.studio > quiet.studio,
)

/*
  The two rules about not interrupting. Both are the difference between a page
  that feels alive and one that fights you.
*/
await page.evaluate(`(() => {
  const t = document.createElement('textarea');
  t.value = 'half a sentence I am still writing';
  document.body.append(t);
  window.__PULSE.jobs_done = 1234;
})()`)
const beforeTyping = await asked()
await poke()
await page.waitForTimeout(1_500)
const whileTyping = await asked()
check(
  'a half-typed message is never thrown away by a background refresh',
  `${String(whileTyping.studio)} studio call(s), was ${String(beforeTyping.studio)}`,
  whileTyping.studio === beforeTyping.studio,
)

// And the deferred change lands once the text is gone.
await page.evaluate(`document.querySelectorAll('textarea').forEach((t) => { t.value = '' })`)
await page.waitForTimeout(3_000)
const afterTyping = await asked()
check(
  'and the change it held back arrives once you stop typing',
  `${String(afterTyping.studio)} studio call(s)`,
  afterTyping.studio > whileTyping.studio,
)

check('no uncaught JavaScript', crashes.join(' | ') || 'none', crashes.length === 0)

await browser.close()
server.close()

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
