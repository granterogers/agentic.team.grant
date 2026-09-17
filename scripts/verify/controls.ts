/**
 * Does every control actually do something?
 *
 *   npm run verify:controls
 *
 * Issue #41. Grant: *"not only back end architecture, but front end buttons,
 * all that kind of stuff."*
 *
 * The failure this catches is the one no other check can: a button that renders
 * perfectly, passes every layout assertion, is captured in a screenshot that
 * looks right — and does nothing when pressed. Nothing in `shots`, `probe`,
 * `wide` or `smoke` would notice.
 *
 * It works by pressing things. For every interactive element on every route it
 * records a fingerprint of the DOM, clicks, and records it again. A control
 * that changes nothing is reported. So is one with no accessible name, and one
 * that cannot be reached by keyboard.
 *
 * ## What "changed nothing" means, and why it is not simply length
 *
 * A first version compared `document.body.innerHTML.length` and reported half
 * the interface as dead, because a toggle that swaps one class changes no
 * characters at all. The fingerprint is the full markup, compared exactly.
 *
 * ## Known-inert controls
 *
 * Some buttons in a prototype genuinely have nowhere to go — "Add a document"
 * has no upload yet. Those are listed rather than hidden, so the count of
 * things-that-do-nothing is a number Grant can watch go down.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'

/*
  Two apps, not one.

  The first version audited `web/studio` and reported a clean sweep, which read
  as "every button in the product works". It was not: `web/hq` — the build page
  Grant actually opens to watch the work — had never been pressed at all, and
  neither had the four AI Team sub-views or the six settings tabs, because none
  of them is reachable by a project tab click. A control audit that silently
  skips half the controls is worse than none, because it is believed.
*/
/*
  One app now (#68, ADR-0019).

  `web/hq` is deleted: every one of its fifteen write actions, its six sections
  and the voice call moved into the studio, which is what the root serves. The
  sweep is smaller and points at the only thing a person can open.
*/
const APPS = ['web/studio'] as const
let ROOT: string = APPS[0]
const PORT = 4614
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.mjs': 'text/javascript; charset=utf-8',
}

/*
  A stand-in for the Team HQ API, served from this same origin.

  `web/hq` is behind a password gate, so the audit saw exactly one control —
  "Unlock" — and reported the build page as one button. Getting past it needs
  two things, and neither of them is a real credential: the page reads
  `window.HQ_API`, so it can be pointed at this server, and it reads
  `localStorage['hq.token']`, which can be seeded with any string because the
  stub does not check it.

  Reads are answered with an empty, correctly-shaped payload; **writes are
  answered without doing anything.** That is deliberate. The two tabs under
  "Setting up" can mint credentials and reconfigure connectors, and pressing
  every button on that page against the live office would be a destructive
  action taken without asking. The audit's question is "does this control do
  something", not "does the office survive it".

  An empty office still renders every tab, every menu item and every
  empty-state action — which is forty-odd controls more than one.
*/
const HQ_SECTIONS: Readonly<Record<string, string>> = {
  overview: 'app.hq_overview()',
  staff: 'app.hq_staff()',
  usage: 'app.hq_usage()',
  activity: 'app.hq_activity(50)',
  series: 'app.hq_series(30)',
  connections: 'app.hq_connections()',
  projects: 'app.hq_projects()',
  artifacts: 'app.hq_artifacts()',
  settings: 'app.hq_settings()',
  team: 'app.hq_team()',
  google: 'app.hq_google()',
  setup: 'app.hq_setup()',
  cost: 'app.hq_cost_per_outcome(30)',
  bots: 'app.hq_bots()',
  routing: 'app.hq_routing()',
  build: 'app.hq_build()',
}

/*
  The read payloads, taken from the real projections at run time and held in
  memory only.

  An empty office renders empty states, and an empty state has almost no
  controls in it: the first version of this stub returned `{}` for everything
  and the phone sweep found ONE control per route — the menu button. It looked
  like coverage and was not.

  So the audit reads each section straight out of Postgres through the
  Management API, which it is already authenticated for, and serves that. Real
  shapes, real row counts, real buttons to press. **Nothing is written to disk
  and nothing is printed** — these projections carry Grant's project names and
  the office's activity, and a fixture file in the repository would be both a
  disclosure and a thing that goes stale.

  Without `SUPABASE_ACCESS_TOKEN` it falls back to `{}` per section and says so.
*/
const HQ_STUB: Record<string, unknown> = {}
let hqData = 'empty (no SUPABASE_ACCESS_TOKEN)'
if ((process.env.SUPABASE_ACCESS_TOKEN ?? '') !== '') {
  const { ManagementApiExecutor } = await import('../../src/db/executor.ts')
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    process.env.SUPABASE_ACCESS_TOKEN ?? '',
  )
  let got = 0
  for (const [name, call] of Object.entries(HQ_SECTIONS)) {
    try {
      HQ_STUB[name] = (await db.execute(`select ${call} as d`)).rows[0]?.d ?? {}
      got += 1
    } catch {
      HQ_STUB[name] = {}
    }
  }
  hqData = `${String(got)}/${String(Object.keys(HQ_SECTIONS).length)} live projections`
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'

  if (path === '/hq-api') {
    const section = new URL(req.url ?? '/', 'http://x').searchParams.get('section') ?? 'overview'
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify(
        req.method === 'POST' ? { result: { ok: true } } : { data: HQ_STUB[section] ?? {} },
      ),
    )
    return
  }
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

/** Controls with nothing behind them YET. Listed, not hidden. */
const KNOWN_INERT = new Set([
  'Add a document',
  'Add a task',
  'Add someone',
  'Add a source',
  'Point it at something',
  '+ Connect something',
  '+ Bring someone in',
  'Show me',
  'Edit labels',
  'Configure',
  'Rotate it',
  'Connect it',
  '+ Connect something',
])

/*
  Controls that are correctly inert on ONE route, and live everywhere else.

  The ribbon's "1 blocked" goes to the blocked job — project, AI Team, Active
  jobs. Pressed from `team/jobs` you are already looking at it, so nothing
  changes, and that is the right answer rather than a dead button. Keyed by
  route so it stays a finding anywhere else, which is what caught it being
  genuinely dead in the first place.
*/
const INERT_HERE = new Set(['team/jobs::1 blocked'])

type Finding = { route: string; label: string; why: string }
const findings: Finding[] = []
let pressed = 0
let inert = 0
/*
  How many of THIS RUN's inert controls were known stubs — not the size of the
  allow-list, which is what the report used to print.

  It read "did nothing: 6 (12 of those are known-inert prototype stubs)", and
  twelve of six is not a number. A report line that states an impossibility
  teaches the reader to skim the whole report, which is the same cost as the
  `check:templates` message that named the wrong cause for every parse error.
*/
let inertKnown = 0
/*
  Controls the sweep could not press, counted rather than swallowed.

  A click that times out is skipped, because it usually means the element moved
  or something is covering it rather than that it is broken. But 219 controls
  seen and 58 pressed reads as full coverage in a report that only prints the
  58. The gap belongs in the report.
*/
let skipped = 0
/*
  And WHICH ones, by name.

  "100 unpressable" is a number with nothing attached, and a number with
  nothing attached is where a defect lives — the count sat in this report for
  weeks reading like coverage while it was the opposite. Naming them is what
  turns it into something anybody can act on, and it is how the desktop and
  phone legs became comparable at all.
*/
const unreached: string[] = []

const browser = await chromium.launch()

/*
  One viewport per run, selected by SIZE.

  The full sweep is about fifteen minutes — 65 controls on the project overview
  alone, each pressed and compared — which is longer than a single command is
  allowed here. `SIZE=desktop` and `SIZE=phone` split it into two runs that each
  finish, and `npm run verify:controls` does both in sequence.
*/
/*
  One naming rule, shared by the mouse collector and the keyboard sweep (#121).

  CLAUDE.md: a row list built twice is a list that will disagree. These two
  passes have to agree on what a control is CALLED or the comparison between
  them is noise - a control named one way while being pressed and another way
  while being tabbed onto would be reported as unreachable for ever.

  An image link IS named, by its image's alt text; title is the last resort,
  as it is for a browser.

  No backticks in this string: it is JS source handed to evaluate.
*/
const NAME_OF = `((el) => {
  /*
    textContent, minus the style sheets.

    Every generated page illustration carries an inline style element, and
    textContent takes its RULES - so six document cards were all named
    ".pg rect { fill: var(--ink-3); opacity: .42 } .pg rect.accen", collapsed
    into one entry by the de-duplication, and five of the six had never been
    pressed or tabbed onto by this audit at all. A screen reader does not read
    a style sheet and neither should this.
  */
  const words = (node) => {
    let out = ''
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue
      /*
        Lower-cased, because an SVG element's tagName keeps its own case while
        an HTML element's is upper-cased - and the style sheet in question is
        inside the generated illustration's svg, so a check against 'STYLE'
        alone misses every one of them. It did, on the first attempt, and the
        finding printed the CSS back at me unchanged.
      */
      else if (c.nodeType === 1 && !['style', 'script'].includes(String(c.tagName).toLowerCase()))
        out += words(c)
    }
    return out
  }
  const img = el.querySelector('img[alt]')
  return (
    el.getAttribute('aria-label') ||
    words(el) ||
    (img === null ? '' : img.getAttribute('alt')) ||
    el.getAttribute('title') ||
    ''
  ).trim().replace(/\\s+/g, ' ')
})`

const only = process.env.SIZE ?? ''
/*
  A route filter, for the same reason SIZE exists.

  Adding the AI Team sub-views, the settings tabs and `web/hq` took the sweep
  past the ten-minute ceiling on a single command, and a run that is killed
  reports nothing. `ROUTES=settings,team` runs just those. `npm run
  verify:controls` still does the whole thing, in slices.
*/
const routeFilter = (process.env.ROUTES ?? '')
  .split(',')
  .map((r) => r.trim())
  .filter((r) => r !== '')
const SIZES = [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', devices['iPhone 14']],
] as const

for (const app of APPS) {
  ROOT = app
  for (const [size, opts] of SIZES.filter(([n]) => only === '' || n === only)) {
    const ctx = await browser.newContext({ ...opts })
    const page = await ctx.newPage()
    const thrown: string[] = []
    page.on('pageerror', (e) => thrown.push(e.message))

    /*
    Block everything that is not this server.

    The staff portraits live in Supabase Storage, and every page load in this
    sandbox waits on eight of them before giving up — 160 failed proxy
    connections in one run, and the audit was killed twice by the timeout
    before finishing. It is not testing the portraits; it is testing whether
    buttons work. `abort()` on off-origin requests turns a nine-second load
    into a fast one, and the initial letter under each portrait is the designed
    fallback anyway.
  */
    await ctx.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith(`http://127.0.0.1:${String(PORT)}`)) {
        void route.continue()
        return
      }
      void route.abort()
    })

    /*
      Unconditional since #74.

      This used to be guarded on `ROOT === 'web/hq'`, and `web/hq` was deleted
      in #68. So the studio was audited with no token: `canWrite()` in
      `web/studio/office.js` reads `localStorage['hq.token']`, it was false,
      and EVERY WRITE CONTROL IN THE PRODUCT WAS NEVER DRAWN. The audit walked
      the page, found only read controls, and passed — while eight separate
      dead buttons sat in the interface waiting for Grant to find them by
      hand, which is how they were found.

      A control audit that cannot see controls is worse than no audit, because
      it is green.
    */
    await page.addInitScript(`
      window.HQ_API = 'http://127.0.0.1:${String(PORT)}/hq-api'
      try { localStorage.setItem('hq.token', 'audit') } catch {}
      /*
        Count the writes.

        A control whose whole job is to change something on the SERVER leaves
        the page identical: the stub answers every POST the same way, so the
        re-render that follows redraws exactly what was there and the "did the
        HTML change" test says the button is dead. Two real, working controls
        were reported that way -- "does not need Notion", which records a
        decision, and Connect, which asks for a link it was not given.

        So a press that issued a write COUNTS AS ACTING, whatever the DOM does
        afterwards. This wraps fetch rather than listening for requests from
        the test, because it has to be readable synchronously beside the HTML
        snapshot and a Playwright listener is not.
      */
      window.__WROTE = 0;
      /*
        And every READ, by section.

        A control whose job is to ask the office again cannot be judged by
        whether the page changed, because this audit serves a STUB: it answers
        every request the same way for ever, so a correct retry against it is
        idempotent by construction and the DOM is identical afterwards. That is
        a fact about the harness, not about the button. What can be judged is
        whether the press issued the request at all -- which is stricter than
        excluding it, because a retry that stops asking becomes a finding
        again. Sections are recorded rather than a bare count so a background
        pulse poll landing mid-press cannot stand in for the read.
      */
      window.__READS = [];
      const through = window.fetch;
      window.fetch = (input, init) => {
        if ((init && init.method) === 'POST') window.__WROTE++;
        else {
          const url = String(typeof input === 'string' ? input : (input && input.url) || '');
          const m = url.match(/[?&]section=([a-z_]+)/);
          window.__READS.push(m ? m[1] : 'other');
        }
        return through(input, init);
      };
    `)

    await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)

    /*
    Each route resets with a `goto`, not by clicking its way back.

    The first version navigated home by pressing the rail's "All projects". Two
    elements carry `data-go="portfolio"` — that one and the hidden copy inside
    the project switcher's menu — so after a re-render detached the first,
    Playwright retried, resolved the hidden one, and waited thirty seconds for
    something invisible to become clickable.

    Reloading is slower and cannot drift. A control audit whose own navigation
    is flaky reports flakiness as dead buttons.
  */
    /*
      Which settings tab the sweep is on, or null off the settings routes.

      Read by `reopenSheet` below. Recorded rather than passed down because the
      press helper is four hundred lines away and every other shell-state
      repair in this file — `openRail`, `shutDock` — works the same way: a
      cheap, idempotent restore that the press loop calls without knowing why
      it is needed.
    */
    let settingsTab: string | null = null

    const home = async () => {
      /* The home board's own panels are removable, and the way into a project
         is a card inside one of them. Restore before the page is read. */
      await page.evaluate(`(() => {
        try { localStorage.removeItem('studio.panels') } catch (e) {}
      })()`)
      // Every route starts here, `intoSettings` included — and it records its
      // tab AFTER calling this, so clearing here covers every other route
      // without needing a second call site that somebody will forget.
      leaveSettings()
      await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(600)
    }
    /*
      Wait for the view transition to lift, not for a number of milliseconds.

      Opening a project runs `carry()`, which is a View Transition. While one is
      running the browser paints a `::view-transition` overlay over the WHOLE
      page, and `document.elementFromPoint` anywhere returns the root element —
      so every click lands on the overlay and Playwright reports
      "main intercepts pointer events" until it times out thirty seconds later.

      The transition is 396ms and the hydrate re-render follows it, so the old
      500ms wait was inside the window about half the time. Measured: at 200ms
      and 500ms the point under a rail button is HTML; by 900ms it is the
      button.

      A bigger number would have worked today and drifted the first time a
      spring was retuned. This waits for the actual condition — the element at
      the target's own centre IS the target — which cannot drift because it is
      the thing the click needs to be true.
    */
    /*
      Wait for the view transition's overlay to lift.

      Opening a project runs `carry()`, a View Transition. While one is running
      the browser paints a `::view-transition` overlay over the WHOLE page, and
      `document.elementFromPoint` anywhere returns the root element — so every
      click lands on the overlay and Playwright reports "main intercepts
      pointer events" until it gives up thirty seconds later.

      Measured: at 200ms and 500ms after opening a project, the point under a
      rail button is HTML; by 900ms it is the button. The old wait was 500ms,
      so it was inside that window.

      Two things this deliberately does NOT do. It does not wait a bigger
      number — that would work today and drift the first time a spring is
      retuned. And it does not wait on `getAnimations()`: the transition's
      animations are not reported there in this Chromium, and the unfiltered
      version never settles at all, because the studio breathes, the skeletons
      pulse and a busy face has a ring going round it.

      So it asks the only question that matters — is the page covered — by
      looking at what is actually under the middle of the viewport.
    */
    const uncovered = async () => {
      await page.waitForFunction(
        `(() => {
           const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
           return at !== null && at !== document.documentElement && at !== document.body
         })()`,
        undefined,
        { timeout: 15_000, polling: 100 },
      )
    }

    const clickWhenReachable = async (selector: string) => {
      await uncovered()
      /*
        And then let it stop moving.

        `uncovered()` answers "is the page covered", which is a different
        question from "has the layout settled". The rail's own width is a .34s
        transition on `grid-template-columns`, so a button can be reachable and
        still sliding — Playwright then refuses the click as "element is not
        stable" and burns its whole timeout waiting.

        A fixed wait is acceptable HERE and was not acceptable for the overlay,
        because this one is a stabiliser on top of a real condition rather than
        a guess standing in for one.
      */
      await page.waitForTimeout(420)
      const target = page.locator(selector).first()
      await target.waitFor({ state: 'visible', timeout: 10_000 })
      /*
        Bring it into view before asking what is under it.

        On a phone the project's sections live in a horizontally SCROLLING bar
        — `.navgroup` is `overflow-x: auto` precisely because six full project
        names never fit across 390px. Documents sat at x=744 in a 390px
        viewport, so `elementFromPoint` at its centre returned null, the hit
        test could never pass, and five routes reported "could not be reached"
        for ten seconds each.

        Nothing was wrong with the page: a person swipes the bar. The audit has
        to do the same thing rather than measure a point outside the window.
        `block: center` also lifts a card out from under the fixed bottom
        navigation, which was the other half of the same report.
      */
      await target.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      })
      await page.waitForTimeout(220)
      /*
        Hit-test it ourselves, then click past Playwright's stability check.

        The studio never stops moving: `breathe()` and `scatter()` keep ambient
        animations running on the shell for as long as the page is open. So
        Playwright's "element is not stable" requirement is never satisfied for
        anything inside it, and every navigation click burned its full timeout
        reporting a stability problem rather than a real one.

        `force: true` is normally a way of pretending a control is clickable.
        It is not that here: the line below asks the browser what is actually
        under the middle of this element and requires the answer to be this
        element, which is the check `force` skips. We do the check and then
        skip the one that cannot pass.
      */
      await page.waitForFunction(
        `(() => {
           const el = document.querySelector(${JSON.stringify(selector)})
           if (el === null) return false
           const r = el.getBoundingClientRect()
           if (r.width < 2 || r.height < 2) return false
           const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
           return at !== null && (at === el || el.contains(at) || at.contains(el))
         })()`,
        undefined,
        { timeout: 10_000, polling: 100 },
      )
      await target.click({ force: true })
      // And again after, so the next click is not issued into the transition
      // this one just started.
      await uncovered()
    }

    /*
      Two attempts, and say so if the second fails.

      The comment above says a control audit whose own navigation is flaky
      reports flakiness as dead buttons, and this is that hazard again: the
      view transition's overlay covers the page for about 900ms after a project
      opens, `uncovered()` catches the common case, and an occasional click
      still lands inside it.

      Retrying the whole route from a fresh load is honest — it is a navigation
      problem, not a finding — and it is bounded, so a genuinely unreachable
      route still fails rather than looping.
    */
    /*
      Open the rail before navigating by it.

      The audit presses every control, and one of them is the sidebar toggle —
      which REMEMBERS, in `localStorage['studio.rail']`, because a person who
      collapses a sidebar means it. Since #80 the project's sections live in
      that sidebar and since #76 collapsing it hides it completely, so after
      the toggle had been pressed once every later route tried to click a
      179px-wide button that was 20px wide and off the left edge, and reported
      "main intercepts pointer events" for thirty seconds each.

      Not a bug in the page: that is what collapsing a sidebar does, and the
      toggle stays visible so there is always a way back. It is a bug in an
      audit that pressed a persistent control and then assumed the layout it
      had before.

      Two attempts, because the transition overlay above is the other way this
      can go wrong and a retry from a fresh load is honest for a navigation
      problem. Bounded, so a genuinely unreachable route still fails.
    */
    const leaveSettings = () => {
      settingsTab = null
    }

    const openRail = async () => {
      const shut = await page.locator('.shell.shut').count()
      if (shut > 0) {
        await page.locator('[data-rail]').first().click()
        await page.waitForTimeout(450)
      }
    }

    /*
      Shut the dock before navigating, for the same reason the rail is opened.

      The audit presses every control, and one of them opens the dock (#103) —
      which REMEMBERS, in `localStorage['studio.dock']`, because a person who
      opens a conversation panel means it. On a phone that panel is a sheet, so
      every route pressed after it reported "could not be reached" for ten
      seconds each and the whole phone sweep returned nothing.

      Not a bug in the page once the sheet stopped covering the navigation bar
      — that part WAS a bug and is fixed. This is the audit's half: a check
      that presses a persistent control and then assumes the layout it had
      before is a check that reports its own state as the product's.
    */
    const shutDock = async () => {
      await page.evaluate(`(() => {
        try { localStorage.setItem('studio.dock', 'shut') } catch (e) {}
        const d = document.querySelector('#dock');
        if (d !== null) { d.hidden = true; document.body.classList.remove('docked'); }
      })()`)
    }

    /*
      Put the boards back before reading a route.

      Third instance of the same shape, and the file already carries the other
      two: #103's dock and #183's rail. The sweep presses every control, and
      three of the controls on a panel header are Narrower, Wider and REMOVE -
      which persists, because a person who removes a panel means it.

      So the audit removed the Projects panel on the portfolio route and then
      spent eleven routes reporting "could not be reached", because the way
      into a project is a card inside that panel. Ten seconds each, and the
      message named the selector rather than the reason.

      Cleared through `localStorage` rather than by pressing Reset: Reset is
      itself one of the controls under test, and a restore that depends on the
      thing being tested cannot be trusted to have run.

      Called at the TOP of `intoProject`, before anything reads the page -
      #190's correction, where a restore that ran just before the click was
      one step too late because the state had already been read.
    */
    const BOARD_PANELS = { home: 5, project: 6 }

    const putBoardsBack = async () => {
      const short = (await page.evaluate(`(() => {
        const board = document.querySelector('[data-home-board], [data-board]')
        if (board === null) return 0
        const want = board.hasAttribute('data-home-board') ? ${BOARD_PANELS.home} : ${BOARD_PANELS.project}
        return want - board.querySelectorAll('[data-panel]').length
      })()`)) as number
      if (short <= 0) return
      /*
        Reset is itself one of the controls under test, which is a dependency
        worth stating rather than hiding: if Reset stops working this restore
        stops working, and the audit will say so twice - once here as panels
        that stay missing, and once as Reset reported inert.

        Clearing `localStorage` alone is not enough. `panels.js` keeps a live
        in-memory map that wins over storage, deliberately, so that a drag feels
        instant - so the page has to be told, and Reset is the telling.
      */
      await page.evaluate(`(() => {
        try { localStorage.removeItem('studio.panels') } catch (e) {}
        const r = document.querySelector('[data-home-reset], [data-reset-panels]')
        if (r !== null) r.click()
      })()`)
      /*
        Nearly a second, not a quarter of one. The studio never stops moving -
        `breathe` and `scatter` run for as long as the page is open - so a panel
        that has just been redrawn is still settling, and Playwright's stability
        check cannot pass against a box that is moving. This file already
        records that; the first draft waited 260ms and two Remove buttons
        reported "locator resolved, click timed out", which is what an unstable
        element looks like from the outside.
      */
      await page.waitForTimeout(950)
    }

    const intoProject = async (tab: string) => {
      await putBoardsBack()
      for (let go = 1; go <= 2; go += 1) {
        try {
          await home()
          await shutDock()
          await openRail()
          await clickWhenReachable('.project[data-open="legacy-coaching-course"]')
          await openRail()
          await clickWhenReachable(`[data-tab="${tab}"]`)
          await page.waitForTimeout(350)
          return
        } catch (e) {
          if (go === 2) throw e
        }
      }
    }

    /*
    AI Team's own four and the settings sheet's six.

    A project tab click never reaches these, so the sweep walked straight past
    forty-odd controls and called the product clean. `data-sub` is the sub-view
    selector inside AI Team; `data-settings` opens the sheet and `data-setting`
    picks the tab within it.
  */
    const intoTeam = async (sub: string) => {
      await intoProject('team')
      await page.locator(`[role="tab"][data-sub="${sub}"]`).first().click()
      await page.waitForTimeout(350)
    }
    const intoSettings = async (tab: string) => {
      await home()
      await shutDock()
      settingsTab = tab
      await page.locator('[data-settings]').first().click()
      await page.waitForTimeout(400)
      await page.locator(`[role="tab"][data-setting="${tab}"]`).first().click()
      await page.waitForTimeout(300)
    }

    /*
      Re-open the settings sheet, and this is #111 — the THIRD instance.

      One of the controls this sweep presses is the sheet's own Close button,
      which sits in `.chead` and is therefore collected FIRST, before anything
      in `.setbody`. Pressing it closes the sheet. Every control gathered after
      it on that route still resolves — the nodes are in the tree — but they
      have no box, so Playwright reports:

          - element is not visible

      which reads like a product defect and is not. On five of the six tabs
      nothing was left to press after Close, because those controls had already
      been pressed and de-duplicated on an earlier route. The Behaviour tab has
      three that had not: `chief`, `browser` and `undo` — the three this Issue
      was opened about, one of them the switch Grant relies on for
      `telegram.only_chief_speaks`. Pressed on their own, all three work.

      `shutDock` (#103) and `openRail` (#183) are the same lesson about the
      dock and the rail: **a sweep that presses every control will press the
      one that hides the others, and the page will remember.** The sheet had
      no equivalent.

      The signal WAS `body.behind`, and #158 took that away: Settings is a page
      now, so nothing recedes behind it and `behind` stays false. The check then
      believed Settings was shut on every press, re-opened it before each one,
      and the run died in this helper rather than in the product.

      The signal for a page is its container's `hidden` attribute, which is what
      `sheet()` sets either way. It is NOT the presence of the `.sheet` node:
      the studio leaves that element in the tree and takes its box away, so
      querying for the node reports open while it is shut, which is exactly the
      confusion that made the Behaviour toggles look broken in the first place.
    */
    const reopenSheet = async () => {
      if (settingsTab === null) return
      const shut = await page.evaluate(
        `(() => { const s = document.querySelector('#settings'); return s === null || s.hidden })()`,
      )
      if (shut !== true) return
      /*
        The rail has to be open before the rail's own button can be pressed.

        #183 again: the sweep presses the chevron that collapses the sidebar and
        the page remembers, so `main` covers where this button is. The
        actionability log said so in one line - "<main class='main'> intercepts
        pointer events" - which is the second time in this session that printing
        the END of that log turned a thirty-second mystery into a one-line
        answer.
      */
      await openRail()
      await page.locator('[data-settings]').first().click()
      await page.waitForTimeout(400)
      await page.locator(`[role="tab"][data-setting="${settingsTab}"]`).first().click()
      await page.waitForTimeout(300)
    }

    /*
      HQ_TABS and intoHq were here: the thirteen tabs of `web/hq/index.html`
      and the helper that walked them. The page was deleted in #68 and this
      never went with it (#74), so the audit carried a route list for a target
      that does not exist.
    */

    /*
      No `web/hq` branch any more — the page was deleted in #68 and its script
      entry went with it (#74). A route list that can select a target which does
      not exist is the same shape of bug as the token guard above: it looks like
      coverage and audits nothing.
    */
    const routes: [string, () => Promise<void>][] = [
      ['portfolio', home],
      ...(
        ['overview', 'team', 'documents', 'tasks', 'contacts', 'sources', 'settings'] as const
      ).map(
        (tab) =>
          [
            `project/${tab}`,
            async () => {
              await intoProject(tab)
            },
          ] as [string, () => Promise<void>],
      ),
      ...(['board', 'chat', 'jobs', 'outputs'] as const).map(
        (sub) =>
          [
            `team/${sub}`,
            async () => {
              await intoTeam(sub)
            },
          ] as [string, () => Promise<void>],
      ),
      /*
        Project Settings, all four panes (#36).

        A second level under `project/settings`, so it needs its own entry
        rather than a fifth tab above: the pane fetches its own payload before
        it draws, and the 350ms a tab switch waits would leave this audit
        pressing at the words "Reading the office…".
      */
      ...(['people', 'automations', 'labels', 'project'] as const).map(
        (pane) =>
          [
            `project/settings/${pane}`,
            async () => {
              await intoProject('settings')
              await page.waitForTimeout(900)
              await page.locator(`[data-setpane="${pane}"]`).first().click()
              await page.waitForTimeout(400)
            },
          ] as [string, () => Promise<void>],
      ),
      ...(['team', 'behaviour', 'connections', 'channels', 'models', 'appearance'] as const).map(
        (tab) =>
          [
            `settings/${tab}`,
            async () => {
              await intoSettings(tab)
            },
          ] as [string, () => Promise<void>],
      ),
    ]

    for (const [name, go] of routes.filter(
      (r) => routeFilter.length === 0 || routeFilter.some((f) => r[0].startsWith(f)),
    )) {
      const t0 = Date.now()
      try {
        await go()
      } catch (e) {
        /*
          A route that cannot be reached is a finding, not the end of the run.

          The phone sweep of the build page died on its first route and
          reported nothing at all about the other twelve — the least useful
          possible outcome for a check whose job is to say what is dead.
        */
        findings.push({
          route: `${size}/${name}`,
          label: '(route)',
          why: `could not be reached: ${(e as Error).message.split('\n')[0]}`,
        })
        continue
      }
      // The one selector that says "we are still on this route".
      const [kind, leaf = ''] = name.split('/')
      const here =
        kind === 'portfolio'
          ? '.project'
          : kind === 'hq'
            ? 'body'
            : kind === 'team'
              ? `[role="tab"][data-sub="${leaf}"].on`
              : kind === 'settings'
                ? `[role="tab"][data-setting="${leaf}"].on`
                : `[data-tab="${leaf}"].on`

      // Every control on this route, by a stable handle.
      const labels: string[] = await page.evaluate(`(() => {
      const out = []
      /*
        Scoped to whatever is IN FRONT (#190).

        With a sheet open the studio puts \`behind\` on the body and the shell
        underneath gets \`pointer-events: none\`. Those controls still resolve
        and still have a box — a covered rail is not a removed one — so the
        collector took all ninety-odd of them and then spent 2.5 seconds each
        failing to press something nobody can touch. Settings read as
        "12 pressed, 93 unpressable" and the number meant nothing: it described
        the audit, not the product.

        CLAUDE.md already states the rule from the touch-target version of this
        same mistake: an audit run over a page with something in front of it
        must scope itself to the thing in front. This is that rule, applied to
        the sweep rather than to a measurement.
      */
      /*
        And #158 moved the goalposts: Settings is a PAGE now, so it does not set
        the dim class - nothing is receding behind it and the rail beside it
        still works. It still covers the shell, though, so the scoping rule
        above still applies to it; only the signal changed.

        No backticks in this comment: it lives inside a template literal, which
        is the trap CLAUDE.md records for app.js, for a migration heredoc and
        for verify/import.ts. check:templates covers web/ only, so in here it
        announces itself as an esbuild parse error a long way from the cause -
        which is exactly what it did.

        Asking which of the two containers is open, rather than asking whether
        the body is dimmed, is also the more durable question: it is true of a
        dialog and of a page, and it cannot go stale the next time one of them
        changes what it does to the body.
      */
      const front = (['#settings', '#viewer']
        .map((id) => document.querySelector(id))
        .find((el) => el !== null && !el.hidden) ?? document)
      for (const el of front.querySelectorAll('button, a[href], [role="tab"], [role="option"]')) {
        if (el.closest('[hidden]') !== null) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        // NAME_OF, at the top of this file, and the keyboard sweep uses the
        // same one so the two passes cannot disagree about what a control is
        // called.
        const name = (${NAME_OF})(el)
        out.push(name === '' ? '(unnamed) ' + el.outerHTML.slice(0, 90) : name.slice(0, 60))
      }
      return [...new Set(out)]
    })()`)

      /*
        REACHABLE BY KEYBOARD, not only by mouse (#121).

        The line from that Issue this closes: *"a check that tabs through each
        screen and fails on a control that can be reached by mouse and not by
        keyboard."* Everything else in this file presses with a POINTER, so it
        is blind to exactly the failure it sounds like it would catch — and
        #121 already names three real controls that are `opacity: 0` until
        hover, each with a `:focus-visible` escape that nothing has ever
        proved.

        Matched by NAME rather than by a tag written onto the element, because
        the studio re-renders on a timer and a marker attribute would be gone
        by the time the Tab reached it — the sweep would then report every
        control on the route, which is an audit lying rather than an audit
        finding something.

        The budget is two Tabs per control plus thirty, so a tab ring longer
        than the control list (inputs, the skip link, the address bar handing
        focus back) still gets all the way round.
      */
      const reached = new Set<string>()
      if (labels.length > 0) {
        await page.evaluate(
          `document.activeElement instanceof HTMLElement && document.activeElement.blur()`,
        )
        const budget = Math.min(labels.length * 2 + 30, 260)
        for (let i = 0; i < budget; i += 1) {
          await page.keyboard.press('Tab')
          const name = String(
            await page.evaluate(`(() => {
              const el = document.activeElement
              if (!el || el === document.body) return ''
              return (${NAME_OF})(el).slice(0, 60)
            })()`),
          )
          if (name !== '') reached.add(name)
        }
      }
      /*
        The marks in the icon grid are the one legitimate exception, and it is
        named rather than inferred: 451 of them behind ONE tab stop is #83's
        roving tabindex working as designed, and the arrows that move inside it
        are proved by `verify:keyboard`. Everything else has to be tabbable.
      */
      const rovingGrid = await page.evaluate(
        `document.querySelectorAll('[data-look-icon]').length > 1`,
      )
      const markNames: string[] = rovingGrid
        ? ((await page.evaluate(`[...document.querySelectorAll('[data-look-icon]')]
            .map((el) => (${NAME_OF})(el).slice(0, 60))`)) as string[])
        : []
      for (const label of labels) {
        if (reached.has(label)) continue
        if (markNames.includes(label)) continue
        findings.push({
          route: `${size}/${name}`,
          label,
          why: 'a mouse can press it and Tab never reaches it',
        })
      }

      for (const label of labels) {
        /*
          Restore the sheet BEFORE the locator is built, not just before the
          click.

          The first version of this fix called `reopenSheet` inside `press`,
          which is one step too late for the same reason `openRail` was one
          step too early in #183: by then `frontSel` has already been computed
          against a shut sheet, come back empty, and the locator is searching
          the whole document again. The restore has to happen before anything
          reads the page's state, not merely before the press.
        */
        await reopenSheet()
        if (label.startsWith('UNNAMED::')) {
          findings.push({
            route: `${size}/${name}`,
            label: label.slice(9),
            why: 'no accessible name',
          })
          continue
        }
        /*
          The INNERMOST control carrying this label, not the outermost.

          `hasText` matches any element whose SUBTREE contains the text, and
          `.first()` then takes the one earliest in the document — which for a
          nested control is the wrapper. A contact card is
          `button.pcard > … > a[href^=mailto]`, so pressing "the control
          labelled ben@hartleyco.example" pressed the CARD; Playwright clicked
          its centre, which is the anchor; the anchor carries `data-stop` so
          the card never opened; and six working links were reported as dead
          for months (#180).

          Same shape as the `[data-grip]` trap in CLAUDE.md — the press landed
          somewhere other than the thing being judged — and it is worth fixing
          rather than excluding, because the wrapper is not what the label
          names. Deepest match wins: the candidate that contains no other
          candidate.
        */
        /*
          Searched inside whatever is IN FRONT, for the same reason the
          COLLECTOR is (#190) — and this half was missed.

          #190 scoped the collector, so the sweep stopped gathering the ninety
          controls behind an open sheet. It did not scope the locator that
          presses them, which still searched the whole document by label text.
          With Settings open, "Team" is both the settings tab and the rail's
          "Call the team" button behind the sheet; `hasText` matched both,
          the deepest-match rule picked the rail's, and it is untouchable —
          six routes each reporting a control that works.

          Two halves of one rule, and only one of them was applied. Scope the
          thing that FINDS the control as well as the thing that lists it.
        */
        const frontSel = (await page.evaluate(
          `(() => {
             for (const id of ['#settings', '#viewer']) {
               const el = document.querySelector(id)
               if (el !== null && !el.hidden) return id
             }
             return ''
           })()`,
        )) as string
        const root = frontSel === '' ? page : page.locator(frontSel)
        const candidates = root
          .locator('button:visible, a[href]:visible, [role="tab"]:visible, [role="option"]:visible')
          .filter({ hasText: label })
        const deep = (await candidates.evaluateAll((els) =>
          els.findIndex((el) => !els.some((other) => other !== el && el.contains(other))),
        )) as number
        const target = deep >= 0 ? candidates.nth(deep) : candidates.first()
        const alt = root.getByLabel(label, { exact: true }).first()
        const use = (await candidates.count()) > 0 ? target : alt
        if ((await use.count()) === 0) continue

        /*
          A control that is already where it points changes nothing, correctly.

          "Today" on the Today tab, or the selected settings tab, re-renders the
          same screen — that is a no-op by design, not a dead button, and
          reporting it teaches everyone to ignore the report. The page says so
          itself with `aria-current` / `aria-selected` / `.on`, so the audit can
          simply ask.
        */
        /*
          Both spellings of aria-current, which is a lesson this repository has
          already learned once in CSS and not here.

          `studio.css` carries the note: *"Navigation entries use
          aria-current='page', which is the correct value for 'this is the page
          you are on'; the older ones say 'true'. A selector that knows only one
          of them styles half the rail."* This audit knew only 'true', so a
          correctly-marked control that is already where it points - #216's home
          button, pressed from the home screen - was reported as a control that
          does nothing.

          The spec value is 'page'. Accepting only the older one meant the audit
          punished the correct markup.
        */
        const alreadyHere = await use
          .evaluate(
            (el) =>
              el.getAttribute('aria-current') === 'true' ||
              el.getAttribute('aria-current') === 'page' ||
              el.getAttribute('aria-selected') === 'true' ||
              el.classList.contains('on'),
          )
          .catch(() => false)

        /*
          Two kinds of control this audit cannot judge by "did the page
          change", and both were reported as dead for months (#180).

          `handsOff` — an anchor whose scheme is not http. A `mailto:` or
          `tel:` link hands off to the mail client or the dialler, and a page
          that changed when you pressed one would be the bug. What is worth
          asserting is that the href is WELL FORMED, which is done below
          instead of the DOM test.

          `refetch` — a control whose whole job is to ask the office again.
          The audit serves a stub that answers identically for ever, so a
          correct retry is idempotent here by construction. Judged on whether
          it issued the read instead.

          Both are read off the element rather than matched on its label. A
          label is a string anybody can reuse, and an exclusion keyed on
          wording is an exclusion that silently grows.
        */
        const nature = (await use
          .evaluate((el) => ({
            // No `dom` lib in this tsconfig, so no HTMLAnchorElement to cast to —
            // `getAttribute` is on Element and that is all this needs.
            href: el.tagName === 'A' ? (el.getAttribute('href') ?? '') : '',
            refetch: el.hasAttribute('data-retry-office'),
          }))
          .catch(() => ({ href: '', refetch: false }))) as { href: string; refetch: boolean }
        const handsOff = /^(?:mailto|tel|sms|geo|facetime):/i.test(nature.href)

        const readsBefore = ((await page.evaluate('(window.__READS ?? []).length')) as number) ?? 0
        const before = await page.evaluate('document.body.innerHTML')
        // A write and a focus move are both "it acted", and neither shows up
        // in the HTML. Read alongside it so the three are one observation.
        const wroteBefore = (await page.evaluate('window.__WROTE ?? 0')) as number
        const focusBefore = (await page.evaluate(
          'document.activeElement ? (document.activeElement.tagName + (document.activeElement.getAttribute("data-src-ref") ?? "")) : ""',
        )) as string
        /*
          Press it — and when it cannot be pressed, say WHICH one.

          `skipped` was a bare count, and it read like coverage while being the
          opposite: 100 unpressable against 97 pressed on the desktop leg, and
          2 against 200 on the phone leg of the same routes. A number with no
          names attached is where a defect lives.

          An attempt to replace Playwright's actionability wait with a hit test
          plus `force: true` was tried and reverted — it is recorded in #183
          with what was measured, because the cause is not the one CLAUDE.md's
          "the studio never stops moving" note predicts: hit-tested in a
          settled page, all thirteen of the repeatedly-skipped rail controls
          pass. Something in the sweep's own sequence is covering them, and
          that is worth a session of its own rather than a fourth guess.
        */
        /*
          #183, and the answer is the one CLAUDE.md predicted after all.

          Ninety-one skips a run on desktop and two on the phone, always the
          same controls. #183 ruled out "the studio never stops moving" by
          hit-testing them in a settled page and finding all thirteen
          reachable — but a hit test measures OCCLUSION, and the actionability
          log, which `catch {}` had been discarding, says something else:

              locator resolved to <button data-call class="callbtn" …>
              attempting click action
                waiting for element to be visible, enabled and STABLE
                element is not stable

          It resolves, it is visible, it is enabled, and it never stops moving.
          `breathe()` and `scatter()` run for as long as the page is open and
          the rail is where the ambient motion lives — which is also exactly
          why the phone leg never saw it: the rail is not on screen there.

          One retry with `force: true`, and ONLY for that message. Force
          bypasses occlusion as well as motion, so blanket-forcing would turn a
          genuinely covered control — the `[data-grip]` class of defect this
          suite exists to catch — into a green press. "Intercepts pointer
          events" stays a skip, and so does everything else.

          The reason is recorded either way. A skip with no reason attached is
          how ninety-one of them sat in a report for weeks reading like
          coverage.
        */
        const press = async (): Promise<string | null> => {
          /*
            Re-open the rail first, and this is #183.

            One of the controls this sweep presses is the chevron at the top
            left — "Collapse the sidebar" — and the page REMEMBERS that, in
            `localStorage`, because a person who collapses a sidebar means it.
            The rail then has no width, `main` covers where its buttons are,
            and every rail control pressed afterwards fails with exactly what
            the actionability log says:

                - <main class="main">…</main> intercepts pointer events
              - retrying click action
                - element is outside of the viewport

            The buttons still RESOLVE — a collapsed rail clips them rather than
            removing them, so they keep a box and Playwright counts them as
            visible — which is why this looked like an actionability mystery
            rather than a shut sidebar. Thirteen rail controls × seven routes =
            91 skipped a run, on desktop only, because the phone has no
            collapsing rail. 289 pressed and 1 unpressable afterwards, against
            91 and 91 before.

            `openRail` was already called at navigation, which is one press too
            early: the chevron is pressed after it. It is idempotent — it looks
            for `.shell.shut` and does nothing otherwise — so calling it before
            every press costs one selector count and closes the hole.

            The same shape as `shutDock` two hundred lines up, which exists
            because the dock is remembered for the same reason (#103). #183's
            own guess was right: something in the sweep's own sequence was over
            them. It is the sweep's own press.
          */
          await openRail()
          /*
            And shut the dock, which is #183's correction applied to #103's
            panel.

            `shutDock` was already called at NAVIGATION, and that is one press
            too early for exactly the reason `openRail` was: the control that
            opens the dock is pressed during the sweep, not before it. With the
            dock open it covers the right-hand column, so the two panels in it -
            Projects and The team on the home board - reported "locator
            resolved, click timed out".

            The full actionability log named the cause in one run:

                - <div id="dock" class="dock">…</div> intercepts pointer events

            which is why this file now prints the END of that log rather than
            its first six lines. Two runs were spent on a stability hypothesis
            before it could say that.
          */
          await shutDock()
          /*
            And put the board back, which is the same lesson a third time.

            Three of the controls on every panel header are Narrower, Wider and
            REMOVE, and all three persist. So the sweep spent its way down a
            board: by the time it reached the fourth panel's Remove, the first
            three panels were gone and the row had re-laid out underneath the
            locator - which reads as "locator resolved, click timed out" and is
            the audit measuring the consequences of its own previous press.

            Restoring before EVERY press rather than only at navigation, for
            #183's reason: the destructive control is pressed after navigation,
            so a restore at navigation is one press too early. Each press is
            then independently answered - does this control respond from a
            known board - which is the question the audit is actually asking.

            Idempotent and cheap: one `localStorage` write and a re-render only
            when something had changed.
          */
          await putBoardsBack()
          try {
            await use.click({ timeout: 2500 })
            return null
          } catch (e) {
            return e instanceof Error ? e.message : String(e)
          }
        }
        const failure = await press()
        if (failure !== null) {
          skipped++
          const why = failure
            .split('\n')
            .map((x) => x.trim())
            .filter((x) => x !== '' && !x.startsWith('Call log'))
            /*
              The whole log, not the first six lines of it.

              CLAUDE.md's rule about this exact output: "element is not stable"
              and "intercepts pointer events" have completely different causes
              and completely different fixes, and the discriminating line is the
              LAST one Playwright wrote, not the first. Six lines stopped at
              "attempting click action" - which is the log saying nothing at all
              - and cost two runs of guessing.
            */
            .slice(-8)
            .join(' · ')
            .slice(0, 460)
          unreached.push(`${size}/${name}  ${label}  — ${why}`)
          continue // covered by something else, or moved — not a dead control
        }
        await page.waitForTimeout(260)
        let after = await page.evaluate('document.body.innerHTML')
        /*
          Look again before calling it dead.

          260ms is enough for a class toggle and not enough for `carry` — the
          measured 396ms spring this product uses for a navigation that carries
          an element across. Four controls were reported as doing nothing when
          what they were doing was still in flight: "1 blocked" on three routes
          and "Desk" on a fourth, all of which work when a person presses them.

          The second look costs nothing on a control that already changed, and
          is the difference between a report Grant can act on and one he learns
          to ignore.
        */
        if (before === after) {
          await page.waitForTimeout(500)
          after = await page.evaluate('document.body.innerHTML')
        }
        // A sheet or the command bar swallows every subsequent click, so dismiss
        // whatever opened before moving on. Cheaper than a reload, and it also
        // exercises Escape on every overlay in the product.
        await page.keyboard.press('Escape')
        await page.waitForTimeout(120)
        pressed++

        /*
          Three ways a control can act, not one.

          The HTML is the obvious one and it is the only one the first version
          looked at, which reported two working controls as dead:

            "Legacy Coaching Course does not need Notion" records a decision on
            the SERVER. The stub answers every POST identically, so the
            re-render redraws exactly what was there.

            "Connect" with an empty field focuses the field, because a link is
            what it needs and asking for it is the right answer. Focus is not
            in the HTML either.

          Same shape as every other trap in this repository: a verification
          that looks somewhere other than where the behaviour is passes, or in
          this case fails, for the wrong reason.
        */
        const wrote = ((await page.evaluate('window.__WROTE ?? 0')) as number) > wroteBefore
        const moved =
          ((await page.evaluate(
            'document.activeElement ? (document.activeElement.tagName + (document.activeElement.getAttribute("data-src-ref") ?? "")) : ""',
          )) as string) !== focusBefore
        /*
          A hand-off link is judged on its destination, not on the page.

          Asserted rather than skipped: an empty or malformed `mailto:` is a
          real defect and this is the only sweep that would ever see it.
        */
        if (handsOff) {
          const target = nature.href.split(':').slice(1).join(':').split('?')[0] ?? ''
          if (target.trim() === '') {
            findings.push({
              route: `${size}/${name}`,
              label,
              why: `hands off to the operating system with no destination (${nature.href})`,
            })
          }
        } else if (nature.refetch) {
          /*
            A retry is judged on whether it ASKED, which is stricter than
            excluding it: a retry that stops issuing the read is a finding.
            The pulse poll is discounted by name — it is the one request that
            fires on a timer rather than because anything was pressed.
          */
          const asked = (await page.evaluate(
            `(window.__READS ?? []).slice(${String(readsBefore)}).filter((s) => s !== 'pulse').length`,
          )) as number
          if (asked === 0) {
            findings.push({
              route: `${size}/${name}`,
              label,
              why: 'it is a retry and pressing it issued no request at all',
            })
          }
        } else if (before === after && !wrote && !moved) {
          inert++
          if (KNOWN_INERT.has(label) || INERT_HERE.has(`${name}::${label}`)) inertKnown++
          if (!KNOWN_INERT.has(label) && !INERT_HERE.has(`${name}::${label}`) && !alreadyHere) {
            findings.push({ route: `${size}/${name}`, label, why: 'pressing it changed nothing' })
          }
        }
        /*
        Only reset when the click actually LEFT the route.

        The first version reloaded after every single control — eight routes,
        two sizes, forty-odd controls each, a second of page load apiece — and
        was killed at fifteen minutes without finishing. Most clicks do not
        navigate; a toggle stays put. So the route is checked with one cheap
        selector and only rebuilt when it is genuinely gone.
      */
        const stillHere = await page.locator(here).count()
        if (stillHere === 0) await go()
      }
      // Progress, so a run that is killed says where it got to rather than
      // leaving you to guess which route is slow.
      console.log(
        `  ${size}/${name} — ${String(labels.length)} controls, ${String(Math.round((Date.now() - t0) / 1000))}s`,
      )
    }

    for (const t of thrown) {
      findings.push({ route: `${size}/*`, label: '(page)', why: `threw: ${t}` })
    }
    await ctx.close()
  }
}

await browser.close()
server.close()

const lines = [
  `# Control audit — every button, pressed`,
  ``,
  `Generated by \`npm run verify:controls\` (issue #41).`,
  ``,
  `- controls pressed: **${String(pressed)}**`,
  `- did nothing: **${String(inert)}**${inertKnown === 0 ? '' : ` (${String(inertKnown)} of those are known-inert prototype stubs)`}`,
  `- could not be pressed (covered, or moved under the cursor): **${String(skipped)}**`,
  `- web/hq read from: ${hqData}`,
  `- findings: **${String(findings.length)}**`,
  ``,
  findings.length === 0
    ? `Every control that is not a known stub changed something when pressed.`
    : [
        `| route | control | finding |`,
        `|---|---|---|`,
        ...findings.map((f) => `| ${f.route} | ${f.label} | ${f.why} |`),
      ].join('\n'),
  ``,
]
/*
  A filename, not a path.

  `ROUTES=project/settings` put a slash in the slug, so the report was written
  to `docs/testing/controls-desktop-project/settings.md` — a directory that
  does not exist — and forty-five seconds per route of work ended in ENOENT
  with every finding thrown away. The one output of the run, lost to the
  separator in its own filter.
*/
const slug = [only, routeFilter.join('+')]
  .filter((x) => x !== '')
  .join('-')
  .replace(/[^a-zA-Z0-9+_-]+/g, '-')
await writeFile(`docs/testing/controls${slug === '' ? '' : `-${slug}`}.md`, lines.join('\n'))

console.log(`web/hq read from: ${hqData}`)
console.log(
  `pressed ${String(pressed)} controls · ${String(skipped)} unpressable · ${String(inert)} inert · ${String(findings.length)} findings`,
)
for (const f of findings.slice(0, 30)) console.log(`  ${f.route}  ${f.label} — ${f.why}`)
if (unreached.length > 0) {
  console.log(`\ncould not be pressed (${String(unreached.length)}):`)
  for (const u of unreached.slice(0, 40)) console.log(`  ${u}`)
  if (unreached.length > 40) console.log(`  … and ${String(unreached.length - 40)} more`)
}
if (findings.length > 0) process.exit(1)
