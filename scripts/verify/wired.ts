/*
  Every control in the interface is looked up by something (#105, #74).

  Grant, 11 September: *"Verify all interactive controls: Check buttons and
  links across the interface. Each should perform its intended action."*

  `verify:controls` presses things and watches what happens. That is the right
  check and it is expensive — minutes per route — and it can only report on
  what it manages to reach. This is the cheap complement, and it found what the
  expensive one did not: it walks every screen, collects every `data-*`
  attribute on every visible button and link, and asks whether ANY source file
  ever looks that attribute up.

  An attribute nothing queries is a control nothing can have wired. It is a
  necessary condition rather than a sufficient one — a handler can still be
  attached to a detached node, which is a different bug — but it is exact,
  it takes seconds, and it does not depend on a control being reachable by a
  robot that knows how to open the right sheet.

  What it found on its first run, after eight screens: `data-hire`. The
  "+ Bring someone in" button in Settings > Team, the other half of a roster
  feature whose `staff_retire` had existed alone since migration 0079. Nothing
  anywhere looked it up. Nobody had noticed, including a full press-everything
  audit, because the audit runs without a token and that button is only drawn
  for a writer (#74).

  Run with a token seeded, for exactly that reason: without one, `canWrite()`
  is false and most of the write controls are never in the DOM to be collected.
*/

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const T: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.woff2': 'font/woff2',
}
const srv = createServer((q, r) => {
  let p = join('web/studio', decodeURIComponent((q.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html')
  // A dotless path is a route, as on the host (#382: the older studio is under /classic).
  if (!existsSync(p) && extname(p) === '') p = join('web/studio', 'index.html')
  if (!existsSync(p)) {
    r.writeHead(404)
    r.end('no')
    return
  }
  r.writeHead(200, { 'content-type': T[extname(p)] ?? 'application/octet-stream' })
  r.end(readFileSync(p))
})
await new Promise<void>((ok) => srv.listen(4418, '127.0.0.1', ok))

// Every data-* attribute the source actually looks up.
/*
  Every module in the studio, found rather than listed.

  This was a hardcoded list of nineteen filenames, and the twentieth module was
  uncovered by construction: `project-settings.js` (#36) queries ten data
  attributes and the audit reported all ten as "NOT looked up by any source
  file — these controls cannot be wired", because it had never read the file
  that wires them.

  Which is this audit's own complaint about other audits, turned on itself: a
  check that looks somewhere other than where the code is passes, or fails, for
  the wrong reason. A directory walk cannot go stale.

  `skins.css` stays named because it is the only stylesheet that carries a
  selector a control is addressed by, and reading every CSS file to find one
  would be the opposite mistake.
*/
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : [],
  )

// Stylesheets are NOT a lookup (review: a control that is styled but never wired must still be reported).
const src = [...walk('web/studio')]
  .map((f) => {
    try {
      return readFileSync(f, 'utf8')
    } catch {
      return ''
    }
  })
  .join('\n')
const queried = new Set<string>()
for (const m of src.matchAll(/\[data-([a-z-]+)[\]=]/g)) {
  if (m[1] !== undefined) queried.add(m[1])
}
// A script that sets a state attribute names it in a quoted string (`setAttribute('data-quiet', …)`).
for (const m of src.matchAll(/['"]data-([a-z-]+)['"]/g)) {
  if (m[1] !== undefined) queried.add(m[1])
}
// `dataset.hireGo` and `data-hire-go` are the same attribute spelled two ways,
// so the camelCase form is folded back to the dashed one before comparing.
for (const m of src.matchAll(/dataset\.([A-Za-z]+)/g)) {
  const name = m[1]
  if (name !== undefined) queried.add(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
}

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } })
const pg = await ctx.newPage()
pg.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
/*
  Team HQ (`/`) is the product; `/classic/` is the retired studio kept unlinked (ADR-0019, ADR-0051). This walk visits the
  product by its own addresses. It runs signed out, so the controls a writer alone is shown are not in the DOM; they are
  covered by the Sample Person runs, not by this check.
*/
await pg.goto('http://127.0.0.1:4418/', { waitUntil: 'domcontentloaded' })
await pg.waitForTimeout(1200)

const found = new Map<string, string>()
/*
  And buttons carrying NO attribute at all (#105).

  The check above compares the attributes it finds against the attributes the
  source queries — so a button with no `data-*` is invisible to it. It has
  nothing to compare. Not a hypothetical gap: `emptyState()` renders its
  "Add a task" / "Add a document" / "Add someone" action as a bare
  `<button class="btn">`, the Tasks header does the same, and the first version
  of this check reported no dead controls with every one of them on screen.

  A button here is wired through a data attribute or a form submit. One with
  neither cannot be doing anything.

  The obvious filter — `b.type !== 'submit'` — is WRONG and silently empties
  this check: `HTMLButtonElement.type` returns "submit" for any button with no
  `type` attribute, which is nearly every button in this codebase. The first
  version of this scan used it and reported a clean screen while "Add a task"
  sat on it. Being inside a `<form>` is the real test.
*/
const bare = new Map<string, string>()
let screensWalked = 0
const scan = async (where: string) => {
  screensWalked++
  const rows = (await pg.evaluate(`
    [...document.querySelectorAll('button, a, [role="button"]')]
      .filter(b => b.offsetParent !== null)
      .flatMap(b => [...b.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name.slice(5)))
  `)) as string[]
  for (const r of rows) if (!found.has(r)) found.set(r, where)

  const naked = (await pg.evaluate(`
    [...document.querySelectorAll('button')]
      .filter(b => b.offsetParent !== null)
      .filter(b => !b.closest('form'))
      .filter(b => ![...b.attributes].some(a => a.name.startsWith('data-')))
      .map(b => ({
        label: (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 48),
        classes: [...b.classList],
      }))
      .filter(x => x.label.length > 0)
  `)) as { label: string; classes: string[] }[]
  /*
    A class the source selects on counts as wired.

    Not every control is addressed by a data attribute: the sheet close buttons
    are `$('.close', v)`, which is a perfectly good handle and predates the
    convention. Flagging them would train whoever runs this to ignore it, which
    is how a check with one false positive becomes a check nobody reads.
  */
  for (const x of naked) {
    if (
      x.classes.some(
        (c) => src.includes(`.${c}'`) || src.includes(`.${c}"`) || src.includes(`.${c} `),
      )
    )
      continue
    if (!bare.has(x.label)) bare.set(x.label, where)
  }
}
await scan('home')
/* The project's own screens, by the addresses the product routes to (shell.js TOOLS). Overview is the project's address. */
const PROJECT = '/p/legacy-coaching-course'
for (const tool of [
  '',
  'tasks',
  'board',
  'chat',
  'schedule',
  'team',
  'documents',
  'activity',
  'contacts',
  'sources',
  'settings',
]) {
  await pg.goto(`http://127.0.0.1:4418${PROJECT}${tool === '' ? '' : `/${tool}`}`, {
    waitUntil: 'domcontentloaded',
  })
  await pg.waitForTimeout(900)
  await scan(`project/${tool === '' ? 'overview' : tool}`)
}
/*
  Project Settings, all four panes (#36).

  Its own loop rather than a fifth entry in the list above, because it has a
  second level and a payload of its own — the pane fetches before it draws, so
  scanning it at a tab switch's 450ms would scan the word "Reading the office…"
  and report four screens with no controls on them, which is a green result
  about nothing.

  All four, not one. This audit had never opened the office settings sheet
  either, until it did and found `data-hire` — the other half of a roster
  feature whose `staff_retire` had existed alone since 0079.
*/
/*
  Global Settings, the sheet opened by its own control (#158: a page you can leave). Each tab is pressed by its visible
  name. A walk that reached fewer than three tabs has checked nothing, so it is a failure, not a pass.
*/
await pg.goto(`http://127.0.0.1:4418${PROJECT}`, { waitUntil: 'domcontentloaded' })
await pg.waitForTimeout(900)
await pg.locator('[data-bc-settings]:visible').first().click({ force: true })
await pg.waitForTimeout(900)
await scan('settings/open')
let settingsTabs = 0
for (const name of [
  'Team',
  'Autonomy and approvals',
  'Requests',
  'What it has learned',
  'Services',
  'Messaging',
  'Appearance',
  'Usage and health',
  'Help',
]) {
  const tab = pg.locator('#settings button', { hasText: new RegExp(`^\\s*${name}\\b`) }).first()
  // A renamed or missing tab is a failure of this walk, not a tab that was skipped (review: silent continue hid it).
  if ((await tab.count()) === 0) {
    console.log(
      `verify:wired — the Settings tab "${name}" is not on the page; the walk cannot skip it.`,
    )
    process.exit(1)
  }
  await tab.click({ force: true })
  await pg.waitForTimeout(450)
  settingsTabs++
  await scan(`settings/${name.toLowerCase()}`)
}
if (settingsTabs < 3) {
  console.log(
    `verify:wired — the Settings walk reached ${String(settingsTabs)} tab(s); at least three are required, so nothing was checked there.`,
  )
  process.exit(1)
}
const orphans = [...found].filter(([k]) => !queried.has(k))
await b.close()
srv.close()

console.log(
  `\nverify:wired — ${String(found.size)} control attributes across the screens walked (${String(screensWalked)} scans)`,
)
let bad = 0
if (orphans.length > 0) {
  bad += orphans.length
  console.log('NOT looked up by any source file — these controls cannot be wired:')
  for (const [k, w] of orphans) console.log(`  data-${k}   (first seen on ${w})`)
}
if (bare.size > 0) {
  bad += bare.size
  console.log('buttons with no data attribute and no submit — nothing can be listening:')
  for (const [t, w] of bare) console.log(`  "${t}"   (on ${w})`)
}
if (bad === 0) {
  console.log('every one is looked up, and no button is bare. No dead controls.')
} else {
  process.exit(1)
}
