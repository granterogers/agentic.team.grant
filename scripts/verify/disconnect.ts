/**
 * Disconnect means disconnect.
 *
 *   npm run verify:disconnect
 *
 * Issue #90. Grant: *"Provide a working Disconnect action for connected
 * services such as Notion, and update the displayed connection status."* And
 * the sentence that makes it a P1 rather than a nicety: *"the page asserting a
 * connection that is not there is worse than no button, because he will act on
 * it."*
 *
 * ## How a destructive action is checked without being destructive
 *
 * Every SQL assertion below runs inside `begin … rollback`. The disconnect
 * really executes — the token really is deleted, the health row really flips,
 * the settings really switch off, and the page's own payload is read back
 * INSIDE the same transaction so what is asserted is what a person would have
 * seen — and then none of it happened.
 *
 * That matters more than the tidiness: the alternative is either not checking
 * the branch that does the work, or signing Grant out of Notion every time
 * somebody runs the suite. The check re-asserts afterwards that the real
 * credentials are still present, because a rollback that silently failed would
 * otherwise look exactly like one that worked — the teardown trap in CLAUDE.md,
 * pointed at itself.
 *
 * ## And the half a browser has to do
 *
 * A working RPC behind a button that never calls it is #72's shape. So the
 * page is driven too: the button must exist on a connected service, ask before
 * it acts, name the service and what stops, send the right action, and leave a
 * card that no longer claims a connection.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const PORT = 4623
const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, detail: string, ok: boolean) => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

// --- before: what is really there ------------------------------------------
const before = await one(`
  select (select count(*)::int from vault.secrets where name = 'notion.integration_token') as notion,
         (select count(*)::int from vault.secrets where name = 'notebook.storage_state') as notebook,
         (select count(*)::int from vault.secrets where name = 'google.refresh_token') as google
`)

// --- the refusals, which touch nothing at all ------------------------------
for (const [service, must] of [
  ['openrouter', 'how the team thinks'],
  ['telegram', 'how the office reaches you'],
  ['slack', 'installed app'],
  ['github', 'two decisions'],
  ['supabase', 'this function is running inside it'],
  ['zoom', 'no disconnect for zoom'],
] as const) {
  const r = await one(`select (app.hq_disconnect('${service}'))::text as d`)
  const said = String(r.d ?? '')
  check(
    `${service} is refused, with the reason`,
    said.slice(0, 74),
    said.includes('error') && said.includes(must),
  )
}

/*
  ## The one that would have caught the original bug

  Not "did the RPC return ok" — "does the page's own payload stop claiming a
  connection". `hq_studio_settings()` is what the Connections tab reads, and it
  is read back inside the transaction, after the disconnect, so this asserts
  exactly what a person would be looking at.
*/
/*
  The disconnect gets a statement of its OWN, and the state is read in the
  next one.

  Written as one SELECT it reported that nothing had been deleted. Every
  expression in a target list is evaluated against the snapshot taken when the
  statement began, so the two subqueries beside `hq_disconnect(...)` were
  reading the database as it was BEFORE the call in the column next to them.
  The disconnect worked; the check could not see it.

  A temp table carries the answer across the statement boundary, and is dropped
  by the rollback along with everything else.
*/
const after = await one(`
  begin;
  create temp table _said as select app.hq_disconnect('notion') as v;
  select (select v::text from _said) as said,
         (select x::text from jsonb_array_elements(app.hq_studio_settings() -> 'connections') x
           where x ->> 'key' = 'notion') as row,
         (select count(*)::int from vault.secrets where name = 'notion.integration_token') as left_behind;
  rollback;
`)
const said = String(after.said ?? '')
const row = String(after.row ?? '')
check('disconnecting Notion removes the credential', said.slice(0, 60), said.includes('"removed": 1'))
check('and the credential is really gone', `${String(after.left_behind)} left`, after.left_behind === 0)
check('and says where consent is withdrawn', 'notion.so/profile/integrations', said.includes('notion.so/profile/integrations'))
check('and promises the corpus is kept', 'already imported stay', said.includes('already imported stay'))
check(
  'and the page stops calling it connected',
  row.slice(0, 96) || '(no notion row)',
  row.includes('"state": "missing"') && !row.includes('valid; pages shared'),
)
check(
  'and the page says what happened rather than nothing',
  row.includes('disconnected at your request') ? 'disconnected at your request' : row.slice(0, 60),
  row.includes('disconnected at your request'),
)

const nb = await one(`
  begin;
  create temp table _nb as select app.hq_disconnect('notebooklm') as v;
  select (select v::text from _nb) as said,
         (select value::text from public.system_config where key = 'notebook.enabled') as enabled;
  rollback;
`)
check(
  'disconnecting NotebookLM also switches generation off',
  `enabled=${String(nb.enabled)}`,
  String(nb.said).includes('"removed": 1') && String(nb.enabled) === 'false',
)

const gg = await one(`
  begin;
  create temp table _gg as select app.hq_disconnect('calendar') as v;
  select (select v::text from _gg) as said,
         (select value::text from public.system_config where key = 'calendar.enabled') as enabled,
         (select count(*)::int from vault.secrets where name = 'google.refresh_token') as left_behind;
  rollback;
`)
check(
  'any of the three Google services signs the account out',
  `enabled=${String(gg.enabled)}, ${String(gg.left_behind)} token(s) left`,
  String(gg.said).includes('"service": "Google"') &&
    String(gg.enabled) === 'false' &&
    gg.left_behind === 0,
)

/*
  A teardown that matched nothing looks exactly like a teardown that worked, so
  the honest answer for a service that was never connected has to be different
  from the one for a service that was.
*/
const twice = await one(`
  begin;
  create temp table _once as select app.hq_disconnect('notion') as v;
  select (app.hq_disconnect('notion'))::text as again;
  rollback;
`)
check(
  'disconnecting it twice says there was nothing to remove',
  String(twice.again).slice(0, 60),
  String(twice.again).includes('"removed": 0'),
)

// --- and every rollback really rolled back ---------------------------------
const now = await one(`
  select (select count(*)::int from vault.secrets where name = 'notion.integration_token') as notion,
         (select count(*)::int from vault.secrets where name = 'notebook.storage_state') as notebook,
         (select count(*)::int from vault.secrets where name = 'google.refresh_token') as google
`)
check(
  'CONTROL: the real credentials are untouched',
  `notion ${String(now.notion)}/${String(before.notion)}, notebook ${String(now.notebook)}/${String(before.notebook)}, google ${String(now.google)}/${String(before.google)}`,
  now.notion === before.notion && now.notebook === before.notebook && now.google === before.google,
)

// ===========================================================================
// The half a browser has to do
// ===========================================================================

const sections: Record<string, unknown> = {}
for (const [name, fn, args] of [
  ['studio', 'hq_studio', ''],
  ['studio_settings', 'hq_studio_settings', ''],
  ['usage_overview', 'usage_overview', '30'],
  ['studio_setup', 'hq_setup', ''],
] as const) {
  sections[name] = (await one(`select app.${fn}(${args}) as d`)).d
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}
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
const asked: string[] = []
page.on('dialog', (d) => {
  asked.push(d.message())
  void d.accept()
})

await page.addInitScript(`
  window.__S = ${JSON.stringify(sections)};
  window.__SENT = [];
  try { localStorage.setItem('hq.token', 'verify-disconnect'); } catch (e) {}
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('hq-api')) {
      const m = /section=([a-z_]+)/.exec(url);
      if (m) return new Response(JSON.stringify({ data: window.__S[m[1]] ?? {} }),
        { status: 200, headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(String(init && init.body));
      window.__SENT.push(body);
      if (body.action === 'disconnect') {
        // Stand in for what the RPC really does, which the SQL half above has
        // already proved: the payload the page refetches no longer claims it.
        for (const c of (window.__S.studio_settings.connections || [])) {
          if (c.key === 'notion') { c.state = 'missing'; c.detail = 'disconnected at your request'; }
        }
        return new Response(JSON.stringify({ result: { ok: true, service: 'Notion', removed: 1,
          note: 'Disconnected. Pages it already imported stay.',
          revoke_at: 'https://www.notion.so/profile/integrations' } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ result: { ok: true } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
`)

await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2_000)
await page.evaluate(`document.querySelector('[data-settings]')?.click()`)
await page.waitForTimeout(700)
await page.evaluate(`document.querySelector('[data-setting="connections"]')?.click()`)
await page.waitForTimeout(900)

/*
  Measured, not just counted.

  During the port Disconnect rendered as a 110px EMPTY BOX, because `.mini` in
  studio.css is a 78px preview thumbnail rather than a small button. A control
  that exists, is visible and cannot be read is invisible to a check that only
  asks whether it is there.
*/
const buttons = (await page.evaluate(
  `[...document.querySelectorAll('[data-disconnect]')].map((b) => {
     const r = b.getBoundingClientRect();
     return { key: b.dataset.disconnect, w: Math.round(r.width), h: Math.round(r.height), text: b.textContent.trim() };
   })`,
)) as { key: string; w: number; h: number; text: string }[]
check(
  'a connected service offers Disconnect',
  buttons.map((b) => `${b.key} ${String(b.w)}x${String(b.h)}`).join(', ') || 'none',
  buttons.some((b) => b.key === 'notion'),
)
check(
  'and it is a button with words in it, not an empty box',
  buttons.map((b) => `"${b.text}"`).join(', ') || 'none',
  buttons.length > 0 && buttons.every((b) => b.text === 'Disconnect' && b.w > 60 && b.h >= 28),
)

await page.evaluate(`document.querySelector('[data-disconnect="notion"]')?.click()`)
await page.waitForTimeout(2_500)

check(
  'it asks first, and names the service',
  asked[0]?.slice(0, 60) ?? '(nothing was asked)',
  asked.length === 1 && asked[0]?.startsWith('Disconnect Notion?') === true,
)
check(
  'and the question says what stops and what stays',
  asked[0]?.slice(30, 110) ?? '',
  (asked[0] ?? '').includes('stops being able to read') && (asked[0] ?? '').includes('stay'),
)
const sent = (await page.evaluate('window.__SENT')) as { action: string; args: unknown }[]
const call = sent.find((x) => x.action === 'disconnect')
check(
  'and it reaches the office as the right action',
  call === undefined ? 'nothing was sent' : JSON.stringify(call),
  JSON.stringify(call?.args) === JSON.stringify({ p_service: 'notion' }),
)
const card = (await page.evaluate(
  `(() => {
     const art = [...document.querySelectorAll('article')].find((a) => /Notion/.test(a.textContent));
     return { gone: document.querySelector('[data-disconnect="notion"]') === null,
              text: (art ? art.innerText : '').replace(/\\n/g, ' | ') };
   })()`,
)) as { gone: boolean; text: string }
check(
  'and the card stops claiming a connection, without a reload',
  card.text.slice(0, 96) || '(no Notion card)',
  card.gone && !card.text.includes('valid; pages shared'),
)
check('no uncaught JavaScript', crashes.join(' | ') || 'none', crashes.length === 0)

await browser.close()
server.close()

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
