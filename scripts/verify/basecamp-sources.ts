/*
 * WHAT IS THIS CONNECTION ACTUALLY POINTING AT?  (§22)
 *
 *   npm run verify:basecamp-sources
 *
 * §22: "`Connected` alone is insufficient. Show enough information to
 * understand WHAT is connected... Never expose secrets, tokens, credentials.
 * The Sources page should answer: what is this connection actually pointing
 * at? at a glance."
 *
 * It did not. A row gave the attachment's name and then the raw value of
 * `project_attachments.role`, so Grant's three real Notion databases read
 * "Projects / home / Connected" -- naming no service, and putting a database
 * enum on a person's screen.
 *
 * SIGNED IN, because the whole question is about HIS connections. Without a
 * session the page draws the prototype's invented sources, and a check against
 * those would pass while saying nothing about the thing §22 is about. It also
 * waits for the live payload before touching anything: the surface renders the
 * prototype first and swaps, and a click in between lands on a key the real
 * list does not have.
 *
 * READ-ONLY. It opens, reads and closes; nothing here writes.
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

/*
  WHAT THE OFFICE HOLDS, read first so the page can be compared against it
  rather than against what it happens to say. A check that reads only the
  screen cannot tell a surface that shows everything from one that shows
  nothing, when the office has nothing.
*/
const held = await db.execute(
  `select a.connector, coalesce(nullif(a.display_name, ''), '') as name, a.role
     from public.project_attachments a
     join public.projects p using (project_id)
    where p.slug = '${SLUG}'`,
)
const attachments = held.rows as { connector: string; name: string; role: string }[]
check(
  'the office holds connected sources on this project to ask about',
  attachments.length > 0,
  `${String(attachments.length)} attachment(s)`,
)

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const errors: string[] = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await signIn(page, db, { ref, origin: SITE, back: `${SITE}/basecamp/p/${SLUG}` })
  await page.waitForSelector('[data-bc-pagemenu]', { timeout: 40000 })
  /*
    WAIT FOR HIS SOURCES, not for a fixed pause. The surface draws the
    prototype's until the payload lands, and the tell is a name the office
    actually holds.
  */
  await page.locator('[data-bc-pagemenu]').first().click()
  await page.waitForTimeout(250)
  await page.locator('[data-bc-pagemenu-panel] [data-bc-sources]').first().click()
  /*
    SCOPE THE WAIT TO THE SOURCE NAMES.

    A first version waited for the first attachment's name anywhere in the
    page. That attachment is the project's NotebookLM notebook, which is named
    after the project -- so the condition was already satisfied by the heading
    before a single source had loaded, and the whole suite then measured the
    prototype's invented rows and reported three real defects that were not
    there. The wait has to look where the answer can only come from the thing
    it is waiting for.
  */
  const names = attachments.map((a) => a.name).filter((n) => n !== '')
  await page.waitForFunction(
    `[...document.querySelectorAll('.bcsourcename')].some((el) =>
       ${JSON.stringify(names)}.includes(el.textContent.trim()))`,
    undefined,
    { timeout: 30000 },
  )

  /* --- 1. every connected row names its service --------------------------- */
  const rows = (await page.evaluate(
    inPage(`
      const out = []
      for (const el of document.querySelectorAll('.bcsource')) {
        out.push({
          name: (el.querySelector('.bcsourcename')?.textContent ?? '').trim(),
          says: (el.querySelector('.bcsourcewhat')?.textContent ?? '').trim(),
          when: (el.querySelector('.bcsourcewhen')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        })
      }
      return JSON.stringify(out)
    `),
  )) as string
  const drawn = JSON.parse(rows) as { name: string; says: string; when: string }[]
  const connected = drawn.filter((r) => r.when.includes('Connected'))
  check(
    'his connected sources are the ones on screen',
    connected.length >= attachments.length,
    `${String(connected.length)} connected row(s) against ${String(attachments.length)} attachment(s)`,
  )
  const services = [...new Set(attachments.map((a) => a.connector))]
  check(
    'every connected row names the service it belongs to',
    connected.every((r) => /notebooklm|notion|google|drive|github|upload|mcp/i.test(r.says)),
    connected.map((r) => `${r.name}: ${r.says}`).join(' | '),
  )
  check(
    'and between them they name every service the office has attached',
    services.every((c) =>
      connected.some((r) => r.says.toLowerCase().replace(/\\s/g, '').includes(c.slice(0, 6))),
    ),
    `${services.join(', ')} vs ${connected.map((r) => r.says).join(' | ')}`,
  )

  /*
    --- 2. NO RAW ENUM ON A PERSON'S SCREEN ---------------------------------

    Asserted as a property rather than against the three words the table
    happens to allow today: a role standing alone, with nothing else on the
    line, is the shape of a column value that escaped. "Notion, where new
    material is filed" contains the word and is not it.
  */
  const bare = connected.filter((r) => ['home', 'source', 'mirror'].includes(r.says.toLowerCase()))
  check(
    'no row shows a database enum as its whole description',
    bare.length === 0,
    bare.map((r) => `${r.name}: ${r.says}`).join(' | '),
  )

  /* --- 3. the record answers it too --------------------------------------- */
  await page.locator('.bcsource').first().click()
  await page.waitForTimeout(700)
  const record = (await page.evaluate(
    inPage(
      `return (document.querySelector('[data-bc-expanded]')?.innerText ?? '').replace(/\\s+/g, ' ')`,
    ),
  )) as string
  check(
    'opening one says which service it is, not just that it is connected',
    /notebooklm|notion|google drive|github/i.test(record),
    record.slice(0, 160),
  )
  check(
    'and how much this project has actually had out of it',
    /documents it has contributed/i.test(record),
    record.slice(0, 160),
  )

  /*
    --- 4. AND NOTHING THAT LOOKS LIKE A CREDENTIAL -------------------------

    §22 names this explicitly, and the shapes are the ones `verify:hq` uses:
    each requires token MATERIAL after the prefix, so a help text reading
    "starts xoxb-" does not trip it. CLAUDE.md records why that matters -- a
    security check that cries wolf is one somebody starts overriding.
  */
  const whole = (await page.evaluate(inPage('return document.body.innerText'))) as string
  const shapes: [string, RegExp][] = [
    ['a Slack token', /xox[abposr]-[A-Za-z0-9-]{10,}/],
    ['a bearer secret', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
    ['a Google refresh token', /\b1\/\/[A-Za-z0-9_-]{20,}/],
    ['an OpenAI key', /\bsk-[A-Za-z0-9]{20,}/],
    ['a Notion secret', /\bsecret_[A-Za-z0-9]{20,}/],
  ]
  const leaked = shapes.filter(([, re]) => re.test(whole)).map(([n]) => n)
  check(
    'nothing on the Sources surface looks like a credential',
    leaked.length === 0,
    leaked.join(', '),
  )

  check('nothing threw while reading it', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
}

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
if (fail > 0) process.exit(1)
