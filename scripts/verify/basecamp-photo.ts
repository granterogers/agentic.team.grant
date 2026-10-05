/*
 * A CONTACT'S PHOTOGRAPH, FROM THE FILE PICKER TO THE FACE ON THE BOARD.
 *
 *   npm run verify:basecamp-photo
 *
 * §11: "Grant added an image to a contact. It does not currently appear in the
 * minimized Contacts module. Fix that. If a contact has a real image: show it.
 * If not: show a graceful fallback."
 *
 * WHAT THE INVESTIGATION FOUND, because the defect was not where the sentence
 * points. The office holds five contacts and NONE of them has a photograph --
 * `contacts.photo_path` is null on every row -- so nothing was failing to
 * display; there was nothing to display. Driving the gateway directly proved
 * storage, signing and serving all work. What did not work was the RECORD: the
 * miniature read `photo`, which is the key the payload carries, and the record
 * read `image`, which only the prototype's local data-URL path ever sets. Two
 * views of one person disagreeing about whether there is a picture of them.
 *
 * So this suite drives the path GRANT uses -- a file chosen in the picker, the
 * browser's own downscaling, the gateway, the office, the payload, both views
 * -- rather than the path that was convenient to test. A check that enters
 * halfway proves the half nobody doubted.
 *
 * WHAT IT DOES TO GRANT'S DATA. It adds one contact of its own, photographs
 * it, and deletes it, asserting the deletion. His five are read and never
 * written. The project is real (`ai-team-hq-test`) because it is the only one
 * holding contacts at all, and a fixture project would not be drawn.
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

const SLUG = 'ai-team-hq-test'
const RUN = Math.random().toString(36).slice(2, 8)
const NAME = `Face probe ${RUN}`
const PLAIN = `Face probe ${RUN} unphotographed`
const FACE = new URL('./fixtures/contact-face.png', import.meta.url).pathname

const q = (s: string): string => s.replace(/'/g, "''")

const project = (
  await db.execute(`select project_id::text as id from public.projects where slug = '${SLUG}'`)
).rows[0] as { id: string } | undefined
if (project === undefined) {
  console.error(`no project ${SLUG}`)
  process.exit(1)
}

/*
  TWO CONTACTS, BOTH OURS.

  The negative control -- a person with no photograph shows initials -- cannot
  be taken from Grant's own rows, because he has none: the five in this project
  are archived acceptance-run debris from 23 September, which is why the board
  says nobody is recorded here. A first draft asserted the fallback "on every
  other contact" and failed against an empty list, which is a check passing
  judgement on a population of zero.
*/
const made = await db.execute(
  `insert into public.contacts (project_id, kind, name, role)
   values ('${project.id}'::uuid, 'person', '${q(NAME)}', 'probe'),
          ('${project.id}'::uuid, 'person', '${q(PLAIN)}', 'probe')
   returning contact_id::text as id, name`,
)
const rows = made.rows as { id: string; name: string }[]
const id = String(rows.find((r) => r.name === NAME)?.id ?? '')
const plainId = String(rows.find((r) => r.name === PLAIN)?.id ?? '')
check('two contacts of our own exist, one to photograph and one not', id !== '' && plainId !== '')

/** What the office holds for this contact. */
const storedPath = async (): Promise<string> => {
  const { rows } = await db.execute(
    `select coalesce(photo_path, '') as p from public.contacts where contact_id = '${id}'`,
  )
  return String((rows[0] as { p: string } | undefined)?.p ?? '')
}

/*
  WAIT FOR THE OFFICE. The upload is a round trip the page does not block on,
  so reading once is a race -- and a race that reports "no photograph" is
  indistinguishable from the defect this suite exists to catch.
*/
const officeHasAPhoto = async (within = 20000): Promise<string> => {
  const until = Date.now() + within
  let p = await storedPath()
  while (p === '' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500))
    p = await storedPath()
  }
  return p
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const errors: string[] = []

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await signIn(page, db, { ref, origin: SITE, back: `${SITE}/basecamp/p/${SLUG}` })
  await page.waitForSelector('[data-bc-contact]', { timeout: 30000 })

  /* --- 1. before: the graceful fallback ---------------------------------- */
  const beforeFace = (await page.evaluate(
    inPage(`
      const b = document.querySelector('[data-bc-contact="${id}"]')
      if (b === null) return 'the contact is not on the board'
      if (b.querySelector('img.bcmateface') !== null) return 'an image, with nothing stored'
      const none = b.querySelector('.bcmateface--none')
      return none === null ? 'no face at all' : 'initials: ' + none.textContent.trim()
    `),
  )) as string
  check(
    'a contact with no photograph shows initials rather than a gap',
    beforeFace.startsWith('initials:') && beforeFace.length > 'initials:'.length + 1,
    beforeFace,
  )

  /* --- 2. the picker, which is the path Grant used ----------------------- */
  await page.locator(`[data-bc-contact="${id}"]`).first().click()
  await page.waitForTimeout(600)
  const picker = page.locator(`[data-bc-contact-image="${id}"]`)
  check('the record offers a way to add an image', (await picker.count()) > 0)
  await picker.first().setInputFiles(FACE)

  const path = await officeHasAPhoto()
  check('choosing a file puts a photograph in the office', path !== '', path.slice(0, 48))

  /* --- 3. the record shows it -------------------------------------------- *
   *
   * WAIT FOR THE PAGE, not for the office. These are two different clocks and
   * the second is much the slower: the row was written within a second, and
   * the open record redraws on the payload's own refresh cycle, about ten. A
   * first draft read 1.5s after the office confirmed and reported "no image in
   * the record" -- the exact words of the defect it had just fixed, about a
   * product that was working. A fixed pause here is a coin flip, and the side
   * it lands on is "the thing you set out to prove is broken".
   */
  const recordDraws = async (within = 30000): Promise<string> => {
    const until = Date.now() + within
    let saw = 'no image in the record'
    while (Date.now() < until) {
      saw = (await page.evaluate(
        inPage(`
          const img = document.querySelector('img.bcface--photo')
          if (img === null) return 'no image in the record'
          return img.complete && img.naturalWidth > 0 ? 'drawn ' + img.naturalWidth : 'not drawn yet'
        `),
      )) as string
      if (saw.startsWith('drawn')) return saw
      await page.waitForTimeout(500)
    }
    return saw
  }
  const inRecord = await recordDraws()
  check('and the record draws it', inRecord.startsWith('drawn'), inRecord)

  /* --- 4. the miniature, which is what §11 actually asked about ----------- */
  await page.goto(`${SITE}/basecamp/p/${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`[data-bc-contact="${id}"]`, { timeout: 30000 })
  await page.waitForTimeout(1500)
  const inMini = (await page.evaluate(
    inPage(`
      const img = document.querySelector('[data-bc-contact="${id}"] img.bcmateface')
      if (img === null) return 'the miniature still shows no image'
      return img.complete && img.naturalWidth > 0 ? 'drawn ' + img.naturalWidth : 'not drawn: ' + img.currentSrc.slice(0, 60)
    `),
  )) as string
  check('the minimised Contacts module draws it too', inMini.startsWith('drawn'), inMini)

  /* --- 5. and it survives a refresh, which is §11's own test -------------- */
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`[data-bc-contact="${id}"]`, { timeout: 30000 })
  await page.waitForTimeout(1500)
  const afterReload = (await page.evaluate(
    inPage(`
      const img = document.querySelector('[data-bc-contact="${id}"] img.bcmateface')
      return img !== null && img.complete && img.naturalWidth > 0 ? 'drawn' : 'gone'
    `),
  )) as string
  check('and it is still there after a refresh', afterReload === 'drawn', afterReload)

  /*
    THE URL IS SIGNED AND TEMPORARY, not a public bucket path. A photograph of
    a person is the most private thing on this board, and an image that renders
    from a permanent public URL renders identically.
  */
  const src = (await page.evaluate(
    inPage(
      `const img = document.querySelector('[data-bc-contact="${id}"] img.bcmateface'); return img === null ? '' : img.getAttribute('src')`,
    ),
  )) as string
  check(
    'through a signed URL rather than a public one',
    src.includes('/object/sign/') && src.includes('token='),
    src.slice(0, 70),
  )

  /* --- 6. the control: the one we did NOT photograph ---------------------- */
  const control = (await page.evaluate(
    inPage(`
      const b = document.querySelector('[data-bc-contact="${plainId}"]')
      if (b === null) return 'the control contact is not on the board'
      if (b.querySelector('img.bcmateface') !== null) return 'an image, on the one with nothing stored'
      const none = b.querySelector('.bcmateface--none')
      return none === null ? 'no face at all' : 'initials: ' + none.textContent.trim()
    `),
  )) as string
  check(
    'the contact we did not photograph still shows initials',
    control.startsWith('initials:') && control.length > 'initials:'.length + 1,
    control,
  )

  check('nothing threw while all of that happened', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  /*
    TEARDOWN, AND THE ASSERTION THAT IT WORKED. A teardown that matches nothing
    looks exactly like a teardown that worked -- CLAUDE.md's own rule, and the
    reason the count is read back rather than the delete being trusted.
  */
  await db.execute(`delete from public.contacts where contact_id in ('${id}', '${plainId}')`)
  const left = await db.execute(
    `select count(*)::int as n from public.contacts where contact_id in ('${id}', '${plainId}')`,
  )
  check('both probe contacts are gone again', (left.rows[0] as { n: number }).n === 0)
}

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
if (fail > 0) process.exit(1)
