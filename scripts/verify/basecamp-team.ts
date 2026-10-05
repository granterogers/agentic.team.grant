/*
 * THE TEAM SCREEN IS WHERE THE TEAM IS CONFIGURED  (§16, §17)
 *
 *   npm run verify:basecamp-team
 *
 * §16: "Grant's current requirement is that the Team screen IS the place where
 * the AI team assigned to the project is configured... This must NOT merely be
 * cosmetic profile editing. It needs to affect the underlying agentic system...
 * Do NOT build a parallel frontend-only agent model."
 *
 * So the test is not that a form exists. It is that pressing something on this
 * screen changes the rows the ROUTER reads:
 *
 *   who is on the project   `project_staff`, written by `set_project_staff`
 *   the subject words       `staff.expertise`, written by `hq_staff_update`'s
 *                           p_skills -- the column `who_knows_about` matches a
 *                           request against, which is what makes this the
 *                           routing requirement rather than a profile field
 *
 * Both are read back FROM THE DATABASE after the press, not from the screen. A
 * screen that says it saved is the thing under suspicion.
 *
 * WHAT IT DOES TO GRANT'S OFFICE. It takes one specialist off this project and
 * puts them back, and adds one subject word to one specialist and removes it
 * again -- each asserted, and each restored to the exact value read before.
 * Nothing is created and nobody is hired: `hq_staff_hire` makes a person who
 * cannot then be deleted, and a suite that runs nightly would build a roster
 * of ghosts. The hire FORM is checked for existence and left alone, and that
 * gap is stated rather than papered over.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */

import '../../src/safety/require-production-site.ts'
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
const SLUG = 'legacy-coaching-course'

/*
  THE SUBJECT, chosen so the restore is exact. The quality director is picked
  rather than the chief of staff, whose removal would change where unrouted
  work lands while the suite is running.
*/
const WHO = 'quality-director'
const WORD = 'verify-routing-probe'

const onProject = async (): Promise<string[]> => {
  const { rows } = await db.execute(
    `select public.staff_on_project((select office_id as office from public.projects where slug = '${SLUG}'), project_id) as v
       from public.projects where slug = '${SLUG}'`,
  )
  const v = (rows[0] as { v: unknown }).v
  return Array.isArray(v) ? v.map(String) : []
}
const wordsOf = async (): Promise<string[]> => {
  const { rows } = await db.execute(
    `select coalesce(expertise, array[]::text[]) as v from public.staff where slug = '${WHO}'`,
  )
  const v = (rows[0] as { v: unknown }).v
  return Array.isArray(v) ? v.map(String) : []
}

const wasOn = await onProject()
const wasWords = await wordsOf()
check(
  'the office can say who is on this project, and it is not nobody',
  wasOn.length > 0 && wasOn.includes(WHO),
  wasOn.join(', '),
)

/* Wait for the office rather than reading once: the press is a round trip. */
const settles = async (want: () => Promise<boolean>, within = 20000): Promise<boolean> => {
  const until = Date.now() + within
  while (Date.now() < until) {
    if (await want()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const errors: string[] = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await signIn(page, db, { ref, origin: SITE, back: `${SITE}/basecamp/p/${SLUG}/team` })
  await page.waitForSelector(`[data-bc-person="${WHO}"]`, { timeout: 40000 })

  /* --- 1. it shows the team the OFFICE says is on the project ------------- */
  const shown = (await page.evaluate(
    inPage(
      "return [...document.querySelectorAll('[data-bc-person]')].map((e) => e.getAttribute('data-bc-person'))",
    ),
  )) as string[]
  check(
    'every specialist the office has on this project is on the screen',
    wasOn.every((s) => shown.includes(s)),
    `office ${wasOn.join(', ')} · screen ${shown.join(', ')}`,
  )
  /*
    §17 makes this screen an intentional exception to the identity rule, so a
    name here is required rather than tolerated -- and a slug is not a name.
  */
  const named = (await page.evaluate(
    inPage(`
      const el = document.querySelector('[data-bc-person="${WHO}"] .bcitemtitle')
      return el === null ? '' : el.textContent.trim()
    `),
  )) as string
  check(
    'each one is named as a person, not by their database slug',
    named !== '' && !named.includes('-') && named.toLowerCase() !== WHO,
    named,
  )
  const words = (await page.evaluate(
    inPage(
      `return [...document.querySelectorAll('[data-bc-person="${WHO}"] .bcword')].map((e) => e.textContent.trim())`,
    ),
  )) as string[]
  check(
    'and the subject words routing uses are on the row',
    words.length > 0 && wasWords.some((w) => words.includes(w)),
    words.join(', '),
  )

  /* --- 2. taking somebody off changes project_staff ----------------------- */
  await page.locator(`[data-bc-person="${WHO}"] [data-bc-person-off]`).first().click()
  const cameOff = await settles(async () => !(await onProject()).includes(WHO))
  check('taking somebody off writes it to the office', cameOff, (await onProject()).join(', '))

  /* --- 3. and putting them back on ---------------------------------------- */
  await page.waitForSelector(`[data-bc-person="${WHO}"] [data-bc-person-on]`, { timeout: 20000 })
  await page.locator(`[data-bc-person="${WHO}"] [data-bc-person-on]`).first().click()
  const wentBack = await settles(async () => (await onProject()).includes(WHO))
  check('and putting them back on writes that too', wentBack, (await onProject()).join(', '))

  /*
    --- 4. THE ROUTING REQUIREMENT -----------------------------------------

    A subject word added on this screen has to land in `staff.expertise`, which
    is the column the router matches a request against. This is the difference
    between §16 being satisfied and being decorated.
  */
  await page.locator(`[data-bc-person="${WHO}"] [data-bc-person-edit]`).first().click()
  await page.waitForSelector('[data-bc-personform]', { timeout: 20000 })
  const box = page.locator('#bc-p-skills')
  check('the editor opens with the words it is about to change', (await box.count()) > 0)
  await box.fill([...wasWords, WORD].join(', '))
  await page.locator('[data-bc-person-save]').first().click()
  const landed = await settles(async () => (await wordsOf()).includes(WORD))
  check(
    'a subject word typed here reaches the column the router reads',
    landed,
    (await wordsOf()).join(', '),
  )

  /* --- 5. the hire form exists, and is deliberately not driven ------------ */
  await page.locator('[data-bc-hire]').first().click()
  await page.waitForTimeout(500)
  const hire = (await page.evaluate(
    inPage(`
      const f = document.querySelector('[data-bc-hireform]')
      if (f === null) return ''
      return [...f.querySelectorAll('[name]')].map((e) => e.getAttribute('name')).join(',')
    `),
  )) as string
  check(
    'bringing somebody in asks for a name, a role, a reason and an end',
    ['name', 'title', 'why', 'until'].every((n) => hire.split(',').includes(n)),
    hire,
  )

  check('nothing threw while all of that happened', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  /*
    PUT IT BACK EXACTLY. Both subjects are restored to the value read before
    the run, through the office's own writers, and the restore is asserted --
    a teardown that matches nothing looks exactly like a teardown that worked.
  */
  await db.execute(
    `select app.hq_staff_update('${WHO}', null, null, null, null,
       ${wasWords.length === 0 ? `''` : `'${wasWords.join(', ').replace(/'/g, "''")}'`}, null)`,
  )
  if (wasOn.includes(WHO)) {
    await db.execute(
      `select public.set_project_staff((select office_id as office from public.projects where slug = '${SLUG}'), '${SLUG}', '${WHO}', true, 'verify:basecamp-team')`,
    )
  }
  const nowWords = await wordsOf()
  const nowOn = await onProject()
  /*
    THE SAME WORDS, NOT THE SAME ORDER.

    `hq_staff_update` normalises: it lower-cases, trims, de-duplicates and
    sorts. So a restore is exact in content and cannot be exact in sequence,
    and asserting the sequence reported a correct restore as a failure -- the
    instrument being wrong about the product, for the fourth time tonight.
    The set is what a restore means here; the order is the office's business.
  */
  const same = (a: string[], b: string[]): boolean =>
    a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
  check(
    'the subject words are exactly the ones that were found',
    same(nowWords, wasWords),
    `was ${wasWords.join(', ')} · now ${nowWords.join(', ')}`,
  )
  check(
    'and the project has exactly the team it had',
    same(nowOn, wasOn),
    `was ${wasOn.join(', ')} · now ${nowOn.join(', ')}`,
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
console.log(
  '\nNOT PROVED HERE: bringing somebody in. `hq_staff_hire` creates a person\n' +
    'who cannot then be deleted, so a suite that ran it nightly would build a\n' +
    'roster of ghosts. The form is checked; the press is left to a human.',
)
if (fail > 0) process.exit(1)
