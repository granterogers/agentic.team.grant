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

import { existsSync, readFileSync, statSync } from 'node:fs'
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
const src = [
  'app.js',
  'office.js',
  'call.js',
  'settings.js',
  'usage.js',
  'people.js',
  'panels.js',
  'canvas.js',
  'chat.js',
  'command.js',
  'pdf.js',
  'page.js',
  'workspace.js',
  'cover.js',
  'data.js',
  'alive.js',
  'motion.js',
  'appearance.js',
  'skins.css',
]
  .map((f) => {
    try {
      return readFileSync(join('web/studio', f), 'utf8')
    } catch {
      return ''
    }
  })
  .join('\n')
const queried = new Set<string>()
for (const m of src.matchAll(/\[data-([a-z-]+)[\]=]/g)) {
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
await pg.addInitScript(`try{localStorage.setItem('hq.token','audit')}catch(e){}`)
await pg.goto('http://127.0.0.1:4418/', { waitUntil: 'domcontentloaded' })
await pg.waitForTimeout(1000)

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
const scan = async (where: string) => {
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
await scan('portfolio')
await pg.locator('.project[data-open="legacy-coaching-course"]').click()
await pg.waitForTimeout(700)
for (const tab of ['overview', 'team', 'documents', 'tasks', 'contacts', 'sources', 'activity']) {
  await pg.locator(`[data-tab="${tab}"]`).first().click()
  await pg.waitForTimeout(450)
  await scan(`project/${tab}`)
}
await pg.locator('[data-settings]').first().click()
await pg.waitForTimeout(500)
for (const t of [
  'team',
  'behaviour',
  'governance',
  'connections',
  'channels',
  'models',
  'appearance',
  'setup',
  'help',
]) {
  await pg.locator(`[data-setting="${t}"]`).click()
  await pg.waitForTimeout(450)
  await scan(`settings/${t}`)
}
const orphans = [...found].filter(([k]) => !queried.has(k))
await b.close()
srv.close()

console.log(`\nverify:wired — ${String(found.size)} control attributes across 17 screens`)
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
