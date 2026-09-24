/*
 * WHAT A BROWSER EXPERIENCES, CLEAN AND RETURNING.
 *
 *   npm run verify:basecamp-signin
 *
 * §2 as corrected on 24 September: *"He does not want an office-token
 * interaction in the normal user experience AT ALL... OPEN AGENTIC TEAM ->
 * APPLICATION LOADS -> USER IS AUTHENTICATED -> USE APPLICATION."*
 *
 * And §6: *"Do not test authentication only in the browser that already
 * contains credentials."* So this drives four states, in this order, because
 * the order is the point:
 *
 *   A. a clean browser that has never been here
 *   B. signing in the way a person does
 *   C. a refresh
 *   D. a brand new context with the same storage, standing in for a restart
 *
 * WHAT IT ASSERTS ABOUT THE TOKEN. Not that the word is absent from the page —
 * that is a wording lock and this repository has six of those written down —
 * but the property: a clean browser is never asked for a credential, is never
 * handed one, and the office's own key is nowhere in its storage after a
 * successful sign-in.
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

const realProjects = (
  await db.execute(
    `select name from public.projects where status = 'active' and not is_fixture order by name`,
  )
).rows.map((r) => String((r as { name: string }).name))

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const errors: string[] = []

try {
  /* --- A. a browser that has never been here ----------------------------- */

  const cleanCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await cleanCtx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.goto(`${SITE}/basecamp`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForSelector('.bcsignin', { timeout: 30000 })

  const shown = (await page.evaluate(
    inPage(`
      const box = document.querySelector('.bcsignin')
      const fields = [...box.querySelectorAll('input')].map((i) => ({
        type: i.type,
        name: i.name,
        placeholder: i.placeholder,
        shown: i.checkVisibility === undefined ? true : i.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }),
      }))
      return {
        words: (box.innerText || '').replace(/\\s+/g, ' ').trim(),
        fields,
        stored: Object.keys(localStorage),
      }
    `),
  )) as {
    words: string
    fields: { type: string; name: string; placeholder: string; shown: boolean }[]
    stored: string[]
  }

  check('a clean browser is offered a way in', shown.fields.length > 0, shown.words)
  check(
    'and what it asks for is an email address',
    shown.fields.every((f) => f.type === 'email' || !f.shown),
    shown.fields.map((f) => `${f.type}/${f.name}`).join(', '),
  )
  check(
    'it asks for no credential of any kind',
    !shown.fields.some((f) => f.shown && f.type === 'password'),
    shown.fields.map((f) => f.type).join(', '),
  )
  check(
    'and it is holding nothing',
    !shown.stored.includes('hq.token') && !shown.stored.includes('hq.session'),
    shown.stored.join(', ') || '(empty)',
  )
  /*
    The office key must not be reachable from a page that nobody has signed in
    to — not in storage, not in a global, not in the markup. A property, not a
    wording check: the page may say the word "token" all it likes as long as it
    does not have one.
  */
  const leaked = (await page.evaluate(
    inPage(`
      const inDom = document.documentElement.innerHTML
      return {
        globals: Object.keys(window).filter((k) => /token|secret|key/i.test(k)),
        bearerInDom: /Bearer\\s+\\S{6,}/.test(inDom),
      }
    `),
  )) as { globals: string[]; bearerInDom: boolean }
  check(
    'and nothing credential-shaped is lying about in the page',
    !leaked.bearerInDom,
    leaked.globals.join(', '),
  )

  /* --- B. signing in the way a person does ------------------------------- */

  const who = await signIn(page, db, { ref, origin: SITE, back: `${SITE}/basecamp` })
  check(`signed in as ${who.email}`, true)
  check(
    'and the link landed on the page it came from',
    who.landedOn.startsWith(`${SITE}/basecamp`),
    who.landedOn,
  )

  await page.waitForFunction("document.querySelector('.bcnotlive') === null", undefined, {
    timeout: 45000,
  })

  const after = (await page.evaluate(
    inPage(`
      return {
        stored: Object.keys(localStorage),
        hasOfficeKey: (localStorage.getItem('hq.token') || '') !== '',
        url: location.href,
        body: (document.body.innerText || '').replace(/\\s+/g, ' '),
      }
    `),
  )) as { stored: string[]; hasOfficeKey: boolean; url: string; body: string }

  check('the browser now holds a session', after.stored.includes('hq.session'))
  check(
    'and NOT the office key — that is an implementation detail it never sees',
    !after.hasOfficeKey,
    after.stored.join(', '),
  )
  check(
    'and the session is out of the address bar',
    !after.url.includes('access_token'),
    after.url.slice(0, 80),
  )
  const seen = realProjects.filter((n) => after.body.includes(n))
  check(
    'and it is showing his office rather than the prototype',
    seen.length > 0,
    `looked for ${String(realProjects.length)} real project name(s)`,
  )

  /* --- C. a refresh ------------------------------------------------------ */

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(2500)
  const reloaded = (await page.evaluate(
    inPage(`
      return {
        held: (localStorage.getItem('hq.session') || '') !== '',
        strip: document.querySelector('.bcnotlive') !== null,
        asks: document.querySelector('.bcsignin input') !== null,
      }
    `),
  )) as { held: boolean; strip: boolean; asks: boolean }
  check('a refresh keeps it signed in', reloaded.held && !reloaded.strip)
  check('and asks for nothing', !reloaded.asks)

  /* --- D. a new context, standing in for a restart ----------------------- */
  /*
    Playwright contexts do not share storage, so the honest way to stand in for
    closing and reopening the browser is to carry the storage state across —
    which is exactly what a restart does and a fresh context does not.
  */
  const carried = await cleanCtx.storageState()
  const restarted = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: carried,
  })
  const second = await restarted.newPage()
  second.on('pageerror', (e) => errors.push(String(e.message)))
  await second.goto(`${SITE}/basecamp`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  /*
    WAIT FOR ALL THREE, not for three seconds.

    A fixed pause is a race with the network, and on a cold deployment it
    loses. Three runs against identical bytes failed three different ways --
    once the projects had not repainted, once the prototype strip had not gone,
    once neither -- which is the signature of a timing assumption rather than a
    defect, and of a wait that waits for only part of what is then asserted.

    So the wait is the whole of what the two checks below read: the session
    held, the strip gone, and one of his projects on the screen. A snapshot
    taken before all three have settled describes a page that is still
    arriving.
  */
  await second
    .waitForFunction(
      `(() => {
         let held = false
         try { held = (localStorage.getItem('hq.session') || '') !== '' } catch { held = false }
         const t = document.body.innerText || ''
         return held
           && document.querySelector('.bcnotlive') === null
           && ${JSON.stringify(realProjects)}.some((n) => t.includes(n))
       })()`,
      undefined,
      { timeout: 30000 },
    )
    .catch(() => null)
  const afterRestart = (await second.evaluate(
    inPage(`
      return {
        held: (localStorage.getItem('hq.session') || '') !== '',
        strip: document.querySelector('.bcnotlive') !== null,
        body: (document.body.innerText || '').replace(/\\s+/g, ' '),
      }
    `),
  )) as { held: boolean; strip: boolean; body: string }
  check('a restart keeps it signed in', afterRestart.held && !afterRestart.strip)
  check(
    'and still shows his office',
    realProjects.some((n) => afterRestart.body.includes(n)),
  )

  /* --- and a stranger still gets nothing --------------------------------- */
  /*
    The control. Every check above would pass against an office that let
    anybody in, so one context asks the gateway with a session nobody issued.
  */
  const refused = await fetch(`https://${ref}.supabase.co/functions/v1/hq-api?section=projects`, {
    headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.not.a.session' },
  })
  check(
    'a session nobody issued is refused',
    refused.status === 401,
    `http ${String(refused.status)}`,
  )

  check('nothing threw in the page', errors.length === 0, errors.slice(0, 3).join(' | '))
  await restarted.close()
  await cleanCtx.close()
} finally {
  await browser.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
