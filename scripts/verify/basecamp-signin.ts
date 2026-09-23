/*
 * SIGNING IN FROM THE DEPLOYED PAGE, WITH NOTHING PASTED.
 *
 *   npm run verify:basecamp-signin
 *
 * §2 of the 23 September mission: "Remove the unexpected browser sign-in /
 * office-token requirement from the normal UI flow... Fix the UNDERLYING
 * authentication/session architecture. Do NOT merely hide the warning."
 *
 * So this drives the whole journey the way a person does it: open the deployed
 * page with an empty browser, press one button, and let the office do the rest.
 * The only step a machine cannot take is Grant's thumb — and the thing his
 * thumb does is open a URL, so the suite opens the same URL, read from the
 * database rather than invented.
 *
 * WHAT MAKES THIS MORE THAN A UI TEST. §47: twenty-nine suites in this
 * repository used to write a made-up token into `localStorage`, which worked
 * only while Chromium could not reach the office. Nothing here writes a
 * credential into the browser at all. The page ends up holding whatever the
 * office chose to hand it, and the assertions are about what that buys —
 * whether real projects appear, whether a writer-only control is drawn, and
 * whether it survives a reload.
 *
 * SECRETS. The approve secret is read from the database, used once in a URL
 * that is never printed, and the row is deleted. The token is never read into
 * this process at all: the browser gets it, and the proof is what the browser
 * can then do.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

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
const endpoint = `https://${ref}.supabase.co/functions/v1/signin`

const realProjects = (
  await db.execute(
    `select name from public.projects where status = 'active' and not is_fixture order by name`,
  )
).rows.map((r) => String((r as { name: string }).name))

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(String(e.message)))

let requestId = ''
try {
  await page.goto(`${SITE}/basecamp`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForSelector('.bcsignin', { timeout: 30000 })

  // --- what a person is asked for, before anything is pressed --------------

  const offered = (await page.evaluate(
    inPage(`
      const box = document.querySelector('.bcsignin')
      if (box === null) return { found: false }
      const ask = box.querySelector('[data-bc-signin-ask]')
      const field = box.querySelector('#bc-token')
      const fieldBox = field === null ? null : field.getBoundingClientRect()
      return {
        found: true,
        asks: ask === null ? '' : (ask.textContent || '').trim(),
        askVisible: ask === null ? false : ask.getBoundingClientRect().height > 0,
        // NOT a rectangle. A field inside a SHUT <details> measures 220x44 in
        // Chromium, because a closed disclosure is content-visibility: hidden
        // and that keeps the geometry — so the obvious check reports a folded
        // away control as the thing being asked for. checkVisibility is the
        // question actually being asked, and innerText below agrees with it.
        fieldShown:
          field !== null &&
          field.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }),
        fieldBoxHeight: fieldBox === null ? 0 : fieldBox.height,
        // innerText, not textContent: textContent reads the contents of a shut
        // <details> and every visually-hidden label, so the first draft of
        // this check reported a folded-away fallback as the thing being asked
        // for. What matters is what a person can see.
        words: (box.innerText || '').replace(/\\s+/g, ' ').trim(),
        fallbackOpen: (() => { const d = box.querySelector('details'); return d !== null && d.open })(),
      }
    `),
  )) as {
    found: boolean
    asks: string
    askVisible: boolean
    fieldShown: boolean
    words: string
    fallbackOpen: boolean
    fieldBoxHeight: number
  }

  check('the page offers a way in', offered.found && offered.askVisible, offered.asks)
  check('and it is a button, not a paste', /sign in/i.test(offered.asks), offered.asks)
  check(
    'nothing on screen asks for a pasted token',
    !offered.fieldShown && !offered.fallbackOpen && !/paste/i.test(offered.words),
    `${offered.words.slice(0, 120)} — the field measures ${String(offered.fieldBoxHeight)}px and is ${offered.fieldShown ? 'shown' : 'not shown'}`,
  )

  // --- the ask -------------------------------------------------------------

  await page.click('[data-bc-signin-ask]')
  await page.waitForFunction(
    "document.querySelector('[data-bc-signin-digits]') !== null && (document.querySelector('[data-bc-signin-digits]').textContent || '').length === 6",
    undefined,
    { timeout: 30000 },
  )
  const shown = (await page.evaluate(
    inPage(`
      const d = document.querySelector('[data-bc-signin-digits]')
      const s = document.querySelector('[data-bc-signin-said]')
      const box = document.querySelector('[data-bc-signin-code]')
      return {
        code: d === null ? '' : (d.textContent || '').trim(),
        said: s === null ? '' : (s.textContent || '').trim(),
        codeVisible: box === null ? false : box.getBoundingClientRect().height > 0,
      }
    `),
  )) as { code: string; said: string; codeVisible: boolean }

  check('a code appears on the screen', /^[A-Z0-9]{6}$/.test(shown.code), shown.code)
  check('and it is shown, not merely in the DOM', shown.codeVisible)
  check('and the page says where to look', /telegram/i.test(shown.said), shown.said)

  const row = (
    await db.execute(
      `select request_id, approve_secret, asked_from
         from public.sign_in_requests
        where code = '${shown.code.replace(/'/g, "''")}' and claimed_at is null
        order by started_at desc limit 1`,
    )
  ).rows[0] as { request_id?: string; approve_secret?: string; asked_from?: string } | undefined
  check('the office is holding that exact request', row?.request_id !== undefined, shown.code)
  if (row?.request_id === undefined) throw new Error('no request row to approve')
  requestId = String(row.request_id)
  check(
    'and it says which browser asked, so he can judge it',
    String(row.asked_from ?? '') !== '',
    String(row.asked_from),
  )

  // Still nothing in the browser. This is the assertion §47 is about: the page
  // cannot be holding a credential yet, because nobody has approved anything.
  const beforeTap = (await page.evaluate(
    inPage("return { held: (localStorage.getItem('hq.token') || '') !== '' }"),
  )) as { held: boolean }
  check('the browser is holding nothing while it waits', !beforeTap.held)

  // --- the tap -------------------------------------------------------------
  //
  // Exactly what Telegram opens. Not a database update pretending to be one:
  // if the URL in the message were wrong, this is the only thing that notices.

  const tapped = await fetch(
    `${endpoint}?approve=${encodeURIComponent(String(row.approve_secret))}`,
  )
  const tappedHtml = await tapped.text()
  check('the link in the message works', tapped.status === 200, `http ${String(tapped.status)}`)
  check('and shows the code to compare', tappedHtml.includes(shown.code))

  // --- and the browser lets itself in --------------------------------------

  await page.waitForFunction("document.querySelector('.bcnotlive') === null", undefined, {
    timeout: 45000,
  })
  check('the page signs itself in without being touched again', true)

  const after = (await page.evaluate(
    inPage(`
      return {
        held: (localStorage.getItem('hq.token') || '') !== '',
        body: (document.body.textContent || '').replace(/\\s+/g, ' '),
        strip: document.querySelector('.bcnotlive') !== null,
      }
    `),
  )) as { held: boolean; body: string; strip: boolean }

  check('the browser is now signed in', after.held)
  check('and the "not signed in" strip is gone', !after.strip)

  const seen = realProjects.filter((name) => after.body.includes(name))
  check(
    'and it is showing his office, not the prototype',
    seen.length > 0,
    `looked for ${realProjects.length} real project name(s)`,
  )

  // --- and it stays signed in ----------------------------------------------

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(2500)
  const reloaded = (await page.evaluate(
    inPage(`
      return {
        held: (localStorage.getItem('hq.token') || '') !== '',
        strip: document.querySelector('.bcnotlive') !== null,
        writer: document.querySelector('[data-bc-signin-ask]') === null,
      }
    `),
  )) as { held: boolean; strip: boolean; writer: boolean }
  check('a reload does not sign it out', reloaded.held && !reloaded.strip)
  check('and the sign-in offer is gone, because there is nothing to offer', reloaded.writer)

  // --- the request cannot be used twice ------------------------------------

  const replay = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: SITE },
    body: JSON.stringify({ action: 'claim', request_id: requestId }),
  })
  const replayBody = (await replay.json().catch(() => ({}))) as { ok?: boolean; token?: string }
  check(
    'and a second browser replaying that request gets nothing',
    replayBody.ok === false && replayBody.token === undefined,
  )

  check('nothing threw in the page', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  if (requestId !== '') {
    await db.execute(`delete from public.sign_in_requests where request_id = '${requestId}'`)
  }
  await browser.close()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
