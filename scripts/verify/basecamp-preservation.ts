/*
 * The preservation matrix, as a check rather than as a table nobody reruns.
 *
 * Failure E of the run's pre-mortem: a capability that still exists in code
 * but cannot be found through the new navigation is a regression, and it is
 * the one kind that every green test suite in the world will miss — the code
 * is there, the route is there, the function works. Only "can a person get to
 * it from here" fails.
 *
 * So the property, in both directions:
 *
 *  1. every project section the default studio has is reachable from the
 *     experimental project overview, either as a surface this experience
 *     renders or as an explicit, labelled link back into the current Team HQ;
 *  2. every global destination the default rail offers is reachable from the
 *     experimental shell;
 *  3. the persistent elements that live outside #root — the dock, the undo
 *     bar, the settings and document viewers, the drop layer — survive the
 *     experimental render, because that lifecycle is a structural requirement
 *     of this page and replacing #root is exactly what would break it;
 *  4. the default experience is unchanged: its routes open, its rail is
 *     there, and the experimental stylesheet has not reached it.
 *
 * The section list is read from app.js's own SECTIONS rather than restated
 * here. A copy would be a second place for it to rot, and a check that has to
 * be edited whenever a section is added is a check that will be edited to
 * agree with whatever shipped.
 */
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4637
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
const inPage = (body: string): string => `(() => { ${body} })()`

const APP = await readFile('web/studio/app.js', 'utf8')

/** The project sections the default studio has, read from its own list. */
const sections = (() => {
  const from = APP.indexOf('const SECTIONS = [')
  const to = APP.indexOf('\n]', from)
  const block = APP.slice(from, to)
  return [...block.matchAll(/\{ id: '([a-z-]+)', name: '([^']+)' \}/g)].map((m) => ({
    id: m[1] as string,
    name: m[2] as string,
  }))
})()

/** The global destinations the default rail offers. */
const railGoes = (() => {
  /*
    To the NEXT top-level declaration, not to a function that happens to be
    named. `commandBar` is defined seven hundred lines ABOVE `rail`, so
    slicing between the two names produced an empty string and no
    destinations at all — which the blind-check below caught on its first run
    rather than reporting a vacuous pass. The same correction this run made to
    tests/studio/command.test.ts, for the same reason.
  */
  const from = APP.indexOf('function rail()')
  const next = APP.indexOf('\nfunction ', from + 1)
  const block = APP.slice(from, next === -1 ? APP.length : next)
  return [...new Set([...block.matchAll(/data-go="([a-z-]+)"/g)].map((m) => m[1] as string))]
})()

if (sections.length < 5 || railGoes.length < 2) {
  console.error(
    `parsed ${String(sections.length)} section(s) and ${String(railGoes.length)} rail destination(s) out of app.js — the shapes have changed and this check has gone blind`,
  )
  process.exit(2)
}

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(500)
const slug = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bchome')
await page.waitForTimeout(500)

/* --- 1. every project section has a route from the overview ------------- */
/*
  WHAT "REACHABLE" MEANS, retargeted for project home v2, and this is the third
  retarget of the same lookup in two days - every one of them caused by a check
  naming the MECHANISM rather than the property.

  The property is unchanged: a person standing on the project home can get to
  every section the default studio has. v2 changed three of the mechanisms and
  nothing else:

   - a module heading is no longer a link to a separate address. It is a button
     that opens the expanded view as a modal over this page
     ([data-bc-expand="<id>"]). The address still exists and still works; this
     is simply the press;
   - Sources left the home entirely, into the three-dot menu, because Grant
     asked for it: "remove Where the material comes from as a module";
   - Project settings is in that same menu.

  So a section is reachable if the home carries ANY of: a link to it, a control
  that expands it, or an item in the page menu that opens it.
*/
const reachable = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('[data-bc-go], [data-bc-leave]')) {
       out.push(el.dataset.bcGo ?? el.dataset.bcLeave ?? '')
     }
     return out`),
)) as string[]

/** The ids the home can expand in place. */
const expands = (await page.evaluate(
  inPage(
    `return [...document.querySelectorAll('[data-bc-expand]')].map((el) => el.dataset.bcExpand ?? '')`,
  ),
)) as string[]

/** The ids the three-dot page menu reaches. */
const menuReaches = (await page.evaluate(
  inPage(`const panel = document.querySelector('[data-bc-pagemenu-panel]')
     if (panel === null) return []
     const out = []
     for (const el of panel.querySelectorAll('[data-bc-sources]')) out.push('sources')
     for (const el of panel.querySelectorAll('[data-bc-leave]')) {
       const bits = (el.dataset.bcLeave ?? '').split('/').filter((x) => x !== '')
       if (bits[0] === 'p' && bits[2] !== undefined) out.push(bits[2])
     }
     return out`),
)) as string[]

/*
  A found-nothing check reports a perfect score, so both new lookups get a
  floor before anything is concluded from them. The menu is the one that would
  go silently blind: it is rendered `hidden`, so an empty panel and a missing
  panel look identical from a count of visible things.
*/
check(
  'the home offers expandable modules and a page menu to read reachability from',
  expands.length > 0 && menuReaches.length > 0,
  `${String(expands.length)} expandable module(s), ${String(menuReaches.length)} page-menu destination(s)`,
)

const bare = slug.replace('/basecamp', '')
for (const s of sections) {
  if (s.id === 'overview') {
    /*
      THE OVERVIEW DOES NOT LINK TO ITSELF, and the first draft of this check
      reported that as a preservation gap. It is the landing surface — §17
      phase 3 and the acceptance matrix both require a project to OPEN on it
      with no extra view-selection step — so the property to assert is that
      arriving at a project put us there, which is stronger than finding a
      link to it would have been.
    */
    check(
      'Overview (overview) is where a project opens, so it needs no link to itself',
      (await page.locator('.bchome').count()) > 0 && page.url().endsWith(bare),
      page.url(),
    )
    continue
  }
  const own = reachable.includes(`${slug}/${s.id}`)
  const compat = reachable.includes(`${bare}/${s.id}`)
  const expanded = expands.includes(s.id)
  const inMenu = menuReaches.includes(s.id)
  check(
    `${s.name} (${s.id}) is reachable from the experimental overview`,
    own || compat || expanded || inMenu,
    own || compat || expanded || inMenu
      ? ''
      : `nothing on the home links to ${slug}/${s.id}, expands "${s.id}", or reaches it from the page menu`,
  )
}

/* --- 1b. every hand-off link lands where it says it does ---------------- */
/*
  A link into the current Team HQ is an offer, and an offer may only promise
  what the press can perform. Four of them promised /p/:slug/board, /chat,
  /jobs and /outputs — none of which is a section, so the default studio's own
  router dropped all four onto the project overview. Four links, four wrong
  destinations, and every one of them rendered, styled and pressable.

  The property: a hand-off path naming a project tab must name a tab the
  default studio actually has.
*/
const known = new Set(sections.map((x) => x.id))
/*
  EVERY OWNED SURFACE, not just the overview.

  The first draft collected hand-offs from the overview alone — and the four
  broken links this check exists for were on the TEAM surface, which it had
  never opened. An audit that has never opened a surface says nothing about
  it, and one that reports a clean sweep over surfaces it did not visit is
  worse than none.
*/
const handoffs: string[] = []
for (const s of sections) {
  if (s.id === 'settings') continue
  const to = s.id === 'overview' ? slug : `${slug}/${s.id}`
  await page.goto(url(to), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(300)
  handoffs.push(
    ...((await page.evaluate(
      inPage(
        `return [...document.querySelectorAll('[data-bc-leave]')].map((el) => el.dataset.bcLeave ?? '')`,
      ),
    )) as string[]),
  )
}
check(
  'the hand-off sweep actually visited surfaces and found links',
  handoffs.length > 0,
  'a sweep that found nothing reports a perfect score',
)
for (const h of [...new Set(handoffs)]) {
  const bits = h.split('/').filter((x) => x !== '')
  const tab = bits[0] === 'p' && bits[2] !== undefined ? bits[2] : null
  check(
    `the hand-off to ${h} names a destination the current Team HQ has`,
    tab === null || known.has(tab),
    tab === null
      ? ''
      : `"${tab}" is not one of ${[...known].join(', ')} — the default router would drop this on the overview`,
  )
}

/* --- 2. every global rail destination is reachable ---------------------- */
const GLOBAL: Record<string, string> = {
  portfolio: '/basecamp/',
  tasks: '/basecamp/tasks',
  lately: '/basecamp/activity',
}
for (const g of railGoes) {
  const want = GLOBAL[g]
  if (want === undefined) {
    check(
      `the rail destination "${g}" has an equivalent in the experiment`,
      false,
      'no mapping recorded',
    )
    continue
  }
  check(
    `the global destination "${g}" is reachable`,
    reachable.some((r) => r === want || r === want.replace(/\/$/, '')),
    `looked for ${want}`,
  )
}

/* --- 3. the persistent elements outside #root survive ------------------- */
const persistent = (await page.evaluate(
  inPage(
    `return ['dock', 'undobar', 'settings', 'viewer', 'droplayer'].filter((id) => document.getElementById(id) === null)`,
  ),
)) as string[]
check(
  'the elements that live outside #root survived the experimental render',
  persistent.length === 0,
  `missing: ${persistent.join(', ')}`,
)

/* The dock is not merely present — there is a way in. */
/*
  ON THE PROJECT HOME, which is where the way in now is.

  This ran wherever the tool loop above had finished, and v2 moved the chat
  control from the top row - where it was always present and where Grant said
  it duplicated the team communication - onto the project head. So it is asked
  for on the home. The consequence is real and worth stating: on a bare TOOL
  ADDRESS at desktop width there is no visible chat control, and the way back
  is the breadcrumb. That is acceptable while expanded views are modals over
  the home, and it is the first thing to revisit if Grant wants chat reachable
  from everywhere.

  A VISIBLE way in. `.first()` matched the tray's Chat control, which is
  phone-only and therefore invisible on a desktop - so the press timed out on
  a page where the blue Chat button was right there. Asserting that a way in
  EXISTS and that one of them can actually be pressed are two different
  claims, and only the second is worth having.
*/
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
check(
  'the team conversation can be opened from the experiment',
  (await page.locator('[data-bc-dock]:visible').count()) > 0,
)
await page.locator('[data-bc-dock]:visible').first().click()
await page.waitForTimeout(400)
check(
  'and pressing it actually opens the dock',
  (await page.evaluate(inPage("return document.getElementById('dock')?.hidden === false"))) ===
    true,
)

/* --- 4. the default experience is untouched ----------------------------- */
await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
check('the default experience still draws its rail', (await page.locator('.rail').count()) > 0)
check(
  'the default experience draws no experimental shell',
  (await page.locator('.bctop').count()) === 0,
)
check(
  'the experimental scope attribute is absent on the default route',
  (await page.evaluate(inPage('return document.documentElement.dataset.experience'))) === undefined,
)
for (const s of sections) {
  await page.goto(url(`${bare}/${s.id}`), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(350)
  check(
    `the default ${s.name} route still renders`,
    (await page.locator('.rail').count()) > 0 && (await page.locator('.bctop').count()) === 0,
  )
}

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
