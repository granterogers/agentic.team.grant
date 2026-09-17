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

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const PORT = Number(process.env.UI_VERIFY_PORT ?? 8971)

/*
  Every screen a person can reach, named here so a new one that is never checked
  is a visible omission rather than a silent one.

  Retargeted from `web/hq/index.html` to the studio (#68, ADR-0019). The studio
  is what is served at the root now, and a check pointed at a file nobody can
  open is the failure this repository has already made three times — it is in
  CLAUDE.md as a pattern.

  Three kinds of destination, because the studio has three. A `view` is a rail
  item; a `tab` is a section of the open project; a `pane` is inside the
  settings sheet. The call is a sheet of its own and is last, because opening it
  asks for a microphone.
*/
const ROUTES = [
  { kind: 'view', at: 'portfolio', name: 'all projects' },
  // The desk was here. Removed with the view itself (#77).
  { kind: 'view', at: 'lately', name: 'lately' },
  { kind: 'tab', at: 'overview', name: 'project · overview' },
  { kind: 'tab', at: 'team', name: 'project · AI team' },
  { kind: 'tab', at: 'documents', name: 'project · documents' },
  { kind: 'tab', at: 'tasks', name: 'project · tasks' },
  { kind: 'tab', at: 'contacts', name: 'project · contacts' },
  { kind: 'tab', at: 'sources', name: 'project · sources' },
  // Activity was removed as a section by #222; its panel lives on Overview.
  { kind: 'pane', at: 'team', name: 'settings · team' },
  { kind: 'pane', at: 'behaviour', name: 'settings · behaviour' },
  { kind: 'pane', at: 'governance', name: 'settings · governance' },
  { kind: 'pane', at: 'connections', name: 'settings · connections' },
  { kind: 'pane', at: 'channels', name: 'settings · channels' },
  { kind: 'pane', at: 'models', name: 'settings · usage' },
  { kind: 'pane', at: 'appearance', name: 'settings · appearance' },
  { kind: 'pane', at: 'setup', name: 'settings · setting up' },
  { kind: 'pane', at: 'help', name: 'settings · help' },
  /*
    THE CALL IS NOT A SCREEN, so it is not a route here.

    There was a `{ kind: 'call', name: 'the call' }` row until #123's panel
    measure started naming what it had looked at, and it turned out to be
    looking at the settings help pane — then, once Settings was shut first, at
    whatever section happened to be open. Never at a call.

    It could not have been: #214 turned Call the Team into an INLINE TOGGLE in
    the rail, `drawShell` has no `call` view, and pressing `[data-call]` starts
    a call rather than navigating anywhere. So the row was green about nothing,
    and pressed the microphone on every run of this suite to get there.

    The same defect as the command bar offering "Desk" after #77 removed it,
    in the audit rather than in the product. The voice call has its own suite —
    `npm run verify:talk`, which drives a real call — and the toggle is a
    control, which is `verify:controls`'s job.
  */
] as const

/** The floors. Each one is a defect this check was written to catch. */
/*
  The least a section may say and still be an empty STATE rather than a hole.

  "Nothing to do on Wellness yet." plus its one action is about eighty
  characters, so forty is a floor that a real empty state clears comfortably
  and a section rendering nothing cannot (#123).
*/
const EMPTY_STATE_FLOOR = 40

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

/*
  The payloads the studio actually asks for.

  Three, not eleven: the studio paints its whole shell from one call rather than
  one per tab — 0120's argument that a page fetching per section feels broken
  while being correct. `studio_setup` is separate because it is a checklist about
  credentials rather than a page of preferences.

  Named by the section the PAGE requests, which is the correction that mattered
  last time this list was wrong: it fed the staff tab `hq_staff()` while the page
  asked for `team`, so the tool grid rendered as nothing and passed.
*/
const SECTIONS = [
  ['studio', 'hq_studio'],
  ['studio_settings', 'hq_studio_settings'],
  ['usage_overview', 'usage_overview'],
  ['studio_setup', 'hq_setup'],
  ['lately', 'hq_studio_lately'],
  /*
    #54. Its own payload, and it must be fed as `governance` — the name the
    PAGE asks for — not as `hq_governance`. That correction is the whole reason
    this list is keyed on the section rather than the function: the staff tab
    was once fed `hq_staff()` while the page requested `team`, a completely
    different shape, and every card rendered empty and passed for months.
  */
  ['governance', 'hq_governance'],
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
  // Two of these take an argument, and calling them without one is a different
  // function that does not exist. Written out rather than defaulted, for the
  // reason every public wrapper in this codebase is: the caller is the half
  // that silently drops a parameter.
  const args =
    fn === 'usage_overview'
      ? '30'
      : fn === 'hq_studio_lately'
        ? '40'
        : fn === 'hq_governance'
          ? '40'
          : ''
  const { rows } = await db.execute(`select app.${fn}(${args}) as d`)
  sections[name] = (rows[0] as { d: unknown }).d
}
console.log(`Captured ${String(Object.keys(sections).length)} sections of real data.\n`)

// ===========================================================================
// Serve the page as it stands in the working tree
// ===========================================================================

/*
  The whole directory, not one file.

  `web/hq/index.html` was a single self-contained page and could be served as a
  string. The studio is a page plus thirty files — modules, three stylesheets,
  two self-hosted fonts — and serving only the HTML gives a blank screen and a
  suite that reports "rendered almost nothing" on every route.
*/
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}
const server = createServer((request, response) => {
  let file = join('web/studio', decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
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
  /*
    What is behind an open sheet is measured by nothing.

    The studio scales the shell by a fraction while a sheet is over it, so a
    44px tab measured 43.7 and every settings screen reported five failures for
    controls a person cannot reach at all. Measuring what is covered is the same
    error as measuring what is display:none, in a subtler disguise.

    The class "behind" on the body is the studio's own single fact about this,
    set in one place and read by the CSS, so the audit reads it too rather than
    inferring from a transform.

    No backticks in this string. It is a template literal.
  */
  const behind = document.body.classList.contains('behind')
  const sheets = [...document.querySelectorAll('.viewer:not([hidden])')]
  const covered = (el) => behind && !sheets.some((v) => v.contains(el))

  const tiny = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0) continue
    const text = (el.textContent ?? '').trim()
    if (text.length < 3) continue
    /*
      Text inside an SVG is drawn at the drawing's scale, not the interface's.

      The document cards show a little picture of a page, and the page has its
      title on it — 11px, because it is a page shrunk to 172px wide. Holding
      that to the UI type floor would mean a simulated page title larger than
      the simulated page, which is not the accessibility win it looks like: it
      is not text anybody reads, it is a picture of text.

      The same exclusion npm run wide already makes for SVG geometry, and for
      the same reason: the element is not in the coordinate system the rule is
      about. Text in a real control is still caught, because a real control is
      not inside an svg.
    */
    if (el.closest('svg') !== null) continue
    // Behind an open sheet is not text you are reading, for the same reason it
    // is not a target you can tap.
    if (covered(el)) continue
    const size = Number.parseFloat(getComputedStyle(el).fontSize)
    if (size > 0 && size < ${String(MIN_FONT_PX)}) tiny.push(size + 'px "' + text.slice(0, 26) + '"')
  }

  // Controls under the touch floor. Hidden ones are skipped: a control in a
  // closed menu has no size and is not a target.
  const small = []
  /*
    What is behind an open sheet is not a target.

    The studio scales the shell by a fraction while a sheet is over it, so a
    44px tab measured 43.7 and every settings screen reported five failures for
    controls a person cannot reach at all. Measuring what is covered is the same
    error as measuring what is display:none, wearing a subtler disguise.

    The class "behind" on the body is the studio's own single fact about this —
    set in one place and read by the CSS — so the audit reads it too rather than
    inferring from a transform.

    No backticks anywhere in this string. It is a template literal, and a
    backtick ends it.
  */
  for (const el of document.querySelectorAll('button, select, textarea, input, a[href], [role="button"]')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (covered(el)) continue
    // A checkbox carries its own 17px box and the label around it is the real
    // target, so the box is not the thing to measure.
    if (el.type === 'checkbox' || el.type === 'radio') continue
    // A link inside a sentence is not a tap target in this sense — it sits in a
    // line box and grows the paragraph if you force it taller. Only links that
    // are laid out as their own object are held to the floor.
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue
    if (r.height < ${String(MIN_TAP_PX)}) {
      /*
        One decimal, because a 43.6px control rounded to "44x44" reads as a
        check that cannot count. Sub-pixel misses are the commonest kind — a
        padding and a line-height that sum to just under — and a report that
        hides them sends you looking for the wrong bug.
      */
      const dp = (n) => (Math.round(n * 10) / 10).toString()
      small.push(dp(r.width) + 'x' + dp(r.height) + ' "' + ((el.textContent ?? el.value ?? el.tagName) + '').trim().slice(0, 20) + '"')
    }
  }

  return {
    scrollWidth: de.scrollWidth,
    clientWidth: width,
    over: [...new Set(over)].slice(0, 5),
    tiny: [...new Set(tiny)].slice(0, 5),
    small: [...new Set(small)].slice(0, 5),
    chars: (document.body.innerText || '').length,
    /*
      The SECTION's own words, which is what #123 is actually about.

      The chars measure above takes the whole document, and the whole document
      always has the rail, the header, the project switcher and Call the team
      in it - the smallest screen in a passing run reported 361 characters
      against a floor of 40, so that floor could not fire for the case it was
      written for: a section that renders nothing.

      No backticks in this comment: it lives inside a template literal.

      An empty state is the difference between "nothing here yet, add someone"
      and a blank rectangle that looks exactly like a broken one. Measured on
      the panel, an empty section with an empty state is ~80 characters and one
      without is ~0.

      The container is NAMED in the result rather than assumed, because a
      missing selector measures zero and zero fails — which is the right
      direction to fail in, and unreadable unless the report says the panel was
      not found rather than that the page was blank.
    */
    panel: (() => {
      /*
        The FRONT-MOST surface, not whatever main happens to hold.

        The first version took main unconditionally and every settings pane
        reported the same 476 characters - the project section still sitting
        behind the Settings page. Ten of seventeen rows were passing for the
        wrong reason, measuring a screen nobody was looking at. That is the
        trap this repository records most often: verify:ui once fed the staff
        tab hq_staff while the page asked for hq_team, and verify:controls
        pressed the rail behind an open sheet for weeks.

        So the same rule verify:controls arrived at in #190: find what is in
        front, and measure that.
      */
      const order = ['#settings .setbody', '#viewer .docbody', '#viewer', 'main', '.main']
      for (const sel of order) {
        const box = document.querySelector(sel)
        if (box === null) continue
        const r = box.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        return { found: true, where: sel, chars: (box.innerText || '').length }
      }
      return { found: false, where: 'none', chars: 0 }
    })(),
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
        const section = /section=([a-z_]+)/.exec(url);
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

  /*
    Open a project once, so the seven project tabs have something to be tabs of.

    Clicked, not called: `render()` from the outside would prove the function
    works and nothing about whether the control that reaches it does. The whole
    value of this suite is that it presses things.
  */
  await page.evaluate(`document.querySelector('[data-open]')?.click()`)
  await page.waitForTimeout(900)

  for (const route of ROUTES) {
    // A project card opens through a view transition, so the tab it reveals is
    // not in the DOM in the same tick.
    if (route.kind === 'tab') {
      await page.evaluate(
        `document.querySelector('[data-tab]') ? null : document.querySelector('[data-open]')?.click()`,
      )
      await page.waitForTimeout(700)
    }

    const reached = (await page.evaluate(`(() => {
      const kind = ${JSON.stringify(route.kind)};
      const at = ${JSON.stringify(route.at)};
      const press = (el) => { if (!el) return false; el.click(); return true; };

      /*
        Shut Settings before going anywhere that is not Settings.

        #158 made Settings a PAGE, and this loop walks its seven panes before
        reaching the call - so the call was being measured with the help pane
        still in front of it, and reported the help pane's 4416 characters as
        its own. The row was green and about the wrong screen.

        shutDock in #103 and openRail in #183 exist for exactly this, and #190
        is the note about doing it BEFORE anything reads the page rather than
        just before the press. Third instance; the only new thing is that the
        measure now names what it looked at, which is how this one showed up.
      */
      if (kind !== 'pane') {
        const shut = document.querySelector('#settings .close');
        if (shut && shut.getBoundingClientRect().width > 1) shut.click();
      }

      if (kind === 'view') {
        return press(document.querySelector('[data-go="' + at + '"]'));
      }
      if (kind === 'tab') {
        /*
          Open a project first, every time.

          Opening it once before the loop was not enough: the rail routes that
          run first navigate away, so by the time the tabs came round there was
          no project on screen and all seven reported "no control reaches this
          screen" — the suite blaming the page for its own state.
        */
        if (!document.querySelector('[data-tab]')) {
          const card = document.querySelector('[data-open]');
          if (!card) return false;
          card.click();
        }
        return press(document.querySelector('[data-tab="' + at + '"]'));
      }
      // A settings pane: open the sheet, then the pane.
      const opener = document.querySelector('[data-settings]');
      if (opener) opener.click();
      return press(document.querySelector('[data-setting="' + at + '"]'));
    })()`)) as boolean

    const tab = route.name

    if (!reached) {
      record(`${label} · ${tab}`, 'no control reaches this screen', false)
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
      panel: { found: boolean; where: string; chars: number }
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
    /*
      #123: a section that is empty because it is new must not look identical
      to one that is empty because it is broken. The floor is on the panel
      rather than on the page, and it is the empty STATE that clears it.
    */
    if (!m.panel.found) faults.push('no main panel on this screen to measure')
    else if (m.panel.chars < EMPTY_STATE_FLOOR) {
      faults.push(
        `the section itself says almost nothing (${String(m.panel.chars)} characters) — ` +
          'an empty section needs an empty state, or it reads as a broken one',
      )
    }
    /*
      CONTROL: the panel is a strict SUBSET of the page.

      Without this, someone pointing the panel measure back at `document.body`
      would restore the old inert floor and every row would still read clean —
      which is precisely how the floor came to be inert in the first place.
    */
    if (m.panel.found && m.panel.chars >= m.chars) {
      faults.push(
        `the panel measure is not measuring the panel (${String(m.panel.chars)} of ` +
          `${String(m.chars)} page characters)`,
      )
    }

    record(
      `${label} · ${tab}`,
      faults.length === 0
        ? `clean (${String(m.panel.chars)} in ${m.panel.where}, ${String(m.chars)} on the page)`
        : faults.join(' ;; '),
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
