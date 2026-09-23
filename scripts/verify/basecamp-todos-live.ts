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
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

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
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(String(e.message)))
let requestId = ''

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

  await page.goto(`${SITE}/basecamp`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForSelector('.bcsignin', { timeout: 30000 })
  await page.click('[data-bc-signin-ask]')
  await page.waitForFunction(
    "document.querySelector('[data-bc-signin-digits]') !== null && (document.querySelector('[data-bc-signin-digits]').textContent || '').length === 6",
    undefined,
    { timeout: 30000 },
  )
  const code = String(await page.locator('[data-bc-signin-digits]').innerText()).trim()
  const asked = (
    await db.execute(
      `select request_id, approve_secret from public.sign_in_requests
        where code = '${code.replace(/'/g, "''")}' and claimed_at is null
        order by started_at desc limit 1`,
    )
  ).rows[0] as { request_id?: string; approve_secret?: string } | undefined
  requestId = String(asked?.request_id ?? '')
  await fetch(
    `https://${ref}.supabase.co/functions/v1/signin?approve=${encodeURIComponent(String(asked?.approve_secret))}`,
  )
  await page.waitForFunction("(localStorage.getItem('hq.token') || '') !== ''", undefined, {
    timeout: 30000,
  })
  await page.click(`text=AI Team HQ Test`)
  await page.waitForSelector('li.bctask', { timeout: 30000 })
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
  await page.waitForSelector('li.bctask', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const reloaded = await readRows()
  const stillAt = reloaded.findIndex((r) => r.title === targetTitle)
  check(
    'a reload puts it back in the same place',
    stillAt === target,
    `was ${String(target)}, now ${String(stillAt)}`,
  )
  check('and still shows it completed', reloaded[stillAt]?.done === true)

  check('nothing threw in the page', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  if (requestId !== '') {
    await db.execute(`delete from public.sign_in_requests where request_id = '${requestId}'`)
  }
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
