/*
 * THE BOARD HE ARRANGED, ON THE OTHER MACHINE.
 *
 *   npm run verify:basecamp-arrangement-live
 *
 * #341 and §22: *"Board/module arrangement must be PER USER/PERSON + PER
 * PROJECT, not PER DEVICE. Verify using independent browser contexts. Do not
 * merely copy localStorage."*
 *
 * So two contexts, which share nothing — separate storage, separate cookies,
 * separate everything. One arranges; the other is opened afterwards and must
 * agree. The only thing that can carry the arrangement between them is the
 * office, which is the whole point of ADR-0021 and the thing 0582 unblocked.
 *
 * WHAT WOULD MAKE THIS PASS FOR THE WRONG REASON, and is therefore checked:
 * the second context must be proved EMPTY before it loads the page, or a
 * shared profile would look like a working office.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { signIn } from './lib/sign-in.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

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

const SLUG = 'ai-team-hq-test'
const BOARD = `${SITE}/basecamp/p/${SLUG}`

/** What the office is holding for this surface, read at the office. */
const stored = async (): Promise<{ id: string; x: number; w: number }[]> => {
  const { rows } = await db.execute(
    `select l.panels from public.dashboard_layouts l
       join public.projects p using (project_id)
      where p.slug = '${SLUG}' and l.owner = 'grant' and l.surface = 'basecamp'`,
  )
  const panels = (rows[0] as { panels?: unknown } | undefined)?.panels
  const parsed = typeof panels === 'string' ? JSON.parse(panels) : panels
  return Array.isArray(parsed) ? (parsed as { id: string; x: number; w: number }[]) : []
}

/** What a page is showing, in the order the board puts it. */
const onScreen = (page: import('playwright').Page) =>
  page.evaluate(
    inPage(`
      return [...document.querySelectorAll('[data-mod]')].map((el) => ({
        id: el.getAttribute('data-mod'),
        top: Math.round(el.getBoundingClientRect().top),
        left: Math.round(el.getBoundingClientRect().left),
      }))
    `),
  ) as Promise<{ id: string; top: number; left: number }[]>

const before = await stored()
const browser = await chromium.launch({ args: ['--lang=en-GB'] })

try {
  /* --- the first machine ------------------------------------------------- */

  const one = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const first = await one.newPage()
  await signIn(first, db, { ref, origin: SITE, back: BOARD })
  await first.waitForSelector('[data-mod]', { timeout: 30000 })
  await first.waitForTimeout(2000)

  const was = await onScreen(first)
  check('the board is on screen', was.length > 1, `${String(was.length)} module(s)`)

  /*
    Take a module off. It is the smallest arrangement change that is
    unmistakable from the other side, and it exercises the same `save` path a
    drag does — both go through `grid.save`, which is the point of having one.
  */
  const victim = was.find((m) => m.id === 'documents')?.id ?? was[1]?.id ?? ''
  check('there is a module to move', victim !== '', victim)
  await first.locator(`[data-mod="${victim}"]`).first().hover()
  await first.waitForTimeout(200)
  await first.locator(`[data-bc-modoff="${victim}"]`).click()
  await first.waitForTimeout(3000)

  const nowHere = await onScreen(first)
  check(
    'it comes off this machine',
    !nowHere.some((m) => m.id === victim),
    nowHere.map((m) => m.id).join(','),
  )

  const kept = await stored()
  check(
    'and the OFFICE is holding the arrangement, not just this browser',
    kept.length > 0 && !kept.some((m) => m.id === victim),
    `${String(kept.length)} panel(s): ${kept.map((m) => m.id).join(',')}`,
  )

  /* --- the other machine, which has never seen this ---------------------- */

  const two = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const second = await two.newPage()
  await second.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 45000 })
  const empty = (await second.evaluate(
    inPage('return Object.keys(localStorage).filter((k) => k.indexOf("bc.") === 0).length'),
  )) as number
  check(
    'the second machine is genuinely a different machine',
    empty === 0,
    `${String(empty)} board key(s) in its storage before it loaded anything`,
  )

  await signIn(second, db, { ref, origin: SITE, back: BOARD })
  await second.waitForSelector('[data-mod]', { timeout: 30000 })
  await second.waitForTimeout(3000)

  const there = await onScreen(second)
  check(
    'and it shows the arrangement he made on the first one',
    there.length > 0 && !there.some((m) => m.id === victim),
    there.map((m) => m.id).join(','),
  )
  check(
    'with the same modules in the same order',
    there.map((m) => m.id).join(',') === nowHere.map((m) => m.id).join(','),
    `${nowHere.map((m) => m.id).join(',')} against ${there.map((m) => m.id).join(',')}`,
  )

  /* --- and putting it back reaches the office too ------------------------ */

  await second.locator(`[data-bc-arr-on="${victim}"]`).click()
  await second.waitForTimeout(3000)
  const restored = await stored()
  check(
    'putting it back on the second machine reaches the office as well',
    restored.some((m) => m.id === victim),
    restored.map((m) => m.id).join(','),
  )

  await two.close()
  await one.close()
} finally {
  await browser.close()
  /*
    Put the office back the way it was found. A suite that rearranges a real
    project and leaves it rearranged has changed Grant's workspace.
  */
  if (before.length === 0) {
    await db.execute(`select app.hq_dashboard_layout_reset('${SLUG}', 'basecamp')`)
  } else {
    await db.execute(
      `select app.hq_dashboard_layout_set('${SLUG}', '${JSON.stringify(before).replace(/'/g, "''")}'::jsonb, 'basecamp')`,
    )
  }
  const after = await stored()
  console.log(
    `\nteardown: the office is back to ${after.length === 0 ? 'no stored arrangement' : `${String(after.length)} panel(s)`}, as found`,
  )
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
