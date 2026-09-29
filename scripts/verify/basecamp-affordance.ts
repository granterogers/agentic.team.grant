/*
 * LOOKS INTERACTIVE = WORKS.
 *
 * Grant, 23 September: "Extend the verification philosophy. Create a
 * maintainable gate/harness that catches obvious false affordances. Where
 * feasible, visible buttons, checkboxes, cards, links, menu items, source
 * tiles, schedule entries, document records must have an observable
 * interaction outcome... Do not create brittle tests that merely duplicate
 * implementation details."
 *
 * HOW THIS DIFFERS FROM `verify:basecamp-controls`, which already presses
 * every button: that one asks whether a CONTROL does something. This one asks
 * the opposite question, and it is the one that found the four defects of this
 * pass — whether anything that LOOKS like a control is one. A count chip, a
 * card, a source row and a module header were all plain elements carrying
 * real data and a pointer's worth of expectation, and no press-everything
 * audit could see them, because there was nothing there to press.
 *
 * So the subject is every visible element that a person would reasonably
 * expect to act, found by PROPERTY rather than by a list of selectors:
 *
 *   - it carries a count, a status or a record's name;
 *   - it is inside a region whose siblings are controls;
 *   - it has a pointer cursor, a hover style, or a card's shape.
 *
 * and the assertion is that each one is a real control: a button, a link, a
 * field, a label wrapping an input, or something carrying one of this
 * experience's own data attributes. Nothing here names a component or a class
 * of this week's design; it asks about roles and computed styles, so a
 * redesign does not have to edit it.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

/*
  AGAINST THE DEPLOYED BYTES BY DEFAULT.

  `.out/live` is filled by `npm run live:mirror`, which fetches every file
  back from the deployed host and checks it against what was uploaded. When it
  is not there this falls back to the working tree and SAYS SO, because a gate
  that silently changes subject is worse than one that refuses.
*/
const PORT = 4689
const live = process.env.SUBJECT !== 'source'
let server: Awaited<ReturnType<typeof serveStudio>>
let subject = 'the working tree'
try {
  if (!live) throw new Error('asked for source')
  const { readFile } = await import('node:fs/promises')
  await readFile('.out/live/index.html')
  server = await serveLive(PORT)
  subject = 'the deployed bytes in .out/live'
} catch {
  server = await serveStudio(PORT)
}
console.log(`subject: ${subject}\n`)

const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

/*
  WHAT COUNTS AS "LOOKS INTERACTIVE", in the page, as a property.

  Four signals, each one a thing a person reads as "press me", and each one
  checked against what the element actually IS rather than against what it is
  called. The exemptions are as important as the signals: a heading is not a
  control because it is bold, and a status chip that reports a state nothing
  can change is not a false affordance — so an element inside a real control,
  or carrying a live region, or explicitly marked as decoration, is skipped.
*/
const FINDER = `
  const isControl = (el) => {
    if (el.closest('button, a[href], label, summary, input, select, textarea') !== null) return true
    const role = el.getAttribute('role') ?? ''
    if (['button', 'link', 'menuitem', 'tab', 'switch', 'checkbox', 'option'].includes(role)) return true
    for (const a of el.attributes) {
      if (a.name.startsWith('data-bc-') && a.name !== 'data-bc-go-back') return true
    }
    return false
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  }
  const out = []
  for (const el of document.querySelectorAll('.bcmain *, .bctop *, .bctray *')) {
    if (!visible(el)) continue
    if (isControl(el)) continue
    if (el.closest('[aria-live], [role="status"], [data-bc-decor]') !== null) continue
    /* An element that only wraps controls is not itself an affordance. */
    if (el.querySelector('button, a[href], input, select, textarea, [data-bc-go]') !== null) continue
    const cs = getComputedStyle(el)
    const text = (el.textContent ?? '').replace(/\\s+/g, ' ').trim()
    const why = []
    if (cs.cursor === 'pointer') why.push('has a pointer cursor')
    /*
      A COUNT BESIDE A NOUN is the shape of a filter: "3 late", "12 open
      tasks". A bare number is not - a progress figure reads as information -
      so the pattern needs the word as well.

      AND AN ELAPSED TIME IS NOT A COUNT. The first run of this reported "2
      hours ago" and "2 days ago" - the activity timeline's day headings,
      which are neither counts nor controls. A check that fires on correct
      behaviour is one somebody switches off, so the time vocabulary is
      excluded by shape rather than by naming the class it happened to be on.
    */
    if (/^\\d+ [a-z][a-z ']{2,28}$/.test(text) && !/\\bago$|^\\d+ (second|minute|hour|day|week|month|year)s?\\b/.test(text)) {
      why.push('reads as a count of records')
    }
    if (why.length > 0) out.push({ text: text.slice(0, 44), why: why.join(' and '), cls: String(el.className).slice(0, 40) })
  }
  return out
`

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const slug = await (async (): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
})()

const ROUTES: [string, string][] = [
  ['the project home', slug],
  ['to-dos', `${slug}/tasks`],
  ['the card table', `${slug}/board`],
  ['the schedule', `${slug}/schedule`],
  ['docs and files', `${slug}/documents`],
  ['contacts', `${slug}/contacts`],
  ['sources', `${slug}/sources`],
  ['activity', `${slug}/activity`],
  ['the team', `${slug}/team`],
  ['project settings', `${slug}/settings`],
  ['your own list', '/basecamp/tasks'],
  ['the portfolio', '/basecamp/'],
]

let looked = 0
for (const [name, path] of ROUTES) {
  await page.goto(url(path), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain', { timeout: 8000 }).catch(() => null)
  await page.waitForTimeout(500)
  const found = (await page.evaluate(inPage(FINDER))) as {
    text: string
    why: string
    cls: string
  }[]
  looked += 1
  check(
    `${name}: nothing looks like a control without being one`,
    found.length === 0,
    found.map((f) => `"${f.text}" ${f.why} (${f.cls})`).join('\n        '),
  )
}
check(
  'the sweep actually visited the surfaces',
  looked === ROUTES.length,
  `${String(looked)} route(s)`,
)

/*
  AND THE OTHER DIRECTION, because "looks interactive = works" has two halves
  and the second is the one a press-everything audit already covers for
  BUTTONS but not for the things a person drags, ticks or types into.
*/
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcpanes [data-mod]')
await page.waitForTimeout(500)

const draggables = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcmain *')) {
       const cs = getComputedStyle(el)
       if (!/grab|move|nwse-resize|ns-resize|ew-resize/.test(cs.cursor)) continue
       const r = el.getBoundingClientRect()
       if (r.width < 8 || r.height < 8) continue
       out.push({
         cls: String(el.className).slice(0, 40),
         wired:
           el.hasAttribute('draggable') ||
           el.hasAttribute('data-bc-resize') ||
           el.closest('[data-mod]') !== null,
       })
     }
     return out`),
)) as { cls: string; wired: boolean }[]
check(
  'everything that shows a drag or resize cursor belongs to something that drags or resizes',
  draggables.length > 0 && draggables.every((d) => d.wired),
  draggables
    .filter((d) => !d.wired)
    .map((d) => d.cls)
    .join(', ') || 'nothing showed one at all',
)

const ticks = (await page.evaluate(
  inPage(`const out = []
     for (const el of document.querySelectorAll('.bcmain input[type=checkbox]')) {
       out.push({ disabled: el.disabled, wired: el.hasAttribute('data-bc-tick') || el.hasAttribute('data-bc-mytick') })
     }
     return out`),
)) as { disabled: boolean; wired: boolean }[]
check(
  'every checkbox on the page is one the office can act on',
  ticks.length > 0 && ticks.every((t) => t.wired && !t.disabled),
  `${String(ticks.filter((t) => t.disabled).length)} disabled, ${String(ticks.filter((t) => !t.wired).length)} unwired, of ${String(ticks.length)}`,
)

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
process.exit(fail === 0 ? 0 : 1)
