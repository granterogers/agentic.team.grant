/*
 * TO-DOS, IN BOTH VIEWS, PRESSED RATHER THAN READ.
 *
 * Grant, 22 September: "The miniature To-Dos module remains functionally
 * broken. Fix interaction so that: task checkboxes work; tasks themselves can
 * be clicked where appropriate; changes immediately update the interface;
 * state persists correctly; the miniature view reflects the real underlying
 * task state. The expanded To-Dos interface has the same fundamental problem...
 * Do not accept an interface that merely looks interactive."
 *
 * "Merely looks interactive" is the whole reason this file exists and is why
 * every check below presses something and then asserts on what a PERSON can
 * see afterwards — the tick, the class, the same row after a reload, and the
 * other view of the same task. A check that asserted the store would pass
 * against an interface that never redraws.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4673
const server = await serveStudio(PORT)
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
  BACK TO THE BOARD, which is now more than one press.

  §21 made dismissal step exactly one level: a record inside a sheet closes to
  the sheet, and the sheet closes to the page. A single Escape used to do both,
  so loops like this one pressed once and carried on -- and now leave the sheet
  open, whose backdrop swallows the next click and reports as a timeout on a
  control that is perfectly fine.

  Pressing until nothing is open is the honest way to say "get me back to the
  page", and it is bounded so a surface that will not close fails as a test
  rather than hanging.
*/
const dismissAll = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    if ((await page.locator('[data-bc-expanded]').count()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const slug = await (async (): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
})()

const home = async (): Promise<void> => {
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-mod="tasks"]')
  await page.waitForTimeout(350)
}

await home()
await page.evaluate(
  inPage(`for (const k of Object.keys(localStorage)) {
   if (k.startsWith('bc.todos.') || k.startsWith('bc.layout.')) localStorage.removeItem(k)
 }
 return true`),
)
await home()

/* --- 1. the miniature offers real controls ------------------------------ */
const ticks = page.locator('[data-mod="tasks"] [data-bc-tick]')
const n = await ticks.count()
check('the miniature draws checkboxes', n > 0, `${String(n)} box(es)`)
const disabled = await page.locator('[data-mod="tasks"] [data-bc-tick][disabled]').count()
check(
  'and not one of them is disabled',
  disabled === 0,
  `${String(disabled)} disabled — every row a visitor without a token sees carries no id, so a disabled box means the whole module is a picture`,
)
check(
  'and every task title in the miniature is a control',
  (await page.locator('[data-mod="tasks"] [data-bc-task-open]').count()) > 0,
)

/* --- 2. ticking one changes what is on the screen, at once -------------- */
const firstKey = (await ticks.first().getAttribute('data-bc-tick')) ?? ''
const titleOf = async (key: string): Promise<string> =>
  (await page
    .locator(`[data-mod="tasks"] [data-bc-task-open="${key}"]`)
    .first()
    .innerText()) as string
const subject = await titleOf(firstKey)
await ticks.first().check()
await page.waitForTimeout(500)
const nowDone = async (key: string): Promise<boolean> =>
  (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-tick="${key}"]')
       if (el === null) return false
       const row = el.closest('.bctask') ?? el.closest('.bcitem')
       return el.checked === true && (row === null || row.className.includes('--done'))`),
  )) as boolean
check(
  `ticking "${subject}" marks it done on screen straight away`,
  await nowDone(firstKey),
  'the box is checked AND the row carries the done class — a checked box on an unchanged row is the interface not having redrawn',
)

/* --- 3. it survives a reload -------------------------------------------- */
await home()
check('and it is still done after a reload', await nowDone(firstKey))

/* --- 4. the expanded view agrees ---------------------------------------- */
await page.locator('[data-mod="tasks"] .bcmodhead').first().click()
await page.waitForTimeout(500)
check(
  'the To-dos module opens expanded',
  (await page.locator('[data-bc-expanded="tasks"]').count()) === 1,
)
const inExpanded = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-expanded="tasks"] [data-bc-tick="${firstKey}"]')
     return el === null ? 'missing' : (el.checked ? 'done' : 'open')`),
)) as string
check(
  'and the expanded view shows the same task as done',
  inExpanded === 'done',
  `the expanded view says "${inExpanded}" about a task the miniature says is done — two readers of one fact`,
)

/* --- 5. the expanded view can change it back ---------------------------- */
/*
  A COMPLETED TASK IS IN A DRAWER on the full surface - deliberately, and it
  is why this step opens it rather than asserting the row is where an open
  task would be. The drawer's own summary is the other half of the feedback
  that the tick landed, so it is checked too.
*/
/*
  IT STAYS ON THE PAGE.

  Grant, 23 September: "Clicking/completing a to-do must not make it
  unexpectedly disappear. Completed items should remain visible and clearly
  display a completed/done state."

  This suite used to assert the OPPOSITE - that a ticked task moved into a
  collapsed drawer - which is precisely the behaviour reported as the defect.
  The drawer is gone: done work sits after the open work, marked done.
*/
const ticked = page.locator(`[data-bc-expanded="tasks"] [data-bc-tick="${firstKey}"]`).first()
check(
  'a completed task is still on the page, not hidden in a drawer',
  (await ticked.count()) === 1 && (await ticked.isVisible()),
  'the row disappeared from view when it was ticked',
)
check(
  'and it visibly says it is done',
  (await page.evaluate(
    inPage(`const box = document.querySelector('[data-bc-expanded="tasks"] [data-bc-tick="${firstKey}"]')
       if (box === null) return false
       const row = box.closest('.bcitem')
       const title = row === null ? null : row.querySelector('.bcitemtitle')
       return box.checked === true &&
         row !== null && row.className.includes('bcitem--done') &&
         title !== null && getComputedStyle(title).textDecorationLine.includes('line-through')`),
  )) === true,
  'a done row did not carry the done state',
)
check(
  'and nothing hides completed work behind a summary any more',
  (await page.locator('details.bcdone').count()) === 0,
)

/* No drawer to open any more: the row is right there. */
await page.locator(`[data-bc-expanded="tasks"] [data-bc-tick="${firstKey}"]`).first().uncheck()
await page.waitForTimeout(600)
const back = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-tick="${firstKey}"]')
     return el === null ? 'missing' : (el.checked ? 'done' : 'open')`),
)) as string
check('unticking it in the expanded view puts it back', back === 'open', back)

/* --- 6. and the miniature agrees, without a reload ---------------------- */
await dismissAll()
await page.waitForTimeout(400)
const mini = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-mod="tasks"] [data-bc-tick="${firstKey}"]')
     return el === null ? 'missing' : (el.checked ? 'done' : 'open')`),
)) as string
check('and the miniature agrees the moment the modal closes', mini === 'open', mini)

/* --- 7. a task opens its record from the miniature ---------------------- */
await page.locator(`[data-mod="tasks"] [data-bc-task-open="${firstKey}"]`).first().click()
await page.waitForTimeout(600)
const record = await page.locator('[data-bc-expanded="tasks"]').innerText()
check(
  'pressing a task title in the miniature opens that task',
  record.includes(subject),
  record.replace(/\n/g, ' / ').slice(0, 140),
)
check(
  'and the record is not the error state',
  !record.includes('not on this project any more'),
  record.replace(/\n/g, ' / ').slice(0, 200),
)
await dismissAll()

/* --- 8. the surface, at its own address --------------------------------- */
await page.goto(url(`${slug}/tasks`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(400)
const surfaceDisabled = await page.locator('[data-bc-tick][disabled]').count()
check('no checkbox on the To-dos surface is disabled either', surfaceDisabled === 0)
check(
  'Add a Task is the primary action on the To-dos surface',
  (await page.locator('.bcrecordhead [data-bc-addtask]').count()) === 1 &&
    (await page.locator('.bcrecordhead [data-bc-addtask]').first().innerText()).trim() ===
      'Add a Task',
  (await page.locator('.bcrecordhead').first().innerText()).replace(/\n/g, ' / '),
)
check(
  'and making a list is still offered, separately',
  (await page.locator('[data-bc-addlist]').count()) >= 1,
)

/* --- 9. Add a Task opens a form that is actually there ------------------ */
await page.locator('.bcrecordhead [data-bc-addtask]').first().click()
await page.waitForTimeout(350)
const formOpen = (await page.evaluate(
  inPage(`const f = [...document.querySelectorAll('[data-bc-taskform]')].find((x) => !x.hidden)
     if (f === undefined) return 'none'
     const input = f.querySelector('input')
     return input === null ? 'no field' : (document.activeElement === input ? 'focused' : 'open')`),
)) as string
check(
  'pressing Add a Task opens a form and puts the cursor in it',
  formOpen === 'focused',
  formOpen,
)

/* --- 10. THE SCHEDULE'S OWN REFERENCES ---------------------------------- */
/*
  Grant, 22 September: *"Schedule entries currently contain broken references.
  For example, clicking Conduct first five interviews can produce: This task is
  not in the project anymore."*

  It was one key scheme too many. The schedule's agenda items were addressed
  by `t.id`, which is empty for every row without a record behind it, so the
  record lookup was handed an empty string and correctly reported that no such
  task exists. The miniature, the surface, the card table and the schedule all
  ask the port for the key now - so this check opens EVERY schedule entry
  rather than the one he happened to press, because a class of defect is not
  fixed by fixing the instance.
*/
await home()
const agenda = page.locator('[data-mod="schedule"] [data-bc-task-open]')
const entries = await agenda.count()
check('the schedule offers entries to open', entries > 0, `${String(entries)} entries`)
let broken = 0
const brokenNames: string[] = []
for (let i = 0; i < entries; i += 1) {
  const item = agenda.nth(i)
  const name = (await item.innerText()).trim()
  await item.click()
  await page.waitForTimeout(450)
  const body = await page.locator('[data-bc-expanded]').first().innerText()
  if (body.includes('not on this project any more') || body.includes('not in the project')) {
    broken += 1
    brokenNames.push(name)
  } else if (!body.includes(name)) {
    broken += 1
    brokenNames.push(`${name} (opened something else)`)
  }
  await dismissAll()
}
check('every schedule entry opens the task it names', broken === 0, brokenNames.join(', '))

/* --- 11. adding a task actually adds one -------------------------------- */
/*
  Grant's journey list has "add a task" in it, and the deployed preview has no
  office token - so "Read only, no token in this browser" was the whole of
  what pressing Add a Task did. A prototype that cannot be exercised cannot be
  judged, and judging it is what the preview is for.
*/
await page.goto(url(`${slug}/tasks`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(400)
const made = `Audit task ${String(Date.now()).slice(-5)}`
await page.locator('.bcrecordhead [data-bc-addtask]').first().click()
await page.waitForTimeout(300)
const field = page.locator('[data-bc-taskform]:not([hidden]) input').first()
await field.fill(made)
await page.locator('[data-bc-taskform]:not([hidden])').locator('[data-bc-tasksave]').first().click()
await page.waitForTimeout(700)
check(
  'adding a task puts it on the list',
  (await page.locator('.bcmain').innerText()).includes(made),
)
await page.goto(url(`${slug}/tasks`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(400)
check(
  'and it is still there after a reload',
  (await page.locator('.bcmain').innerText()).includes(made),
)

/* --- 12. THE RECORD PAGE'S OWN CONTROLS --------------------------------- */
/*
  THE THIRD INSTANCE OF ONE DEFECT, found by grepping for its shape rather
  than by waiting for it to be reported. The record's Save and Mark done were
  disabled for any row with no office id - which is every row in the deployed
  preview, exactly as the checkbox was. A class of defect is not fixed by
  fixing the two instances somebody noticed.
*/
await page.goto(url(`${slug}/tasks`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(400)
await page.locator('[data-bc-task-open]').first().click()
await page.waitForTimeout(600)
check(
  'no control on the task record is disabled',
  (await page.locator('.bcmain [disabled]').count()) === 0,
  `${String(await page.locator('.bcmain [disabled]').count())} disabled control(s)`,
)
const recordTitle = (await page.locator('.bcrecordhead h1').innerText()).trim()
await page.locator('#bc-edit-who').fill('Emma')
await page.locator('#bc-edit-due').fill('2026-10-15')
await page.locator('[data-bc-tasksave-edit]').click()
await page.waitForTimeout(700)
check(
  'editing who it is for and when it is due is kept',
  (await page.locator('#bc-edit-who').inputValue()) === 'Emma' &&
    (await page.locator('#bc-edit-due').inputValue()) === '2026-10-15',
  `${await page.locator('#bc-edit-who').inputValue()} / ${await page.locator('#bc-edit-due').inputValue()}`,
)
await page.locator('[data-bc-taskdone]').click()
await page.waitForTimeout(700)
await page.goto(url(`${slug}/tasks`), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcmain')
await page.waitForTimeout(500)
const listNow = await page.locator('.bcmain').innerText()
/*
  THE PROPERTY, not the drawer's old summary line.

  This asserted that the page said "completed task" - the wording of the
  collapsed drawer that used to swallow finished work. The drawer is gone, so
  the assertion had to change; what it should have been asking all along is
  whether the task is STILL TICKED after a reload, which is what persistence
  means and what Grant asked to see verified.
*/
const stillDone = (await page.evaluate(
  inPage(`const rows = [...document.querySelectorAll('.bcitem')]
     const row = rows.find((el) => (el.textContent ?? '').includes(${JSON.stringify(recordTitle)}))
     if (row === undefined) return 'the task is not on the page at all'
     const box = row.querySelector('input[type=checkbox]')
     if (box === null) return 'the row has no checkbox'
     return box.checked ? 'done' : 'open'`),
)) as string
check(
  `marking "${recordTitle}" done from its record is still true after a reload`,
  stillDone === 'done',
  `${stillDone}; the list read: ${listNow.replace(/\n/g, ' / ').slice(0, 120)}`,
)

/*
 * --- THE COMPLETION TARGET -----------------------------------------------
 *
 * Grant: "Investigate the current click target/interaction because completion
 * currently behaves inconsistently. Make the entire intended completion
 * control reliable."
 *
 * So it is measured: every tick is a 44px target whose centre hit-tests to
 * ITSELF - which is the half that catches something invisible lying over it,
 * and the half a size check alone cannot see.
 */
for (const [where, path] of [
  ['the to-dos surface', `${slug}/tasks`],
  ['the project home miniature', slug],
] as [string, string][]) {
  await page.goto(url(path), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcitem, [data-mod="tasks"]')
  await page.waitForTimeout(500)
  /*
    HIT-TESTED ONLY WHERE A HIT TEST MEANS ANYTHING.

    `elementFromPoint` answers null for a coordinate outside the viewport, so
    the first version of this reported every target below the fold as
    "covered" - five of eleven, which looked exactly like the defect it was
    hunting. The size is measured for all of them; the covering test is for the
    ones actually on screen, and the count it managed is reported so a run that
    could only test one cannot pass quietly.
  */
  const targets = (await page.evaluate(
    inPage(`const out = []
       for (const hit of document.querySelectorAll('.bctickhit')) {
         const r = hit.getBoundingClientRect()
         if (r.width < 2) continue
         /*
           VISIBLE MEANS INSIDE ITS OWN PANE TOO.

           A miniature lives in a scroll container, so a row scrolled out of it
           is still inside the VIEWPORT rect while being clipped - and the
           point then hit-tests to whatever module is drawn there, which the
           first version of this reported as six covered targets. Clipped is
           not covered.
         */
         let clip = hit.parentElement
         while (clip !== null && clip !== document.body) {
           const cs = getComputedStyle(clip)
           if (/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflow)) break
           clip = clip.parentElement
         }
         const within = clip === null || clip === document.body
           ? true
           : (() => {
               const c = clip.getBoundingClientRect()
               return r.top >= c.top - 1 && r.bottom <= c.bottom + 1
             })()
         const onScreen = within && r.top >= 0 && r.bottom <= window.innerHeight
         const at = onScreen
           ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
           : null
         out.push({
           w: Math.round(r.width),
           h: Math.round(r.height),
           onScreen,
           own: onScreen && at !== null && at.closest('.bctickhit') === hit,
         })
       }
       return out`),
  )) as { w: number; h: number; onScreen: boolean; own: boolean }[]
  const reachable = targets.filter((t) => t.onScreen)
  check(
    `${where}: every completion target is at least 44px`,
    targets.length > 0 && targets.every((t) => t.w >= 44 && t.h >= 44),
    targets
      .filter((t) => t.w < 44 || t.h < 44)
      .map((t) => `${String(t.w)}x${String(t.h)}`)
      .join(', ') || `${String(targets.length)} target(s)`,
  )
  check(
    `${where}: and nothing is lying over any of them`,
    reachable.length > 0 && reachable.every((t) => t.own),
    `${String(reachable.filter((t) => !t.own).length)} of ${String(reachable.length)} on-screen target(s) covered`,
  )
}

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
