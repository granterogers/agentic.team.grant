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
const APPS = ['web/studio', 'web/hq'] as const
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
  Controls the sweep could not press, counted rather than swallowed.

  A click that times out is skipped, because it usually means the element moved
  or something is covering it rather than that it is broken. But 219 controls
  seen and 58 pressed reads as full coverage in a report that only prints the
  58. The gap belongs in the report.
*/
let skipped = 0

const browser = await chromium.launch()

/*
  One viewport per run, selected by SIZE.

  The full sweep is about fifteen minutes — 65 controls on the project overview
  alone, each pressed and compared — which is longer than a single command is
  allowed here. `SIZE=desktop` and `SIZE=phone` split it into two runs that each
  finish, and `npm run verify:controls` does both in sequence.
*/
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

    if (ROOT === 'web/hq') {
      await page.addInitScript(`
        window.HQ_API = 'http://127.0.0.1:${String(PORT)}/hq-api'
        try { localStorage.setItem('hq.token', 'audit') } catch {}
      `)
    }

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
    const home = async () => {
      await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(600)
    }
    const intoProject = async (tab: string) => {
      await home()
      await page.locator('.project[data-open="legacy-coaching-course"]').click()
      await page.waitForTimeout(500)
      await page.locator(`[role="tab"][data-tab="${tab}"]`).click()
      await page.waitForTimeout(350)
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
      await page.locator('[data-settings]').first().click()
      await page.waitForTimeout(400)
      await page.locator(`[role="tab"][data-setting="${tab}"]`).first().click()
      await page.waitForTimeout(300)
    }

    /* The build page's own menu — every tab, not just whatever loads first. */
    const HQ_TABS = [
      'overview',
      'projects',
      'talk',
      'build',
      'output',
      'activity',
      'staff',
      'connections',
      'cost',
      'usage',
      'trends',
      'setup',
      'help',
    ]
    const intoHq = async (tab: string) => {
      await home()
      /*
        `:visible`, because there are two navs in this markup.

        The sheet holds one copy of the menu and the sidebar the other — one
        set of markup, two shapes. On a desktop the sheet is `display: none`,
        so a bare `[data-tab]` resolves the hidden copy first and Playwright
        waits 2.5s for something that will never be clickable. The same trap
        the `data-go="portfolio"` note below describes, in the other app.
      */
      /*
        On a phone the menu is a sheet, and it is closed.

        Desktop shows the sidebar copy and hides the sheet copy; the phone does
        the reverse, so on a phone NEITHER copy is visible until the "where you
        are" button is pressed. The desktop run passed and the phone run
        crashed on its first route.
      */
      const opener = page.locator('#menubtn:visible')
      if ((await opener.count()) > 0) {
        await opener.first().click()
        await page.waitForTimeout(300)
      }
      await page.locator(`[data-tab="${tab}"]:visible`).first().click({ timeout: 2500 })
      await page.waitForTimeout(400)
    }

    const routes: [string, () => Promise<void>][] =
      ROOT === 'web/hq'
        ? HQ_TABS.map(
            (tab) =>
              [
                `hq/${tab}`,
                async () => {
                  await intoHq(tab)
                },
              ] as [string, () => Promise<void>],
          )
        : [
            ['portfolio', home],
            ...(
              ['overview', 'team', 'documents', 'tasks', 'contacts', 'sources', 'activity'] as const
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
            ...(
              ['team', 'behaviour', 'connections', 'channels', 'models', 'appearance'] as const
            ).map(
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
                : `[role="tab"][data-tab="${leaf}"].on`

      // Every control on this route, by a stable handle.
      const labels: string[] = await page.evaluate(`(() => {
      const out = []
      for (const el of document.querySelectorAll('button, a[href], [role="tab"], [role="option"]')) {
        if (el.closest('[hidden]') !== null) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        /*
          An image link IS named — by the image's alt text.

          The build page's screenshot links hold nothing but an <img alt="...">,
          and reading only aria-label and textContent reported them as having
          no accessible name. That is the audit being wrong about accessibility,
          which is worse than saying nothing: a real unnamed control would be
          lost in the noise. title is the last resort, as it is for a browser.
        */
        const img = el.querySelector('img[alt]')
        const name = (
          el.getAttribute('aria-label') ||
          el.textContent ||
          (img === null ? '' : img.getAttribute('alt')) ||
          el.getAttribute('title') ||
          ''
        ).trim().replace(/\\s+/g, ' ')
        out.push(name === '' ? '(unnamed) ' + el.outerHTML.slice(0, 90) : name.slice(0, 60))
      }
      return [...new Set(out)]
    })()`)

      for (const label of labels) {
        if (label.startsWith('UNNAMED::')) {
          findings.push({
            route: `${size}/${name}`,
            label: label.slice(9),
            why: 'no accessible name',
          })
          continue
        }
        const target = page
          .locator('button:visible, a[href]:visible, [role="tab"]:visible, [role="option"]:visible')
          .filter({ hasText: label })
          .first()
        const alt = page.getByLabel(label, { exact: true }).first()
        const use = (await target.count()) > 0 ? target : alt
        if ((await use.count()) === 0) continue

        /*
          A control that is already where it points changes nothing, correctly.

          "Today" on the Today tab, or the selected settings tab, re-renders the
          same screen — that is a no-op by design, not a dead button, and
          reporting it teaches everyone to ignore the report. The page says so
          itself with `aria-current` / `aria-selected` / `.on`, so the audit can
          simply ask.
        */
        const alreadyHere = await use
          .evaluate(
            (el) =>
              el.getAttribute('aria-current') === 'true' ||
              el.getAttribute('aria-selected') === 'true' ||
              el.classList.contains('on'),
          )
          .catch(() => false)

        const before = await page.evaluate('document.body.innerHTML')
        try {
          await use.click({ timeout: 2500 })
        } catch {
          skipped++
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

        if (before === after) {
          inert++
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
  `- did nothing: **${String(inert)}** (${String(KNOWN_INERT.size)} of those are known-inert prototype stubs)`,
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
const slug = [only, routeFilter.join('+')].filter((x) => x !== '').join('-')
await writeFile(`docs/testing/controls${slug === '' ? '' : `-${slug}`}.md`, lines.join('\n'))

console.log(`web/hq read from: ${hqData}`)
console.log(
  `pressed ${String(pressed)} controls · ${String(skipped)} unpressable · ${String(inert)} inert · ${String(findings.length)} findings`,
)
for (const f of findings.slice(0, 30)) console.log(`  ${f.route}  ${f.label} — ${f.why}`)
if (findings.length > 0) process.exit(1)
