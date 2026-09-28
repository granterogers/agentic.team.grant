/*
 * TICKING A TO-DO ON THE DEPLOYED PAGE, AGAINST THE REAL OFFICE.
 *
 *   npm run verify:basecamp-todos-live
 *
 * §6 and §7 of the 23 September mission, and the last open piece of §2.
 *
 * WHY THIS HAD TO SEED ITS OWN WORK. §48: the whole live office held three
 * tasks, all on one project, so there was nothing to measure and nothing to
 * tick. The subjects here are created on the test project, carry a mark in
 * their titles so teardown matches the CLASS rather than this run's list, and
 * are removed in a `finally` — a crashed run must not leave work on a project
 * Grant looks at.
 *
 * WHAT IT PROVES THAT A LOCAL RUN CANNOT. That the tick reaches the office and
 * comes back, and that the row is in the same place afterwards. The reorder was
 * never the page's doing: `app.studio_tasks` orders by state, so completing a
 * task sent it to the end of its list, and with the module folded to six rows
 * it vanished and everything below slid up. Only a signed-in browser reading
 * the real payload can see that.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { signIn } from './lib/sign-in.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

/** One row as the page draws it. Named, because an inline generic here is one
    the formatter has already broken once. */
type Row = { title: string; offset: number; top: number; done: boolean; height: number }

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

const SITE =
  process.env.BASECAMP_SITE ?? 'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app'
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(1)
}
const db = new ManagementApiExecutor(ref, accessToken)

const MARK = 'todos-live-probe'
const SLUG = 'ai-team-hq-test'

/* The awkward shapes on purpose: a long title, one with nothing beside it, one
   with an assignee and no date, one overdue. A row list that only ever holds
   the easy case cannot show an alignment defect. */
const SUBJECTS: [string, string | null, string | null][] = [
  ['Send the weekly note', '2026-09-26', 'communications-director'],
  ['A considerably longer to-do title than any of the others, long enough to be cut', null, null],
  ['Short', null, 'finance-director'],
  ['Decide about the pricing tiers', '2026-10-08', null],
  ['Ring the accountant', '2026-09-25', 'finance-director'],
]

const projectId = String(
  (await db.execute(`select project_id from public.projects where slug = '${SLUG}'`)).rows[0]
    ?.project_id ?? '',
)
if (projectId === '') {
  console.error(`no project ${SLUG} to write to`)
  process.exit(1)
}

const made: string[] = []
/*
  WAIT FOR THE TASKS, AND SAY WHAT THE PAGE HAD IF THEY NEVER CAME.

  A bare thirty-second selector wait after a fresh sign-in is a race with a
  cold deployment, and when it loses it says only "waiting for locator" --
  which names no cause and reads like a missing feature. It lost twice against
  a page that renders perfectly when the suite runs alone.

  Longer, and it prints what was on screen, because a failure that names
  nothing is the thing CLAUDE.md warns about most. The same helper
  basecamp-docorder-live got for the same reason.
*/
const waitForTasks = async (p: Page): Promise<void> => {
  try {
    await p.waitForSelector('li.bctask', { timeout: 60000 })
  } catch {
    const said = (
      (await p
        .evaluate("(() => (document.body.innerText || '').slice(0, 300))()")
        .catch(() => '')) as string
    )
      .replace(/\s+/g, ' ')
      .trim()
    throw new Error(`no task rows after 60s. The page said: ${said}`)
  }
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(String(e.message)))

try {
  for (const [title, due, who] of SUBJECTS) {
    const answer = await db.execute(
      `select app.task_add(
         p_project => '${projectId}'::uuid,
         p_title => '${`${title} [${MARK}]`.replace(/'/g, "''")}',
         p_detail => '',
         p_due_on => ${due === null ? 'null' : `'${due}'::date`},
         p_assignee => ${who === null ? 'null' : `'${who}'`},
         p_milestone => false,
         p_added_by => 'verify-todos-live',
         p_job => null) as r`,
    )
    const r = (answer.rows[0] as { r?: { id?: string } }).r
    if (r?.id !== undefined) made.push(String(r.id))
  }
  check(`${String(made.length)} controlled to-dos to work with`, made.length === SUBJECTS.length)

  // --- signed in the way a person signs in ---------------------------------

  await signIn(page, db, { ref, origin: SITE, back: `${SITE}/basecamp` })

  /*
    OPENING THE PROJECT, and saying what was on the home board if it is not
    there.

    `page.click` on a text locator reports only "waiting for locator", which
    names neither the cause nor what the page had instead -- and on a cold
    deployment the home board's project list arrives after the shell does. The
    project is asserted to exist in the office two steps above this; if it is
    not on the screen, the screen is what needs printing.
  */
  try {
    await page.click('text=AI Team HQ Test', { timeout: 60000 })
  } catch {
    const said = (
      (await page
        .evaluate("(() => (document.body.innerText || '').slice(0, 400))()")
        .catch(() => '')) as string
    )
      .replace(/\s+/g, ' ')
      .trim()
    throw new Error(`the home board never offered AI Team HQ Test. It said: ${said}`)
  }
  await waitForTasks(page)
  await page.waitForTimeout(2000)

  const readRows = async (): Promise<Row[]> =>
    (await page.evaluate(
      inPage(`
        return [...document.querySelectorAll('li.bctask')].map((li) => {
          const t = li.querySelector('.bctasktitle')
          const r = li.getBoundingClientRect()
          const tr = t === null ? null : t.getBoundingClientRect()
          return {
            title: (t === null ? '' : t.textContent || '').trim(),
            offset: tr === null ? -1 : Math.round(tr.left - r.left),
            top: Math.round(r.top),
            height: Math.round(r.height),
            done: li.className.indexOf('--done') >= 0,
          }
        })
      `),
    )) as Row[]

  // --- §6, alignment -------------------------------------------------------

  const before = await readRows()
  check(
    'the seeded work is on the page',
    before.length >= SUBJECTS.length,
    `${before.length} row(s)`,
  )
  const offsets = [...new Set(before.map((r) => r.offset))]
  check(
    'every title starts at the same place',
    offsets.length === 1 && offsets[0] !== -1,
    `offsets: ${offsets.join(', ')}`,
  )
  const heights = [...new Set(before.map((r) => r.height))]
  check('and every row is the same height', heights.length === 1, `heights: ${heights.join(', ')}`)

  // --- §7, ticking does not move it ---------------------------------------

  /*
    The MIDDLE of whatever order the page chose, not a title I expect to find
    there. The first draft looked for one by name and it sorted last, so the
    check reported "there is a row in the middle to tick" as a failure about a
    page that was working -- a claim about the data rather than the product.
  */
  const target = Math.floor(before.length / 2)
  check(
    'there is a row in the middle to tick',
    target > 0 && target < before.length - 1,
    `${String(before.length)} row(s)`,
  )
  const targetTitle = before[target]?.title ?? ''
  /*
    Distance from the first row, not absolute y. Completing something shortens
    the counters above the list, so the whole module rises by a line -- which
    is the module telling the truth, not the row moving.
  */
  const gapWas = (before[target]?.top ?? 0) - (before[0]?.top ?? 0)

  await page.click(`li.bctask:nth-of-type(${String(target + 1)}) .bctickhit`)
  const looksDone = await page
    .waitForFunction(
      `(() => { const li = document.querySelectorAll('li.bctask')[${String(target)}]; return li !== undefined && li.className.indexOf('--done') >= 0 })()`,
      undefined,
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false)
  await page.waitForTimeout(1500)

  const after = await readRows()
  const nowAt = after.findIndex((r) => r.title === targetTitle)
  check('the ticked row is still on the page', nowAt >= 0, targetTitle)
  check(
    'and in the same position',
    nowAt === target,
    `was ${String(target)}, now ${String(nowAt)} — ${after.map((r) => r.title.slice(0, 14)).join(' / ')}`,
  )
  const gapNow = (after[nowAt]?.top ?? -999) - (after[0]?.top ?? 0)
  check(
    'and the same distance down the list',
    Math.abs(gapNow - gapWas) <= 1,
    `was ${String(gapWas)}px below the first row, now ${String(gapNow)}`,
  )
  check('and it looks completed without a reload', looksDone && after[nowAt]?.done === true)
  check(
    'and nothing else moved',
    after.map((r) => r.title).join('|') === before.map((r) => r.title).join('|'),
  )
  check(
    'and the titles still line up',
    [...new Set(after.map((r) => r.offset))].length === 1,
    `offsets: ${[...new Set(after.map((r) => r.offset))].join(', ')}`,
  )

  // --- the office actually took it ----------------------------------------

  const stored = (
    await db.execute(
      `select state from public.tasks where title = '${targetTitle.replace(/'/g, "''")}'`,
    )
  ).rows[0] as { state?: string } | undefined
  check('the office recorded the completion', stored?.state === 'done', String(stored?.state))

  // --- and a reload agrees -------------------------------------------------

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
  await waitForTasks(page)
  await page.waitForTimeout(2500)
  const reloaded = await readRows()
  const stillAt = reloaded.findIndex((r) => r.title === targetTitle)
  check(
    'a reload puts it back in the same place',
    stillAt === target,
    `was ${String(target)}, now ${String(stillAt)}`,
  )
  check('and still shows it completed', reloaded[stillAt]?.done === true)

  /* --- §8: dragging a card into Stuck ------------------------------------ */
  /*
    It used to OPEN THE TASK instead of moving it: the office refuses `blocked`
    without a reason, and that was answered by asking rather than by supplying
    one. The reason the board supplies is true -- it was moved to Stuck on the
    board -- and Grant can say more on the task, which is where there is room.
  */
  const board = await page
    .waitForSelector('[data-bc-drop="blocked"]', { timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  check('the card table is on the project page', board)

  if (board) {
    const picked = (await page.evaluate(
      inPage(`
        const card = document.querySelector('[data-bc-card]')
        if (card === null) return { key: '', title: '' }
        const t = card.textContent || ''
        return { key: card.getAttribute('data-bc-card') || '', title: t.replace(/\\s+/g, ' ').trim().slice(0, 60), stage: card.getAttribute('data-stage') || '' }
      `),
    )) as { key: string; title: string; stage?: string }
    check('there is a card to drag', picked.key !== '', picked.title)

    const expandedBefore = (await page.evaluate(
      inPage("return document.querySelector('.bcrecordhead') !== null"),
    )) as boolean
    check('and nothing is expanded over the page yet', !expandedBefore)

    /*
      THE DRAG, AS THE BROWSER DELIVERS IT.

      Two honest attempts at a pointer gesture first: `page.dragAndDrop`, and
      then a button-down with eight intermediate moves. Neither made headless
      Chromium start a NATIVE drag, and the check reported a card still in
      `todo` -- which is exactly what a broken product looks like and was the
      harness failing to drag. So this dispatches the events the browser would
      have dispatched, against one DataTransfer carried between them, which is
      what the product's handlers actually listen for.

      What that does and does not prove: it drives `dragstart`, `dragover` and
      `drop` on the real deployed page, so the routing, the write and the
      refusal to open the card are all genuinely exercised. It does not prove
      Chromium starts a drag from a mouse gesture, which is the browser's job
      rather than this page's. A human dragging a card is the remaining step.
    */
    const dragged = (await page.evaluate(
      inPage(`
        const card = document.querySelector('[data-bc-card="${picked.key}"]')
        const col = document.querySelector('[data-bc-drop="blocked"]')
        if (card === null || col === null) return 'nothing to drag'
        const dt = new DataTransfer()
        card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
        if (dt.getData('text/plain') === '') return 'dragstart carried nothing'
        col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
        card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
        return 'dropped ' + dt.getData('text/plain')
      `),
    )) as string
    check('the drag carried the card it started on', dragged.startsWith('dropped'), dragged)
    /*
      A BOUNDED EVENTUAL STATE, not a fixed pause (#375 item 10). The first
      version read the task once, 4 s after the drop. On a freshly restarted
      gateway the write takes 5-7 s, so it failed three checks while the
      product was right. So it polls the canonical row until the move lands or
      20 s pass, and says how long it took. A throttled read is a read that
      has not happened yet, never an answer (CLAUDE.md: a 429 is not data).
      Only then is "did not open the card" judged, because a card that opened
      on the write would open after it.
    */
    type Moved = { state?: string; blocked_on?: string }
    const dropAt = Date.now()
    let moved: Moved | undefined
    while (Date.now() - dropAt < 20000) {
      moved = await db
        .execute(
          `select state, blocked_on from public.tasks where task_id = '${picked.key.replace(/'/g, "''")}'`,
        )
        .then((r) => r.rows[0] as Moved | undefined)
        .catch(() => moved)
      if (moved?.state === 'blocked') break
      await page.waitForTimeout(500)
    }
    const tookMs = Date.now() - dropAt
    await page.waitForTimeout(500)

    const expandedAfter = (await page.evaluate(
      inPage("return document.querySelector('.bcrecordhead') !== null"),
    )) as boolean
    check('dropping into Stuck does not open the card', !expandedAfter)

    check(
      'the office moved it to blocked',
      moved?.state === 'blocked',
      `${String(moved?.state)} after ${String(tookMs)} ms`,
    )
    /*
      PROVENANCE, NOT AN EXPLANATION. §10: the automatic reason may record that
      a person marked it, and must not invent why. Both halves are asserted --
      something was recorded, and it does not claim to know a cause.
    */
    const reason = String(moved?.blocked_on ?? '')
    check('and recorded that it was marked, which the office insists on', reason !== '', reason)
    check(
      'and did not invent a cause nobody has given',
      /marked stuck/i.test(reason) && !/waiting on|blocked by|dependency|problem/i.test(reason),
      reason,
    )

    /*
      WAIT FOR THE REDRAW, do not read once. The first version read the column
      immediately after the write and passed on one run and failed on the next
      with `todo` -- the office had moved it and the page had not repainted
      yet. A check that races is worse than no check: it teaches you to re-run
      until it is green.
    */
    const landed = await page
      .waitForFunction(
        `(() => { const c = document.querySelector('[data-bc-card="${picked.key}"]'); if (c === null) return false; const col = c.closest('[data-bc-drop]'); return col !== null && col.getAttribute('data-bc-drop') === 'blocked' })()`,
        undefined,
        { timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false)
    check('and the card ends up in the Stuck column', landed)

    /*
      AND THE CONTROL FOR IT. "Dropping into Stuck does not open the card" is a
      check that says nothing unless the same expression can also be true, so
      press a card and watch it open. Without this the drop check would pass
      against a page where nothing can ever open.
    */
    await page.click(`[data-bc-card="${picked.key}"]`)
    const openedOnPurpose = await page
      .waitForSelector('.bcrecordhead', { timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    check('but pressing a card still opens it', openedOnPurpose)
  }

  check('nothing threw in the page', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  /*
    The CLASS, not this run's ids. A crashed run leaves its work behind and the
    next teardown must be able to collect it — CLAUDE.md records thirty debris
    projects accumulating because a sweep only ever matched its own prefix.
  */
  const swept = await db.execute(
    `with gone as (delete from public.tasks where title like '%[${MARK}]%' returning 1)
     select count(*)::int as n from gone`,
  )
  const left = await db.execute(
    `select count(*)::int as n from public.tasks where title like '%[${MARK}]%'`,
  )
  console.log(
    `\nteardown: removed ${String((swept.rows[0] as { n?: number }).n)} probe to-do(s), ` +
      `${String((left.rows[0] as { n?: number }).n)} left`,
  )
  if ((left.rows[0] as { n?: number }).n !== 0) fail += 1
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
