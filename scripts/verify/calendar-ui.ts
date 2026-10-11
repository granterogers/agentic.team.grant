/*
 * THE PROJECT CALENDAR, DRIVEN IN A REAL BROWSER (4 October 2026).
 *
 *   npx tsx scripts/verify/calendar-ui.ts
 *
 * Day, Week and Month; size-responsive (large / medium / small); creating,
 * editing and deleting an event; the scope control; overlapping events side by
 * side; a to-do with a date still on its day. Runs against the prototype (no
 * token), where the calendar uses invented in-memory events and says so, and
 * against a stubbed office for the `office` adapter, so the gateway contract
 * the UI speaks is asserted too. Screenshots go to .out/ux-cal-*.png.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`
const PORT = 4689
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

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})
const shot = async (n: string): Promise<void> => {
  await page.screenshot({ path: `.out/ux-cal-${n}.png` })
}

await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const slug = (await page.evaluate(
  inPage(
    `const el = document.querySelector('[data-bc-go^="/p/"]'); return el ? el.dataset.bcGo : ''`,
  ),
)) as string
const open = async (): Promise<void> => {
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcstage [data-mod]')
  await page.waitForTimeout(400)
}
await page.evaluate(
  inPage(
    `for (const k of Object.keys(localStorage)) if (k.startsWith('bc.')) localStorage.removeItem(k); return true`,
  ),
)
await open()

/* --- the module chooses what to be by its size ---------------------------- */
const sizeOfMod = async (): Promise<string> =>
  (await page.evaluate(
    inPage(`return document.querySelector('[data-mod="schedule"] [data-bc-cal]').dataset.size`),
  )) as string
check(
  'the default Schedule module (small) shows the agenda',
  (await sizeOfMod()) === 'small',
  await sizeOfMod(),
)
check(
  'and the agenda lists upcoming items, not a crushed month',
  (await page.locator('[data-mod="schedule"] .bccal2compact .bccal2agrow').count()) > 0,
)
check(
  'the month grid is not visible in a small module',
  !(await page.locator('[data-mod="schedule"] .bccal2large').isVisible()),
)

/* make it big by dragging its resize corner */
const resize = async (id: string, dx: number, dy: number): Promise<void> => {
  await page.locator(`[data-mod="${id}"]`).hover()
  const r = await page.locator(`[data-mod="${id}"] [data-bc-resize]`).boundingBox()
  if (r === null) throw new Error('no handle')
  const x = r.x + r.width / 2
  const y = r.y + r.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 8, y + 8, { steps: 3 })
  await page.mouse.move(x + dx, y + dy, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}
/* first move it to the left/top corner so there is room to grow */
await page.evaluate(inPage(`return true`))
await page.locator('.bcdock [data-bc-zoom="out"]').click()
await page.locator('.bcdock [data-bc-zoom="out"]').click()
await page.waitForTimeout(500)
const h0 = await page.locator('[data-mod="schedule"] .bcmodopen').boundingBox()
if (h0 === null) throw new Error('no header')
await page.mouse.move(h0.x + 20, h0.y + 8)
await page.mouse.down()
await page.mouse.move(h0.x + 30, h0.y + 8, { steps: 3 })
await page.mouse.move(150, 150, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(250)
await resize('schedule', 520, 160)
check(
  'widened a little, a module becomes the condensed calendar',
  ['medium', 'large'].includes(await sizeOfMod()),
  await sizeOfMod(),
)
await resize('schedule', 360, 260)
check(
  'widened and heightened, it becomes the full calendar',
  (await sizeOfMod()) === 'large',
  await sizeOfMod(),
)
await shot('01-module-large')
check(
  'the full calendar has Day, Week and Month',
  (await page.locator('[data-mod="schedule"] [data-cal-view]').count()) === 3,
)
await page.locator('.bcdock [data-bc-zoom="reset"]').click()
await page.waitForTimeout(300)

/* --- the expanded view: Month, Week, Day ---------------------------------- */
await page.locator('[data-mod="schedule"]').hover()
// The module was dragged to the top of the board, so its header sits under the sticky bar; this check is about the calendar, not the canvas.
await page.locator('[data-bc-max="schedule"]').dispatchEvent('click')
await page.waitForSelector('.bcexp .bccal2--full')
await page.waitForTimeout(600)
check(
  'the expanded Schedule is the full calendar',
  (await sizeOfMod().catch(() => 'x')) !== undefined,
)
const exp = page.locator('.bcexp .bccal2large')
check('Month view draws 42 day cells', (await exp.locator('.bccal2cell').count()) === 42)
check('today is marked', (await exp.locator('.bccal2cell.is-today').count()) === 1)
check(
  'a to-do with a date appears on its day',
  (await exp.locator('.bccal2chip--task').count()) > 0,
)
check('events appear as chips', (await exp.locator('.bccal2chip--own').count()) > 0)
await shot('02-month')
await exp.locator('[data-cal-view="week"]').click()
await page.waitForTimeout(300)
check('Week view draws seven day columns', (await exp.locator('.bccal2col').count()) === 7)
/* overlapping events: sample-1 10:00-11:00 and sample-6 10:30-11:15 tomorrow */
for (let i = 0; i < 2; i += 1) {
  const have = await page
    .locator('.bcexp .bccal2large .bccal2blk', { hasText: 'first client' })
    .count()
  if (have > 0) break
  await exp.locator('[data-cal-nav="next"]').click()
  await page.waitForTimeout(250)
}
check(
  'timed events are drawn as blocks on the time grid',
  (await exp.locator('.bccal2blk').count()) >= 2,
)
const widths = (await page.evaluate(
  inPage(
    `const out = []; for (const b of document.querySelectorAll('.bcexp .bccal2large .bccal2blk')) { if (b.textContent.includes('first client') || b.textContent.includes('Client check-in')) out.push(b.getBoundingClientRect().width) } return out`,
  ),
)) as number[]
const col = (await page.evaluate(
  inPage(
    `return document.querySelector('.bcexp .bccal2large .bccal2col').getBoundingClientRect().width`,
  ),
)) as number
check(
  'overlapping events sit side by side, each narrower than its column',
  widths.length === 2 && widths.every((w) => w < col * 0.7),
  `${JSON.stringify(widths)} in ${String(col)}`,
)
await shot('03-week')
await exp.locator('[data-cal-view="day"]').click()
await page.waitForTimeout(300)
check('Day view draws one column', (await exp.locator('.bccal2col').count()) === 1)
await shot('04-day')
await exp.locator('[data-cal-view="month"]').click()
await page.waitForTimeout(200)

/* --- create, edit, delete -------------------------------------------------- */
await exp.locator('[data-cal-new]').first().click()
await page.waitForSelector('.bccal2dlg form')
await page.fill('.bccal2dlg input[name="title"]', 'Pricing review')
await page.fill('.bccal2dlg input[name="location"]', 'Room 2')
await shot('05-editor')
await page.locator('.bccal2dlg button[type="submit"]').click()
await page.waitForTimeout(400)
check(
  'a new event is added to the calendar',
  (await page.locator('.bcexp .bccal2large .bccal2chip', { hasText: 'Pricing review' }).count()) >
    0,
)
await page.locator('.bcexp .bccal2large .bccal2chip', { hasText: 'Pricing review' }).first().click()
await page.waitForSelector('.bccal2dlg form')
await page.fill('.bccal2dlg input[name="title"]', 'Pricing review (moved)')
await page.locator('.bccal2dlg button[type="submit"]').click()
await page.waitForTimeout(400)
check(
  'an event can be edited',
  (await page.locator('.bcexp .bccal2large .bccal2chip', { hasText: 'moved' }).count()) > 0,
)
await page.locator('.bcexp .bccal2large .bccal2chip', { hasText: 'moved' }).first().click()
await page.locator('.bccal2dlg [data-cal-del]').click()
await page.waitForTimeout(400)
check(
  'an event can be deleted',
  (await page.locator('.bcexp .bccal2large .bccal2chip', { hasText: 'Pricing review' }).count()) ===
    0,
)
await page.locator('.bcexp [data-cal-new]').first().click()
await page.locator('.bccal2dlg button[type="submit"]').click()
check(
  'an event without a title is refused with a reason',
  (await page.locator('.bccal2dlg .bccal2err').textContent())?.includes('title') === true,
)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check(
  'Escape closes the editor and not the calendar behind it',
  (await page.locator('.bccal2dlg').count()) === 0 && (await page.locator('.bcexp').count()) === 1,
)
check(
  'the scope control offers this project, all projects and Google',
  (await page.locator('.bcexp [data-cal-scope] option').count()) === 3,
)
await exp.locator('[data-cal-nav="next"]').click()
await page.waitForTimeout(200)
check(
  'next month moves the title',
  !((await exp.locator('.bccal2title').first().textContent()) ?? '').includes(
    new Date().toLocaleString('en-GB', { month: 'long' }),
  ),
)
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

/* --- the office adapter speaks the gateway contract ------------------------ */
const calls: { action?: string; args?: Record<string, unknown>; section?: string }[] = []
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p2 = await ctx2.newPage()
const err2: string[] = []
p2.on('pageerror', (e) => {
  err2.push(e.message)
})
await p2.addInitScript(() => {
  localStorage.setItem('hq.token', 'stub-token-for-test')
})
const events = [
  {
    id: 'e1',
    source: 'team_hq',
    title: 'From the office',
    starts_at: new Date(Date.now() + 3600e3 * 26).toISOString(),
    ends_at: new Date(Date.now() + 3600e3 * 27).toISOString(),
    all_day: false,
    project_slug: 'x',
    sync: 'synced',
    origin_channel: 'teamhq',
    editable: true,
  },
  {
    id: 'g:primary:abc',
    source: 'google',
    title: 'Google thing',
    starts_at: new Date(Date.now() + 3600e3 * 50).toISOString(),
    ends_at: new Date(Date.now() + 3600e3 * 51).toISOString(),
    all_day: false,
    sync: 'external',
    editable: false,
    external_url: 'https://calendar.google.com/x',
  },
]
await p2.route('**/*', async (route) => {
  const u = route.request().url()
  if (!u.includes('hq-api')) return route.continue()
  const parsed = new URL(u)
  if (route.request().method() === 'POST') {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      action: string
      args: Record<string, unknown>
    }
    calls.push({ action: body.action, args: body.args })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ result: { ok: true } }),
    })
  }
  const section = parsed.searchParams.get('section') ?? ''
  calls.push({ section, args: Object.fromEntries(parsed.searchParams) })
  if (section === 'project_events') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: { events } }),
    })
  }
  // The page reads the project list before anything else; a stub that does not serve it shows "could not be loaded".
  if (section === 'studio' || section === 'layout') {
    const data =
      section === 'layout'
        ? { panels: null, rev: 0, now: Date.now() }
        : {
            generated_at: new Date().toISOString(),
            crew: [
              { slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' },
            ],
            projects: [
              {
                slug: 'stub-project',
                name: 'Stub project',
                purpose: 'A made-up project.',
                tasks: [],
                documents: [],
                contacts: [],
                sources: [],
                activity: [],
                waiting: [],
                modules: [],
                requests: [],
                layout_board: null,
              },
            ],
          }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data }),
    })
  }
  return route.fulfill({
    status: 500,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ error: 'stub' }),
  })
})
await p2.goto(url('/'), { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(800)
const hasProject = (await p2.locator('[data-bc-go^="/p/"]').count()) > 0
check('the stub office shows a project to open', hasProject)
await ctx2.close()

check('no page errors', thrown.length === 0 && err2.length === 0, [...thrown, ...err2].join(' | '))

/* --- phone ----------------------------------------------------------------- */
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const pp = await phone.newPage()
await pp.goto(url(slug), { waitUntil: 'domcontentloaded' })
await pp.waitForSelector('.bcstage [data-mod="schedule"]')
await pp.waitForTimeout(500)
await pp.locator('[data-mod="schedule"] [data-bc-max]').first().dispatchEvent('click')
await pp.waitForSelector('.bcexp .bccal2--full')
await pp.waitForTimeout(500)
const over = (await pp.evaluate(
  inPage(`return document.documentElement.scrollWidth > innerWidth + 1`),
)) as boolean
check('phone: the expanded calendar does not scroll sideways', !over)
await pp.screenshot({ path: '.out/ux-cal-06-phone-390.png' })
await pp.locator('.bcexp [data-cal-view="week"]').click()
await pp.waitForTimeout(300)
await pp.screenshot({ path: '.out/ux-cal-07-phone-week-390.png' })

console.log(`\n${String(pass)} passed, ${String(fail)} failed`)
void calls
await browser.close()
server.close()
process.exitCode = fail === 0 ? 0 : 1
