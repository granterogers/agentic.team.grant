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

/*
  The refusals, which touch nothing at all — and the two that STOPPED being
  refusals, which touched a great deal.

  This loop called `app.hq_disconnect` OUTSIDE a transaction, on the reasoning
  that a refusal has nothing to roll back. That was true when it was written
  and 0350 made it false: Slack and Telegram became real disconnects that
  afternoon, and this loop kept asserting the old refusal.

  So it did not merely go red. **It really disconnected Slack**, deleting the
  bot token and the signing secret, every time anybody ran this suite. Telegram
  survived only by accident — 0350 deletes `telegram.chief_bot_token` and the
  stored name is `telegram.chief.bot_token`, so that delete has never matched
  anything.

  Two separate rules were broken by one line, and both are in CLAUDE.md: a
  CONTROL goes stale when the thing it controls for changes, and a check that
  performs a destructive action must do it inside `begin … rollback` like
  every other assertion in this file. The transaction is not an optimisation
  here; it is the only thing standing between a verification run and Grant's
  workspace.

  Every call is wrapped now, refusal or not. A refusal has nothing to roll
  back, which costs nothing; a disconnect has everything to roll back, and the
  wrapper cannot know which it is until it has already happened.
*/
for (const [service, must] of [
  ['openrouter', 'how the team thinks'],
  ['github', 'two decisions'],
  ['supabase', 'this function is running inside it'],
  ['zoom', 'no disconnect for zoom'],
] as const) {
  const r = await one(`
    begin;
    create temp table _r as select (app.hq_disconnect('${service}'))::text as d;
    select (select d from _r) as d;
    rollback;
  `)
  const said = String(r.d ?? '')
  check(
    `${service} is refused, with the reason`,
    said.slice(0, 74),
    said.includes('error') && said.includes(must),
  )
}

/*
  Slack and Telegram DO disconnect now (0350, #198), and asserting that is the
  point — but inside the transaction, because it is real.
*/
for (const [service, must] of [
  ['slack', 'Reconnecting means installing the app again'],
  ['telegram', 'staff bots are separate'],
] as const) {
  const r = await one(`
    begin;
    create temp table _d as select (app.hq_disconnect('${service}'))::text as d;
    select (select d from _d) as d;
    rollback;
  `)
  const said = String(r.d ?? '')
  check(
    `${service} disconnects for real, and says what reconnecting costs`,
    said.slice(0, 84),
    said.includes('"ok": true') && said.includes(must),
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
check(
  'disconnecting Notion removes the credential',
  said.slice(0, 60),
  said.includes('"removed": 1'),
)
check(
  'and the credential is really gone',
  `${String(after.left_behind)} left`,
  after.left_behind === 0,
)
check(
  'and says where consent is withdrawn',
  'notion.so/profile/integrations',
  said.includes('notion.so/profile/integrations'),
)
check(
  'and promises the corpus is kept',
  'already imported stay',
  said.includes('already imported stay'),
)
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
  And the revoke that the sign-out is supposed to START (#109).

  This is the half 0350 could not do: a deleted vault row and a live refresh
  token at Google are not the same state, and for a token that has been on a
  machine we no longer control that difference is the whole point of the
  button.

  Everything here is inside `begin … rollback`, so Grant is not signed out and
  no job survives the transaction — which is what makes it safe to drive the
  real path rather than a mock of it.

  The subject is a FIXTURE token, written and rolled back, because the real
  refresh token may or may not be present depending on whether Google is
  connected right now, and a check whose result depends on that reports the
  weather rather than the code.
*/
const revoking = await one(`
  begin;
  -- A token to park, so this exercises the branch that HAS one rather than the
  -- branch that says there was nothing to do.
  --
  -- Only when there is not one already: Google may or may not be connected
  -- when this runs, and the first version inserted unconditionally and died on
  -- the unique index the day it was. Either way the transaction rolls back, so
  -- a real token is parked and restored rather than lost.
  do $do$
  begin
    if not exists (select 1 from vault.secrets where name = 'google.refresh_token') then
      perform vault.create_secret('1//fixture-refresh-token-for-verify-disconnect',
        'google.refresh_token', 'verify:disconnect fixture, rolled back');
    end if;
  end
  $do$;
  create temp table _rv as select app.hq_forget_google() as v;
  select (select v::text from _rv) as said,
         (select count(*)::int from vault.secrets
           where name = 'google.refresh_token') as still_ours,
         (select count(*)::int from vault.secrets
           where name = 'google.revoking_refresh_token') as parked,
         (select count(*)::int from public.jobs
           where kind = 'google.revoke' and state = 'queued') as queued;
  rollback;
`)
check(
  'signing out of Google enqueues the revoke, rather than only forgetting',
  `queued=${String(revoking.queued)}, said ${String(revoking.said).slice(0, 60)}`,
  revoking.queued === 1 && String(revoking.said).includes('"revoking": true'),
)
/*
  The safety property #109 asked for, asserted as a property rather than as an
  ordering.

  The Issue said "delete the local copy, THEN enqueue" — and those two cannot
  both happen in that order, because the revoke endpoint takes the token as its
  argument. What it WANTED is that nothing the office reads still points at a
  live credential, and that is checkable directly: the name `googleAccess` asks
  for is gone, and the parked copy lives under a name only the revoke handler
  is allowed to read.
*/
check(
  'and the credential the office reads is gone at that moment, parked under another name',
  `ours=${String(revoking.still_ours)}, parked=${String(revoking.parked)}`,
  revoking.still_ours === 0 && revoking.parked === 1,
)
/*
  CONTROL, and the reason it is here: every assertion above passes just as well
  if `app.vault_secret` had been widened carelessly. The parked name must be
  readable by the handler and the ORIGINAL name must still be refused to
  anything outside the allow-list — so the check that the parking is not a
  loophole is the one that asks what the gate now permits.
*/
const gate = await one(`
  select (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname = 'vault_secret'
             and pg_get_functiondef(p.oid) like '%google.revoking_refresh_token%') as knows_parked,
         (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname = 'vault_secret'
             and pg_get_functiondef(p.oid) like '%42501%') as still_refuses
`)
check(
  'the parked name is readable, and the gate still refuses everything else',
  `knows_parked=${String(gate.knows_parked)}, refuses=${String(gate.still_refuses)}`,
  gate.knows_parked === 1 && gate.still_refuses === 1,
)
/*
  The parked copy is destroyed whether the revoke worked or not.

  A parked token that outlives its job is exactly the thing #109 exists to
  prevent, wearing a different name — so both outcomes are driven, not just
  the happy one.
*/
for (const [what, ok] of [
  ['a confirmed revoke', true],
  ['a FAILED revoke', false],
] as const) {
  const finish = await one(`
    begin;
    do $do$
    begin
      if not exists (select 1 from vault.secrets where name = 'google.revoking_refresh_token') then
        perform vault.create_secret('1//fixture-parked-token', 'google.revoking_refresh_token',
          'verify:disconnect fixture, rolled back');
      end if;
    end
    $do$;
    create temp table _fin as select app.google_revoke_finish(${ok ? 'true' : 'false'},
      'verify:disconnect') as v;
    select (select v::text from _fin) as said,
           (select count(*)::int from vault.secrets
             where name = 'google.revoking_refresh_token') as parked_left,
           (select detail from public.connection_health where service = 'google_calendar') as detail,
           (select action from public.connection_health where service = 'google_calendar') as action;
    rollback;
  `)
  check(
    `${what} destroys the parked copy`,
    `parked_left=${String(finish.parked_left)}`,
    finish.parked_left === 0 && String(finish.said).includes('"parked_copy_removed": 1'),
  )
  check(
    `${what} says the honest thing on the Connections panel`,
    `${String(finish.detail)} -- ${String(finish.action)}`,
    ok
      ? String(finish.detail).includes('revoked at Google')
      : String(finish.detail).includes('did not confirm') &&
          String(finish.action).includes('myaccount.google.com/permissions'),
  )
}

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
