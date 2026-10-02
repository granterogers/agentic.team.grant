/**
 * What he customised is his, not the browser's.
 *
 *   npm run verify:arrangement
 *
 * Issues #81 (the panel arrangement) and #83 (a project's icon, its colour and
 * an uploaded image). One suite rather than two, because they are one subject:
 * ADR-0021 — anything a person composed and would be annoyed to lose belongs
 * in the office, and the failure mode is identical.
 *
 * Issue #81. Grant asked for a customisable project dashboard and was explicit
 * about where the arrangement lives: *"Layout is per person, per dashboard
 * project, and persists. Not `localStorage`: he uses more than one device and
 * the whole point of arranging it is that it stays arranged."*
 *
 * ## Why this needs its own check
 *
 * The failure this guards against is invisible to every other suite. A page
 * that saves an arrangement only to `localStorage` looks perfect: it drags, it
 * snaps, it survives a reload, it captures beautifully. It is wrong only on the
 * SECOND device, which no capture run has. So the assertion has to be about
 * what leaves the page — the request — and about whether a layout arriving
 * from the office is the one drawn.
 *
 * The page is served from the working tree and every `hq-api` call is answered
 * here. Nothing reaches the network: the studio's own payload is fed in, with a
 * stored layout planted in it, and the POSTs the page makes are captured rather
 * than sent. `verify:hq` and `scripts/verify/hq.ts` cover the live round trip;
 * this covers the half a browser has to do.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const PORT = 4621
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

/*
  Real rows, for the same reason `verify:ui` uses them: a synthetic project
  with two documents proves nothing about a panel that has to hold twelve.
*/
const studio = (
  (await db.execute('select app.hq_studio(app.operator_office()) as d')).rows[0] as {
    d: {
      // #110. Only what this suite plants into or reads back — the payload has
      // a great deal more and typing all of it here would be a second copy of
      // `hq_studio` that drifts.
      contactLabels?: unknown
      projects: {
        slug: string
        name: string
        layout: unknown
        icon: string | null
        iconHue: string | null
        image: string | null
        contacts?: unknown
      }[]
    }
  }
).d
const subject = studio.projects[0]
if (subject === undefined) {
  console.error('the office has no active dashboard project to arrange')
  process.exit(2)
}

/*
  The planted arrangement.

  Deliberately NOT the default: one panel, full width, in a slot the default
  never puts anything in. If the page drew the default instead, the assertion
  below could not tell the difference — which is how a check passes for the
  wrong reason.
*/
const PLANTED = [{ id: 'tasks', x: 0, y: 0, w: 3, h: 300 }]
subject.layout = PLANTED
/*
  And a look (#83), planted the same way and for the same reason.

  Planted HERE rather than set through the picker and read back: the question
  is whether what the OFFICE holds is what is DRAWN, and a check that chooses
  through the interface first would pass even if the page never asked the
  office at all. It has to be set before the page loads, because the payload is
  hydrated once — mutating it afterwards proves nothing and reaches nothing.
*/
subject.icon = 'rocket'
subject.iconHue = 'p-iris'
subject.image = null

/*
  And the contact labels (#110, migration 0285), the last thing the studio kept
  in `localStorage`.

  Planted for the same reason as the layout and the look: the question is
  whether what the OFFICE holds is what is DRAWN. `Bespoke` is a name no seed
  contains and no `role` string can derive, so a chip reading it can only have
  come from the payload — the derived fallback (#107) could not produce it.

  `labelsSet: true` with a label the role does not name is the other half: it
  proves the office's answer WINS over the derivation, which is the rule that
  makes a label Grant removed stay removed.
*/
const PLANTED_LABELS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Bespoke', hue: 'p-plum' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Client', hue: 'p-moss' },
]
studio.contactLabels = PLANTED_LABELS
subject.contacts = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Planted Person',
    kind: 'person',
    role: 'Client',
    stage: 'active',
    labels: [PLANTED_LABELS[0]?.id],
    labelsSet: true,
    fields: [{ label: 'Cohort', value: 'Spring 2026' }],
    docs: [],
  },
]

const server = createServer(async (request, response) => {
  let file = join('web/studio', decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  // A dotless path is a route, as on the host (#382: the older studio is under /classic).
  if (!existsSync(file) && extname(file) === '') file = join('web/studio', 'index.html')
  if (!existsSync(file)) {
    response.writeHead(404)
    response.end('not here')
    return
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  response.end(await readFile(file))
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

/*
  Every POST the page makes, kept rather than sent.

  `window.__SENT` is the whole point of the suite: the question is not whether
  the arrangement is on screen, it is whether it left the browser.
*/
// The page has to know which office it belongs to before its first line
// runs, or the shim below never sees a URL with hq-api in it. ADR-0048.
await page.addInitScript(namesAnOffice())

await page.addInitScript(`
  window.__SECTIONS = ${JSON.stringify({ studio })};
  window.__SENT = [];
  try { localStorage.setItem('hq.token', 'verify-arrangement'); } catch (e) {}
  try { localStorage.removeItem('studio.panels'); } catch (e) {}
  try { localStorage.removeItem('studio.people'); } catch (e) {}
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('hq-api')) {
      const section = /section=([a-z_]+)/.exec(url);
      if (section) {
        return new Response(JSON.stringify({ data: window.__SECTIONS[section[1]] ?? {} }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      try { window.__SENT.push(JSON.parse(String(init && init.body))); } catch (e) {}
      return new Response(JSON.stringify({ result: { ok: true } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
`)

const crashes: string[] = []
page.on('pageerror', (e) => crashes.push(e.message.slice(0, 140)))

const checks: { what: string; detail: string; ok: boolean }[] = []
const check = (what: string, detail: string, ok: boolean) => {
  checks.push({ what, detail, ok })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2_000)
await page.evaluate(`document.querySelector('[data-open]')?.click()`)
await page.waitForTimeout(1_200)

const sent = async () =>
  (await page.evaluate('window.__SENT')) as { action: string; args: Record<string, unknown> }[]

// --- 1. what the office stored is what is drawn -----------------------------
/*
  `page.evaluate` with a string, not `evaluateAll` with a callback: this file is
  type-checked as Node, where `HTMLElement` does not exist, and adding the DOM
  lib for one cast would change what every other Node script is allowed to say.
*/
/*
  Show the panels, because #25 stopped them being what a project opens on.

  The project Overview is a MAP now, with a Map / Panels toggle above it, and
  Map is the default. This suite kept asserting against whatever the Overview
  drew and reported "no panels at all" — an arrangement guarantee reading as
  broken because the audit was on a different screen, which is the third time
  in this repository an audit has needed a shell state set before it looks
  (`openRail` in #183, `shutDock` in #103, the settings restore in #190).

  Pressed rather than assumed: if the toggle is ever removed the click is a
  no-op and the check below fails honestly, which is the right direction.
*/
await page.evaluate(`document.querySelector('[data-overview="panels"]')?.click()`)
await page.waitForTimeout(700)

const drawn = (await page.evaluate(
  `[...document.querySelectorAll('[data-panel]')].map((e) => e.dataset.panel)`,
)) as string[]
check(
  'the arrangement the office holds is the one drawn',
  drawn.length === 0 ? 'no panels at all' : drawn.join(', '),
  drawn.length === 1 && drawn[0] === 'tasks',
)

// --- 2. changing it sends it to the office ----------------------------------
const panel = page.locator('[data-panel]').first()
if ((await panel.count()) === 0) {
  check('a panel to change', 'the board is empty — nothing else can be asserted', false)
  console.log('\n1/1 checks passed')
  process.exit(1)
}
await panel.hover()
await panel.locator('[data-narrower]').click()
await page.waitForTimeout(700)
let posts = await sent()
const saved = posts.filter((p) => p.action === 'dashboard_layout_set').at(-1)
check(
  'narrowing a panel reaches the office',
  saved === undefined ? 'nothing was sent' : `${saved.action} ${JSON.stringify(saved.args.p_slug)}`,
  saved !== undefined && saved.args.p_slug === subject.slug,
)
const body = saved?.args.p_panels as { id: string; w: number }[] | undefined
check(
  'and carries the new width, not the old one',
  body === undefined ? 'no panels in the body' : `w=${String(body[0]?.w)}`,
  Array.isArray(body) && body[0]?.w === 2,
)

/*
  ## The one that would have caught the original bug

  `layout()` prefers the office's copy, so the redraw immediately after a change
  read the arrangement as it was BEFORE the change and put the panel back. The
  save had worked and the screen disagreed with it — and a check that only
  asserted the request would have passed.
*/
/*
  Read through `$$eval` rather than a locator, because a locator WAITS. When
  this regressed the panel was not on the page at all and the suite died on a
  30-second timeout instead of reporting a failure — a check that crashes tells
  you less than one that says which assertion broke.
*/
const width = await page.evaluate(
  `document.querySelector('[data-panel="tasks"]')?.style.width ?? '(no tasks panel on the page)'`,
)
check(
  'and the screen agrees with what was saved',
  String(width),
  String(width).includes('66.6') || String(width).includes('66.7'),
)

// --- 3. removing the last panel resets rather than storing nothing ----------
await panel.hover()
await page.locator('[data-drop-panel]').first().click()
await page.waitForTimeout(700)
posts = await sent()
const last = posts.at(-1)
check(
  'emptying the board asks for a reset, never an empty layout',
  last === undefined ? 'nothing was sent' : last.action,
  last?.action === 'dashboard_layout_reset',
)

// ===========================================================================
// How a project looks (#83) — the same rule, the other feature
// ===========================================================================

await page.evaluate(`document.querySelector('[data-go="portfolio"]')?.click()`)
await page.waitForTimeout(1_200)

const marks = (await page.evaluate(
  `[...document.querySelectorAll('.cover')].map((c) =>
     c.querySelector('.covimg') ? 'image' : c.querySelector('.iconmark') ? 'icon' : 'art')`,
)) as string[]
check(
  'a project wearing an icon draws the icon, not the generated art',
  marks.join(', ') || 'no covers',
  marks[0] === 'icon',
)
const painted = await page.evaluate(
  `(() => {
     const m = document.querySelector('.iconmark');
     if (m === null) return '(no mark)';
     const c = getComputedStyle(m);
     return c.backgroundColor + ' / ' + (m.querySelector('svg') === null ? 'no glyph' : 'glyph');
   })()`,
)
/*
  The BACKGROUND, not only the glyph.

  The first cut painted a pale tint of the chosen hue over a background still
  set to the project's own colour, so a lilac rocket on a blue square was
  near-white on blue and the colour picker's choices barely registered. A
  transparent mark means that regression is back.
*/
check(
  'and the mark is painted in the colour he chose',
  String(painted),
  !String(painted).includes('rgba(0, 0, 0, 0)') && String(painted).includes('glyph'),
)

await page.evaluate(`document.querySelector('[data-open]')?.click()`)
await page.waitForTimeout(1_200)
await page.evaluate(`document.querySelector('[data-look]')?.click()`)
await page.waitForTimeout(900)
const grid = (await page.evaluate(
  `({ icons: document.querySelectorAll('[data-look-icon]').length,
      hues: document.querySelectorAll('[data-look-hue]').length,
      on: document.querySelector('[data-look-icon].on')?.dataset.lookIcon ?? '(none)' })`,
)) as { icons: number; hues: number; on: string }
check(
  'the picker offers about thirty marks and the palette',
  `${String(grid.icons)} marks, ${String(grid.hues)} colours`,
  grid.icons >= 28 && grid.hues === 6,
)
check('and shows which one is already chosen', grid.on, grid.on === 'rocket')

const before = sent.length
await page.evaluate(`document.querySelector('[data-look-icon="leaf"]')?.click()`)
await page.waitForTimeout(1_800)
const look = (await sent()).slice(before).find((x) => x.action === 'project_look')
check(
  'choosing a mark reaches the office',
  look === undefined ? 'nothing was sent' : JSON.stringify(look.args),
  look?.args.p_icon === 'leaf' && typeof look.args.p_slug === 'string',
)
/*
  Pressing the mark that is already on must take it OFF, and as a clear rather
  than a null — null cannot mean both "leave this alone" and "remove it", which
  is why the RPC takes `p_clear` at all.
*/
await page.evaluate(`document.querySelector('[data-look-icon="rocket"].on')?.click()`)
await page.waitForTimeout(1_500)
const cleared = (await sent()).at(-1)
check(
  'and pressing the chosen mark again takes it off',
  cleared === undefined ? 'nothing was sent' : JSON.stringify(cleared.args),
  JSON.stringify(cleared?.args ?? {}).includes('"p_clear":["icon"]'),
)

// --- 4. contact labels and fields are the office's, not the browser's (#110) --
//
// ADR-0021's last holdout. The failure is invisible to every other suite for
// exactly the reason the layout's was: a page that keeps labels in
// `localStorage` drags, filters, renders and captures perfectly, and is wrong
// only on the second device.

/*
  Close the look picker first. Section 3 left it open in `#viewer`, and a sheet
  covering the page swallows every click underneath it — which reads as "the
  button did nothing" and cost three red checks that were about the sheet and
  not about labels at all.
*/
await page.evaluate(
  `document.querySelectorAll('#viewer .close, #settings .close').forEach((b) => { b.click() })`,
)
await page.waitForTimeout(600)
const sheetShut = await page.evaluate(
  `document.querySelector('#viewer').hidden && document.querySelector('#settings').hidden`,
)
check(
  'the look picker closes',
  sheetShut === true ? 'both sheets hidden' : 'still open',
  sheetShut === true,
)

await page.evaluate(`document.querySelector('[data-tab="contacts"]')?.click()`)
await page.waitForTimeout(900)

const chips = (await page.evaluate(
  `[...document.querySelectorAll('[data-filter]')].map((e) => e.textContent.trim())`,
)) as string[]
check(
  'a label defined in the office is drawn',
  chips.length === 0 ? 'no filter chips at all' : chips.join(' | '),
  chips.some((c) => c.includes('Bespoke')),
)

/*
  The count beside the chip, not just the chip.

  `Planted Person` has `role: 'Client'`, so #107's derivation would put them
  under Client — and `labelsSet` says Grant already decided, and decided
  Bespoke. Bespoke reading 1 and Client reading 0 is the whole rule in two
  numbers, and getting it backwards is what "the derived set never merges into
  his choice" means when it fails.
*/
const counts = Object.fromEntries(
  (
    (await page.evaluate(
      `[...document.querySelectorAll('[data-filter]')].map((e) =>
         [e.textContent.replace(/[0-9]+$/, '').trim(), e.querySelector('.n')?.textContent ?? ''])`,
    )) as [string, string][]
  ).map(([k, v]) => [k, v]),
)
check(
  'his decision wins over the derived label (#107)',
  JSON.stringify(counts),
  counts.Bespoke === '1' && counts.Client === '0',
)

// `data-person`, not `data-contact`: the contacts TAB draws `.pcard` with the
// name, while `data-contact` is the dashboard panel's index-keyed card.
await page.evaluate(`document.querySelector('[data-person]')?.click()`)
await page.waitForTimeout(900)

const field = (await page.evaluate(
  `[...document.querySelectorAll('#viewer .field .t-label')].map((e) => e.textContent.trim())`,
)) as string[]
check(
  'a field he added is drawn from the office',
  field.join(', ') || 'no fields',
  field.includes('Cohort'),
)

const before4 = (await sent()).length
await page.evaluate(
  `document.querySelector('[data-toggle-label="22222222-2222-4222-8222-222222222222"]')?.click()`,
)
await page.waitForTimeout(1_200)
const toggled = (await sent()).slice(before4).find((x) => x.action === 'contact_labels_set')
check(
  'applying a label reaches the office',
  toggled === undefined ? 'nothing was sent' : JSON.stringify(toggled.args),
  Array.isArray(toggled?.args.p_labels) &&
    (toggled.args.p_labels as string[]).includes('22222222-2222-4222-8222-222222222222'),
)

const before5 = (await sent()).length
await page.evaluate(`
  const f = document.querySelector('[data-add-field]');
  if (f) { f.label.value = 'Zoom'; f.value.value = 'grant.rogers'; f.requestSubmit(); }
`)
await page.waitForTimeout(1_200)
const fielded = (await sent()).slice(before5).find((x) => x.action === 'contact_fields_set')
check(
  'adding a field reaches the office',
  fielded === undefined ? 'nothing was sent' : JSON.stringify(fielded.args),
  JSON.stringify(fielded?.args.p_fields ?? []).includes('Zoom'),
)

/*
  And the assertion that is the whole point of ADR-0021: after all of that,
  nothing was written to `localStorage`.

  Without this the suite passes for a page that sends to the office AND keeps a
  local copy — which is worse than either, because the two disagree the moment
  a second device touches it.
*/
const stored = await page.evaluate(`
  (() => { try { return localStorage.getItem('studio.people'); } catch (e) { return 'unreadable'; } })()
`)
check(
  'and nothing went to localStorage',
  stored === null ? 'the key is not there' : String(stored),
  stored === null,
)

/* -------------------------------------------------------------------------- *
 * 6. How it LOOKS belongs to the person too (#124, migration 0400).
 * -------------------------------------------------------------------------- */
/*
  ADR-0021's own instruction, rather than a parallel check:

    "Any new customisable surface should add a column or a table, not a key in
     localStorage, and should EXTEND verify:arrangement rather than inventing a
     parallel check."

  And its reason, which is exactly why appearance went unnoticed until #124
  asked for a density: a page that saves only to localStorage "drags, snaps,
  survives a reload and captures perfectly, and is wrong only on a second
  device, which no capture run has."

  So the question here is the same one the rest of this file asks — did it
  LEAVE the browser — and the answer has to be yes for a value that until now
  never did.
*/
await page.evaluate(`document.querySelector('[data-settings]')?.click()`)
await page.waitForTimeout(700)
await page.evaluate(`document.querySelector('[data-setting="appearance"]')?.click()`)
await page.waitForTimeout(700)

const beforeDensity = (await sent()).length
await page.evaluate(`document.querySelector('[data-density-pick="compact"]')?.click()`)
await page.waitForTimeout(700)
const densitySent = (await sent()).slice(beforeDensity).find((x) => x.action === 'appearance_set')

check(
  'choosing a density goes out to the office',
  densitySent === undefined
    ? 'nothing was sent'
    : `${densitySent.action} ${JSON.stringify((densitySent.args.p_settings as Record<string, unknown>)?.density)}`,
  densitySent !== undefined &&
    (densitySent.args.p_settings as Record<string, unknown>)?.density === 'compact',
)
/*
  The WHOLE object, not just the key that changed.

  `hq_appearance_set` stores one jsonb, so a partial write would drop the
  palette the moment the density changed. Asserted because the shape of the
  payload is the thing a caller gets wrong, and it would look fine on this
  device — where localStorage still has everything — and wrong on the next.
*/
check(
  'and it carries the whole appearance, not only what changed',
  densitySent === undefined
    ? 'nothing was sent'
    : Object.keys((densitySent.args.p_settings as Record<string, unknown>) ?? {}).join(', '),
  densitySent !== undefined &&
    ['palette', 'scheme', 'texture', 'density'].every(
      (k) => (densitySent.args.p_settings as Record<string, unknown>)?.[k] !== undefined,
    ),
)
check(
  'and the page is actually in it',
  String(await page.evaluate(`document.documentElement.dataset.density || ''`)),
  (await page.evaluate(`document.documentElement.dataset.density`)) === 'compact',
)

// --- and nothing threw ------------------------------------------------------
check('no uncaught JavaScript', crashes.join(' | ') || 'none', crashes.length === 0)

await browser.close()
server.close()

const passed = checks.filter((c) => c.ok).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
