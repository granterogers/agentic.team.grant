/**
 * The Browser surface, rendered and photographed (#135, #16).
 *
 *   npm run shot:browser
 *
 * CLAUDE.md: a screen with no capture is a screen nothing is watching, and
 * `npm run shots` does not reach this one — it lives inside a project's
 * Sources, below the fold, and is drawn only when the project HAS browsing to
 * show. Every state below is therefore invisible to every existing capture.
 *
 * ## Why it is stubbed, and why the stub is not the thing the product forbids
 *
 * `needSites` deliberately has no prototype fallback: an invented signed-in
 * session would be a claim that the office holds a credential for a site, and
 * that is the one fiction a screenshot of this page must never contain. That
 * rule is about the PRODUCT inventing data for the person looking at it. This
 * is a capture harness feeding stated rows through the same interception
 * `verify:ui` uses, so what is photographed is the real renderer over known
 * input, and nobody is being told a session exists.
 *
 * Four states in one frame, because the ones that go wrong are never the happy
 * one: something running with a Stop, a stop already asked for, something
 * parked waiting for Grant, and pages already read with their thumbnails.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = Number(process.env.SHOT_BROWSER_PORT ?? 8973)
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

mkdirSync('.out', { recursive: true })

/*
  The shell's own payload, from the real database.

  The first version of this capture stubbed only the browser_* sections and
  photographed four perfectly good PNGs of the wrong screen — `found: false` on
  every one, because with a token set the page draws no prototype projects, so
  there was no project card to open and no Sources tab to reach. Keyed by the
  name the PAGE asks for, which is the correction `verify:ui` carries in
  capitals: it once fed the staff tab a function of a different shape and every
  card rendered empty and passed for months.
*/
const access = process.env.SUPABASE_ACCESS_TOKEN
if (access === undefined || access === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required: the shell is drawn from real rows')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  access,
)
// P3: these read the dashboard of the person whose pages are being captured, so they name that office first.
const OFFICE_FIRST = new Set(['hq_studio', 'usage_overview', 'hq_studio_lately'])
const callOf = (fn: string, args: string): string =>
  `app.${fn}(${OFFICE_FIRST.has(fn) ? `app.operator_office()${args === '' ? '' : `, ${args}`}` : args})`
const shell: Record<string, unknown> = {}
for (const [name, fn, args] of [
  ['studio', 'hq_studio', ''],
  ['studio_settings', 'hq_studio_settings', ''],
  ['lately', 'hq_studio_lately', '40'],
] as const) {
  const { rows } = await db.execute(`select ${callOf(fn, args)} as d`)
  shell[name] = (rows[0] as { d: unknown }).d
}

const server = createServer((request, response) => {
  let file = join('web/studio', decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  // A dotless path is a route, as on the host (#382: the older studio is under /classic).
  if (!existsSync(file) && extname(file) === '') file = join('web/studio', 'index.html')
  if (!existsSync(file)) {
    response.writeHead(404)
    response.end('not here')
    return
  }
  const body = readFileSync(file)
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
  })
  response.end(body)
})
await new Promise<void>((resolve) => server.listen(PORT, resolve))

/*
  A 1x1 PNG built from bytes, so the capture needs no network and no storage.
  What is being judged is the FRAME — its size, its place in the row, whether
  several of them read as a column you can scan — and a real page photograph
  would not change any of that.
*/
const DOT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()

const SECTIONS: Record<string, unknown> = {
  ...shell,
  browser_budget: { cap_minutes: 10, exhausted: false, left_minutes: 7.4 },
  browser_lately: [
    {
      at: ago(3_600_000),
      detail: 'read',
      ms: 1840,
      ok: true,
      shot_url: DOT,
      url: 'https://supplier.example.com/orders/september',
      verb: 'read',
    },
    {
      at: ago(7_200_000),
      detail: 'photographed',
      ms: 2960,
      ok: true,
      shot_url: DOT,
      url: 'https://supplier.example.com/invoices/2026-09',
      verb: 'shot',
    },
    {
      at: ago(90_000_000),
      detail: 'the site asked for a sign-in (http 200)',
      ms: 620,
      ok: false,
      shot_url: null,
      url: 'https://www.coachaccountable.com/clients',
      verb: 'read',
    },
  ],
  browser_now: [
    {
      job_id: '11111111-1111-4111-8111-111111111111',
      since: ago(42_000),
      site: 'supplier.example.com',
      state: 'running',
      stop_asked: false,
      url: 'https://supplier.example.com/orders/october',
      waiting_for_you: false,
    },
    {
      job_id: '22222222-2222-4222-8222-222222222222',
      since: ago(260_000),
      site: 'coachaccountable.com',
      state: 'running',
      stop_asked: true,
      url: 'https://www.coachaccountable.com/clients',
      waiting_for_you: false,
    },
    {
      job_id: '33333333-3333-4333-8333-333333333333',
      since: ago(900_000),
      site: 'instagram.com',
      state: 'waiting_user',
      stop_asked: false,
      url: 'https://www.instagram.com/accounts/login/',
      waiting_for_you: true,
    },
  ],
  browser_sessions: [
    {
      has_credential: true,
      last_alive_at: ago(3_600_000),
      purpose: 'Read the weekly order confirmations so Daniel can reconcile them',
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      site: 'supplier.example.com',
      state: 'live',
    },
    {
      has_credential: false,
      last_alive_at: null,
      purpose: 'Pull the client session notes into the project record each Monday',
      session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      site: 'coachaccountable.com',
      state: 'needs_sign_in',
    },
  ],
}

const browser = await chromium.launch({ executablePath: CHROMIUM })
let drew = 0

for (const [label, device] of [
  ['desktop', { viewport: { height: 1000, width: 1440 } }],
  ['phone', devices['iPhone 14']],
] as const) {
  for (const scheme of ['dark', 'light'] as const) {
    const context = await browser.newContext({ ...(device as Record<string, unknown>) })
    const page = await context.newPage()
    // The page has to know which office it belongs to before its first line
    // runs, or the shim below never sees a URL with hq-api in it. ADR-0048.
    await page.addInitScript(namesAnOffice())

    await page.addInitScript(`
      window.__SECTIONS = ${JSON.stringify(SECTIONS)};
      try {
        localStorage.setItem('hq.token', 'shot-browser');
      } catch (e) {}
      window.fetch = (input, init) => {
        const url = String(input);
        if (url.includes('hq-api')) {
          /*
            Record what an ACTION was asked to do, so the sign-in check can
            assert the wiring rather than guessing from a side effect. The jar
            is recorded only as "a jar was sent" -- writing the value into a
            harness array would put a session in a log, which is the thing the
            form exists to avoid.
          */
          try {
            const body = init && init.body ? JSON.parse(String(init.body)) : null;
            if (body && body.action) {
              window.__sent = window.__sent || [];
              window.__sent.push({
                action: body.action,
                site: body.args ? body.args.p_site : undefined,
                jarSent: !!(body.args && typeof body.args.p_jar === 'string' && body.args.p_jar.length > 10),
              });
            }
          } catch (e) {}
          const section = /section=([a-z_]+)/.exec(url);
          const body = section
            ? { data: window.__SECTIONS[section[1]] ?? {} }
            : { result: { ok: true } };
          return Promise.resolve(new Response(JSON.stringify(body), {
            status: 200, headers: { 'content-type': 'application/json' },
          }));
        }
        return Promise.resolve(new Response('{}', {
          status: 200, headers: { 'content-type': 'application/json' },
        }));
      };
    `)
    const crashes: string[] = []
    page.on('pageerror', (error) => crashes.push(error.message.slice(0, 140)))

    await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      `document.documentElement.setAttribute('data-scheme', ${JSON.stringify(scheme)})`,
    )
    /*
      Open a project FIRST, then its Sources tab.

      A project card opens through a view transition, so the tab it reveals is
      not in the DOM in the same tick — `verify:ui` learned this and the note
      is worth repeating, because pressing the tab selector on the home board
      simply matches nothing and the capture succeeds at photographing the
      wrong screen.
    */
    await page.waitForTimeout(900)
    await page.evaluate(
      `document.querySelector('[data-tab]') ? null : document.querySelector('[data-open]')?.click()`,
    )
    await page.waitForTimeout(900)
    const opened = await page.evaluate(`(() => {
      const t = document.querySelector('[data-tab="sources"]')
      if (!t) return false
      t.click()
      return true
    })()`)
    if (opened !== true) console.log(`  (${label}/${scheme}: no Sources tab to press)`)
    await page.waitForTimeout(1600)

    /*
      Named, and reported. A capture of a screen the block is not on is the
      found-nothing shape: a perfectly good PNG of the wrong thing.
    */
    const found = await page.evaluate(`(() => {
      const el = document.querySelector('.bsites')
      if (el === null) return { found: false }
      el.scrollIntoView({ block: 'start' })
      return {
        found: true,
        height: Math.round(el.getBoundingClientRect().height),
        live: document.querySelectorAll('.bnow').length,
        stops: document.querySelectorAll('[data-stop-job]').length,
        thumbnails: document.querySelectorAll('.bshot').length,
        brow: (() => {
          const r = document.querySelector('.brow')
          if (!r) return 'none'
          const cs = getComputedStyle(r)
          return {
            cols: cs.gridTemplateColumns,
            kids: r.children.length,
            names: [...r.children].map((c) => c.className || c.tagName),
          }
        })(),
      }
    })()`)
    await page.waitForTimeout(400)

    /*
      ------------------------------------------------------ the sign-in form

      Pressed, not merely rendered, and only once — on the desktop dark pass —
      because what is being checked is wiring rather than layout.

      `browser_session_establish` sat unpressed for the life of the feature
      behind a baselined reason that was false, so a capture that only
      photographs the new control would be the same mistake with a picture.
      The two things that can silently break here are that the opener does not
      reveal the form, and that the pasted session is left in the DOM — where
      it would sit as a live credential for as long as the page is open and
      appear in every screenshot of this screen.
    */
    if (label === 'desktop' && scheme === 'dark') {
      const JAR = `SESSIONJARCANARY-${'x'.repeat(40)}`
      const wiring = await page.evaluate(`(async () => {
        const fill = (jar) => {
          document.querySelector('[data-signin-open]').click()
          document.querySelector('[data-si-site]').value = 'supplier.example.com'
          document.querySelector('[data-si-purpose]').value = 'Read the weekly order confirmations'
          document.querySelector('[data-si-jar]').value = jar
        }
        const opener = document.querySelector('[data-signin-open]')
        if (!opener) return { opened: false, why: 'no opener control' }

        /*
          SUBMIT first, and what is asserted about it is the WIRING: which
          action was called and with what. Asserting that the field is empty
          afterwards looks like a security check and is inert — the submit
          path calls refresh(), which redraws the form, so the textarea being
          measured is a brand new node that was never filled in. Proved by
          removing the clearing line: the check stayed green.
        */
        fill(${JSON.stringify(JAR)})
        window.__sent = []
        document.querySelector('[data-si-go]').click()
        await new Promise((r) => setTimeout(r, 900))

        /*
          CANCEL is where the clearing can actually be observed, because
          nothing re-renders: the same node that held the jar is still there.
        */
        fill(${JSON.stringify(JAR)})
        document.querySelector('[data-si-cancel]').click()
        await new Promise((r) => setTimeout(r, 200))
        const field = document.querySelector('[data-si-jar]')
        return {
          opened: true,
          sent: window.__sent,
          afterCancelInDom: document.documentElement.outerHTML.includes(${JSON.stringify(JAR)}),
          afterCancelInField: (field ? field.value : '') !== '',
        }
      })()`)
      console.log(`  sign-in form: ${JSON.stringify(wiring)}`)
      const w = wiring as {
        opened: boolean
        why?: string
        sent?: { action?: string; site?: string; jarSent?: boolean }[]
        afterCancelInDom?: boolean
        afterCancelInField?: boolean
      }
      if (!w.opened) throw new Error(`the sign-in control did not open the form: ${w.why ?? ''}`)
      const call = (w.sent ?? [])[0]
      if (call?.action !== 'browser_session_establish') {
        throw new Error(
          `the form pressed ${String(call?.action ?? 'nothing')}, not browser_session_establish`,
        )
      }
      if (call.site !== 'supplier.example.com') throw new Error('the site did not reach the action')
      if (call.jarSent !== true) throw new Error('the session jar did not reach the action')
      if (w.afterCancelInField === true) throw new Error('the jar field was not cleared on cancel')
      if (w.afterCancelInDom === true) {
        throw new Error('THE PASTED SESSION IS STILL IN THE DOM after cancelling')
      }
      await page.evaluate(`document.querySelector('[data-signin-open]')?.click()`)
      await page.waitForTimeout(400)
    }

    const file = `.out/browser-${label}-${scheme}.png`
    await page.screenshot({ path: file })
    drew++
    console.log(
      `${file}  ${JSON.stringify(found)}${crashes.length === 0 ? '' : `  PAGE ERRORS: ${crashes.join(' | ')}`}`,
    )
    await context.close()
  }
}

await browser.close()
server.close()
console.log(`\n${String(drew)} capture(s) in .out/`)
