/**
 * The page, in a real browser, on a real phone-sized screen.
 *
 *   npm run verify:ui
 *
 * ## Why this exists
 *
 * Grant, on the front end: *"overloaded; text-heavy; cramped; old-fashioned;
 * difficult to scan; poorly adapted to mobile."* And, on the thing he suspected
 * was broken: *"Do not consider this resolved simply because the component
 * renders."*
 *
 * He was right to distrust it, and the reason is embarrassing: this repository
 * had 777 unit tests and **not one of them had ever opened the page**. Every
 * check ran against Node. So the layout was whatever it happened to be, on
 * whatever screen someone last looked at, and three measurable defects had been
 * shipping for weeks:
 *
 *     533px of content inside a 390px viewport   (Connections, iPhone 14)
 *     text at 10.5px and 11.5px                   (every tab, every viewport)
 *     controls as small as 62 x 26                (five tabs)
 *
 * None of those is a matter of taste. Each is a number, and a number can be
 * asserted, which is what this file does.
 *
 * ## What it asserts
 *
 * Per viewport, per tab: no horizontal overflow, no text below 12px, no
 * interactive control below the 44px touch floor on a touch device, and no
 * uncaught JavaScript.
 *
 * ## Why the data is stubbed and the page is not
 *
 * The HTML, CSS and JavaScript are the real deployed page. Only the API
 * responses are replaced, and they are replaced with **real rows** captured
 * from the `app.hq_*` functions — because a layout check against an empty
 * dashboard tests nothing, and the overflow above was caused by the length of a
 * real note about a real parked service.
 *
 * Stubbing also means the check needs no dashboard password, which is what lets
 * it run in the ordinary verify suite rather than only by hand.
 *
 * ## Why it serves the page locally
 *
 * Chromium in this sandbox cannot tunnel to the deployment (the relay drops
 * CONNECT for it; `curl` to the same host is fine). So the file is served from
 * `web/hq/index.html` on a loopback port. That is a better test anyway: it
 * checks what is about to be deployed rather than what was deployed last time.
 */

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium, devices } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = Number(process.env.UI_VERIFY_PORT ?? 8971)

/** Every tab in the menu. Named here so a new tab that is never checked is a */
/** visible omission rather than a silent one. */
const TABS = [
  'overview',
  'projects',
  'staff',
  'connections',
  'activity',
  'output',
  'trends',
  'usage',
  'settings',
  'routing',
  'talk',
] as const

/** The floors. Each one is a defect this check was written to catch. */
const MIN_FONT_PX = 12
const MIN_TAP_PX = 44

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

// ===========================================================================
// Real rows, so the layout is tested against real lengths
// ===========================================================================

const SECTIONS = [
  ['overview', 'hq_overview'],
  ['series', 'hq_series'],
  /*
    `hq_team`, not `hq_staff`.

    The page's staff tab asks for section `team`, which the API serves from
    `app.hq_team()` — the payload with the roster, the bot assignments, the tool
    grants and the written-down procedures on it. This list fed it `hq_staff()`
    instead, whose shape is entirely different, so the team tab has been laid
    out here against a payload the page never receives: no tool boxes, no bot
    pickers, no procedures, and every one of those rendered as nothing at all.
    A layout check that renders an empty card passes.
  */
  ['team', 'hq_team'],
  ['activity', 'hq_activity'],
  ['usage', 'hq_usage'],
  ['connections', 'hq_connections'],
  ['projects', 'hq_projects'],
  ['artifacts', 'hq_artifacts'],
  ['settings', 'hq_settings'],
  ['routing', 'hq_routing'],
] as const

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const sections: Record<string, unknown> = {}
for (const [name, fn] of SECTIONS) {
  const { rows } = await db.execute(`select app.${fn}() as d`)
  sections[name] = (rows[0] as { d: unknown }).d
}
console.log(`Captured ${String(Object.keys(sections).length)} sections of real data.\n`)

// ===========================================================================
// Serve the page as it stands in the working tree
// ===========================================================================

const html = readFileSync('web/hq/index.html')
const server = createServer((_request, response) => {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
  })
  response.end(html)
})
await new Promise<void>((resolve) => server.listen(PORT, resolve))

// ===========================================================================
// The viewports
// ===========================================================================
//
// A phone, a tablet and a desktop, because §5 asks for three explicit states
// and "it reflows" is the answer this check exists to reject.

const VIEWPORTS = [
  ['iPhone 14', devices['iPhone 14'], true],
  ['iPad', devices['iPad (gen 7)'], true],
  ['desktop', { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false }, false],
] as const

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })

/** What the page is measured for, in the page's own context. */
const MEASURE = `() => {
  const de = document.documentElement
  const width = de.clientWidth

  // Horizontal overflow, reported as the DEEPEST offenders — the elements that
  // are too wide and have no child that is also too wide. The parents of an
  // overflowing element are all overflowing too, and naming them buries the
  // one line worth reading.
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.right <= width + 2 && r.width <= width + 2) continue
    const child = [...el.children].some((k) => {
      const kr = k.getBoundingClientRect()
      return kr.right > width + 2 || kr.width > width + 2
    })
    if (!child) over.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).join('.') : '') + ' (' + Math.round(r.width) + 'px)')
  }

  // Text below the floor. Leaf elements only: an ancestor reports the computed
  // size it would give a text node, not a size anything is actually set in.
  const tiny = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0) continue
    const text = (el.textContent ?? '').trim()
    if (text.length < 3) continue
    const size = Number.parseFloat(getComputedStyle(el).fontSize)
    if (size > 0 && size < ${String(MIN_FONT_PX)}) tiny.push(size + 'px "' + text.slice(0, 26) + '"')
  }

  // Controls under the touch floor. Hidden ones are skipped: a control in a
  // closed menu has no size and is not a target.
  const small = []
  for (const el of document.querySelectorAll('button, select, textarea, input, a[href], [role="button"]')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    // A checkbox carries its own 17px box and the label around it is the real
    // target, so the box is not the thing to measure.
    if (el.type === 'checkbox' || el.type === 'radio') continue
    // A link inside a sentence is not a tap target in this sense — it sits in a
    // line box and grows the paragraph if you force it taller. Only links that
    // are laid out as their own object are held to the floor.
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue
    if (r.height < ${String(MIN_TAP_PX)}) {
      small.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + ((el.textContent ?? el.value ?? el.tagName) + '').trim().slice(0, 20) + '"')
    }
  }

  return {
    scrollWidth: de.scrollWidth,
    clientWidth: width,
    over: [...new Set(over)].slice(0, 5),
    tiny: [...new Set(tiny)].slice(0, 5),
    small: [...new Set(small)].slice(0, 5),
    chars: (document.body.innerText || '').length,
  }
}`

for (const [label, device, touch] of VIEWPORTS) {
  const context = await browser.newContext({ ...(device as Record<string, unknown>) })
  const page = await context.newPage()

  // The token gets the page past its own gate; the fetch shim answers with the
  // captured rows. Both in an init script so they are in place before the
  // page's first line runs.
  await page.addInitScript(`
    window.__SECTIONS = ${JSON.stringify(sections)};
    try { localStorage.setItem('hq.token', 'verify-ui'); } catch (e) {}
    const passThrough = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('hq-api')) {
        const section = /section=([a-z]+)/.exec(url);
        const body = section
          ? { data: window.__SECTIONS[section[1]] ?? {} }
          : { result: { ok: true } };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // Anything else — the voice mint, an avatar — is not this check's
      // business and must not reach the network from a test.
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
  `)

  const crashes: string[] = []
  page.on('pageerror', (error) => crashes.push(error.message.slice(0, 120)))

  await page.goto(`http://127.0.0.1:${String(PORT)}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForTimeout(2_000)

  for (const tab of TABS) {
    // Clicked the way a person clicks it — by the label in the menu — rather
    // than by calling the render function. A tab that cannot be reached is a
    // failure, and calling `show()` directly would hide that.
    const reached = (await page.evaluate(`(() => {
      const wanted = ${JSON.stringify(tab)};
      const control = [...document.querySelectorAll('a,button,[data-tab],[data-section]')].find(
        (el) =>
          el.getAttribute('data-tab') === wanted ||
          el.getAttribute('data-section') === wanted ||
          (el.textContent ?? '').trim().toLowerCase() === wanted,
      );
      if (control === undefined) return false;
      control.click();
      return true;
    })()`)) as boolean

    if (!reached) {
      record(`${label} · ${tab}`, 'no control in the menu opens this tab', false)
      continue
    }
    await page.waitForTimeout(900)

    const m = (await page.evaluate(`(${MEASURE})()`)) as {
      scrollWidth: number
      clientWidth: number
      over: string[]
      tiny: string[]
      small: string[]
      chars: number
    }

    const faults: string[] = []
    if (m.scrollWidth > m.clientWidth + 2) {
      faults.push(
        `overflows to ${String(m.scrollWidth)}px in ${String(m.clientWidth)}px — ${m.over.join(', ')}`,
      )
    }
    if (m.tiny.length > 0) faults.push(`text under ${String(MIN_FONT_PX)}px — ${m.tiny.join(', ')}`)
    if (touch && m.small.length > 0) {
      faults.push(`targets under ${String(MIN_TAP_PX)}px — ${m.small.join(', ')}`)
    }
    if (m.chars < 40) faults.push(`rendered almost nothing (${String(m.chars)} characters)`)

    record(
      `${label} · ${tab}`,
      faults.length === 0 ? `clean (${String(m.chars)} chars)` : faults.join(' ;; '),
      faults.length === 0,
    )
  }

  record(
    `${label} · no uncaught JavaScript`,
    crashes.length === 0 ? 'none' : [...new Set(crashes)].join(' ;; '),
    crashes.length === 0,
  )
  await context.close()
}

await browser.close()
server.close()

// ===========================================================================

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)

process.exit(passed === checks.length ? 0 : 1)
