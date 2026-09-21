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
  (await page.evaluate(inPage("return document.activeElement?.id === 'bc-task-title'"))) === true,
)
await page.locator('#bc-task-title').fill('Abandoned before saving')
await page.locator('[data-bc-taskcancel]').click()
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
  (await page.locator('#bc-task-title').inputValue()) === '',
)

/* --- validation appears by the field (§11.3) --- */
await page.locator('[data-bc-tasksave]').click()
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
await page.locator('#bc-task-title').fill('Write the acceptance evidence')
await page.locator('#bc-task-due').fill('2026-10-02')
await page.locator('#bc-task-who').fill('claire')
await page.locator('[data-bc-tasksave]').click()
await page.waitForTimeout(900)

const add = seen.find((s) => s.action === 'task_add')
check('the save reached the office as task_add', add !== undefined)
check(
  'it carried the project, the title, the due date and the assignee',
  add?.args.p_project === 'journey-subject' &&
    add?.args.p_title === 'Write the acceptance evidence' &&
    add?.args.p_due_on === '2026-10-02' &&
    add?.args.p_assignee === 'claire',
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
check(
  'completed work recedes behind a count rather than vanishing',
  (await page.locator('details summary').count()) === 1,
)

/* --- optimistic rollback, visibly (§12) --- */
failNext = 'task_state'
const before = tasks.find((t) => t.id === 't-1')?.state
await page.locator('[data-bc-tick]').first().check()
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
  inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string
check('the read-only browser still renders a project to press', roSlug !== '')
await rp.goto(url(`${roSlug}/tasks`), { waitUntil: 'domcontentloaded' })
await rp.waitForSelector('.bcmain')
await rp.waitForTimeout(700)
const sentBefore = seen.length
await rp.locator('[data-bc-addtask]').first().click()
await rp.waitForTimeout(150)
await rp.locator('#bc-task-title').fill('Should never be created')
await rp.locator('[data-bc-tasksave]').click()
await rp.waitForTimeout(500)
check(
  'a browser with no token is told it is read-only rather than failing silently',
  (await rp.locator('[data-bc-taskform]').innerText()).toLowerCase().includes('read-only'),
)
check('and nothing was sent', seen.length === sentBefore)
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
await page.locator('#bc-edit-who').fill('emma')
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
  tasks[0]?.who === 'emma' && tasks[0]?.due === '2026-11-13',
  JSON.stringify(tasks[0] ?? {}),
)
await open('/basecamp/p/journey-subject/tasks')
check(
  'and they are there after a full reload',
  (await page.locator('.bcitemmeta').first().innerText()).includes('emma'),
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
await page.locator('#bc-edit-who').fill('')
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
const preview = await page.locator('.bctool', { hasText: 'Agentic Team' }).innerText()
check(
  'the overview preview names the latest output and that it is waiting',
  preview.includes('Course one-pager') && preview.includes('Ready for you'),
  preview.replace(/\n/g, ' / ').slice(0, 160),
)

await page.locator('.bctool', { hasText: 'Agentic Team' }).locator('.bcpreview').click()
await page.waitForTimeout(700)
check('the preview opens the team surface', page.url().endsWith('/team'), page.url())

const outRow = page.locator('[data-bc-output]').first()
const outText = await outRow.innerText()
/*
  §9: an agent output always names the originating job, the instruction, the
  input sources and the time. All four, because three of four is how a trail
  becomes unreconstructable — and the one that goes missing is always the
  instruction.
*/
check('the output names who produced it', outText.includes('oliver'), outText.replace(/\n/g, ' / '))
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
  'the document is on the project’s Documents surface',
  (await page.locator('.bcitemtitle', { hasText: 'Course one-pager' }).count()) === 1,
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
