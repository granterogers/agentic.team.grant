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
                  documents: [],
                  contacts: [],
                  sources: [],
                  activity: [],
                  waiting: [],
                  modules: [],
                  requests: [],
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
