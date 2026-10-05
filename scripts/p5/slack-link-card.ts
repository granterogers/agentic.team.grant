/**
 * The "Your Slack" card in Settings -> Messaging, in every state and through its two presses (ADR-0065).
 *   npm run verify:slack-card        (local class: files and a fake gateway on the same machine; no call to any office)
 *
 * The real page runs as a signed-in person against a FAKE gateway this file serves: it answers `studio_settings` (the
 * minimum the page needs to believe it is looking at a live office), `slack_link` (whatever state the harness set) and the two
 * Slack actions, and records exactly what the page sent. So the card is judged through the page's own read path, not by
 * poking its store. Asserted, each with the control that stops it passing for the wrong reason:
 *   - a person who is not the operator sees the card; the operator does not;
 *   - until the Slack app is opened to other workspaces there is NO Connect button and the words say why;
 *   - a connected workspace is named, and the card says honestly whether the team can answer there or only here;
 *   - Connect sends NOTHING but the action (no office, no workspace, no token, no state), opens Slack's link and waits;
 *   - Disconnect asks first, in the page's own dialog; Cancel sends nothing, Confirm sends the one action;
 *   - what Slack's callback says on return is shown in words and taken out of the address.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

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
const LINK_URL = 'https://slack.com/oauth/v2/authorize?client_id=1111.2222&state=fake'
const gatewayPosts: { action: string; args: Record<string, unknown> }[] = []
let operator = false
let slackNow: Record<string, unknown> = {}
const json = (res: import('node:http').ServerResponse, body: unknown): void => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname
  if (path === '/hq') {
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        action: string
        args: Record<string, unknown>
      }
      gatewayPosts.push(body)
      if (body.action === 'slack_link_begin') {
        slackNow = { ...slackNow, state: 'waiting' }
        return json(res, {
          action: body.action,
          result: {
            ok: true,
            url: LINK_URL,
            expires_at: new Date(Date.now() + 600000).toISOString(),
          },
        })
      }
      if (body.action === 'slack_link_disconnect') {
        slackNow = { state: 'none', available: true, can_connect: true, managed_by_operator: false }
        return json(res, {
          action: body.action,
          result: { ok: true, removed: 1, revoked_at_slack: true },
        })
      }
      return json(res, { action: body.action, result: { ok: true } })
    }
    const section = url.searchParams.get('section')
    if (section === 'studio_settings') {
      return json(res, {
        data: {
          behaviours: [],
          team: [],
          spare_bots: [],
          connections: [],
          channels: [],
          viewer: { operator },
        },
      })
    }
    if (section === 'slack_link') return json(res, { data: { slack: slackNow } })
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
    return
  }
  try {
    const body = await readFile(
      join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, '')),
    )
    res.writeHead(200, {
      'content-type':
        TYPES[extname(path) === '' ? '.html' : extname(path)] ?? 'application/octet-stream',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(4798, '127.0.0.1', () => r()))

let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(
  "window.HQ_API = 'http://127.0.0.1:4798/hq'; try { localStorage.setItem('hq.token', 'local-only-not-a-credential') } catch {}",
)
const errors: string[] = []
let native = 0
const open = async (extra = ''): Promise<import('playwright').Page> => {
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => {
    native += 1
    void d.dismiss()
  })
  await p.goto(`http://127.0.0.1:4798/?settings=channels${extra}`, {
    waitUntil: 'domcontentloaded',
  })
  await p.waitForSelector('[data-bc-settings]', { timeout: 30000 })
  await p.locator('[data-bc-settings]').first().click({ force: true })
  await p.waitForSelector('#settings .stg-navitem', { timeout: 15000 })
  await p.locator('#settings [data-setting="channels"]').click({ force: true })
  // the pane is drawn from what the gateway answered; wait for the Messaging pane, not for a fixed pause
  await p.waitForFunction(
    "document.querySelector('#settings')?.innerText.includes('How the team gets in touch with you')",
    null,
    { timeout: 15000 },
  )
  await p.waitForTimeout(700)
  return p
}
const card = async (
  p: import('playwright').Page,
): Promise<{ present: boolean; text: string; buttons: string[]; hrefs: string[] }> =>
  (await p.evaluate(`(() => {
    const sec = [...document.querySelectorAll('#settings section')].find((s) => /^\\s*Your Slack/i.test((s.innerText || '')))
    if (!sec) return { present: false, text: '', buttons: [], hrefs: [] }
    return {
      present: true,
      text: sec.innerText.replace(/\\s+/g, ' '),
      buttons: [...sec.querySelectorAll('button, a')].map((b) => (b.textContent || '').trim()).filter(Boolean),
      hrefs: [...sec.querySelectorAll('a')].map((a) => a.getAttribute('href') || ''),
    }
  })()`)) as { present: boolean; text: string; buttons: string[]; hrefs: string[] }

const state = (s: Record<string, unknown>, op = false): void => {
  operator = op
  slackNow = { managed_by_operator: false, ...s }
}

// ---- states, through the page's own read path -----------------------------------------------------------------------------
state({ state: 'none', available: true, can_connect: true, managed_by_operator: true }, true)
let p = await open()
check('the operator sees no Slack card (their Slack is the deployment’s)', !(await card(p)).present)
await p.close()

state({ state: 'none', available: false, can_connect: false })
p = await open()
let c = await card(p)
check(
  'not opened to other workspaces: the card says so in words',
  c.present &&
    /not switched on for other workspaces/i.test(c.text) &&
    /Not available yet/.test(c.text),
  c.text.slice(0, 140),
)
check(
  'and there is NO Connect button (an unpressable control is not offered)',
  c.present && !c.buttons.some((b) => /connect slack/i.test(b)),
  c.buttons.join(' | '),
)
await p.close()

state({ state: 'none', available: true, can_connect: true })
p = await open()
c = await card(p)
check(
  'opened: Connect Slack is offered, with nothing to copy or type',
  c.buttons.includes('Connect Slack') && /nothing to copy or type/i.test(c.text),
  c.buttons.join(' | '),
)
await p.close()

state({
  state: 'connected',
  available: true,
  workspace: 'Acme Studio',
  can_receive: true,
  can_reply: false,
  connected_at: new Date().toISOString(),
})
p = await open()
c = await card(p)
check(
  'connected: names the workspace, is honest that answers appear in Team HQ, offers Disconnect',
  /Acme Studio/.test(c.text) &&
    /answers appear here in Team HQ/i.test(c.text) &&
    c.buttons.includes('Disconnect'),
  c.text.slice(0, 200),
)
check(
  'CONTROL: it does not claim answers come back in Slack while it cannot reply',
  !/come back to you in Slack/i.test(c.text),
)
await p.close()

state({
  state: 'connected',
  available: true,
  workspace: 'Acme Studio',
  can_receive: true,
  can_reply: true,
  connected_at: new Date().toISOString(),
})
p = await open()
c = await card(p)
check(
  'and when it CAN reply, it says answers come back in Slack',
  /come back to you in Slack/i.test(c.text) && !/appear here in Team HQ/i.test(c.text),
)
await p.close()

state({ state: 'waiting', available: true, can_connect: true })
p = await open()
c = await card(p)
check(
  'waiting with no link on this page (a reload): says so and offers Start again, not a dead Open Slack',
  /no longer has it/i.test(c.text) &&
    c.buttons.includes('Start again') &&
    !c.buttons.includes('Open Slack'),
  c.text.slice(0, 160),
)
await p.close()

// ---- the presses ---------------------------------------------------------------------------------------------------------
state({ state: 'none', available: true, can_connect: true })
p = await open()
gatewayPosts.length = 0
await p.locator('#settings [data-slack-begin]').first().click()
await p
  .waitForFunction("document.querySelector('#settings')?.innerText.includes('Open Slack')", null, {
    timeout: 8000,
  })
  .catch(() => null)
check(
  'Connect sends exactly one action and NOTHING else (no office, workspace, token or state)',
  gatewayPosts.length === 1 &&
    gatewayPosts[0]?.action === 'slack_link_begin' &&
    Object.keys(gatewayPosts[0]?.args ?? {}).length === 0,
  JSON.stringify(gatewayPosts),
)
c = await card(p)
check(
  'and the card moves to Waiting with Slack’s own link and a way to start again',
  /Waiting for you/.test(c.text) && c.hrefs.includes(LINK_URL) && c.buttons.includes('Start again'),
  c.hrefs.join(' | '),
)
check('and says the link works once and for ten minutes', /once and for ten minutes/i.test(c.text))
// the page watches for the result: when the office says connected, the card follows without a reload
slackNow = {
  managed_by_operator: false,
  state: 'connected',
  available: true,
  workspace: 'Acme Studio',
  can_reply: false,
  can_receive: true,
  connected_at: new Date().toISOString(),
}
await p
  .waitForFunction(
    "document.querySelector('#settings')?.innerText.includes('is connected')",
    null,
    { timeout: 12000 },
  )
  .catch(() => null)
c = await card(p)
check(
  'then, when the office says connected, the card follows by itself (it was watching)',
  /Connected/.test(c.text) && c.buttons.includes('Disconnect'),
  c.text.slice(0, 120),
)
await p.close()

state({
  state: 'connected',
  available: true,
  workspace: 'Acme Studio',
  can_receive: true,
  can_reply: false,
  connected_at: new Date().toISOString(),
})
p = await open()
gatewayPosts.length = 0
await p.locator('#settings [data-slack-disconnect]').first().click()
await p.waitForSelector('.stg-confirmbox', { timeout: 5000 })
check(
  'Disconnect asks first, in the page’s own dialog, naming what happens',
  /Disconnect Slack\?/.test(await p.locator('.stg-confirmbox h2').innerText()) && native === 0,
)
await p.locator('.stg-confirmbox [data-no]').click()
await p.waitForTimeout(300)
check('Cancel sends nothing', gatewayPosts.length === 0)
await p.locator('#settings [data-slack-disconnect]').first().click()
await p.waitForSelector('.stg-confirmbox', { timeout: 5000 })
await p.locator('.stg-confirmbox [data-yes]').click()
await p
  .waitForFunction(
    "document.querySelector('#settings')?.innerText.includes('Connect your own Slack')",
    null,
    { timeout: 8000 },
  )
  .catch(() => null)
check(
  'Confirm sends the one action, with nothing else, and the card goes back to Connect',
  gatewayPosts.length === 1 &&
    gatewayPosts[0]?.action === 'slack_link_disconnect' &&
    Object.keys(gatewayPosts[0]?.args ?? {}).length === 0 &&
    (await card(p)).buttons.includes('Connect Slack'),
  JSON.stringify(gatewayPosts),
)
await p.close()

// ---- what Slack's callback said on return -------------------------------------------------------------------------------
state({ state: 'none', available: true, can_connect: true })
for (const [word, expect] of [
  ['refused', /was not connected/i],
  ['failed', /could not finish connecting/i],
  ['connected', /back from Slack/i],
] as const) {
  const q = await open(`&slack=${word}`)
  const c2 = await card(q)
  const url = q.url()
  check(
    `returning with slack=${word}: said in words, and taken out of the address`,
    expect.test(c2.text) && !url.includes('slack='),
    `${c2.text.slice(0, 80)} | ${url}`,
  )
  await q.close()
}
{
  const q = await open('&slack=%3Cscript%3Ealert(1)%3C/script%3E')
  const c2 = await card(q)
  check(
    'CONTROL: anything else in the address is ignored, never shown',
    !/script|alert/i.test(c2.text) &&
      !/back from Slack|was not connected|could not finish/i.test(c2.text),
  )
  await q.close()
}

check(
  'no native browser dialog and no page error',
  native === 0 && errors.length === 0,
  errors.join('; ').slice(0, 160),
)
await browser.close()
server.close()
console.log(failed === 0 ? '\nall passed' : `\n${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
