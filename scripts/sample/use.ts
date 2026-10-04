/**
 * Using Team HQ as the Sample Person, through the real page and the real gateway, the way a customer would.
 *   npm run sample:use [label]        screenshots into .out/use-<label>/
 *
 * Creates, edits, completes and removes a task; creates, opens, reloads and archives a temporary fourth project; opens a
 * document and a contact; presses the Late and Stuck counters; searches. Every write lands in the Sample office; the run
 * tidies the project it made, and `npm run sample:reset` restores the baseline. Each step reports pass or fail and the run
 * goes on, because one broken control should not hide the next.
 *
 * Waits are for the thing being asserted (a row in the database, text on the page), never for a fixed pause: a production
 * write takes one to three seconds, and a harness that guesses reports a slow office as a broken button.
 *
 * Not here: Team Chat and voice (scripts/sample/chat.ts), tool requests (verify:sample-tool-requests), account creation
 * (verify:account-ui).
 */
import { mkdirSync } from 'node:fs'
import type { Page } from 'playwright'
import { newPage, openSettings, signIn, startStudio } from './browser.ts'
import { rows, sampleOffice, session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/use-${label}`
mkdirSync(out, { recursive: true })
const office = await sampleOffice()
const O = office.officeId
const RUN = Date.now().toString(36).slice(-5)

const results: { what: string; ok: boolean; detail: string }[] = []
const step = async (what: string, fn: () => Promise<string | undefined | void>): Promise<void> => {
  try {
    const detail = (await fn()) ?? ''
    results.push({ what, ok: true, detail })
    console.log(`ok   ${what}${detail === '' ? '' : ` — ${detail}`}`)
  } catch (e) {
    const detail = String(e instanceof Error ? e.message : e)
      .split('\n')
      .filter((l) => l.trim() !== '')
      .slice(0, 4)
      .join(' | ')
      .slice(0, 300)
    results.push({ what, ok: false, detail })
    console.log(`FAIL ${what} — ${detail}`)
  }
}
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))
/** Poll until the condition holds, or say what never became true. */
const eventually = async (
  what: string,
  cond: () => Promise<boolean>,
  ms = 25000,
): Promise<void> => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond().catch(() => false)) return
    await sleep(700)
  }
  throw new Error(`never became true: ${what}`)
}
const must = (cond: boolean, why: string): void => {
  if (!cond) throw new Error(why)
}
const body = async (p: Page): Promise<string> =>
  (await p.locator('body').innerText()).replace(/\s+/g, ' ')
const shot = (p: Page, n: string): Promise<unknown> =>
  p.screenshot({ path: `${out}/${n}.png`, fullPage: true })
const count = async (sql: string): Promise<number> => Number((await rows(sql))[0]?.n ?? 0)
const taskCount = (title: string, state?: string): Promise<number> =>
  count(
    `select count(*) n from public.tasks where office_id = '${O}' and title = '${title}'${state === undefined ? '' : ` and state = '${state}'`}`,
  )

const studio = await startStudio(4792)
const s = await session()
// PHONE=1 drives the same flow on an iPhone-sized touch screen (390x844), where the controls are the ones a person taps.
const PHONE = process.env.PHONE === '1'
const { page, errors } = await newPage(
  studio,
  PHONE ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  PHONE,
)
// The product asks before archiving with the browser's own confirm; a person presses OK.
page.on('dialog', (d) => void d.accept())
try {
  await signIn(studio, page, s)
  const go = async (path: string): Promise<void> => {
    await page.goto(`${studio.base}${path}`, { waitUntil: 'domcontentloaded' })
    await page
      .waitForFunction("!document.body.innerText.includes('Loading your office')", undefined, {
        timeout: 30000,
      })
      .catch(() => null)
    // The page paints twice (what it holds, then what the office says); a press between the two lands on a node that is
    // about to be replaced. A person would not press that fast; neither does the harness.
    await page.waitForLoadState('networkidle').catch(() => null)
    await sleep(2500)
  }

  // ---- tasks ---------------------------------------------------------------------------------------------------
  const title = `UX run ${RUN}: order the yoga mats`
  const renamed = `${title} (blue ones)`
  await step('add a task to a project through the form', async () => {
    await go('/p/wellness-studio-launch/tasks')
    await page.locator('[data-bc-addtask]').first().click()
    const form = page.locator('[data-bc-taskform]:not([hidden])').first()
    await form.locator('input[name=title]').fill(title)
    await form
      .locator('input[name=due]')
      .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
    await form.locator('[data-bc-tasksave]').click()
    await eventually('stored once', async () => (await taskCount(title)) === 1)
    await eventually('shown', async () => (await body(page)).includes(title))
    await shot(page, 'task-added')
  })
  await step('the task survives a reload', async () => {
    await go('/p/wellness-studio-launch/tasks')
    must((await body(page)).includes(title), 'gone after reload')
  })
  await step('open the task and rename it', async () => {
    await page.locator('[data-bc-task-open]', { hasText: title }).first().click()
    await page.waitForSelector('#bc-edit-title', { timeout: 15000 })
    await page.fill('#bc-edit-title', renamed)
    await page.locator('[data-bc-tasksave-edit]').click()
    await eventually('renamed in the database', async () => (await taskCount(renamed)) === 1)
    await shot(page, 'task-record')
  })
  await step('mark it done, then reopen it', async () => {
    await page.locator('[data-bc-taskdone]').click()
    await eventually('done', async () => (await taskCount(renamed, 'done')) === 1)
    // the record redraws with the opposite button once the office has answered
    await eventually('the button now says reopen', async () =>
      /reopen/i.test(await page.locator('[data-bc-taskdone]').innerText()),
    )
    await page.locator('[data-bc-taskdone]').click()
    await eventually('open again', async () => (await taskCount(renamed, 'todo')) === 1)
  })
  await step('remove it (two presses), and it leaves the list', async () => {
    const rm = page.locator('[data-bc-taskremove]')
    await rm.click()
    must(/press again/i.test(await rm.innerText()), 'the first press did not ask for a second')
    await rm.click()
    await eventually('cancelled', async () => (await taskCount(renamed, 'cancelled')) === 1)
    await go('/p/wellness-studio-launch/tasks')
    must(!(await body(page)).includes(renamed), 'still listed after a reload')
  })

  // ---- the temporary fourth project ---------------------------------------------------------------------------
  // A name that shares no words with the three real ones: the office asks before making a near match, and that is tested
  // below on purpose.
  // SKIP_PROJECT=1 leaves this block out: a project that was made and archived stays as an archived row for ever.
  const makeProject = process.env.SKIP_PROJECT !== '1'
  const temp = `Allotment ${RUN}`
  let slug = ''
  const pstep = makeProject ? step : async (): Promise<void> => undefined
  await pstep('creating a project that resembles an existing one asks first', async () => {
    await go('/')
    await page.locator('[data-bc-newproject-open]').click()
    await page.fill('#bc-newproject-name', 'Japan Spring Trip')
    await page.locator('[data-bc-newproject-go]').click()
    await eventually('the question', async () =>
      /already have|new project/i.test(await page.locator('[data-bc-newproject-said]').innerText()),
    )
    must(
      (await count(
        `select count(*) n from public.projects where office_id = '${O}' and name = 'Japan Spring Trip'`,
      )) === 1,
      'it made a duplicate without asking',
    )
    await shot(page, 'project-duplicate-question')
  })
  await pstep('create a fourth project from Home', async () => {
    await go('/')
    await page.locator('[data-bc-newproject-open]').click()
    await page.fill('#bc-newproject-name', temp)
    await page.locator('[data-bc-newproject-go]').click()
    await page.waitForURL(/\/p\//, { timeout: 40000 })
    slug = new URL(page.url()).pathname.split('/')[2] ?? ''
    await eventually('opened', async () => (await body(page)).includes(temp))
    await shot(page, 'project-new')
    return slug
  })
  await pstep('add a task to it and see it after a reload', async () => {
    await go(`/p/${slug}/tasks`)
    await page.locator('[data-bc-addtask]').first().click()
    const form = page.locator('[data-bc-taskform]:not([hidden])').first()
    await form.locator('input[name=title]').fill('First thing in the new project')
    await form.locator('[data-bc-tasksave]').click()
    await eventually(
      'stored',
      async () =>
        (await count(
          `select count(*) n from public.tasks t join public.projects p on p.project_id = t.project_id where t.office_id = '${O}' and p.slug = '${slug}' and t.title = 'First thing in the new project'`,
        )) === 1,
    )
    await go(`/p/${slug}/tasks`)
    must((await body(page)).includes('First thing in the new project'), 'lost on reload')
  })
  await pstep('its settings open, and Project has an Archive control', async () => {
    await go(`/p/${slug}/settings`)
    await page.locator('[data-setpane="project"]').click()
    await page.waitForSelector('[data-archive]', { timeout: 15000 })
    await shot(page, 'project-settings')
  })
  await pstep('archive it, and it leaves Home', async () => {
    await page.locator('[data-archive]').click()
    await eventually(
      'archived',
      async () =>
        (await count(
          `select count(*) n from public.projects where office_id = '${O}' and slug = '${slug}' and status = 'archived'`,
        )) === 1,
    )
    await go('/')
    must(!(await body(page)).includes(temp), 'still on Home')
  })

  // ---- documents, contacts, counters --------------------------------------------------------------------------
  await step('open a document', async () => {
    await go('/p/2027-financial-plan/documents')
    // A document with words opens in its own tab, so a person gets a second tab with the text in it.
    const [tab] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 20000 }),
      page.locator('[data-bc-doc-open]').first().click(),
    ])
    // The tab now opens on the tap, blank, and is pointed at the file when the office answers: wait for the words, not the tab.
    let text = ''
    for (let i = 0; i < 30 && text.length <= 200; i += 1) {
      await sleep(500)
      text = (
        await tab
          .locator('body')
          .innerText()
          .catch(() => '')
      ).trim()
    }
    await tab.screenshot({ path: `${out}/document-open.png` }).catch(() => null)
    await tab.close()
    must(text.length > 200, `the document tab was nearly empty (${text.length} characters)`)
  })
  await step('switch the documents to a list', async () => {
    await go('/p/2027-financial-plan/documents')
    await page.locator('[data-bc-docview="list"]').click()
    await sleep(800)
    must(
      (await page.locator('[data-bc-docview="list"]').getAttribute('aria-pressed')) === 'true',
      'not pressed',
    )
    await shot(page, 'documents-list')
  })
  await step('open a contact', async () => {
    await go('/p/japan-spring-trip/contacts')
    await page.getByText('Haruka Mori').first().click()
    // The details are in form fields, which a page's text does not include; read the field, as a person would.
    await eventually('the contact form shows the organisation', async () =>
      (
        await page
          .locator('input')
          .evaluateAll((els) => els.map((e) => (e as { value?: string }).value ?? '').join('|'))
      ).includes('Sakura Journeys'),
    )
    await shot(page, 'contact-open')
  })
  await step('press the Late counter', async () => {
    await go('/p/wellness-studio-launch')
    await page.locator('button:has-text("late")').first().click()
    await sleep(1800)
    await shot(page, 'counter-late')
    must(/overdue/i.test(await body(page)), 'did not open a list of late items')
  })
  await step('press the Stuck counter', async () => {
    await go('/p/wellness-studio-launch')
    await page.locator('button:has-text("stuck")').first().click()
    await sleep(1800)
    await shot(page, 'counter-stuck')
    must(/blocked/i.test(await body(page)), 'did not open a list of stuck items')
  })
  await step('My Tasks is there with the personal to-dos', async () => {
    await go('/tasks')
    must(/My Tasks/i.test(await body(page)), 'no My Tasks')
    await shot(page, 'my-tasks')
  })
  await step('the jump bar finds a project by a few letters', async () => {
    await go('/')
    await page.keyboard.press('Shift+J')
    await sleep(500)
    await page.keyboard.type('japan')
    await eventually('offered', async () => (await body(page)).includes('Japan Spring Trip'))
    await page.keyboard.press('Escape')
  })
  await step('search finds a document by a word in its title', async () => {
    await go('/search')
    const box = page.locator('#bc-search-q').first()
    await box.fill('budget')
    await box.press('Enter')
    await sleep(2500)
    await shot(page, 'search')
    must(/2027-annual-budget|budget/i.test(await body(page)), 'no result')
  })

  // ---- requests for reach: approve, take back, decline, through Settings ---------------------------------------------
  // Two requests raised by the office for this run (unique pairs: a decline is durable by design), answered by pressing.
  const free = (await rows(
    `select s.slug, t.tool from public.staff s
       cross join (select tool from public.tool_permissions where enabled and level <= 1 and tool in ('calendar.read','gmail.read','gmail.search','notebook.read')) t
      where s.active and s.permanent and not s.is_fixture
        and not exists (select 1 from public.tool_requests r where r.office_id = '${O}' and r.asked_by = s.slug and r.tool = t.tool)
        and not exists (select 1 from public.staff_tools x where x.office_id = '${O}' and x.staff_slug = s.slug and x.tool = t.tool)
      order by random() limit 2`,
  )) as { slug: string; tool: string }[]
  const raise = async (p: { slug: string; tool: string }): Promise<string> => {
    const r = await rows(
      `select app.request_tool('${O}'::uuid, '${p.tool}', '${p.slug}', 'ux run ${RUN}: needs ${p.tool}', '{}'::jsonb, null)::text r`,
    )
    const j = JSON.parse(String(r[0]?.r)) as { request_id?: string; id?: string }
    return String(j.request_id ?? j.id ?? '')
  }
  const held = (p: { slug: string; tool: string }): Promise<number> =>
    count(
      `select count(*) n from public.staff_tools where office_id = '${O}' and staff_slug = '${p.slug}' and tool = '${p.tool}'`,
    )
  const [yes, no] = free
  const answer = async (id: string, verb: 'approve' | 'decline'): Promise<void> => {
    await openSettings(page, 'requests')
    await page.locator(`#settings [data-tool="${id}:${verb}"]`).click()
  }
  if (yes !== undefined && no !== undefined) {
    const yesId = await raise(yes)
    const noId = await raise(no)
    await go('/')
    await step('approve a request from Settings, and the grant exists in this office', async () => {
      await answer(yesId, 'approve')
      await page.locator('.stg-confirm [data-yes]').click()
      await eventually('granted', async () => (await held(yes)) === 1)
      await shot(page, 'request-approved')
    })
    await step('take the grant back from Settings', async () => {
      await openSettings(page, 'requests')
      // An answered request moves under "Earlier decisions", which is folded; a person opens it to find Take back.
      await page
        .locator('#settings summary:has-text("Earlier decisions")')
        .click({ timeout: 15000 })
      await page
        .locator(`#settings [data-revoke-tool="${yes.slug}:${yes.tool}"]`)
        .click({ timeout: 20000 })
      await page.locator('.stg-confirm [data-yes]').click()
      await eventually('withdrawn', async () => (await held(yes)) === 0)
    })
    await step('decline a request: a reason is asked for, and nothing is granted', async () => {
      await answer(noId, 'decline')
      await page.locator('.stg-confirm [data-text]').fill('not something I want this team to do')
      await page.locator('.stg-confirm [data-yes]').click()
      await eventually(
        'declined',
        async () =>
          (await count(
            `select count(*) n from public.tool_requests where request_id = '${noId}'::uuid and state = 'declined'`,
          )) === 1,
      )
      must((await held(no)) === 0, 'declining granted something')
    })
  }
} finally {
  await studio.close()
}
console.log(
  `\nerrors on the page: ${errors.length === 0 ? 'none' : errors.slice(0, 3).join(' || ')}`,
)
const failed = results.filter((r) => !r.ok)
console.log(
  `sample:use ${label}: ${results.length - failed.length}/${results.length}   (images in ${out}; run \`npm run sample:reset\` to restore the baseline)`,
)
if (failed.length > 0 || errors.length > 0) process.exitCode = 1
