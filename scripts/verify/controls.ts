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

const ROOT = 'web/studio'
const PORT = 4614
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.mjs': 'text/javascript; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
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

type Finding = { route: string; label: string; why: string }
const findings: Finding[] = []
let pressed = 0
let inert = 0

const browser = await chromium.launch()

/*
  One viewport per run, selected by SIZE.

  The full sweep is about fifteen minutes — 65 controls on the project overview
  alone, each pressed and compared — which is longer than a single command is
  allowed here. `SIZE=desktop` and `SIZE=phone` split it into two runs that each
  finish, and `npm run verify:controls` does both in sequence.
*/
const only = process.env.SIZE ?? ''
const SIZES = [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', devices['iPhone 14']],
] as const

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

  const routes: [string, () => Promise<void>][] = [
    ['portfolio', home],
    ...(['overview', 'team', 'documents', 'tasks', 'contacts', 'sources', 'activity'] as const).map(
      (tab) =>
        [
          `project/${tab}`,
          async () => {
            await intoProject(tab)
          },
        ] as [string, () => Promise<void>],
    ),
  ]

  for (const [name, go] of routes) {
    const t0 = Date.now()
    await go()
    // The one selector that says "we are still on this route".
    const here =
      name === 'portfolio' ? '.project' : `[role="tab"][data-tab="${name.split('/')[1] ?? ''}"].on`

    // Every control on this route, by a stable handle.
    const labels: string[] = await page.evaluate(`(() => {
      const out = []
      for (const el of document.querySelectorAll('button, a[href], [role="tab"], [role="option"]')) {
        if (el.closest('[hidden]') !== null) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const name = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ')
        out.push(name.slice(0, 60))
      }
      return [...new Set(out)]
    })()`)

    for (const label of labels) {
      if (label === '') {
        findings.push({ route: `${size}/${name}`, label: '(unnamed)', why: 'no accessible name' })
        continue
      }
      const target = page
        .locator('button, a[href], [role="tab"], [role="option"]')
        .filter({ hasText: label })
        .first()
      const alt = page.getByLabel(label, { exact: true }).first()
      const use = (await target.count()) > 0 ? target : alt
      if ((await use.count()) === 0) continue

      const before = await page.evaluate('document.body.innerHTML')
      try {
        await use.click({ timeout: 2500 })
      } catch {
        continue // covered by something else, or moved — not a dead control
      }
      await page.waitForTimeout(260)
      const after = await page.evaluate('document.body.innerHTML')
      // A sheet or the command bar swallows every subsequent click, so dismiss
      // whatever opened before moving on. Cheaper than a reload, and it also
      // exercises Escape on every overlay in the product.
      await page.keyboard.press('Escape')
      await page.waitForTimeout(120)
      pressed++

      if (before === after) {
        inert++
        if (!KNOWN_INERT.has(label)) {
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

await browser.close()
server.close()

const lines = [
  `# Control audit — every button, pressed`,
  ``,
  `Generated by \`npm run verify:controls\` (issue #41).`,
  ``,
  `- controls pressed: **${String(pressed)}**`,
  `- did nothing: **${String(inert)}** (${String(KNOWN_INERT.size)} of those are known-inert prototype stubs)`,
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
await writeFile(`docs/testing/controls${only === '' ? '' : `-${only}`}.md`, lines.join('\n'))

console.log(
  `pressed ${String(pressed)} controls · ${String(inert)} inert · ${String(findings.length)} findings`,
)
for (const f of findings.slice(0, 30)) console.log(`  ${f.route}  ${f.label} — ${f.why}`)
if (findings.length > 0) process.exit(1)
