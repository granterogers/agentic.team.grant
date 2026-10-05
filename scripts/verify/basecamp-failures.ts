/*
 * WHAT THE PAGE SAYS WHEN THE OFFICE WILL NOT ANSWER.
 *
 * Grant, 23 September: "Test failure paths: what happens if a task fails to
 * save, a date fails to save, a chat message fails to send, a contact fails to
 * save, a source fails to connect, layout persistence fails, microphone
 * permission is denied, a voice token request fails, a document fails to load.
 * The product must fail honestly and visibly, not silently."
 *
 * TWO LIES ARE BEING HUNTED, and they are not the same one:
 *
 *   1. SAYING IT WORKED. A write that throws and leaves "Saved." on screen is
 *      the worst of the two, because the person walks away.
 *   2. SAYING THERE IS NOTHING THERE. CLAUDE.md states it as a rule - "you may
 *      say you could not look; you may not say there is nothing there" - and
 *      the studio has already shipped it twice, once in `needMine` and once in
 *      `mailBlock`. A read that fails and renders an empty state is a claim
 *      about the office's records that nobody checked.
 *
 * So every section here breaks one thing on purpose and asks the SCREEN what
 * it now says. Nothing below asserts a wording: it asserts that some sentence
 * naming trouble is visible, and that no sentence claiming success is.
 *
 * THE TOKEN. `attempt()` refuses before it runs anything when there is none,
 * which is correct and is not what this suite is about - a refusal to try is
 * not a failure to save. So each write section puts a throwaway string in
 * `localStorage` to get past that gate and then has the network refuse. The
 * string is not a credential, is not read by anything but a length check, and
 * never leaves the browser this suite opened.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { chromium, type Page } from 'playwright'
import { serveLive } from './serve-live.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4692
let server: Awaited<ReturnType<typeof serveStudio>>
let subject = 'the working tree'
try {
  if (process.env.SUBJECT === 'source') throw new Error('asked for source')
  const { readFile } = await import('node:fs/promises')
  await readFile('.out/live/index.html')
  server = await serveLive(PORT)
  subject = 'the deployed bytes in .out/live'
} catch {
  server = await serveStudio(PORT)
}
console.log(`subject: ${subject}\n`)
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

/*
  "THE SCREEN SAYS SOMETHING WENT WRONG", as a PROPERTY rather than a list of
  sentences.

  The first draft of this matched a vocabulary - "failed", "could not",
  "refused" - and reported five honest refusals as silent ones, because
  `office.js` repeats the OFFICE'S OWN WORDS rather than composing its own
  ("the RPC is the authority and the page repeats what it said"), and the words
  it happened to be given were "upstream unavailable". That is the wording lock
  CLAUDE.md records six times, and believing it would have sent somebody adding
  apologies to a page that was already honest.

  So the refusal is made RECOGNISABLE where it is injected, and the property is
  that the page repeats it. Where the failure carries no words at all - a
  dropped connection - the property is that the screen CHANGED: an office that
  never answered may not leave the page looking exactly as it did before.
*/
const REFUSAL = 'the office is not answering right now'
const SUCCESS = /\b(saved|added|updated|sent|connected|dated|removed)\b\.?\s*$/i

/* What a person actually reads: the rendered text of the shell. */
const visibleText = async (page: Page): Promise<string> =>
  (await page.evaluate(
    inPage(`const bits = []
       for (const sel of ['.bctop', '.bcnotlive', '.bcmain', '.bctray', '#dock']) {
         const el = document.querySelector(sel)
         if (el !== null) bits.push(el.innerText ?? '')
       }
       return bits.join('\\n').replace(/[ \\t]+/g, ' ')`),
  )) as string

const browser = await chromium.launch({ args: ['--lang=en-GB'] })

/* A page with a throwaway token, and the office refusing in a stated way. */
const openWith = async (
  how: 'status' | 'abort' | 'rpc-error',
  opts: { permissions?: string[] } = {},
): Promise<{ page: Page; close: () => Promise<void>; calls: string[]; thrown: string[] }> => {
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    permissions: opts.permissions ?? [],
  })
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
  )
  const calls: string[] = []
  const thrown: string[] = []
  /*
    THE CONVERSATION GOES SOMEWHERE ELSE. `chat.js` posts to `/turn`, not to
    `hq-api` - which is why the first draft of this reported a message send as
    never reaching the office: the suite was watching the wrong door.
  */
  await ctx.route('**/turn**', async (route) => {
    calls.push('{"action":"turn"}')
    if (how === 'abort') {
      await route.abort('connectionfailed')
      return
    }
    await route.fulfill({
      status: 502,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ error: REFUSAL }),
    })
  })
  await ctx.route('**/hq-api**', async (route) => {
    const body = route.request().postData() ?? ''
    calls.push(body.slice(0, 120))
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      return
    }
    /*
      A READ IS REFUSED AT ONCE rather than passed through. Letting it travel
      means letting it travel to the real office, which this container cannot
      reach - so it stalled for thirty seconds and the surface under test never
      finished drawing. The page falls back to its prototype rows when a read
      fails, which is exactly the state these sections want: something on
      screen, and a write that still goes to the office.
    */
    if (!body.includes('"action"')) {
      await route.abort('connectionfailed')
      return
    }
    if (how === 'abort') {
      await route.abort('connectionfailed')
      return
    }
    if (how === 'rpc-error') {
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ result: { error: REFUSAL } }),
      })
      return
    }
    await route.fulfill({
      status: 500,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ error: REFUSAL }),
    })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  return { page, calls, thrown, close: () => ctx.close() }
}

const slug = await (async (): Promise<string> => {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(400)
  const s = (await p.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
  await ctx.close()
  return s
})()

/*
  Each write is driven the same way: open the surface, fill the form, press
  save with the office refusing, and read the screen. `told` is the sentence
  the person is left with.
*/
type Drive = {
  what: string
  path: string
  how: 'status' | 'abort' | 'rpc-error'
  run: (page: Page) => Promise<void>
}

const drives: Drive[] = [
  {
    what: 'a task that will not save',
    path: `${slug}/tasks`,
    how: 'status',
    run: async (page) => {
      /*
        THE INTERACTION `verify:basecamp-todos` ALREADY PROVES WORKS, copied
        rather than re-invented. Two drafts of this were spent on selectors
        that resolved to a hidden twin of the same control, and a drive that
        never reached the form reports the product as silent when it was the
        test that stayed quiet.
      */
      await page.locator('.bcrecordhead [data-bc-addtask]').first().click()
      await page.waitForTimeout(400)
      await page
        .locator('[data-bc-taskform]:not([hidden]) input')
        .first()
        .fill('A task the office will refuse')
      await page
        .locator('[data-bc-taskform]:not([hidden])')
        .locator('[data-bc-tasksave]')
        .first()
        .click()
      await page.waitForTimeout(1600)
    },
  },
  {
    what: 'a message that will not send',
    path: slug,
    how: 'status',
    run: async (page) => {
      /*
        THE VISIBLE toggle: there are two in the tree (the head's and the
        tray's) and only one of them is on screen at this width. Pressing the
        hidden one opened nothing, which is why the first draft of this
        reported a message send as never reaching the office.
      */
      /*
        THE SIDEBAR'S OWN COMPOSER, which is the studio's (`[data-docksay]`
        inside `#dock`) and not the project surface's "Ask the team" form -
        those are two different fields with two different ids, and the send
        this section is about is the sidebar's, because that is the one
        `chat.js` takes to `/turn`.
      */
      await page.locator('[data-bc-dock]:visible').first().click()
      await page.waitForTimeout(700)
      await page.locator('#dock [data-docksay]').fill('Does this reach anybody?')
      await page.locator('#dock [data-dockform] button[type="submit"]').click()
      /* The office is given its full waiting period before the screen is read. */
      await page.waitForTimeout(4000)
    },
  },
  {
    what: 'a source that will not connect',
    path: `${slug}/sources`,
    how: 'rpc-error',
    run: async (page) => {
      await page.locator('[data-bc-source-add]').first().click()
      await page.waitForTimeout(500)
      await page
        .locator('[data-bc-sourceform]:not([hidden]) #bc-src-url')
        .fill('https://example.com/a-thing')
      await page
        .locator('[data-bc-sourceform]:not([hidden])')
        .locator('[data-bc-source-save]')
        .first()
        .click()
      await page.waitForTimeout(1600)
    },
  },
]

for (const d of drives) {
  const { page, close, thrown, calls } = await openWith(d.how)
  await page.goto(url(d.path), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain', { timeout: 8000 }).catch(() => null)
  await page.waitForTimeout(600)
  const before = await visibleText(page)
  /*
    A SWALLOWED HARNESS ERROR IS THE ONE THING THAT SAYS WHY. CLAUDE.md records
    three attempts spent on a bare skip count for exactly this reason, so the
    drive's own failure is kept and reported rather than caught into silence.
  */
  const broke = await d.run(page).then(
    () => '',
    (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e)),
  )
  check(`${d.what}: the drive itself ran`, broke === '', broke)
  const told = await visibleText(page)
  /*
    FIRST: DID THE DRIVE ACTUALLY ASK THE OFFICE TO DO ANYTHING. A section that
    never reached a write would otherwise report the product as silent when it
    was the test that stayed quiet - the commonest shape of wrong finding in
    this repository, which is why this line comes before the others.
  */
  const asked = calls.filter((c) => c.includes('"action"'))
  check(
    `${d.what}: the drive really did ask the office`,
    asked.length > 0,
    `${String(calls.length)} call(s) went out, none of them a write`,
  )
  if (d.how === 'abort') {
    check(
      `${d.what}: a dropped connection does not leave the screen exactly as it was`,
      told !== before,
      'the page is unchanged, so nothing told the person anything',
    )
  } else {
    check(
      `${d.what}: the screen repeats what the office said`,
      told.toLowerCase().includes(REFUSAL),
      `screen read: ${told.replace(/\n+/g, ' / ').slice(-260)}`,
    )
  }
  check(
    `${d.what}: and nothing on screen claims it worked`,
    !told.split('\n').some((t) => SUCCESS.test(t.trim())),
    told
      .split('\n')
      .filter((t) => SUCCESS.test(t.trim()))
      .join(' / '),
  )
  check(`${d.what}: nothing threw`, thrown.length === 0, thrown.join(' | '))
  await close()
}

/*
 * --- THE TWO WRITES THAT DO NOT GO TO THE OFFICE AT ALL -------------------
 *
 * A due date and a contact on a PROTOTYPE row are kept in this browser, by
 * design: `wire.js` takes the local branch for any key beginning `p:`, and the
 * contacts backend is not deployed (the migration is written and unapplied -
 * see the acceptance report). So there is no network failure to inject for
 * either of them, and a section that pretended otherwise would be asserting
 * against a path nothing takes.
 *
 * What CAN fail for them is the storage, so that is what is broken here: the
 * page must not tell somebody a thing was kept when nothing could keep it.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  await ctx.addInitScript(`(() => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('bc.')) throw new Error('QuotaExceededError')
      return real.call(this, k, v)
    }
  })()`)
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  await page.goto(url(`${slug}/schedule`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(600)
  const dated = page.locator('[data-bc-setdue]').first()
  if ((await dated.count()) > 0) {
    await dated.fill('2026-12-01')
    await page.waitForTimeout(700)
  }
  const afterDate = await visibleText(page)
  check(
    'a date that cannot be stored does not take the page down',
    thrown.length === 0 && afterDate.length > 120,
    thrown.join(' | '),
  )
  await page.goto(url(`${slug}/contacts`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(600)
  await page.locator('[data-bc-contact]').first().click()
  await page.waitForTimeout(500)
  const note = page.locator('[data-bc-ctfield="note"]').first()
  if ((await note.count()) > 0) {
    await note.fill('A note nothing can keep')
    await page.locator('[data-bc-contact-save]').first().click()
    await page.waitForTimeout(700)
  }
  check('and neither does a contact that cannot be stored', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* --- layout persistence failing ----------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const thrown: string[] = []
  /*
    STORAGE THAT REFUSES TO WRITE, which is what a private window and a full
    quota both look like. The page must still arrange itself and still let a
    module be moved; it simply cannot remember it afterwards.
  */
  await ctx.addInitScript(`(() => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('bc.layout.')) throw new Error('QuotaExceededError')
      return real.call(this, k, v)
    }
  })()`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcpanes [data-mod]')
  await page.waitForTimeout(500)
  const before = await page.locator('.bcpanes [data-mod]').count()
  const head = await page.locator('[data-mod="documents"] .bcmodhead').first().boundingBox()
  if (head !== null) {
    await page.mouse.move(head.x + 30, head.y + head.height / 2)
    await page.mouse.down()
    await page.mouse.move(head.x + 300, head.y + 260, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(400)
  }
  const after = await page.locator('.bcpanes [data-mod]').count()
  check(
    'layout persistence failing does not take the page down with it',
    after === before && before > 0 && thrown.length === 0,
    `${String(before)} modules before, ${String(after)} after; ${thrown.join(' | ')}`,
  )
  await ctx.close()
}

/* --- the microphone, refused -------------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, permissions: [] })
  const thrown: string[] = []
  await ctx.addInitScript(`(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
  })()`)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-voice]')
  await page.waitForTimeout(400)
  await page.locator('[data-bc-voice]').first().click()
  await page.waitForTimeout(2500)
  const told = await visibleText(page)
  /*
    WHERE THE CALL SPEAKS is the experience's own callsay line, beside the control, which is
    where `verify:basecamp-voice` reads it too. Asking the whole shell for the
    word "microphone" found the activity feed instead - a check looking
    somewhere other than where the product speaks passes, or fails, for the
    wrong reason.
  */
  const saidMic = await page.locator('[data-bc-callsay]').first().innerText()
  check(
    'the microphone being refused is said beside the control that asked for it',
    saidMic.trim() !== '',
    `the control said nothing; the shell read: ${told.replace(/\n+/g, ' / ').slice(-200)}`,
  )
  const phase = (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-voice]')
       return el === null ? 'gone' : (el.dataset.phase ?? el.getAttribute('aria-pressed') ?? 'none')`),
  )) as string
  check(
    'and the control does not sit there claiming a call',
    phase !== 'live',
    `the control reads ${phase}`,
  )
  check('nothing threw when the microphone was refused', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/* --- the voice token, refused ------------------------------------------- */
{
  const { page, close, thrown } = await openWith('status', { permissions: ['microphone'] })
  /*
    THE MINT, and only the mint.

    This pattern used to be a wildcard around the bare word voice, which also
    matches this experience's own modules - voicenote.js and livevoice.js - so
    the moment those existed the route blocked the page's own code and nothing
    rendered at all. A route pattern matches a URL, not a meaning, and two
    modules here have that word in their names.

    No glob written out in this comment: a star followed by a slash inside a
    block comment ends it, which is how the first version of this comment broke
    the file.
  */
  await page.route('**/voice-token**', (r) => r.fulfill({ status: 503, body: 'no' }))
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-voice]')
  await page.waitForTimeout(400)
  const quiet = await visibleText(page)
  await page.locator('[data-bc-voice]').first().click()
  await page.waitForTimeout(2500)
  const told = await visibleText(page)
  const saidVoice = await page.locator('[data-bc-callsay]').first().innerText()
  check(
    'a voice session that cannot be established is said beside the control',
    saidVoice.trim() !== '' && told !== quiet,
    `the control said "${saidVoice.trim()}"`,
  )
  check(
    'and nothing claims a call is under way',
    !/\blistening\b|\bin a call\b/i.test(told),
    told.replace(/\n+/g, ' / ').slice(-200),
  )
  check('nothing threw when the voice token was refused', thrown.length === 0, thrown.join(' | '))
  await close()
}

/* --- a document that will not load --------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const thrown: string[] = []
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  /* Everything a document body could come from, refused. */
  await page.route('**/samples/**', (r) => r.abort('connectionfailed'))
  await page.route('**/*.pdf', (r) => r.abort('connectionfailed'))
  await page.goto(url(`${slug}/documents`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(700)
  const opened = page.locator('[data-bc-doc], [data-bc-doc-open]').first()
  if ((await opened.count()) > 0) {
    await opened.click()
    await page.waitForTimeout(1200)
  }
  const told = await visibleText(page)
  check(
    'a document whose file will not load still shows what the office knows about it',
    told.length > 120,
    `only ${String(told.length)} characters on screen`,
  )
  check(
    'and does not claim there is nothing there',
    !/\bnothing (here|yet|to show)\b/i.test(told),
    told.slice(-200),
  )
  check('nothing threw when the file would not load', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/*
 * --- AND THE SECOND LIE: A FAILED READ RENDERED AS AN EMPTY OFFICE --------
 *
 * The one this repository has already shipped twice. Every read refused, and
 * the assertion is that no surface says the office HAS nothing - it may only
 * say it could not look.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
  )
  await ctx.route('**/hq-api**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      : r.abort('connectionfailed'),
  )
  const page = await ctx.newPage()
  const thrown: string[] = []
  page.on('pageerror', (e) => {
    thrown.push(e.message)
  })
  const EMPTY =
    /\bno (tasks|documents|contacts|sources|messages|records)\b|\bnothing (here|yet|to show|due)\b|\bis empty\b/i
  for (const [name, path] of [
    ['to-dos', `${slug}/tasks`],
    ['contacts', `${slug}/contacts`],
    ['docs and files', `${slug}/documents`],
    ['your own list', '/basecamp/tasks'],
  ] as [string, string][]) {
    await page.goto(url(path), { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bcmain', { timeout: 8000 }).catch(() => null)
    await page.waitForTimeout(900)
    const told = await visibleText(page)
    check(
      `${name}: an office it could not reach is not reported as an office with nothing in it`,
      !EMPTY.test(told),
      told
        .split('\n')
        .filter((t) => EMPTY.test(t))
        .join(' / '),
    )
  }
  check('nothing threw while every read was refused', thrown.length === 0, thrown.join(' | '))
  await ctx.close()
}

/*
 * --- AND THE SAME LIE ONE LAYER UP: INVENTED ROWS, UNLABELLED --------------
 *
 * Found by this suite rather than reasoned about: with a token in the browser
 * and every read refused, the contacts surface showed four people - names,
 * roles, towns, email addresses - and nothing anywhere said they were the
 * prototype's. The default studio has said so since #119 and this experience
 * never had, so a signed-in person whose office had gone down would have read
 * invented records as their own.
 */
{
  for (const [name, withToken, refuse, wantRetry] of [
    ['with no token, the prototype says it is the prototype', false, false, false],
    ['with a token and the office unreachable, the page says that instead', true, true, true],
  ] as [string, boolean, boolean, boolean][]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } })
    if (withToken) {
      await ctx.addInitScript(
        `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
      )
    }
    if (refuse) {
      await ctx.route('**/hq-api**', (r) =>
        r.request().method() === 'OPTIONS'
          ? r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
          : r.abort('connectionfailed'),
      )
    }
    const page = await ctx.newPage()
    await page.goto(url(`${slug}/contacts`), { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bcmain').catch(() => null)
    await page.waitForTimeout(1800)
    const strip = page.locator('.bcnotlive')
    const said =
      (await strip.count()) === 0 ? '' : (await strip.first().innerText()).replace(/\n+/g, ' ')
    check(
      `${name}: the page says what is on screen`,
      said.trim() !== '',
      'no notice at all, beside invented records',
    )
    /*
      THE TWO STATES MUST NOT WEAR THE SAME WORDS. "You are not signed in" is
      ordinary and "your office has gone down" is not, and #119's whole point
      is that the alarming one was wearing the quieter label.
    */
    const alarming = /did not answer|out of date|signed out/i.test(said)
    check(
      `${name}: and does not confuse the ordinary state with the alarming one`,
      alarming === refuse,
      said,
    )
    const retry = page.locator('[data-bc-retry-office]')
    check(
      `${name}: a retry is offered exactly where retrying could help`,
      (await retry.count()) > 0 === wantRetry,
      `${String(await retry.count())} retry control(s)`,
    )
    if (wantRetry) {
      await retry.first().click()
      await page.waitForTimeout(1200)
      check(
        `${name}: and pressing it asks again rather than doing nothing`,
        (await page.locator('.bcnotlive').count()) > 0 &&
          (await page.locator('[data-bc-retry-office]').first().isEnabled()),
        'the control never came back from its attempt',
      )
    }
    await ctx.close()
  }
}

/*
 * --- THE CONNECTION DROPS WHILE THE PAGE IS OPEN ---------------------------
 *
 * Nothing listened for it: a page open when the network went kept looking
 * current until a later read failed, and a change made in between looked
 * saved. The strip must say so at once, and coming back must not relabel a
 * visitor's example page as an outage (the negative control: the fix first
 * re-asked the office with no credential and did exactly that).
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  const page = await ctx.newPage()
  await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain')
  await page.waitForTimeout(600)
  const before = (
    await page
      .locator('.bcnotlive')
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ')
  await ctx.setOffline(true)
  await page.waitForTimeout(500)
  const off = (
    await page
      .locator('.bcnotlive')
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ')
  check('losing the connection is said at once', /offline/i.test(off), off.slice(0, 80))
  check(
    'and it says changes cannot reach the office',
    /can.?t reach the office/i.test(off),
    off.slice(0, 120),
  )
  await ctx.setOffline(false)
  await page.waitForTimeout(900)
  const back = (
    await page
      .locator('.bcnotlive')
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ')
  check('coming back clears it', !/offline/i.test(back), back.slice(0, 80))
  check(
    'and a signed-out page returns to what it said before, not to an outage',
    back.slice(0, 40) === before.slice(0, 40),
    `before: ${before.slice(0, 40)} / after: ${back.slice(0, 40)}`,
  )
  await ctx.close()
}

/*
 * --- THE CHAT PAGE WHILE THE TEAM IS WORKING, AND WHEN IT FAILS -----------
 *
 * The page drew the in-flight row as a message - a name, a time and no
 * words - drew a failure as the agent saying "I could not reach the office",
 * offered no way to ask again, and did not follow a new answer, which landed
 * under the sticky composer out of sight.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  await ctx.addInitScript(
    `try { localStorage.setItem('hq.token', 'not-a-credential-local-test-only') } catch {}`,
  )
  let answer: 'slow' | 'fail' = 'slow'
  let asked = 0
  await ctx.route('**/turn', async (r) => {
    if (r.request().method() === 'OPTIONS') {
      return r.fulfill({
        status: 204,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      })
    }
    asked += 1
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    if (answer === 'slow') {
      await new Promise((ok) => setTimeout(ok, 2500))
      return r.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify({ speak: 'Booked for Tuesday.', did: 'answered' }),
      })
    }
    return r.fulfill({
      status: 500,
      headers: cors,
      body: JSON.stringify({ error: 'the office is having trouble' }),
    })
  })
  const page = await ctx.newPage()
  await page.goto(url(`${slug}/chat`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-sayform]')
  await page.waitForTimeout(900)
  await page.fill('#bc-say', 'Can you book the next interview?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  /*
    Read at once, never waited for: innerText() on a locator that matches
    nothing waits up to 30s, by which time the answer has arrived and the
    state under test is gone - the blank check below was vacuous for exactly
    that reason until a sabotage showed it.
  */
  const working = (
    (await page.evaluate(
      inPage(`return document.querySelector('.bcsaid--working')?.textContent ?? ''`),
    )) as string
  ).replace(/\s+/g, ' ')
  check(
    'while the team works, the page says so in words',
    /working on it|sending/i.test(working),
    working,
  )
  /* By the visible TEXT: an empty body still renders <p></p>, so :empty can never match. */
  const blank = (await page.evaluate(
    inPage(`return [...document.querySelectorAll('.bcsaid:not(.bcsaid--working) .bcsaidtext')]
      .filter((e) => (e.textContent ?? '').trim() === '').length`),
  )) as number
  check(
    'and no empty message stands in for the answer',
    blank === 0,
    `${String(blank)} blank message(s)`,
  )
  await page.waitForTimeout(2600)
  check(
    'the answer replaces the working row',
    (await page.locator('.bcsaid--working').count()) === 0,
  )
  answer = 'fail'
  await page.fill('#bc-say', 'And the one after?')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1800)
  const failed = (
    await page
      .locator('.bcsaid--failed')
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ')
  check(
    'a failed answer is a notice from the office, not an agent speaking',
    /no answer came back/i.test(failed) && !/^\w+ [A-Z].*I could not/.test(failed),
    failed,
  )
  const retry = page.locator('[data-bc-chatretry]').first()
  check(
    'and it is in view, not under the composer',
    (await page
      .evaluate(
        inPage(`const el = document.querySelector('[data-bc-chatretry]')
          if (el === null) return false
          const r = el.getBoundingClientRect()
          const c = document.querySelector('.bcsay')?.getBoundingClientRect()
          return r.bottom <= innerHeight && (c === undefined || r.bottom <= c.top + 1)`),
      )
      .catch(() => false)) as boolean,
  )
  answer = 'slow'
  const before = asked
  await retry.click()
  await page.waitForTimeout(3200)
  check(
    'Try again asks the office again',
    asked === before + 1,
    `${String(asked - before)} new request(s)`,
  )
  check(
    'and the notice is replaced by the answer',
    (await page.locator('.bcsaid--failed').count()) === 0,
  )
  await ctx.close()
}

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${subject}`)
process.exit(fail === 0 ? 0 : 1)
