/*
 * The task journey, driven end to end in a real browser over real HTTP.
 *
 * ## What this proves, and what it does not
 *
 * It proves the whole CLIENT half of §17 phase 4: the inline Add expands and
 * focuses, Cancel leaves no record and restores focus, a save goes through
 * `office.js` as a real POST with the real action and arguments, the row
 * appears, IT SURVIVES A RELOAD, a tick persists, a failing write rolls the
 * tick back visibly, and a read-only browser is told so rather than being let
 * to press a control that cannot work.
 *
 * It does NOT prove the production RPCs. This environment carries no token,
 * so the office at the other end is a stand-in that speaks the gateway's
 * contract. Two things keep that honest rather than theatrical:
 *
 *  - `verify:basecamp-actions` checks every action name and required argument
 *    this experience sends against the ACTIONS map in the gateway's own
 *    source, so the stand-in cannot accept something production would refuse;
 *  - the stand-in is a SERVER, not a stubbed function. The page uses the same
 *    `act()` client, the same fetch, the same bearer header and the same
 *    error contract it uses against the real office.
 *
 * Proving it against the production office is recorded as HUMAN_BLOCKED in
 * docs/basecamp/RUN-LEDGER.md and needs one credential, not more work.
 */
import '../../src/safety/arm.ts'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

/* Browser code travels as a string — see serve-studio.ts and the other
   browser checks; tsconfig carries no DOM library on purpose. */
const inPage = (body: string): string => `(() => { ${body} })()`

const PAGE_PORT = 4634
const API_PORT = 4635

/* ------------------------------------------------------- the office stand-in */

type Task = { id: string; title: string; who: string | null; due: string | null; state: string }
const tasks: Task[] = [
  { id: 't-1', title: 'An existing commitment', who: 'claire', due: null, state: 'todo' },
]
/*
  ONE OUTPUT, AND THE DOCUMENTS IT HAS BECOME.

  `documents` is a list rather than a flag so that a duplicate is
  REPRESENTABLE: a stand-in that could not create two could not prove the page
  does not ask for two, which is the found-nothing shape. Importing the same
  output twice appends nothing because the real index does not — the four
  migrations that got that right are recorded in CLAUDE.md — and the check
  below reads the length, not a boolean somebody set.
*/
const requests = [
  {
    id: 'job-1',
    ask: 'Turn the six modules into a one-page outline',
    from: 'Grant · chat',
    who: 'oliver',
    asked: '2 days ago',
    state: 'review',
    delivered: '2 days ago',
    output: { id: 'out-1', imported: false, title: 'Course one-pager', kind: 'made', size: 'A4' },
    derived: ['WS01 — Legacy Opening Assessment', 'Journey VS Destination'],
  },
]
const documents: { id: string; fromOutput: string; job: string; producedBy: string }[] = []
const seen: { action: string; args: Record<string, unknown> }[] = []
/* Set to make the NEXT write fail, so the rollback path can be driven. */
let failNext: string | null = null

const office = createServer((req, res) => {
  let raw = ''
  req.on('data', (c: Buffer) => {
    raw += c.toString()
  })
  req.on('end', () => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'content-type': 'application/json',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET') {
      const section = url.searchParams.get('section')
      if (section === 'studio') {
        res.writeHead(200, cors)
        res.end(
          JSON.stringify({
            data: {
              generated_at: new Date().toISOString(),
              crew: [
                { slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' },
                /* A second person, so the record's picker has somebody to
                   change TO: with one, the persistence check below picked the
                   current assignee and an ignored edit passed. */
                { slug: 'research-director', name: 'Emma', role: 'Research', state: 'idle' },
              ],
              projects: [
                {
                  slug: 'journey-subject',
                  name: 'Journey subject',
                  purpose: 'The project this check drives. Nothing here is Grant’s.',
                  tasks,
                  documents: documents.map((d) => ({
                    title: 'Course one-pager',
                    kind: 'made',
                    origin: d.producedBy,
                    size: 'A4',
                  })),
                  contacts: [],
                  sources: [],
                  activity: [],
                  waiting: [],
                  modules: [],
                  requests,
                },
              ],
            },
          }),
        )
        return
      }
      res.writeHead(200, cors)
      res.end(JSON.stringify({ data: [] }))
      return
    }
    const body = JSON.parse(raw === '' ? '{}' : raw) as {
      action?: string
      args?: Record<string, unknown>
    }
    const action = body.action ?? ''
    const args = body.args ?? {}
    seen.push({ action, args })

    if (failNext === action) {
      failNext = null
      /*
        A RECOVERABLE failure in the gateway's own shape: http 200 with an
        error inside `result`, which is how an RPC refuses on its own terms.
        `act()` turns that into an exception with the server's words, which is
        what the page must show — not a transport error, which would be a
        different message and a different remedy.
      */
      res.writeHead(200, cors)
      res.end(
        JSON.stringify({ result: { error: 'The office refused that: try again in a moment.' } }),
      )
      return
    }

    if (action === 'task_add') {
      const id = `t-${String(tasks.length + 1)}`
      tasks.push({
        id,
        title: String(args.p_title ?? ''),
        who: (args.p_assignee as string | null) ?? null,
        due: (args.p_due_on as string | null) ?? null,
        state: 'todo',
      })
      res.writeHead(200, cors)
      res.end(JSON.stringify({ result: { id } }))
      return
    }
    if (action === 'output_import') {
      const output = String(args.p_output ?? '')
      const already = documents.some((d) => d.fromOutput === output)
      if (!already) {
        /*
          Provenance travels WITH the document, which is the whole point of
          §9's addition: the job that produced it and who ran it, recorded at
          the moment it becomes canonical. Afterwards nobody can reconstruct
          it, which is why Failure L is about this instant and not about
          storage in general.
        */
        const req = requests.find((r) => r.output.id === output)
        documents.push({
          id: `doc-${String(documents.length + 1)}`,
          fromOutput: output,
          job: req?.id ?? '',
          producedBy: req?.who ?? '',
        })
        if (req !== undefined) req.output.imported = true
      }
      res.writeHead(200, cors)
      res.end(
        JSON.stringify({
          result: { document_id: documents.find((d) => d.fromOutput === output)?.id, already },
        }),
      )
      return
    }
    if (action === 'task_update') {
      const t = tasks.find((x) => x.id === args.p_task_id)
      if (t !== undefined) {
        const clear = (args.p_clear as string[] | undefined) ?? []
        /*
          `p_clear` is how the office is told to EMPTY a field: null means
          "leave it alone" to hq_task_update, so a stand-in that treated null
          as a clear would let a page that never sends p_clear look correct.
        */
        if (clear.includes('assignee')) t.who = null
        else if (args.p_assignee != null) t.who = String(args.p_assignee)
        if (clear.includes('due_on')) t.due = null
        else if (args.p_due_on != null) t.due = String(args.p_due_on)
      }
      res.writeHead(200, cors)
      res.end(JSON.stringify({ result: { ok: true } }))
      return
    }
    if (action === 'task_state') {
      const t = tasks.find((x) => x.id === args.p_task_id)
      if (t !== undefined) t.state = String(args.p_state ?? 'todo')
      res.writeHead(200, cors)
      res.end(JSON.stringify({ result: { ok: true } }))
      return
    }
    res.writeHead(200, cors)
    res.end(JSON.stringify({ result: { ok: true } }))
  })
})
await new Promise<void>((r) => {
  office.listen(API_PORT, '127.0.0.1', () => {
    r()
  })
})

const server = await serveStudio(PAGE_PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PAGE_PORT)}${p}`

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

/*
  Point the page at the stand-in and give it a token, BEFORE any script runs.
  `window.HQ_API` is the seam office.js already reads, so nothing in the
  product is modified to make this checkable.
*/
await ctx.addInitScript(
  `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}
   try { localStorage.setItem('hq.token', 'journey-token') } catch {}`,
)

const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const open = async (p: string): Promise<void> => {
  await page.goto(url(p), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(700)
}

/* ------------------------------------------------ the journey, in order */

await open('/basecamp/p/journey-subject/tasks')
check('the tool opens on real data from the office', (await page.locator('.bcitem').count()) === 1)

/* --- Cancel creates nothing and restores focus (§10.2) --- */
await page.locator('[data-bc-addtask]').first().click()
await page.waitForTimeout(200)
check(
  'inline Add expands in place and focuses the name field',
  /*
    THE FORM'S OWN FIRST FIELD. §6 gave every list its own add form, so the
    id now carries the list - `bc-task-title-m4`. What §10.2 asks for is that
    Add focuses the field you type the name into, which is a property of the
    form and survives the next change to how a list is addressed.
  */
  (await page.evaluate(
    inPage(`const f = document.querySelector('[data-bc-taskform]:not([hidden])')
       return f !== null && document.activeElement === f.querySelector('input')`),
  )) === true,
)
await page
  .locator('[data-bc-taskform]:not([hidden]) input[name="title"]')
  .fill('Abandoned before saving')
await page.locator('[data-bc-taskform]:not([hidden]) [data-bc-taskcancel]').click()
await page.waitForTimeout(200)
check('Cancel collapses the form', await page.locator('[data-bc-taskform]').isHidden())
check(
  'Cancel restored focus to the control that opened it',
  (await page.evaluate(
    inPage("return document.activeElement?.hasAttribute('data-bc-addtask') === true"),
  )) === true,
)
check(
  'Cancel created no record',
  tasks.length === 1,
  `${String(tasks.length)} task(s) at the office`,
)
await page.locator('[data-bc-addtask]').first().click()
await page.waitForTimeout(150)
check(
  'a reopened form does not hold the abandoned text',
  (await page.locator('[data-bc-taskform]:not([hidden]) input[name="title"]').inputValue()) === '',
)

/* --- validation appears by the field (§11.3) --- */
await page.locator('[data-bc-taskform]:not([hidden]) [data-bc-tasksave]').click()
await page.waitForTimeout(200)
check(
  'an empty title is refused by the field, not by a toast',
  (await page.locator('.bcerror').count()) > 0,
)
check(
  'nothing was sent to the office for an empty title',
  seen.filter((s) => s.action === 'task_add').length === 0,
)

/* --- a real write --- */
await page
  .locator('[data-bc-taskform]:not([hidden]) input[name="title"]')
  .fill('Write the acceptance evidence')
await page.locator('[data-bc-taskform]:not([hidden]) input[name="due"]').fill('2026-10-02')
/*
  Chosen from the team, not typed. It typed 'claire', which only this suite's
  fake office accepted: hq_task_add resolves p_assignee against
  public.staff.slug, and Claire's is chief-of-staff.
*/
const addWho = page.locator('[data-bc-taskform]:not([hidden]) select[name="who"]')
const claireValue =
  (await addWho.locator('option').filter({ hasText: 'Claire' }).first().getAttribute('value')) ?? ''
await addWho.selectOption(claireValue)
await page.locator('[data-bc-taskform]:not([hidden]) [data-bc-tasksave]').click()
await page.waitForTimeout(900)

const add = seen.find((s) => s.action === 'task_add')
check('the save reached the office as task_add', add !== undefined)
check(
  'it carried the project, the title, the due date and the assignee',
  add?.args.p_project === 'journey-subject' &&
    add?.args.p_title === 'Write the acceptance evidence' &&
    add?.args.p_due_on === '2026-10-02' &&
    claireValue === 'chief-of-staff' &&
    add?.args.p_assignee === claireValue,
  JSON.stringify(add?.args ?? {}),
)
check('the office now holds two tasks', tasks.length === 2)
check(
  'the form collapsed after a successful save',
  await page.locator('[data-bc-taskform]').isHidden(),
)

/* --- THE RELOAD. Persistence is not a render, it is what survives one. --- */
await open('/basecamp/p/journey-subject/tasks')
check(
  'the new task is there after a full reload',
  (await page.locator('.bcitemtitle', { hasText: 'Write the acceptance evidence' }).count()) === 1,
  'a row that only exists until the next load is a render, not a record',
)

/* --- completion persists --- */
await page.locator('[data-bc-tick]').nth(1).check()
await page.waitForTimeout(900)
check(
  'completing sent task_state done',
  seen.some((s) => s.action === 'task_state' && s.args.p_state === 'done'),
)
await open('/basecamp/p/journey-subject/tasks')
check(
  'the completion survived a reload',
  tasks.find((t) => t.title === 'Write the acceptance evidence')?.state === 'done',
)
/*
  COMPLETED WORK STAYS ON THE PAGE.

  This asserted the opposite - that finished work receded behind a summary
  count - and that behaviour is precisely what Grant reported on 23 September:
  "clicking/completing a to-do must not make it unexpectedly disappear.
  Completed items should remain visible and clearly display a completed/done
  state." The drawer is gone; the row stays where it was, ticked and struck
  through, under a quiet heading.
*/
check(
  'completed work stays on the page rather than receding behind a count',
  (await page.locator('details summary').count()) === 0 &&
    (await page.locator('.bcdonelist .bcitem--done').count()) >= 1,
  `${String(await page.locator('details summary').count())} drawer(s), ` +
    `${String(await page.locator('.bcdonelist .bcitem--done').count())} done row(s) on the page`,
)

/* --- optimistic rollback, visibly (§12) --- */
failNext = 'task_state'
const before = tasks.find((t) => t.id === 't-1')?.state
/*
  CLICKED, not `.check()`.

  `.check()` asserts the box ends up CHECKED - and the whole point of this
  step is that the write is refused and the tick rolls back, so the assertion
  races the rollback. It passed on a quiet machine and threw inside a full
  gate run, which is the signature of a harness race rather than a product
  defect: four standalone runs and two gate runs disagreed about the same
  code. The two checks below are what this step is actually for.
*/
await page.locator('[data-bc-tick]').first().click()
await page.waitForTimeout(900)
check(
  'a refused write left the office unchanged',
  tasks.find((t) => t.id === 't-1')?.state === before,
)
check(
  'the tick rolled back rather than showing a change that did not happen',
  (await page.locator('[data-bc-tick]').first().isChecked()) === false,
  'a tick that survives a failed write is the product lying about canonical state',
)
const words = await page.locator('.bcitem').first().innerText()
check(
  'the office’s own words are shown, not a generic failure',
  words.includes('refused'),
  `the row reads: ${words.replace(/\n/g, ' / ').slice(0, 160)}`,
)

/* --- read-only is honest --- */
const ro = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ro.addInitScript(
  `window.HQ_API = ${JSON.stringify(`http://127.0.0.1:${String(API_PORT)}/hq-api`)}`,
)
const rp = await ro.newPage()
/*
  A DIFFERENT PROJECT, and the reason is worth writing down.

  Without a token `hydrate()` cannot reach the office, so the studio falls
  back to its prototype projects and `journey-subject` does not exist —
  `goToPath` lands on the portfolio and there is no tasks surface to press at
  all. The first draft asked for the subject anyway and died on a thirty-second
  timeout that read like a missing control.

  So the read-only leg asks the page which project it HAS, rather than telling
  it which one it should have.
*/
await rp.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
await rp.waitForSelector('.bcmain')
await rp.waitForTimeout(600)
const roSlug = (await rp.evaluate(
  inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string
check('the read-only browser still renders a project to press', roSlug !== '')
await rp.goto(url(`${roSlug}/tasks`), { waitUntil: 'domcontentloaded' })
await rp.waitForSelector('.bcmain')
await rp.waitForTimeout(700)
const sentBefore = seen.length
await rp.locator('[data-bc-addtask]').first().click()
await rp.waitForTimeout(150)
await rp
  .locator('[data-bc-taskform]:not([hidden]) input[name="title"]')
  .fill('Should never be created')
await rp.locator('[data-bc-taskform]:not([hidden]) [data-bc-tasksave]').click()
await rp.waitForTimeout(500)
/*
  WHAT A TOKENLESS BROWSER DOES NOW, and why this check changed.

  It used to assert the words "read-only", because pressing Save without a
  token did nothing but say so. Grant, 22 September, is judging the deployed
  preview - which has no token - and an interface that cannot be exercised
  cannot be judged, so the prototype keeps the row in the browser instead.

  The half that MATTERS is unchanged and is asserted first: nothing reached
  the office. The second half is the new honesty requirement - a local row
  that appeared exactly as a real one would is the prototype quietly claiming
  to be the office.
*/
check('and nothing was sent', seen.length === sentBefore)
check(
  'a browser with no token says where the row actually went',
  /this browser/i.test(await rp.locator('.bcmain').innerText()),
  (await rp.locator('.bcmain').innerText()).replace(/\n/g, ' / ').slice(0, 200),
)
await ro.close()

/* ---------------------------------- the task record page (§9, §17 phase 4) */

await open('/basecamp/p/journey-subject/tasks')
check(
  'every task row offers a way into its record',
  (await page.locator('[data-bc-task-open]').count()) >= 1,
)
await page.locator('[data-bc-task-open]').first().click()
await page.waitForTimeout(500)
const rec = await page.locator('.bcmain').innerText()
/*
  §9's order, asserted as presence rather than as pixels: breadcrumb and
  actions, title and status, then the details and the relationships. The
  breadcrumb is the one that matters most here — §18 requires the
  preview → tool → record → project return path to always be clear, and a
  record with no way back is where that path stops.
*/
check(
  'the record page draws a breadcrumb back to the tool and the project',
  (await page.locator('.bccrumb a').count()) === 2,
)
check('the record names the task', rec.includes('An existing commitment'))
check('the record carries a status', (await page.locator('.bcstatus').count()) >= 1)
check(
  'the record exposes assignment and the due date beside the task',
  (await page.locator('#bc-edit-who').count()) === 1 &&
    (await page.locator('#bc-edit-due').count()) === 1,
)

/* Assignment and the due date persist through a reload — §18. */
/*
  The assignee is a PICKER now. hq_task_update resolves p_assignee against
  public.staff.slug and refuses anything else, so the free-text box it
  replaced only worked if somebody typed a role slug. The option's value is
  what the office needs; the suite asserts that value reached it.
*/
/* Chosen as somebody the task is NOT already assigned to: the seeded task
   is Claire's, and the first option is Claire, so picking the first one
   was a no-op and an ignored edit would have passed. */
const whoBefore = await page.locator('#bc-edit-who').inputValue()
const person = page
  .locator(`#bc-edit-who option:not([value=""]):not([value="${whoBefore}"])`)
  .first()
const emmaValue = (await person.getAttribute('value')) ?? ''
const emmaName = ((await person.innerText()).split('·')[0] ?? '').trim()
check(
  'the edit picks a different person',
  emmaValue !== '' && emmaValue !== whoBefore,
  `${whoBefore} -> ${emmaValue}`,
)
await page.locator('#bc-edit-who').selectOption(emmaValue)
await page.locator('#bc-edit-due').fill('2026-11-13')
await page.locator('[data-bc-tasksave-edit]').click()
await page.waitForTimeout(900)
const upd = seen.filter((x) => x.action === 'task_update')
check(
  'the edit reached the office as task_update',
  upd.length === 1,
  JSON.stringify(upd[0]?.args ?? {}),
)
check(
  'the assignee and the due date persisted',
  emmaValue !== '' && tasks[0]?.who === emmaValue && tasks[0]?.due === '2026-11-13',
  JSON.stringify(tasks[0] ?? {}),
)
await open('/basecamp/p/journey-subject/tasks')
check(
  'and they are there after a full reload',
  emmaName !== '' && (await page.locator('.bcitemmeta').first().innerText()).includes(emmaName),
  await page.locator('.bcitemmeta').first().innerText(),
)

/*
  CLEARING A FIELD IS NOT THE SAME AS LEAVING IT ALONE, and the office's own
  contract says so: null means "leave it" to hq_task_update, and p_clear is
  how a field is emptied. A page that sent null for an emptied box would look
  correct and silently save nothing.
*/
await page.locator('[data-bc-task-open]').first().click()
await page.waitForTimeout(500)
await page.locator('#bc-edit-who').selectOption('')
await page.locator('[data-bc-tasksave-edit]').click()
await page.waitForTimeout(900)
const cleared = seen.filter((x) => x.action === 'task_update').at(-1)
/*
  Read once into a local rather than chained through a cast. The first draft
  wrote `(cleared?.args.p_clear as string[])`, where the assertion defeats the
  optional chain: with no matching call the whole check THROWS instead of
  failing, which reports as a crashed suite rather than as a red line.
*/
const clearList = Array.isArray(cleared?.args.p_clear) ? (cleared.args.p_clear as string[]) : []
check(
  'emptying the assignee sends p_clear rather than a null the office ignores',
  clearList.includes('assignee'),
  JSON.stringify(cleared?.args ?? {}),
)
check('and the assignee is actually gone', tasks[0]?.who === null, JSON.stringify(tasks[0] ?? {}))

/* The list is still whole after all of that. */
await open('/basecamp/p/journey-subject/tasks')
check('the tasks list still renders after every edit', (await page.locator('.bcitem').count()) >= 1)

/* ------------------------------------------- the agent-output journey (§17.5) */

await open('/basecamp/p/journey-subject')
/*
  THE MODULE THAT LEADS TO THE TEAM, not the class that used to draw it.
  This named `.bctool` with the text "Agentic Team", which was one of three
  things that have drawn a project home here and is also a heading somebody
  may reasonably rename. What it means is that the home's team module says
  what the team produced and that pressing it arrives at the team surface.
*/
/*
  THE MODULE THAT LEADS TO THE TEAM, found by where its heading GOES.

  This named `[data-slot="crew"]` - the slot composition B gave it - and fell
  back to a class-plus-heading-text match, so the next composition timed out
  on a home that was working perfectly. The address is the stable thing: one
  module on the home links to the team surface, whatever the composition calls
  its slot and whatever the heading says.
*/
/*
  THE TEAM IS NOT A MODULE ON THE HOME ANY MORE, and this is the THIRD retarget
  of this lookup - each one caused by the check naming a mechanism.

  Grant, 22 September: *"The standalone Agentic Team panel on the project
  homepage is superfluous. Remove it. Configuration/management of the agentic
  team belongs in Settings rather than consuming project-dashboard real
  estate. Do not remove the actual team/chat functionality - only the redundant
  homepage panel."*

  So the two halves of what this section always meant come apart, and both are
  still asserted. The HOME must still say that something is waiting - which it
  does in the head, where the state line has carried it all along. And the
  TEAM must still be one press away - which it is, from the page menu.
*/
/*
  THE STATE LINE, asserted on what it can say about THIS subject rather than
  on the words the prototype project happens to produce. The journey drives a
  project it made itself, which is on track with one open task - so asserting
  "something is waiting" would have been asserting against the fixture, not
  against the product. The property that holds for every project is that the
  head answers the question the page exists to answer.
*/
/*
  AND THE FOURTH RETARGET, for the reason the comment above predicts.

  Grant, 23 September: the Tasks summary in the project header repeated the
  To-dos panel directly beneath it, so the counts moved to the to-dos surface
  where they are also the filters. The head no longer says "1 open task" and
  should not. What this section has always MEANT - that the home answers the
  question the page exists to answer, without navigating - is unchanged, so it
  is asserted where the answer now is: beside the to-dos.

  The team's waiting work stayed in the head, because it is not a to-do count
  and nothing else says it - but this journey's own project has none, so
  asserting it here would be asserting against the fixture. `basecamp-home`
  asserts that half against a project that has some.
*/
/* The project head was folded into the single top bar (11 October 2026, one unified top part), so the head line is read there. */
const headLine = await page.locator('.bctop--work').first().innerText()
const todoPanel = await page
  .locator('.bcpanes [data-mod="tasks"]')
  .first()
  .innerText()
  .catch(() => '')
check(
  'the home still summarises the work, beside the to-dos rather than above them',
  /\d/.test(todoPanel) && /yours|team|\d+\s*\/\s*\d+/i.test(todoPanel),
  todoPanel.replace(/\n/g, ' / ').slice(0, 160),
)
check(
  'and the head no longer repeats those counts above the panel',
  !/open task|nothing open/i.test(headLine),
  headLine.replace(/\n/g, ' / ').slice(0, 160),
)
check(
  'and the redundant Agentic Team panel is genuinely off the board',
  (await page.locator('.bcpanes [data-mod="team"]').count()) === 0,
)
await page.locator('[data-bc-pagemenu]').first().click()
await page.waitForTimeout(250)

const teamWay = page.locator('[data-bc-pagemenu-panel] [data-bc-expand="team"]').first()
await teamWay.click()
await page.waitForTimeout(700)
/*
  "WITHOUT NAVIGATING AWAY" IS ABOUT THE PAGE UNDERNEATH, not about the
  address. The address now says `/x/team` deliberately - an expanded view is a
  place, so that Back closes it rather than leaving the project - and this
  check read that suffix as a navigation. What it means is that the project
  HOME is still there behind the dialog, which is both stronger and immune to
  the next change to the address.
*/
check(
  'the home opens the team surface AS A MODAL, without navigating away',
  (await page.locator('[data-bc-expanded="team"]').count()) === 1 &&
    (await page.locator('.bcpanes').count()) === 1,
  `dialogs: ${String(await page.locator('[data-bc-expanded]').count())}, boards: ${String(await page.locator('.bcpanes').count())}, url ${page.url()}`,
)
check(
  'and the modal carries an X that closes it back to the home',
  (await page.locator('[data-bc-expanded] [data-bc-expclose]').count()) >= 1,
)
await page.locator('[data-bc-expanded] .bcexpx').click()
await page.waitForTimeout(400)
check(
  'closing it returns to the project home',
  (await page.locator('[data-bc-expanded]').count()) === 0 &&
    (await page.locator('.bcpanes').count()) === 1,
)

/*
  The output journey below is about the TEAM SURFACE, and the modal proof above
  deliberately ends back on the home. The address still renders that surface -
  v2 made the modal the press, not the only way in - so the journey goes there
  by address rather than assuming the dialog left it somewhere.
*/
await open('/basecamp/p/journey-subject/team')

const outRow = page.locator('[data-bc-output]').first()
const outText = await outRow.innerText()
/*
  §9: an agent output always names the originating job, the instruction, the
  input sources and the time. All four, because three of four is how a trail
  becomes unreconstructable — and the one that goes missing is always the
  instruction.
*/
/* By NAME. This asserted the lowercase key 'oliver', which is the defect of
   printing a database slug to the screen, locked in as a pass. */
check('the output names who produced it', outText.includes('Oliver'), outText.replace(/\n/g, ' / '))
check('the output names the instruction it came from', outText.includes('Turn the six modules'))
check('the output names where the instruction came from', outText.includes('Grant · chat'))
check('the output names what it was derived from', outText.includes('WS01'))
check('the output names when', outText.includes('2 days ago'))

check(
  'Add to project is offered once',
  (await page.locator('[data-bc-addtoproject]').count()) === 1,
)
await page.locator('[data-bc-addtoproject]').first().click()
await page.waitForTimeout(900)

const imported = seen.filter((s2) => s2.action === 'output_import')
check('Add to project reached the office as output_import', imported.length === 1)
check('it carried the output', imported[0]?.args.p_output === 'out-1')
check(
  'a canonical document now exists',
  documents.length === 1,
  `${String(documents.length)} document(s)`,
)
check(
  'the document carries its provenance — the job and who ran it',
  documents[0]?.job === 'job-1' && documents[0]?.producedBy === 'oliver',
  JSON.stringify(documents[0] ?? {}),
)

await open('/basecamp/p/journey-subject/team')
check(
  'the output now says it is in the project',
  (await page.locator('[data-bc-output]').first().innerText()).includes('In the project'),
)
check(
  'and Add to project is no longer offered',
  (await page.locator('[data-bc-addtoproject]').count()) === 0,
  'an idempotent operation offered a second time is a control that appears to act and does not',
)

await open('/basecamp/p/journey-subject/documents')
check(
  'the document is on the project’s Docs and Files surface',
  /*
    BY NAME, in whichever view. This named `.bcitemtitle` - the class the list
    view uses - and §21 made the thumbnail wall the default, so a document that
    was plainly on screen counted as absent. What the check means is that the
    surface names the document, and it has to be true of both views.
  */
  (await page.locator('.bcmain').getByText('Course one-pager', { exact: false }).count()) >= 1,
  (await page.locator('.bcmain').innerText()).replace(/\n/g, ' / ').slice(0, 160),
)

/*
  THE IDEMPOTENCY PROOF, driven rather than reasoned about.

  The page no longer offers the press, which is the product behaving — but
  "the button is gone" is not the same claim as "doing it twice makes one
  document". So the second import is sent through the same client the page
  uses, at the same address, and the document count is read afterwards.
*/
const second = await page.evaluate(
  `fetch(window.HQ_API, {
     method: 'POST',
     headers: { Authorization: 'Bearer journey-token', 'Content-Type': 'application/json' },
     body: JSON.stringify({ action: 'output_import', args: { p_output: 'out-1' } }),
   }).then((r) => r.json())`,
)
check(
  'importing the same output twice makes one document, not two',
  documents.length === 1,
  `${String(documents.length)} document(s) after a second import; the office said ${JSON.stringify(second)}`,
)
check(
  'and the second import returns the same document',
  (second as { result?: { document_id?: string } }).result?.document_id === documents[0]?.id,
)

check('nothing was thrown anywhere in the journey', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
office.close()

let bad = 0
for (const c of checks) {
  if (!c.ok) bad += 1
  console.log(
    `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.ok || c.detail === '' ? '' : `\n        ${c.detail}`}`,
  )
}
console.log(`\n${String(checks.length - bad)}/${String(checks.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
