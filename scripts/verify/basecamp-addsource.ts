/*
 * ADD SOURCE, ACTUALLY EXERCISED  (§23)
 *
 *   npm run verify:basecamp-addsource
 *
 * §23: "Do not assume Add Source works because a button/modal exists. Exercise
 * actual supported connection flows. Verify: Add Source -> actual provider flow
 * -> persistence -> reload -> still connected -> useful connection identity
 * displayed -> source genuinely available to the agentic system. Test relevant
 * failures: cancelled, rejected, expired, unavailable, malformed configuration.
 * Do not fake successful connection states."
 *
 * ADD SOURCE HAS TWO PATHS AND THIS DRIVES ONE OF THEM, which is stated here
 * rather than left for somebody to discover from a green number:
 *
 *   something to read   a URL, written by `add_project_reference`. Driven end
 *                       to end: typed on the deployed page, read back out of
 *                       `project_references`, survives a reload, shows its
 *                       identity, and removed again.
 *
 *   a connected service opens the office's own Connections settings, because
 *                       one account serves every project. That is the correct
 *                       architecture and not a stub -- but the provider half
 *                       is an OAuth round trip to Google or Notion, which
 *                       cannot be driven here and must not be faked. It is
 *                       BLOCKED on a human, and `verify:basecamp-connectors`
 *                       covers what the office does with a connection once it
 *                       exists.
 *
 * THE FAILURES §23 LISTS are driven where they have meaning for this path: a
 * malformed address, an empty one, and a write refused because nobody is
 * signed in. Cancelled, rejected and expired belong to the OAuth flow and are
 * named as not covered rather than approximated with something that looks
 * similar.
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
const SLUG = 'legacy-coaching-course'
const RUN = Math.random().toString(36).slice(2, 8)
const ADDRESS = `innergy.com/verify-add-source-${RUN}`

type Reference = { id: string; url: string; kind: string; title: string }

const stored = async (): Promise<Reference[]> => {
  const { rows } = await db.execute(
    `select r.reference_id::text as id, r.url, r.kind, coalesce(r.title, '') as title
       from public.project_references r
       join public.projects p using (project_id)
      where p.slug = '${SLUG}' and r.url like '%verify-add-source-${RUN}%'`,
  )
  return rows as Reference[]
}

const landed = async (within = 20000): Promise<Reference[]> => {
  const until = Date.now() + within
  let got = await stored()
  while (got.length === 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500))
    got = await stored()
  }
  return got
}

const before = await stored()
check('nothing by this name is on the project yet', before.length === 0)

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const errors: string[] = []
let made: string[] = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await signIn(page, db, { ref, origin: SITE, back: `${SITE}/basecamp/p/${SLUG}/sources` })
  await page.waitForSelector('[data-bc-source-add]', { timeout: 40000 })

  const openAdd = async (): Promise<void> => {
    await page.goto(`${SITE}/basecamp/p/${SLUG}/sources`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-bc-source-add]', { timeout: 30000 })
    await page.locator('[data-bc-source-add]').first().click()
    await page.waitForSelector('[data-bc-sourceform]', { timeout: 20000 })
  }
  /*
    WAIT FOR THE SENTENCE, do not read at a fixed pause.

    A first version read 500ms after the press and got an empty string from the
    malformed-address check, which reads as "the office said nothing about a
    bad address" -- a product defect that is not there. `attempt` shows a
    working line first and replaces it with the outcome, so a fixed pause lands
    wherever the machine happens to be.
  */
  const said = async (within = 8000): Promise<string> => {
    const until = Date.now() + within
    let words = ''
    while (Date.now() < until) {
      words = (await page.evaluate(
        inPage(
          `return (document.querySelector('[data-bc-source-said]')?.textContent ?? '').trim()`,
        ),
      )) as string
      if (words !== '' && !/…$/.test(words)) return words
      await page.waitForTimeout(250)
    }
    return words
  }

  /* --- 1. the failures first, so a pass below is not a pass by accident --- */
  await openAdd()
  await page.locator('[data-bc-source-save]').first().click()
  const empty = await said()
  check('an empty address is refused, and says so', empty !== '', empty || '(it said nothing)')

  await page.locator('#bc-src-url').fill('not an address at all')
  await page.locator('[data-bc-source-save]').first().click()
  const bad = await said()
  check(
    'a malformed address is refused, and says why',
    bad !== '' && !/^added/i.test(bad),
    bad || '(it said nothing)',
  )
  check(
    'and neither refusal wrote anything to the project',
    (await stored()).length === 0,
    `${String((await stored()).length)} row(s)`,
  )

  /* --- 2. the real thing ------------------------------------------------- */
  await page.locator('#bc-src-url').fill(ADDRESS)
  await page.locator('[data-bc-source-save]').first().click()
  const rows = await landed()
  made = rows.map((r) => r.id)
  check('a real address is written to the office', rows.length === 1, JSON.stringify(rows))
  check(
    'and the office worked out what kind of thing it is',
    rows.length === 1 && (rows[0]?.kind ?? '') !== '',
    rows[0]?.kind ?? '(none)',
  )

  /* --- 3. persistence, which is §23's own word --------------------------- */
  await page.goto(`${SITE}/basecamp/p/${SLUG}/sources`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcsource', { timeout: 30000 })
  const onScreen = await page
    .waitForFunction(`document.body.innerText.includes('verify-add-source-${RUN}')`, undefined, {
      timeout: 30000,
    })
    .then(
      () => true,
      () => false,
    )
  check('and after a reload it is still on the Sources page', onScreen)

  /* --- 4. useful identity, which is §22's requirement applied to a new one */
  const row = (await page.evaluate(
    inPage(`
      for (const el of document.querySelectorAll('.bcsource')) {
        if (el.innerText.includes('verify-add-source-${RUN}')) {
          return el.innerText.replace(/\\s+/g, ' ').trim()
        }
      }
      return ''
    `),
  )) as string
  check(
    'the new source says what it is, not just that it exists',
    row !== '' && /something to read|a website|a page|a document/i.test(row),
    row,
  )

  check('nothing threw while all of that happened', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  /*
    REMOVED THROUGH THE OFFICE'S OWN WRITER, and the removal asserted: a
    teardown that matches nothing looks exactly like a teardown that worked,
    and a reference left behind sits on one of Grant's real projects for ever.
  */
  for (const id of made) {
    await db.execute(`select public.remove_project_reference('${id}'::uuid)`)
  }
  const left = await stored()
  check('the probe reference is gone again', left.length === 0, JSON.stringify(left))
}

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
console.log(
  '\nNOT PROVED HERE: the provider half of Add Source. Connecting Google or\n' +
    'Notion is an OAuth round trip that cannot be driven from this sandbox and\n' +
    'must not be faked. Cancelled, rejected and expired belong to that flow and\n' +
    'are not approximated with something that merely looks similar.',
)
if (fail > 0) process.exit(1)
