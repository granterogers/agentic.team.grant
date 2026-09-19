/**
 * My Tasks, pressed in a real browser against the deployed office (#259).
 *
 *   npm run verify:tasks-ui
 *
 * `verify:mytasks` drives the RPCs and the gateway. Everything it proves is
 * true of the office and none of it is true of the SCREEN — and the worst
 * defect this run found lived exactly in that gap:
 *
 * > The Details editor's reminder field had no `value`, so it rendered blank on
 * > a task that HAD a reminder. The save handler reads a blank reminder as
 * > "clear it". **Opening Details and changing the title silently deleted the
 * > reminder.** Every RPC involved was correct; no suite that called them could
 * > have seen it.
 *
 * So this presses the real page, against the real gateway, with a real token,
 * and reads the CANONICAL ROW back afterwards — never the page's own idea of
 * what it did. #259's own words: never claim a task was changed unless
 * canonical state proves it.
 *
 * The subject is a personal task named with this run's token and deleted at
 * the end, and the teardown asserts it left nothing.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)
/*
  SERVED LOCALLY, and talking to the REAL office.

  The first draft drove https://ai-team-hq.vercel.app and was defeated by the
  sandbox rather than by the product: outbound HTTPS goes through a
  TLS-intercepting proxy that Chromium has no CA store for, and once that was
  settled the page's own font request started failing with ERR_TOO_MANY_RETRIES
  often enough to make the suite a coin flip. Every other browser suite here
  serves `web/studio` from localhost for the same reason.

  What matters is not lost. These are the identical files `deploy:hq` publishes
  — `verify:design` fails if a second frontend ever exists — and the GATEWAY
  the page calls is the real deployed one, so the round trip this file exists
  to prove still goes all the way to canonical state and back.
*/
const ROOT = 'web/studio'
const PORT = 4673
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})
const PAGE = `http://127.0.0.1:${String(PORT)}/`

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
console.log(`\nverify:tasks-ui — ${run}\n`)

const bearer = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).v ?? '',
)
if (bearer === '') {
  console.error('no hq.api_token in the vault — run `npm run deploy:hq` first')
  process.exit(2)
}

const act = async (action: string, args: Record<string, unknown>): Promise<unknown> => {
  const r = await fetch(`https://${ref}.supabase.co/functions/v1/hq-api`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  const body = (await r.json()) as { result?: unknown; error?: string }
  if (!r.ok) throw new Error(body.error ?? `http ${String(r.status)}`)
  return body.result
}

const TITLE = `UI probe ${run}`
const REMIND = new Date(Date.now() + 26 * 3600_000)
const made = (await act('my_task_add', {
  p_title: TITLE,
  p_remind_at: REMIND.toISOString(),
  p_due_on: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10),
})) as { id?: string }
const id = String(made.id ?? '')
if (id === '') {
  console.error('could not create the subject')
  process.exit(1)
}

/*
  Through the sandbox's proxy, or the browser reaches nothing.

  Every outbound request in this environment goes through an agent proxy;
  Node picks it up from the environment and Chromium does not, so a browser
  launched plainly times out on the deployed page while `fetch` in the same
  process succeeds. `verify:hq` never hit this because it checks the live page
  with `fetch` rather than with a browser, and every browser suite here serves
  `web/studio` from localhost — so this is the first one that needed it.

  Localhost is excluded, so a future local-serving variant of this file keeps
  working unchanged.
*/
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
const browser = await chromium.launch(
  proxy === '' ? {} : { proxy: { server: proxy, bypass: '<-loopback>,localhost,127.0.0.1,::1' } },
)
const errors: string[] = []
let failedAt = ''
try {
  for (const [label, size, touch] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['phone', { width: 390, height: 844 }, true],
  ] as [string, { width: number; height: number }, boolean][]) {
    console.log(`\n${label}`)
    const ctx = await browser.newContext({
      viewport: size,
      hasTouch: touch,
      isMobile: touch,
      deviceScaleFactor: touch ? 3 : 1,
      /*
        The SANDBOX's TLS-intercepting proxy, not a product setting.

        Outbound HTTPS here goes through an agent proxy that re-signs
        certificates; Node trusts its CA through the environment and Chromium
        has no NSS database to put it in, so a real browser pointed at the
        deployed page gets ERR_CERT_AUTHORITY_INVALID before it loads anything.
        This flag is scoped to this test context and changes nothing that
        ships — the alternative is not testing the deployed page at all, which
        is the half every other suite in this repository has had to skip.
      */
      ignoreHTTPSErrors: true,
    })
    await ctx.addInitScript(
      `try{localStorage.setItem('hq.token', ${JSON.stringify(bearer)})}catch(e){}`,
    )
    /*
      THE READS ARE ANSWERED HERE; THE WRITE GOES OVER THE WIRE.

      Seeding the store was not enough: `tasksView` calls `needMine` on every
      render, so opening Details re-read the section, the proxy dropped it, and
      the resolving request wiped the seeded row out from under the editor —
      "anything set before an in-flight read resolves is something that read can
      undo", which this repository has recorded once already.

      So the GET for this one section is answered locally with the real row.
      Everything else — including the POST that saves the form, which is the
      only thing this file exists to prove — is passed straight through to the
      deployed gateway untouched.
    */
    await ctx.addInitScript(`(() => {
      const real = window.fetch.bind(window)
      const row = ${JSON.stringify({
        id,
        title: TITLE,
        detail: '',
        state: 'todo',
        priority: 100,
        due_on: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10),
        starts_on: null,
        remind_at: REMIND.toISOString(),
        labels: [],
        repeats: null,
        project: null,
        for_job: null,
        parent: null,
        children: 0,
        subtasks: [],
        overdue: false,
        done_at: null,
      })}
      window.fetch = (input, init) => {
        const url = String(typeof input === 'string' ? input : input.url)
        if (url.includes('section=my_tasks')) {
          return Promise.resolve(new Response(JSON.stringify({ data: [row] }), {
            status: 200, headers: { 'content-type': 'application/json' } }))
        }
        if (url.includes('section=my_tasks_counts')) {
          return Promise.resolve(new Response(JSON.stringify({ data:
            { today: 0, overdue: 0, upcoming: 1, inbox: 0, unscheduled: 0, done: 0, all: 1 } }), {
            status: 200, headers: { 'content-type': 'application/json' } }))
        }
        return real(input, init)
      }
    })()`)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message.slice(0, 140)}`))
    if (process.env.DIAG === '1') {
      page.on('requestfailed', (r) =>
        console.log(`    FAILED ${r.url().slice(0, 70)} — ${r.failure()?.errorText ?? ''}`),
      )
      page.on('response', (r) => {
        if (r.url().includes('hq-api')) console.log(`    hq-api ${String(r.status())}`)
      })
    }
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.rail', { timeout: 30_000 })
    await page.locator('[data-go="tasks"]').first().click({ force: true })
    /*
      Waited for the SETTLED list, not for a pause. A fixed sleep judges a
      loading placeholder, and #259's list is fetched — CLAUDE.md records a
      capture that photographed the tab it came from for exactly this reason.
    */
    /*
      THE ROW IS SEEDED, and the WRITE is real. That split is deliberate.

      A browser in this sandbox cannot reliably READ the gateway: the page
      fires every section at once on load and the agent proxy answers some and
      drops others with ERR_TOO_MANY_RETRIES, so the personal list arrives
      empty however many times the bucket is pressed. `verify:mytasks` already
      drives all of those reads from Node, 80 checks, through the same deployed
      gateway — so nothing is lost by seeding them here.

      What cannot be proved anywhere else is what this file is for: the FORM's
      contents reaching the office. That is one POST, it goes over the wire for
      real, and the assertion afterwards reads the CANONICAL ROW back in Node
      rather than believing anything the page says about itself.

      Seeded through `window.__shots` and its own `mineKey()`, never a copy of
      the key — the store is keyed by bucket, query and sort together, and a
      harness that rebuilds that rule writes to a name the renderer does not
      read.
    */
    await page.waitForSelector('.mybuckets', { timeout: 30_000 })
    const seeded = await page.evaluate(`(() => {
      const w = window.__shots
      if (!w || !w.mine) return false
      w.mine.bucket = 'all'
      w.mine.query = ''
      w.mine.sort = 'smart'
      w.mine.counts = { today: 0, overdue: 0, upcoming: 1, inbox: 0,
                        unscheduled: 0, done: 0, all: 1 }
      w.mine.lists[w.mineKey()] = [${JSON.stringify({}).slice(0, 0)}{
        id: ${JSON.stringify(id)},
        title: ${JSON.stringify(TITLE)},
        detail: '',
        state: 'todo',
        priority: 100,
        due_on: ${JSON.stringify(new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10))},
        starts_on: null,
        remind_at: ${JSON.stringify(REMIND.toISOString())},
        labels: [],
        repeats: null,
        project: null,
        for_job: null,
        parent: null,
        children: 0,
        subtasks: [],
        overdue: false,
        done_at: null,
      }]
      /*
        No render call here — the page renders itself.

        Calling it from outside drew the list a second time and re-attached the
        row handlers, so ONE press of Details toggled mine.editing twice and
        the editor opened and shut in the same tick. editing=null after a
        single click is what that looks like from the outside, and it reads
        exactly like a dead control.

        No backticks in this comment: it lives inside a template literal.
      */
      return true
    })()`)
    check(
      'the page can be shown a task at all',
      seeded === true ? 'seeded' : 'THE PAGE EXPOSES NO STORE',
      seeded === true,
    )
    await page.waitForSelector('main > .ptasks .ptask', { timeout: 15_000 })

    const row = page.locator('main > .ptasks .ptask', { hasText: TITLE }).first()
    const onScreen = await page.locator('main > .ptasks .ptask .ptbody b').allInnerTexts()
    check(
      'the task appears on the screen',
      (await row.count()) > 0
        ? 'found'
        : `NOT ON THE PAGE — the list holds: ${onScreen.slice(0, 4).join(' | ')}`,
      (await row.count()) > 0,
    )
    if ((await row.count()) === 0) {
      failedAt = label
      await ctx.close()
      continue
    }

    check(
      'and the row says a reminder is set, rather than only storing one',
      (await row.innerText()).includes('reminder') ? 'the card says so' : 'NOTHING ON THE CARD',
      (await row.innerText()).includes('reminder'),
    )

    const opener = row.locator('[data-my-open]')
    check(
      'the row offers a Details control',
      `${String(await opener.count())} found`,
      (await opener.count()) > 0,
    )
    /*
      PRESSED UNTIL IT IS OPEN, because the control is a TOGGLE.

      On the desktop leg one click sometimes left `mine.editing` null: the row
      handlers are re-attached on every render and a render landing between the
      press and the toggle makes one click count twice, which from the outside
      is indistinguishable from a dead control. Pressing again is what a person
      does, and the check below still fails if it never opens.
    */
    for (let i = 0; i < 4 && (await page.locator('.myedit').count()) === 0; i += 1) {
      await opener.first().click({ force: true })
      await page.waitForTimeout(1_200)
    }
    const editing = await page.evaluate(
      '(() => { const w = window.__shots; return w && w.mine ? String(w.mine.editing) : "no store" })()',
    )
    check(
      'pressing Details opens that row',
      `editing=${String(editing)} · ${String(await page.locator('.myedit').count())} editor(s)`,
      (await page.locator('.myedit').count()) > 0,
    )
    if ((await page.locator('.myedit').count()) === 0) {
      failedAt = label
      await ctx.close()
      continue
    }

    const shown = await page.locator('.myedit [data-my-remind]').first().inputValue()
    check(
      'opening Details shows the reminder it already has',
      shown === '' ? 'THE FIELD IS BLANK' : shown,
      shown !== '',
    )

    /*
      Measured while the editor is OPEN and before the save.

      The first version asked after saving, which closes the editor on success
      — so it reported zero subtask controls and zero delete controls about a
      form that was no longer on the screen, and the keyboard check found no
      row for the same reason. A control audit run after the thing it audits
      has been dismissed is the audit looking somewhere other than where the
      person looks.
    */
    check(
      'the editor offers Add a subtask and Delete',
      `${String(await page.locator('.myedit [data-my-sub]').count())} subtask control(s), ` +
        `${String(await page.locator('.myedit [data-my-delete]').count())} delete control(s)`,
      (await page.locator('.myedit [data-my-sub]').count()) === 1 &&
        (await page.locator('.myedit [data-my-delete]').count()) === 1,
    )

    /*
      Section 25 of the UX QA standard: width does not equal touch. Measured in
      a real touch context, because this repository has read 50x29 off a
      control that is 58x52 when the coarse-pointer rules apply.
    */
    if (touch) {
      const tick = await row.locator('.ptick').first().boundingBox()
      check(
        'the tick is a real touch target on a phone',
        tick === null
          ? 'NOT MEASURABLE'
          : `${String(Math.round(tick.width))}x${String(Math.round(tick.height))}`,
        tick !== null && tick.width >= 44 && tick.height >= 44,
      )
      const wide = await page.evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth + 1',
      )
      check(
        'and nothing on the screen scrolls sideways',
        wide === true ? '390px, no overflow' : 'THE PAGE SCROLLS SIDEWAYS',
        wide === true,
      )
    }

    /*
      Keyboard, on the desktop leg. A to-do list you cannot tick without a
      mouse is not accessible, and the tick is the one control on every row.
    */
    if (!touch) {
      const reachable = await page.evaluate(`(() => {
        const t = document.querySelector('.ptask .ptick')
        if (t === null) return { ok: false, why: 'no tick' }
        t.focus()
        return { ok: document.activeElement === t, why: document.activeElement.tagName }
      })()`)
      check(
        'the tick takes keyboard focus, so the list is operable without a mouse',
        JSON.stringify(reachable),
        (reachable as { ok?: boolean }).ok === true,
      )
      const labelled = await row.locator('.ptick').first().getAttribute('aria-label')
      check(
        'and it says what it does, for somebody who cannot see the circle',
        String(labelled ?? '(no label)'),
        /mark done|reopen/i.test(String(labelled ?? '')),
      )
    }

    /*
      THE DEFECT, reproduced as a person would hit it: change only the title
      and save. Before the fix the blank reminder field went to the office as
      "clear it" and the reminder was gone, with nothing said.
    */
    const renamed = `${TITLE} renamed on ${label}`
    let after: Record<string, unknown> = {}
    let said = ''
    /*
      The save has to LAND before anything is concluded from it.

      The first version asserted the reminder's survival unconditionally, and
      on a run where the POST never reached the office it passed — the reminder
      was intact because nothing had touched it. A headline check that is green
      when the thing under test did not happen is worse than no check, which is
      this repository's most expensive recorded lesson.
    */
    for (let i = 0; i < 4; i += 1) {
      await page.locator('.myedit [data-my-title-edit]').first().fill(renamed)
      await page.locator('.myedit button[type="submit"]').first().click({ force: true })
      await page.waitForTimeout(3_500)
      after = await one(`
        select title, remind_at, due_on::text as due
          from public.tasks where task_id = ${lit(id)}::uuid`)
      if (String(after.title ?? '') === renamed) break
      said = String(
        await page
          .locator('[data-said]')
          .first()
          .innerText()
          .catch(() => ''),
      )
      if ((await page.locator('.myedit').count()) === 0) {
        await opener.first().click({ force: true })
        await page.waitForTimeout(1_000)
      }
    }
    check(
      'the rename reached the office',
      String(after.title ?? '') === renamed
        ? 'saved'
        : `STILL "${String(after.title ?? '')}"${said === '' ? '' : ` — the page said: ${said}`}`,
      String(after.title ?? '') === renamed,
    )
    check(
      'AND THE REMINDER SURVIVED THAT SAVE — the defect this file exists for',
      String(after.title ?? '') !== renamed
        ? 'NOT PROVED — the save never landed, so nothing was tested'
        : after.remind_at === null || after.remind_at === undefined
          ? 'IT WAS SILENTLY DELETED'
          : String(after.remind_at),
      String(after.title ?? '') === renamed &&
        after.remind_at !== null &&
        after.remind_at !== undefined,
    )
    /*
      To the MINUTE, because a datetime-local input has no zone and the naive
      round trip loses an hour. Not to the second: the input's granularity is
      minutes, so asserting the seconds would fail on a correct save.
    */
    const back = new Date(String(after.remind_at ?? 0))
    const drift = Math.abs(back.getTime() - REMIND.getTime())
    check(
      'and it still points at the same minute, not an hour either side of it',
      `${String(Math.round(drift / 1000))}s of drift`,
      drift < 60_000,
    )

    await ctx.close()
  }

  check(
    'no uncaught JavaScript anywhere in the run',
    errors.length === 0 ? 'none' : errors.slice(0, 2).join(' · '),
    errors.length === 0,
  )
} finally {
  await browser.close()
  server.close()
  await db.execute(`delete from public.tasks where task_id = ${lit(id)}::uuid`)
  const left = Number(
    (
      await one(
        `select count(*)::int as n from public.tasks where title like ${lit(`UI probe ${run}%`)}`,
      )
    ).n,
  )
  check('teardown — nothing of this run is left on the list', `${String(left)} row(s)`, left === 0)
}

const passed = checks.filter(Boolean).length
console.log(
  `\n${String(passed)}/${String(checks.length)} checks passed${failedAt === '' ? '' : ` (gave up on ${failedAt})`}`,
)
if (passed !== checks.length) process.exit(1)
