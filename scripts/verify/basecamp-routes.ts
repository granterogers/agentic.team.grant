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

/* ---------------------------------------------------------- default first */

await open('/')
check(
  'the default Team HQ still opens at /',
  (await page.locator('.rail').count()) > 0,
  'the default studio draws a left rail; its absence means the experiment has taken the root',
)
check(
  'the default experience carries no experience attribute',
  (await page.evaluate(inPage('return document.documentElement.dataset.experience'))) === undefined,
  'a stray attribute on the root is what would let the experimental stylesheet reach the product',
)
const defaultBc = await page.locator('.bctop').count()
check('the default experience draws no experimental shell', defaultBc === 0)

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
  canvas === 'rgb(11, 21, 27)',
  `body background is ${canvas}; expected the --bc-canvas value rgb(11, 21, 27)`,
)

/* ------------------------------------------- deep addresses under the prefix */

const slug = (await page.evaluate(
  inPage(`const first = document.querySelector('[data-bc-go^="/basecamp/p/"]')
     return first === null ? null : first.dataset.bcGo`),
)) as string | null
check('the home surface offers a project', slug !== null)

if (slug !== null) {
  await open(slug)
  check(
    `a project opens on its overview at ${slug}`,
    (await page.locator('.bcgrid').count()) > 0,
    'the overview is the landing surface; there must be no extra view-selection step',
  )
  check(
    'the overview draws tool previews',
    (await page.locator('.bcpreview').count()) >= 6,
    `found ${String(await page.locator('.bcpreview').count())} previews`,
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

/* ------------------------------------------------- the default is still fine */

await open('/')
check(
  'the default Team HQ still opens after the experiment has been visited',
  (await page.locator('.rail').count()) > 0,
)
check(
  'the scope attribute is removed again on the default route',
  (await page.evaluate(inPage('return document.documentElement.dataset.experience'))) === undefined,
  'it must be deleted rather than set to another value: an attribute-presence selector would still match',
)

/* ------------------- every owned tool's address opens THAT tool ------------- */

/*
  A LINK THAT LANDS SOMEWHERE ELSE IS THE WORST KIND OF DEAD CONTROL, because
  it looks like it worked.

  /basecamp/p/:slug/activity was accepted by the SPA rewrite and then
  rewritten to the overview by the router, which validated the tab against
  the DEFAULT studio's SECTIONS — and Activity was removed from that list in
  #222. So the Activity preview linked back to the page it sat on. Four
  capture runs photographed the overview under the name "activity", and it
  surfaced only because two published files had identical byte counts.

  So the property is not "the address renders something". It is that the
  address renders THE TOOL IT NAMES, read off the breadcrumb the surface
  draws for itself.
*/
if (slug !== null) {
  const owned: [string, string][] = [
    ['tasks', 'Tasks'],
    ['team', 'Agentic Team'],
    ['documents', 'Documents & Assets'],
    ['activity', 'Activity'],
    ['contacts', 'Contacts'],
    ['sources', 'Sources & Integrations'],
  ]
  for (const [id, name] of owned) {
    await open(`${slug}/${id}`)
    const crumb = (await page.evaluate(
      inPage(
        "const c = document.querySelector('.bccrumb'); return c === null ? '' : (c.textContent ?? '').trim()",
      ),
    )) as string
    const heading = (await page.evaluate(
      inPage(
        "const h = document.querySelector('.bcrecordhead h1'); return h === null ? '' : (h.textContent ?? '').trim()",
      ),
    )) as string
    check(
      `${slug}/${id} opens the ${name} tool, not something else`,
      crumb.includes(name) && heading === name,
      `breadcrumb "${crumb}", heading "${heading}" — an address that silently lands on the overview is a link back to the page you pressed it on`,
    )
  }
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
