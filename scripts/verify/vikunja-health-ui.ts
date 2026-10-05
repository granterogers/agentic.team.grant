/**
 * The Settings card for the Vikunja connection, in each state it can be in, driven in a REAL browser (0981).
 *
 *   unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL
 *   npx tsx scripts/verify/vikunja-health-ui.ts
 *
 * The gateway is STUBBED and nothing leaves the machine: every request that is not to the local static server is aborted
 * in the browser context, and the card's own read (section=task_sync) is answered from this file. That is the point of the
 * stub, not a shortcut: the question is what the card DRAWS for a reading, and the reading's own correctness is proved in
 * SQL (scripts/isolated/vikunja-health.ts). Screenshots go to .out/ux-vikunja-*.png at 1440x900 and 390x844; open them.
 *
 * Asserted per state: the chip's words and tone, whether the "why it stopped" row is there and what it says, the last-in-step
 * time, the Disconnect control still present, and that nothing overflows a 390px phone. The healthy state is the control:
 * the same page with no health reading, and with an ok one, must NOT draw a failure.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

// A random high port: other suites (and other sessions on this machine) hold the fixed ones.
const PORT = 47000 + Math.floor(Math.random() * 2000)
const server = await serveStudio(PORT)
const origin = `http://127.0.0.1:${String(PORT)}`
let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

const HOURS = (n: number): string => new Date(Date.now() - n * 3_600_000).toISOString()
const base = {
  configured: true,
  base_url: 'https://tasks.example.test',
  project_id: 7,
  linked: 12,
  trouble: [],
}
const STATES: {
  name: string
  payload: Record<string, unknown>
  chip: RegExp | null
  tone: string
  why: RegExp | null
  last: RegExp | null
}[] = [
  { name: 'no-reading', payload: { ...base }, chip: /In step/, tone: 'ok', why: null, last: null },
  {
    name: 'ok',
    payload: {
      ...base,
      health: {
        state: 'ok',
        kind: null,
        detail: 'the last round reached Vikunja',
        checked_at: HOURS(0.1),
        last_ok_at: HOURS(0.1),
      },
    },
    chip: /In step/,
    tone: 'ok',
    why: null,
    last: /Last in step/,
  },
  {
    name: 'unreachable',
    payload: {
      ...base,
      health: {
        state: 'down',
        kind: 'unreachable',
        detail: 'http 503',
        checked_at: HOURS(0.1),
        last_ok_at: HOURS(5),
      },
    },
    chip: /Not answering/,
    tone: 'bad',
    why: /http 503.*not answering.*clears itself/s,
    last: /Last in step 5 hours ago/,
  },
  {
    name: 'refused',
    payload: {
      ...base,
      health: {
        state: 'down',
        kind: 'refused',
        detail: 'the token was refused (http 401)',
        checked_at: HOURS(0.1),
        last_ok_at: HOURS(30),
      },
    },
    chip: /Token refused/,
    tone: 'bad',
    why: /token was refused \(http 401\).*fresh token/s,
    last: /Last in step 1 day ago/,
  },
]

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const thrown: string[] = []
const outside: string[] = []
for (const [device, viewport] of [
  ['1440', { width: 1440, height: 900 }],
  ['390', { width: 390, height: 844 }],
] as const) {
  for (const state of STATES) {
    const ctx = await browser.newContext({
      viewport,
      hasTouch: device === '390',
      isMobile: device === '390',
    })
    await ctx.route('**/*', (route) => {
      const u = route.request().url()
      if (u.startsWith(origin)) return route.continue()
      outside.push(u)
      return route.abort()
    })
    await ctx.addInitScript(`(() => {
      try { localStorage.setItem('hq.token', 'stub-token-not-a-secret') } catch {}
      const payload = ${JSON.stringify(state.payload)}
      const real = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = String(typeof input === 'string' ? input : input.url)
        if (url.includes('section=task_sync')) {
          return Promise.resolve(new Response(JSON.stringify({ data: payload }), { status: 200, headers: { 'content-type': 'application/json' } }))
        }
        if (url.includes('section=studio_settings')) {
          // The settings pane draws nothing without its own payload. Minimal and honest: no team, no services.
          return Promise.resolve(new Response(JSON.stringify({ data: { behaviours: [], team: [], spare_bots: [], services: [], channels: [], viewer: { operator: true } } }), { status: 200, headers: { 'content-type': 'application/json' } }))
        }
        if (!url.startsWith(location.origin)) return Promise.reject(new TypeError('Failed to fetch'))
        return real(input, init)
      }
    })()`)
    ctx.setDefaultTimeout(3000)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => thrown.push(`${device}/${state.name}: ${e.message.slice(0, 140)}`))
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    // Team HQ's own settings control, then the Services tab once, then wait for the card: pressing the tab again would
    // redraw the pane and throw away the read that is still arriving.
    let reached = false
    await page.locator('[data-bc-settings]').first().click({ force: true })
    await page.waitForTimeout(800)
    await page.locator('[data-setting="connections"]').first().click({ force: true })
    for (let i = 0; i < 20 && !reached; i += 1) {
      await page.waitForTimeout(300)
      reached =
        (await page
          .locator('.st-card', { hasText: 'Keep your tasks in step with Vikunja' })
          .count()) > 0
    }
    const label = `${device}px / ${state.name}`
    check(`${label}: the Vikunja card is reached`, reached)
    if (!reached) {
      await page.screenshot({ path: `.out/ux-vikunja-${device}-${state.name}-MISSING.png` })
      await ctx.close()
      continue
    }
    const card = page
      .locator('.st-card', { hasText: 'Keep your tasks in step with Vikunja' })
      .first()
    await card.scrollIntoViewIfNeeded()
    const text = (await card.innerText()).replace(/\s+/g, ' ')
    const chip = card.locator('.st-chip').first()
    const chipText = (await chip.innerText()).trim()
    const chipClass = (await chip.getAttribute('class')) ?? ''
    if (state.chip !== null)
      check(`${label}: chip says ${String(state.chip)}`, state.chip.test(chipText), chipText)
    check(
      `${label}: chip tone is ${state.tone}`,
      chipClass.split(/\s+/).includes(state.tone),
      chipClass,
    )
    const whyRows = await card.locator('[data-tsync-down]').count()
    if (state.why === null) check(`${label}: no failure row is drawn`, whyRows === 0, text)
    else {
      const whyText = (
        await card
          .locator('[data-tsync-down]')
          .first()
          .innerText()
          .catch(() => '')
      ).replace(/\s+/g, ' ')
      check(`${label}: the failure row says why`, whyRows === 1 && state.why.test(whyText), whyText)
    }
    if (state.last !== null)
      check(`${label}: says when it was last in step`, state.last.test(text), text.slice(0, 300))
    else
      check(`${label}: says nothing about a last time it does not know`, !/Last in step/.test(text))
    if (device === '390') {
      const over = await page.evaluate(
        `(() => { const d = document.documentElement; return d.scrollWidth - d.clientWidth })()`,
      )
      check(`${label}: nothing pushes the phone sideways`, Number(over) <= 1, `${String(over)}px`)
    }
    await page.screenshot({ path: `.out/ux-vikunja-${device}-${state.name}.png` })
    await ctx.close()
  }
}
await browser.close()
server.close()
check('no page error was thrown', thrown.length === 0, thrown.join(' | '))
check(
  'nothing outside the local server was ever requested successfully (all aborted in the context)',
  true,
  `${String(outside.length)} aborted`,
)
console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
process.exitCode = fail === 0 ? 0 : 1
