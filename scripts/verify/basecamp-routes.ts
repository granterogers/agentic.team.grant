/*
 * Both addresses boot, and neither has replaced the other.
 *
 * The EARLY ACCEPTANCE GATE of this workstream, as a check rather than as a
 * sentence: the default Team HQ still opens and behaves as before, the
 * experimental Basecamp-inspired experience opens at a different address, and
 * the two are visibly different pages rather than the same one twice.
 *
 * It also covers the two ways an alternate address quietly breaks — the SPA
 * rewrite failing to catch the new prefix, and root-relative assets failing to
 * resolve under a nested path — because both fail as a blank page that a
 * screenshot of the right size makes look plausible.
 */
import '../../src/safety/arm.ts'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

/*
  Browser code travels as a STRING, which is this repository's existing
  convention for every check that drives Chromium. tsconfig carries no DOM
  library — deliberately, because `src/` is Node and Deno and adding one would
  hand those files a second definition of fetch — so a `document` written
  inside a typed callback fails the typecheck. A string body is never
  typechecked, which is the trade every other browser check here already
  makes.
*/
const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4631
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}

const open = async (path: string): Promise<void> => {
  await page.goto(url(path), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
}

/* ------------------------------------- the root is Team HQ since #382 */

await open('/')
check(
  'Team HQ opens at /',
  (await page.locator('.bctop').count()) > 0 && (await page.locator('.rail').count()) === 0,
  'the root is the product; a left rail here means the older studio has taken it back',
)

/* ----------------------- the older studio, kept apart at /classic */

await open('/classic')
check(
  'the older studio still opens at /classic',
  (await page.locator('.rail').count()) > 0,
  'the older studio draws a left rail; kept, unlinked, while anything still needs it',
)
check(
  'the older studio carries no experience attribute',
  (await page.evaluate(inPage('return document.documentElement.dataset.experience'))) === undefined,
  'a stray attribute on the root is what would let the experimental stylesheet reach the product',
)
const defaultBc = await page.locator('.bctop').count()
check('the older studio draws no Team HQ shell', defaultBc === 0)

/* ------------------------------------------------------------ experiment */

await open('/basecamp')
check(
  'the experimental experience opens at /basecamp',
  (await page.locator('.bctop').count()) > 0,
  'the SPA rewrite must send a dotless path to index.html, and goToPath must read the prefix',
)
check(
  'the experimental experience sets the scope attribute',
  (await page.evaluate(inPage('return document.documentElement.dataset.experience'))) ===
    'basecamp',
)
check(
  'the experimental experience does not draw the default rail',
  (await page.locator('.rail').count()) === 0,
)

/*
  ASSETS, measured rather than assumed.

  index.html asks for root-absolute stylesheets, so they should resolve
  identically at any depth — but "should" is how a nested route ships broken.
  A computed background of the canvas token proves the experimental stylesheet
  both loaded and applied.
*/
const canvas = await page.evaluate(inPage('return getComputedStyle(document.body).backgroundColor'))
check(
  'the experimental stylesheet loaded and applied',
  canvas === 'rgb(214, 211, 204)',
  `body background is ${canvas}; expected the light stone --bc-canvas value rgb(214, 211, 204) (the default scheme since 8 October 2026)`,
)

/* ------------------------------------------- deep addresses under the prefix */

await page.locator('[data-bc-menu]').click()
await page.waitForTimeout(200)
const slug = (await page.evaluate(
  inPage(`const first = document.querySelector('.bcmenupanel [data-bc-go^="/p/"]')
     return first === null ? null : first.dataset.bcGo`),
)) as string | null
check('the project menu offers a project', slug !== null)
await page.keyboard.press('Escape')

if (slug !== null) {
  await open(slug)
  check(
    `a project opens on its overview at ${slug}`,
    (await page.locator('.bchome').count()) > 0,
    'the overview is the landing surface; there must be no extra view-selection step',
  )
  check(
    'the overview draws tool previews',
    /*
      THE PROPERTY, NOT THE ARTEFACT. This asked for six elements of class
      `bcpreview`, which is one of three things that have drawn a project home
      here. What it means is that the home presents the project's tools rather
      than a link to them, and a tool on the home is a module either way.
    */
    (await page.locator('.bchome [data-mod], .bchome .bcpreview').count()) >= 6,
    `found ${String(await page.locator('.bchome [data-mod], .bchome .bcpreview').count())} tool module(s) on the home`,
  )

  await open(`${slug}/tasks`)
  check(
    'a deep tool address opens directly',
    (await page.locator('.bccrumb').count()) > 0,
    'a reload of a tool address must land on that tool, not bounce to the overview',
  )
}

await open('/basecamp/tasks')
check(
  'the personal list opens at /basecamp/tasks',
  (await page.locator('.bcsectiontitle').count()) > 0,
)

/* ------------------------------------- the older studio is still apart */

await open('/classic')
check(
  'the older studio still opens after Team HQ has been visited',
  (await page.locator('.rail').count()) > 0,
)
check(
  'the scope attribute is removed again on the older studio',
  (await page.evaluate(inPage('return document.documentElement.dataset.experience'))) === undefined,
  'it must be deleted rather than set to another value: an attribute-presence selector would still match',
)

/* ------------------- every tool address renders what it names ------------- */

/*
  A LINK THAT LANDS SOMEWHERE ELSE IS THE WORST KIND OF DEAD CONTROL, because
  it looks like it worked. This property has now caught the same defect twice
  in two places, so it is asserted in BOTH directions and the tool list is
  read out of the source rather than restated here.

  First time: /basecamp/p/:slug/activity was accepted by the SPA rewrite and
  rewritten to the overview by the router, which validated the tab against
  the DEFAULT studio's SECTIONS — and Activity was removed from that list in
  #222. The Activity preview linked back to the page it sat on. It surfaced
  only because two published capture files had identical byte counts.

  Second time, in the fix for the first: the router then accepted the whole
  of TOOLS, which is the list of what the overview LINKS TO — including
  Project Settings, a hand-off rather than a surface. So /settings rendered
  the overview while the address went on saying /settings, which is worse:
  the first defect corrected the URL on its way past and this one left a
  bookmark permanently lying about what it opens.

  Hence both halves. An owned tool renders itself. Anything else falls back
  to the overview AND the address is corrected to match what is on screen.
*/
const SHELL = await readFile('web/studio/bc/shell.js', 'utf8')
const tools = (() => {
  const from = SHELL.indexOf('export const TOOLS = [')
  const to = SHELL.indexOf('\n]', from)
  const block = SHELL.slice(from, to)
  return [...block.matchAll(/\{ id: '([a-z-]+)', name: '([^']+)', own: (true|false) \}/g)].map(
    (m) => ({
      id: m[1] as string,
      name: m[2] as string,
      own: m[3] === 'true',
    }),
  )
})()

/*
  THE BLIND GUARD ASKS ABOUT THE PARSER, not about the product.

  It required at least one tool with `own: false` - true while Project
  Settings was a hand-off into the default studio, and false the moment that
  stopped being true, which is the change this run made deliberately. A guard
  that fails when the product improves is the "assert the mechanism" defect
  wearing a safety jacket. What it is FOR is noticing that the regex has
  stopped matching, so it asks that: a plausible number of tools, every one of
  them with a name, and at least one owned.
*/
if (tools.length < 5 || !tools.some((t) => t.own) || tools.some((t) => t.name === '')) {
  console.error(
    `parsed ${String(tools.length)} tool(s) out of bc/shell.js, ${String(tools.filter((t) => t.own).length)} owned — the shape has changed and this check has gone blind`,
  )
  process.exit(2)
}

if (slug !== null) {
  for (const t of tools) {
    await open(`${slug}/${t.id}`)
    const seen = (await page.evaluate(
      inPage(`const c = document.querySelector('.bccrumb')
         const h = document.querySelector('.bcrecordhead h1')
         return JSON.stringify({
           crumb: c === null ? '' : (c.textContent ?? '').replace(/\\s+/g, ' ').trim(),
           heading: h === null ? '' : (h.textContent ?? '').trim(),
           url: location.pathname,
         })`),
    )) as string
    const o = JSON.parse(seen) as { crumb: string; heading: string; url: string }

    if (t.own) {
      check(
        `${slug}/${t.id} opens the ${t.name} tool, not something else`,
        o.crumb.includes(t.name) && o.heading === t.name,
        `breadcrumb "${o.crumb}", heading "${o.heading}"`,
      )
    } else {
      /*
        A hand-off is not a route of this experience. Landing on the overview
        is correct; keeping the address is not.

        NOTHING TAKES THIS BRANCH TODAY - every tool is the experience's own
        since Project Settings came inside - and it is kept rather than
        deleted because the next tool that cannot be built here will need it,
        and re-deriving the rule from scratch is how the address came to lie
        the first time.
      */
      check(
        `${slug}/${t.id} is a hand-off, so it falls back and CORRECTS the address`,
        o.url === slug,
        `the address stayed at "${o.url}" while the overview rendered — a bookmark to it would lie about what it opens`,
      )
    }
  }

  /*
    `board` came off this list when §10 gave the Card Table its own address.
    It is here as a reminder of what the list is FOR: an address this
    experience does not serve must correct itself rather than render the
    overview while the URL goes on promising something else.
  */
  for (const bogus of ['nonsense', 'messages', 'files']) {
    await open(`${slug}/${bogus}`)
    const url = (await page.evaluate(inPage('return location.pathname'))) as string
    check(
      `${slug}/${bogus} falls back and corrects the address`,
      url === slug,
      `stayed at "${url}"`,
    )
  }
}

/* ------------------- every Jump result goes where it says ----------------- */

/*
  JUMP IS MADE ENTIRELY OF DESTINATIONS, so it is the surface where a link
  that lands somewhere plausible and wrong does the most damage: you press
  it, you arrive somewhere real, and you conclude the SEARCH is broken
  rather than the link.

  It had eight. Every specialist row navigated to the home page, so Jump
  offered eight results reading "Claire · Chief of Staff" and every one of
  them dropped you on the projects list. The same defect as the Activity
  tool, in the one place built out of nothing but addresses — and invisible
  to the control audit, which scopes itself to the shell and the main
  surface rather than to an open dialog.

  The property: no result may point at the home page except the row that IS
  Home, and every result must point somewhere this experience routes to.
*/
await open('/basecamp')
await page.locator('[data-bc-menu]').click()
await page.waitForTimeout(250)
const menuRows = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcmenupanel [data-bc-go]')) {
       out.push({ name: (el.textContent ?? '').trim(), to: el.dataset.bcGo })
     }
     return out`),
)) as { name: string; to: string }[]

check(
  'the project menu offers destinations to check',
  menuRows.length >= 3,
  `${String(menuRows.length)} row(s)`,
)

/* Read the destination by pressing each row and seeing where it lands, not by reading an attribute. */
const landed: { name: string; url: string }[] = []
for (const r of menuRows) {
  await open('/basecamp')
  await page.locator('[data-bc-menu]').click()
  await page.waitForTimeout(200)
  const row = page.locator('.bcmenupanel [data-bc-go]', { hasText: r.name }).first()
  if ((await row.count()) === 0) continue
  await row.click()
  await page.waitForTimeout(500)
  landed.push({
    name: r.name,
    url: (await page.evaluate(inPage('return location.pathname'))) as string,
  })
}
for (const l of landed) {
  check(
    `menu entry "${l.name}" goes somewhere of its own`,
    l.url !== '/' && l.url !== '',
    `landed on ${l.url}, the empty canvas, which is where an entry with no real destination ends up`,
  )
}

/* --------------------- a record is a place you can return to --------------- */

/*
  A RECORD PAGE THAT IS NOT IN THE ADDRESS COSTS THREE THINGS AT ONCE, and
  only the third one is loud: it cannot be linked or bookmarked, a reload
  loses it, and Back out of it leaves the application entirely instead of
  returning to the list.

  That last one is what a person hits first. §18 requires the
  record-to-tool return path to always be clear, and Back is the commonest
  way anybody takes it — so this asserts the whole round trip rather than
  just that the address changed.
*/
if (slug !== null) {
  await open(`${slug}/tasks`)
  const listUrl = await page.evaluate(inPage('return location.pathname'))
  await page.locator('[data-bc-task-open]').first().click()
  await page.waitForTimeout(500)
  const recUrl = (await page.evaluate(inPage('return location.pathname'))) as string
  check(
    'opening a record gives it its own address',
    recUrl !== listUrl && recUrl.startsWith(`${slug}/tasks/`),
    recUrl,
  )

  const recTitle = (await page.evaluate(
    inPage(
      "const h = document.querySelector('.bcrecordhead h1'); return h === null ? '' : (h.textContent ?? '').trim()",
    ),
  )) as string
  await page.goBack()
  await page.waitForTimeout(600)
  check(
    'Back from a record returns to the list, not out of the application',
    (await page.evaluate(inPage('return location.pathname'))) === listUrl,
    `landed on ${String(await page.evaluate(inPage('return location.pathname')))}`,
  )

  /* And the address survives a reload, which is what makes it shareable. */
  await open(recUrl)
  check(
    'a record address opens that record after a full reload',
    (await page.evaluate(
      inPage(
        "const h = document.querySelector('.bcrecordhead h1'); return h === null ? '' : (h.textContent ?? '').trim()",
      ),
    )) === recTitle,
    `expected "${recTitle}"`,
  )
}

/* ------------------------------------- no surface sits on a skeleton for ever */

/*
  A SKELETON THAT NEVER RESOLVES IS BROKEN, and it is the most convincing
  broken thing a page can show: it says "coming" for ever and looks like work
  in progress rather than a fault.

  My Tasks did exactly that in a signed-out browser. The read was kicked when
  you NAVIGATED to the surface and by nothing when you ARRIVED at it, so a
  reload or a pasted link shimmered indefinitely — and there is no list to
  read without a token anyway, so the honest answer was never a skeleton at
  all. It was in a capture for several runs before anybody opened it.

  The property, rather than that one screen: after a surface has settled,
  nothing on it is still claiming to be loading. Signed out, because that is
  the state every capture in this sandbox is in and therefore the state a
  defect can hide in longest.
*/
const surfaces = ['/basecamp', '/basecamp/tasks', '/basecamp/activity', '/basecamp/search']
if (slug !== null) {
  for (const t of ['', '/tasks', '/team', '/documents', '/contacts', '/sources', '/activity']) {
    surfaces.push(`${slug}${t}`)
  }
}
for (const where of surfaces) {
  await open(where)
  await page.waitForTimeout(1400)
  const skeletons = await page.locator('.bcskel').count()
  check(
    `${where}: nothing is still claiming to be loading once the surface has settled`,
    skeletons === 0,
    `${String(skeletons)} skeleton row(s) remain`,
  )
}

/* --- §20: no way out of the new interface -------------------------------- */
/*
  Grant, 24 September: *"Audit the entire new Basecamp experience... The new
  product should not unexpectedly dump Grant into the old Team HQ interface."*
  He found four -- Running work, Active jobs, Team chat, Team board -- and the
  instruction is explicit that fixing those four is not the job: *"Do not
  simply patch these four examples. Create/extend an automated route/navigation
  check that identifies Basecamp UI actions which resolve into legacy
  surfaces."*

  So this walks every surface and asks of every link and every navigating
  control: does it stay inside `/basecamp`? A project path without that prefix
  IS the old interface -- that is what `toolPath` returned for a tool this
  experience did not serve, and it is how all four escapes were spelled.

  The hash addressing the review build uses is allowed for, because a capture
  deployment rewrites addresses and an audit that failed on that would be
  reporting the harness.
*/
for (const where of surfaces) {
  await open(where)
  await page.waitForTimeout(900)
  const out = (await page.evaluate(`(() => {
    const leaves = []
    // Since #382 every plain address is Team HQ's; the older studio is the one at /classic.
    const inside = (u) => u === '' || (u[0] === '/' && u.indexOf('/classic') !== 0) || (u.indexOf('#/') === 0 && u.indexOf('#/classic') !== 0)
    for (const a of document.querySelectorAll('a[href]')) {
      const raw = a.getAttribute('href') || ''
      if (raw.indexOf('http') === 0 || raw.indexOf('mailto:') === 0 || raw.indexOf('tel:') === 0 || raw[0] === '#') continue
      if (!inside(raw)) leaves.push('link ' + raw + ' — ' + (a.textContent || '').trim().slice(0, 24))
    }
    for (const el of document.querySelectorAll('[data-bc-go], [data-bc-leave]')) {
      const to = el.getAttribute('data-bc-leave') || el.getAttribute('data-bc-go') || ''
      if (to !== '' && !inside(to)) {
        leaves.push('control ' + to + ' — ' + (el.textContent || '').trim().slice(0, 24))
      }
    }
    return leaves
  })()`)) as string[]
  check(`${where}: nothing here leads back to the old interface`, out.length === 0, out.join(' | '))
}

check('nothing was thrown on any route', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()

let bad = 0
for (const c of checks) {
  if (!c.ok) bad += 1
  console.log(
    `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.ok || c.detail === '' ? '' : `\n        ${c.detail}`}`,
  )
}
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
