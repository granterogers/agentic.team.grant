/**
 * Render the prototype, capture it, and put the pictures where they can be
 * judged.
 *
 *   npm run shots
 *
 * §14A: *"Never evaluate visual quality from source code alone."* This runs the
 * real files in a real browser at real sizes, in both themes, and writes PNGs.
 * It is not a pass/fail harness — it is the capture half of the
 * render→capture→critique loop, and the critique is done by looking.
 */

import { mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'

/*
  Which density to capture (#124).

  `DENSITY=compact npm run shots` writes a parallel set named `-compact` rather
  than overwriting the comfortable one, because the pair is the point: the
  question compact has to answer is "is this better", and that cannot be
  answered from one image.
*/
const DENSITY = process.env.DENSITY === 'compact' ? 'compact' : 'comfortable'
const SUFFIX = DENSITY === 'compact' ? '-compact' : ''

const ROOT = 'web/studio'
const OUT = '.out'
const PORT = 4610

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.mjs': 'text/javascript; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise<void>((r) =>
  server.listen(PORT, '127.0.0.1', () => {
    r()
  }),
)
await mkdir(OUT, { recursive: true })

/*
  Clear the captures before writing, so `.out` is exactly what THIS run
  rendered.

  It was not. `.out/activity-desktop-dark.png` sat beside today's captures
  showing the rail labelled "Studio" and an Activity tab — a name #216 changed
  and a tab #222 removed — because the route was retired and nothing ever
  deleted the PNG it had left behind. Reading it today produced a confident
  finding about a screen that has not existed for two days, and there is
  nothing in a directory listing that distinguishes a fresh capture from a
  stale one: same folder, same naming, and a timestamp nobody checks before
  opening an image.

  This is the wrong-payload trap wearing a different coat. `CLAUDE.md` already
  records three ways an audit can look somewhere other than where the user
  looks; this is the fourth, and the cheapest to close.

  Scoped to the `.png` files in `.out` and nothing else: the directory also
  holds `measurements.jsonl`, `sessions.jsonl` and the e2e records, which are
  append-only history and must survive. A capture that a run does not produce
  is a capture that should not be there afterwards — which is the property
  this buys, and it is why the delete is unconditional rather than a
  best-effort tidy at the end.
*/
{
  /*
    Only the files THIS script names, matched by its own suffix grammar.

    The first draft deleted every `.png` in `.out`, which is wrong in the
    expensive direction: the folder also holds captures from `verify:print`,
    from the space and control audits, and from ad-hoc runs, and a tool that
    deletes another tool's evidence is worse than the stale file it was
    written to remove. The grammar below is exactly what line 84 composes -
    name, size, scheme, optional density suffix - so anything shots can write,
    shots can clear, and nothing else is touched.
  */
  const MINE = /-(?:desktop|phone)-(?:light|dark)(?:-compact)?\.png$/
  let cleared = 0
  for (const name of await readdir(OUT)) {
    if (!MINE.test(name)) continue
    await unlink(join(OUT, name))
    cleared += 1
  }
  console.log(`cleared ${String(cleared)} previous capture(s) from ${OUT}`)
}

const browser = await chromium.launch()
const shots: string[] = []

const SIZES = [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', devices['iPhone 14']],
] as const

for (const [size, opts] of SIZES) {
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme })
    await ctx.addInitScript(seedAppearance(scheme, { density: DENSITY }))
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${String(PORT)}/`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    })
    await page.waitForTimeout(900)

    const shoot = async (name: string) => {
      const file = `${OUT}/${name}-${size}-${scheme}${SUFFIX}.png`
      await page.screenshot({ path: file, fullPage: false })
      shots.push(file)
    }

    await shoot('portfolio')

    // The appearance picker, and one alternative palette, so a change to the
    // skin system is visible in a capture rather than only in the CSS.
    if (size === 'desktop' && scheme === 'light') {
      await page.locator('[data-settings]').click()
      await page.waitForTimeout(400)
      // Settings opens on Team now, not on the palette. The picker is a tab in.
      await page.locator('[data-setting="appearance"]').click()
      await page.waitForTimeout(400)
      await shoot('appearance')
      await page.locator('[data-palette-pick="clay"]').click()
      await page.locator('[data-texture-pick="plaster"]').click()
      await page.waitForTimeout(400)
      await page.locator('#settings .close').click()
      await page.waitForTimeout(300)
      await shoot('palette-clay')
      // Back to the default so the rest of the captures are comparable.
      await page.locator('[data-settings]').click()
      await page.locator('[data-palette-pick="paper"]').click()
      await page.locator('#settings .close').click()
      await page.waitForTimeout(300)
    }

    /*
      The settings tabs, including the long one.

      `.setbody` scrolls INSIDE the sheet — the sheet is capped at 86vh — so a
      page screenshot at 900px tall can never show the bottom of a long tab
      however `fullPage` is set. Usage is the first tab long enough for that to
      matter: its chart and its "what is being used the most" ranking are both
      below the fold, so the only capture of them was no capture at all, and a
      visual standard that says "run it and look at it" cannot be met by
      looking at the top third.

      So the scroll container is scrolled and shot again. Two honest images
      rather than one CSS-mutated one: overriding max-height to fit everything
      would photograph a layout that does not exist.
    */
    if (size === 'desktop') {
      await page.locator('[data-settings]').click()
      await page.waitForTimeout(400)
      /*
        Connections at desktop too, for the provider grid #276 gave controls.

        The list was models / behaviour / governance, so the only desktop
        capture of Connections came from the cross-screen wall and the
        providers section — which is below the fold — was in no desktop image
        at all. A panel below the fold in every capture is a panel nobody has
        judged, and these three controls change what the office can reach.
      */
      for (const tab of ['models', 'behaviour', 'governance', 'connections'] as const) {
        await page.locator(`[data-setting="${tab}"]`).click()
        await page.waitForTimeout(450)
        await shoot(`settings-${tab}`)
        // A string, not a closure: this file has no DOM lib and `document` is
        // not in scope at compile time. Playwright evaluates either.
        const scrolled = await page.evaluate(`(() => {
          const el = document.querySelector('#settings .setbody')
          if (el === null) return false
          const box = el.closest('.sheet, .settings') || el
          const target = box.scrollHeight > box.clientHeight ? box : el
          if (target.scrollHeight <= target.clientHeight + 40) return false
          target.scrollTop = target.scrollHeight
          return true
        })()`)
        if (scrolled) {
          await page.waitForTimeout(400)
          await shoot(`settings-${tab}-lower`)
        }
        /*
          The middle, for a tab that is four sections long (#54).

          Top and bottom photograph the lessons and the agents and skip the two
          in between entirely — and "what it wants" is the section with the
          only irreversible controls on the page. A capture set that cannot see
          the buttons cannot judge them.
        */
        /*
          The providers, which are below the fold on every screen size.

          A panel below the fold in every capture is a panel nobody has judged
          — this file paid for that on the history panel — and #276 put three
          controls down there.

          What this capture CANNOT show is those three: they are drawn only for
          a writer, and the prototype holds no token. Signing in locally was
          tried and is worse than useless here, because the settings pane
          fetches when it opens and there is no office behind this server, so
          the tab renders as an office that could not be asked. The controls
          are proved instead by `npm run verify:connectors`, which presses all
          three through the deployed gateway.
        */
        if (tab === 'connections') {
          await page.evaluate(
            `(() => { const el = document.querySelector('.provsec');
                      if (el !== null) el.scrollIntoView({ block: 'start' }); })()`,
          )
          await page.waitForTimeout(350)
          await shoot('settings-providers')
        }
        if (tab === 'governance' && scrolled) {
          await page.evaluate(`(() => {
            const el = document.querySelector('#settings .setbody')
            if (el === null) return
            const box = el.closest('.sheet, .settings') || el
            const target = box.scrollHeight > box.clientHeight ? box : el
            target.scrollTop = Math.round(target.scrollHeight * 0.38)
          })()`)
          await page.waitForTimeout(400)
          await shoot(`settings-${tab}-middle`)
        }
      }
      await page.locator('#settings .close').click()
      await page.waitForTimeout(300)
    }

    /*
      Hover states, captured deliberately.

      Iteration 4 added pointer-tracked tilt and a specular highlight, and a
      still of the page at rest shows none of it — which would have had Grant
      judging an iteration with its whole point missing. `mouse.move` twice,
      because a single move fires no `pointermove` on an element the cursor is
      already inside.
    */
    if (size === 'desktop') {
      const card = page.locator('.project[data-open="ai-learning"]')
      const box = await card.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
        await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.3)
        await page.waitForTimeout(500)
        await shoot('portfolio-hover')
      }
    }

    /*
      The desk was captured here. It is gone (#77) — Grant called it redundant
      and everything on it now has a home in a project section.

      The collapsed rail takes its place, because #76 changed what collapsing
      means: it used to leave a 74px icon strip and now it leaves nothing, and
      that is a state worth having a picture of.
    */

    // Into a project, which is the shared-element transition. Everything after
    // this — People, contacts, documents — only exists inside one.
    await page.locator('.project[data-open="legacy-coaching-course"]').click()
    await page.waitForTimeout(900)
    /*
      The tab is remembered per project, so a run that ended on People leaves
      the next one there. Board is what the "project" capture is of, so say so
      rather than depending on whatever the last run happened to leave behind.
    */
    await page.locator('[data-tab="overview"]').click()
    await page.waitForTimeout(500)
    await shoot('project')

    /*
      And the panels board, which has had no capture since #25 (#156).

      The Overview is the map now and the board is behind a toggle, so the
      design record lost the screen entirely — which is how `verify:arrangement`
      came to be failing against it for a morning without anybody seeing.
      It also carries the new How it got here panel, and a panel nobody has
      looked at is a panel nobody has judged.
    */
    await page.locator('[data-overview="panels"]').click()
    await page.waitForTimeout(900)
    await shoot('project-panels')
    /*
      And the lower half, where How it got here sits (#156).

      A panel below the fold in every capture is a panel nobody has looked at,
      which is how the settings sheet went months with three defects on it.
    */
    await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`)
    await page.waitForTimeout(600)
    await shoot('project-panels-lower')
    await page.evaluate(`window.scrollTo(0, 0)`)
    await page.waitForTimeout(300)
    await page.locator('[data-overview="map"]').click()
    await page.waitForTimeout(500)

    if (size === 'desktop') {
      /*
        The document hover lives on the DOCUMENTS tab now (#25).

        The Overview became the project map, so the board's Documents panel —
        which is what this used to hover over — is not on that screen any more.
        The capture went on clicking Overview and then waiting thirty seconds
        for a card that had moved one tab away, and reported a timeout rather
        than the change that caused it. Go where the documents are.
      */
      await page.locator('[data-tab="documents"]').click()
      await page.waitForTimeout(600)
      const doc = page.locator('[data-doc="0"] .page')
      // Scroll it into view first: boundingBox() happily returns coordinates
      // for something below the fold, so the capture came back showing the top
      // of the page with the hover applied to something nobody could see.
      await doc.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      const box = await doc.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
        await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.26)
        await page.waitForTimeout(500)
        await shoot('document-hover')
      }
    }

    /*
      People is reached from INSIDE a project now, not from the top of the rail
      — Grant: "people is a subset of each project.. not merged". The old
      selector was a global nav item that no longer exists, which is exactly the
      kind of thing a capture script catches and a code review does not.
    */
    if (size === 'desktop') {
      /*
        Contacts is reached from the project's own tabs now. The rail used to
        carry a People sub-item under the current project; it duplicated this
        tab, so Grant asked for it gone — "obviously, they don't duplicate
        things". A capture script is where a removed selector announces itself.
      */
      await page.locator('[data-tab="contacts"]').click()
      await page.waitForTimeout(500)
      await shoot('contacts-section')
      /*
        The project switcher, open. It replaced the rail's project list — a
        still of it closed proves only that a button exists.
      */
      await page.locator('[data-switch-open]').click()
      await page.waitForTimeout(400)
      await shoot('project-switcher')
      await page.keyboard.press('Escape')
      await page.locator('h1').first().click()
      await page.waitForTimeout(300)

      /*
        Settings, all six tabs. It is the half of the product Grant said was
        being left behind, and a capture of only the first tab would prove the
        least interesting one.
      */
      await page.locator('[data-settings]').first().click()
      await page.waitForTimeout(500)
      for (const tab of [
        'team',
        'behaviour',
        'governance',
        'connections',
        'channels',
        'models',
        'appearance',
      ]) {
        await page.locator(`[data-setting="${tab}"]`).click()
        await page.waitForTimeout(400)
        await shoot(`settings-${tab}`)
      }
      await page.locator('#settings .close').click()
      await page.waitForTimeout(400)

      await page.locator('[data-rail]').click()
      await page.waitForTimeout(600)
      await shoot('rail-collapsed')
      await page.locator('[data-rail]').click()
      await page.waitForTimeout(500)
    }

    /*
      The team's in-tray and the chat (#26, #27, #28).

      Both are new tabs on the project, and both are things Grant asked for in
      one sentence — so both get a capture on every size, not only desktop. The
      talk action is captured mid-flight, with the item already attached to the
      composer, because a still of the button proves nothing about whether the
      context actually travels.
    */
    /*
      The command bar (#40 idea 1). Captured mid-query, because a still of an
      empty bar proves a box exists and nothing about whether it finds anything.
    */
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(350)
    await page.locator('[data-cmd-input]').type('vision', { delay: 25 })
    await page.waitForTimeout(400)
    await shoot('command-bar')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    /*
      MY TASKS (#259), which had never been captured at all.

      The global Tasks screen has existed since #123 and no capture run has
      ever opened it — a screen with no capture is a screen nobody is watching,
      and this file's own history is the argument. #259 replaced it with My
      Tasks, so the first picture of it is also the first picture of the thing
      it became.

      Through the door for the usual two reasons: the composer, the buckets and
      the row editor are drawn only for a writer, and the list only for rows
      that exist. The token is written, the page redrawn so the controls are
      there, THEN the store is filled — the order #263's capture had to learn
      twice.
    */
    await page.locator('[data-go="tasks"]').click()
    await page.waitForTimeout(400)
    await page.evaluate(`(() => {
      const w = window.__shots
      if (w === undefined) throw new Error('the capture door is not open')
      localStorage.setItem('hq.token', 'local-capture-only')
      w.render()
    })()`)
    await page.waitForTimeout(300)
    await page.evaluate(`(() => {
      const w = window.__shots
      const day = 86400000
      const on = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10)
      w.mine.counts = { today: 3, overdue: 1, upcoming: 4, inbox: 2,
                        unscheduled: 2, done: 11, all: 17 }
      w.mine.bucket = 'today'
      w.mine.lists.today = [
        { id: 'mt-1', title: 'Ring the venue about the September cohort',
          state: 'todo', due_on: on(-2), labels: ['errand'], overdue: true,
          project: { slug: 'legacy-coaching-course', name: 'Legacy Coaching Course' },
          repeats: null, for_job: null },
        { id: 'mt-2', title: 'Authorize Google Drive so the office can read it',
          state: 'todo', due_on: on(0), labels: [], overdue: false,
          project: null, repeats: null, for_job: 'job-1' },
        { id: 'mt-3', title: 'Send Priya the revised figures',
          state: 'todo', due_on: on(0), labels: ['admin', 'waiting'], overdue: false,
          project: { slug: 'ai-learning', name: 'AI Learning' },
          repeats: { every: '7 days', from: 'due' }, for_job: null },
      ]
      w.render()
    })()`)
    await page.waitForSelector('.mybuckets', { timeout: 5000 })
    await page.waitForTimeout(400)
    await shoot('my-tasks')

    // And one row open, because the editor is where labels, reminders and
    // recurrence live and it is drawn for exactly one row at a time.
    await page.evaluate(`(() => {
      window.__shots.mine.editing = 'mt-3'
      window.__shots.render()
    })()`)
    await page.waitForSelector('.myedit', { timeout: 5000 })
    await page.waitForTimeout(300)
    await shoot('my-tasks-details')
    await page.evaluate(`(() => {
      const w = window.__shots
      localStorage.removeItem('hq.token')
      w.mine.editing = null
      w.mine.counts = null
      for (const k of Object.keys(w.mine.lists)) delete w.mine.lists[k]
      w.render()
    })()`)
    await page.waitForTimeout(300)
    /*
      And back into the project, HOME first.

      `.project[data-open=…]` is a card on the portfolio, and the Tasks screen
      is not the portfolio — the first run of this block waited thirty seconds
      for a card that was two screens away. The wordmark is the way home and
      #216 exists because there was not one.
    */
    await page.locator('[data-go="portfolio"]').first().click()
    await page.waitForTimeout(500)
    await page.locator('.project[data-open="legacy-coaching-course"]').click()
    await page.waitForTimeout(600)

    await page.locator('[data-tab="team"]').click()
    await page.waitForTimeout(600)
    await shoot('team-board')

    await page.locator('[role="tab"][data-sub="jobs"]').click()
    await page.waitForTimeout(500)
    await shoot('active-jobs')

    /*
      AND THE PROGRESS BESIDE THE STOP BUTTON (#263, #276).

      Through the capture door for the same two reasons as the review queue:
      the line is drawn only for a job that is RUNNING and only for a writer,
      and a prototype job has no real step list. The token is a local-only
      stand-in and both it and the rows come straight back out.
    */
    /*
      TWO passes, and then the token again, and the first two runs needed all
      of it.

      Setting the token does not redraw, so `[data-stop-job]` matched nothing
      — Stop is drawn only for a writer — and the seed loop ran over an empty
      list. That is pass one. Pass two revealed the second reason: a signed-in
      render asks the real gateway for each running job's steps, the capture's
      token is a local-only stand-in, and a 401 makes `token.clear()` fire and
      the page sign itself out from under the seed. So the token is written
      again after seeding, and `progress` is filled before that render, which
      is what stops the fetch happening at all.

      The `waitForSelector` at the end is the point of the exercise: a capture
      that quietly photographs the screen it came from is worse than no
      capture, and both of those runs produced a PNG that looked plausible.
    */
    await page.evaluate(`(() => {
      const w = window.__shots
      if (w === undefined) throw new Error('the capture door is not open')
      localStorage.setItem('hq.token', 'local-capture-only')
      w.render()
    })()`)
    await page.waitForSelector('[data-stop-job]', { timeout: 5000 })
    /*
      AND WAIT FOR THAT RENDER'S OWN FETCH TO LAND BEFORE SEEDING.

      Run three of this capture: `waitForSelector('.jsteps')` PASSED and the
      PNG still had no chips. The signed-in render asks the gateway for the
      running job's steps; the reply is a 401; the catch writes `null` over
      whatever is in the store and redraws — and it arrives AFTER the seed,
      so the chips appear, the wait succeeds, and they are gone again a moment
      later. A selector that is satisfied and then unsatisfied is the one thing
      a wait cannot tell you about, which is why the image is the judge.

      Once the catch has written its null, `needProgress` never asks again, so
      everything after this point is stable.
    */
    await page.waitForTimeout(1500)
    await page.evaluate(`(() => {
      const w = window.__shots
      const running = document.querySelectorAll('[data-stop-job]')
      if (running.length === 0) throw new Error('no running job to show progress for')
      for (const b of running) {
        w.progress[b.dataset.stopJob] = {
          state: 'running',
          steps: [
            { step: 'read the brief', ordinal: 0, done: true, unrepeatable: false },
            { step: 'gathered the sources', ordinal: 1, done: true, unrepeatable: false },
            { step: 'drafted', ordinal: 2, done: false, unrepeatable: false },
            { step: 'told slack', ordinal: 3, done: false, unrepeatable: true },
          ],
          paused: null,
        }
      }
      localStorage.setItem('hq.token', 'local-capture-only')
      w.render()
    })()`)
    await page.waitForSelector('.jsteps', { timeout: 5000 })
    await page.evaluate(
      `(() => { const el = document.querySelector('.jsteps');
                if (el !== null) el.scrollIntoView({ block: 'center' }); })()`,
    )
    await page.waitForTimeout(300)
    await shoot('job-progress')
    await page.evaluate(`(() => {
      localStorage.removeItem('hq.token')
      for (const k of Object.keys(window.__shots.progress)) delete window.__shots.progress[k]
      window.__shots.render()
    })()`)
    await page.waitForTimeout(300)

    await page.locator('[role="tab"][data-sub="outputs"]').click()
    await page.waitForTimeout(500)
    await shoot('team')

    await page.locator('[role="tab"][data-sub="chat"]').click()
    await page.waitForTimeout(500)
    await shoot('chat-empty')

    await page
      .locator('[data-say]')
      .fill('Can you turn the WS02 client list into an email I can send?')
    /*
      Enter rather than the Send button. On a phone the bottom navigation is
      fixed, and Playwright's scroll-into-view stops as soon as the button is
      technically visible — which is underneath it. Enter is also the path a
      person actually uses, so this tests the more common one.
    */
    await page.locator('[data-say]').press('Enter')
    await page.waitForTimeout(600)
    await shoot('chat')

    await page.locator('[data-tab="documents"]').click()
    await page.waitForTimeout(500)
    await shoot('documents')

    /*
      The review queue (#28, #276), which nothing else can photograph.

      Two conditions have to hold at once and the prototype can honestly
      produce neither: the office must have MADE something nobody has decided
      about, and the viewer must be able to write. So the rows go in through
      the capture door, and the token is a local-only stand-in for "signed in"
      — both are removed immediately afterwards, and neither can reach the
      deployed page, because the door is guarded on `location.hostname`.

      Without this the block would ship unlooked-at, and §14A is explicit that
      no graphical change is complete because it compiles.
    */
    await page.evaluate(`(() => {
      const w = window.__shots
      if (w === undefined) throw new Error('the capture door is not open')
      localStorage.setItem('hq.token', 'local-capture-only')
      const hour = 3600000
      w.reviewing['legacy-coaching-course'] = [
        { document_id: 'shot-1', title: 'Legacy Coaching Course — current status',
          produced_by: 'Emma', state: 'draft', kind: 'pdf',
          created_at: new Date(Date.now() - 2 * hour).toISOString(),
          derived_from: ['The programme brief', 'Week 4 review notes'] },
        { document_id: 'shot-2', title: 'Draft announcement for the September cohort',
          produced_by: 'Oliver', state: 'draft', kind: 'doc',
          created_at: new Date(Date.now() - 20 * hour).toISOString(),
          derived_from: [] },
      ]
      w.render()
    })()`)
    await page.waitForTimeout(400)
    await page.evaluate(
      `(() => { const el = document.querySelector('.review');
                if (el !== null) el.scrollIntoView({ block: 'start' }); })()`,
    )
    await page.waitForTimeout(300)
    await shoot('review-queue')
    await page.evaluate(`(() => {
      localStorage.removeItem('hq.token')
      delete window.__shots.reviewing['legacy-coaching-course']
      window.__shots.render()
    })()`)
    await page.waitForTimeout(300)

    /*
      TAGS AND COLLECTIONS, on an open document (#276).

      Same argument as the review queue, and the same door. `docActions` and
      `docOrganising` are drawn only for a document that HAS an id and only for
      a writer — a prototype document has neither — so without this the block
      ships unlooked-at, and this file's own history is full of things that
      compiled, rendered and were wrong: a class that does not exist, an
      ellipsis with no `white-space`, a chip with no border on a same-coloured
      card. All three were found by opening the PNG.
    */
    await page.evaluate(`(() => {
      const w = window.__shots
      if (w === undefined) throw new Error('the capture door is not open')
      localStorage.setItem('hq.token', 'local-capture-only')
      const p = w.projects.find((x) => x.slug === 'legacy-coaching-course')
      if (p === undefined) throw new Error('no project to open a document in')
      const docs = p.documents ?? []
      if (docs.length < 2) throw new Error('not enough documents to photograph')
      docs[0].id = '00000000-0000-4000-8000-000000000001'
      docs[0].tags = ['pricing', 'week 4', 'for review']
      docs[0].collections = ['Board pack']
      docs[1].id = '00000000-0000-4000-8000-000000000002'
      docs[1].tags = ['week 4']
      docs[1].collections = ['Board pack', 'Programme notes']
      w.render()
    })()`)
    await page.waitForTimeout(400)
    await page.locator('[data-doc="0"]').click()
    await page.waitForSelector('.docorg', { timeout: 5000 })
    /*
      Scrolled to the block, because on a phone the sheet is taller than the
      screen and the organising rows are below the fold — CLAUDE.md: a panel
      below the fold in every capture is a panel nobody has judged. The first
      run of this capture photographed only the title and the four write
      actions, which is how the phone defect above was found rather than the
      thing the shot was taken for.
    */
    await page.evaluate(
      `(() => { const el = document.querySelector('.docorg');
                if (el !== null) el.scrollIntoView({ block: 'center' }); })()`,
    )
    await page.waitForTimeout(500)
    await shoot('document-tags-and-collections')
    await page.evaluate(`(() => {
      localStorage.removeItem('hq.token')
      const p = window.__shots.projects.find((x) => x.slug === 'legacy-coaching-course')
      for (const d of p.documents ?? []) {
        delete d.id
        delete d.tags
        delete d.collections
      }
      window.__shots.render()
    })()`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // The talk action on a document, and where it lands.
    await page.locator('[data-doc="0"]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await page.locator('.withtalk:has([data-doc="0"]) .talkabout').click()
    await page.waitForTimeout(600)
    await shoot('talk-about-a-document')

    /*
      IMPORT TO PROJECT, open (#28).

      Captured because the sheet is the whole of that Issue's user-facing half,
      and §14A's loop is render, capture, LOOK. A form nobody has looked at is a
      form with a 12px label and a select that zooms the page on focus, and
      neither of those shows up in any check.

      Guarded: the mock has one output with an id, and a data shape that grows
      an unimportable row later should not fail the capture run.
    */
    await page.locator('[data-tab="team"]').click()
    await page.waitForTimeout(400)
    const outputsTab = page.locator('[data-sub="outputs"]').first()
    if ((await outputsTab.count()) > 0) {
      await outputsTab.click()
      await page.waitForTimeout(400)
    }
    /*
      PREVIEW, before the decision (#28).

      Captured first and closed again, because the specification draws
      Preview / Discuss ABOVE the import gate and a still of the gate says
      nothing about whether an output can be read before it is approved. The
      tile is a button now; this is the picture that proves the viewer opens
      on something that is not in the gallery yet.
    */
    /*
      THE DROP TARGET (#126).

      Triggered with a synthetic `dragenter` carrying a DataTransfer whose
      types include Files, because Playwright cannot drag from the desktop and
      the overlay is the half of this feature a person sees. A capture of it is
      the only way to find out whether "Drop it here" reads as an invitation or
      as an error.
    */
    await page.evaluate(`(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'a.pdf', { type: 'application/pdf' }))
      document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }))
    })()`)
    await page.waitForTimeout(400)
    await shoot('drop-a-file')
    await page.evaluate(`document.dispatchEvent(new DragEvent('dragleave', { bubbles: true }))`)
    await page.waitForTimeout(300)

    const previewBtn = page.locator('[data-out-open]').first()
    if ((await previewBtn.count()) > 0) {
      await previewBtn.click()
      await page.waitForTimeout(900)
      await shoot('preview-an-output')
      await page.locator('#viewer .close').first().click()
      await page.waitForTimeout(500)
    }

    const importBtn = page.locator('[data-import]').first()
    if ((await importBtn.count()) > 0) {
      await importBtn.click()
      await page.waitForTimeout(700)
      await shoot('import-to-project')
      await page.locator('[data-import-close]').first().click()
      await page.waitForTimeout(400)
    }

    /*
      RECENT ACTIVITY (#14).

      It had no capture at all, which CLAUDE.md names as its own class of
      defect: a screen nothing photographs is a screen nobody has judged. It is
      also the screen #14 was filed about — on the live office it was forty
      identical rows of the noticing pass, and 0412 folds those.

      What a SANDBOX capture can show is the layout and the empty state: the
      prototype has no lately payload behind it, so the folded row with its
      count is not visible here and is proved by `npm run verify:lately`
      against the real database instead.
    */
    const latelyBtn = page.locator('[data-go="lately"]').first()
    if ((await latelyBtn.count()) > 0) {
      await latelyBtn.click({ force: true })
      await page.waitForTimeout(900)
      await shoot('recent-activity')
      /*
        And back into the project, because everything after this expects to be
        on one. The first version of this capture left the run on the activity
        screen and the next line waited thirty seconds for a tab that no longer
        existed — a capture that moves the page has to put it back.
      */
      const backIn = page.locator('.navitem.proj[data-open], .project[data-open]').first()
      if ((await backIn.count()) > 0) await backIn.click({ force: true })
      await page.waitForTimeout(1200)
    }

    await page.locator('[data-tab="overview"]').click()
    await page.waitForTimeout(500)

    /*
      Governance on a phone (#54).

      The only settings capture taken at 390px, and it is here because it is
      the settings tab with the most stacking to get wrong: four sections, a
      three-column agent grid, and every row ending in buttons. The rest of the
      settings sheet is captured at desktop only, which is a gap this Issue
      does not widen but does prove worth closing.
    */
    if (size === 'phone') {
      await page.locator('[data-settings]').first().click()
      await page.waitForTimeout(500)
      /*
        Connections on a phone, which had never been captured (#158, §15, §35).

        The comment above says the rest of the settings sheet is desktop-only
        and calls it "a gap this Issue does not widen but does prove worth
        closing". The cross-screen wall closed it by drawing the hole: two
        missing cells, both of them Connections, which is the surface with the
        credential forms on it and the one §35 asks to be exercised hardest.

        One tab rather than all seven. The wall wants a representative, not an
        archive, and Connections is the one whose cards stack worst.
      */
      await page.locator('[data-setting="connections"]').click()
      await page.waitForTimeout(500)
      await shoot('settings-connections')
      /*
        And the providers, which are below the fold on every screen size.

        A panel below the fold in every capture is a panel nobody has judged —
        this file already paid for that on the history panel — and the three
        controls #276 added (add a provider, offer a tool, stop using one) all
        live down there.
      */
      /*
        And the providers, below the fold (#265, #276).

        The three controls #276 added are drawn only for a writer, so they are
        absent here for the same reason every other write control is absent
        from a prototype capture. `verify:connectors` presses them.
      */
      await page.evaluate(
        `(() => { const el = document.querySelector('.provsec');
                  if (el !== null) el.scrollIntoView({ block: 'start' }); })()`,
      )
      await page.waitForTimeout(350)
      await shoot('settings-providers')
      await page.locator('[data-setting="governance"]').click()
      await page.waitForTimeout(500)
      await shoot('settings-governance')
      await page.evaluate(`(() => {
        const el = document.querySelector('#settings .setbody')
        if (el === null) return
        const box = el.closest('.sheet, .settings') || el
        const target = box.scrollHeight > box.clientHeight ? box : el
        target.scrollTop = Math.round(target.scrollHeight * 0.45)
      })()`)
      await page.waitForTimeout(400)
      await shoot('settings-governance-middle')
      await page.evaluate(`(() => {
        const el = document.querySelector('#settings .setbody')
        if (el === null) return
        const box = el.closest('.sheet, .settings') || el
        const target = box.scrollHeight > box.clientHeight ? box : el
        target.scrollTop = target.scrollHeight
      })()`)
      await page.waitForTimeout(400)
      await shoot('settings-governance-lower')
      await page.locator('#settings .close').click()
      await page.waitForTimeout(400)
    }
    await page.locator('[data-switch-open]').click()
    await page.waitForTimeout(300)
    await page.locator('[data-switch-menu] [data-open="wellness"]').click()
    await page.waitForTimeout(700)
    for (const s of ['documents', 'tasks', 'contacts', 'sources']) {
      await page.locator(`[data-tab="${s}"]`).click()
      await page.waitForTimeout(350)
      await shoot(`empty-${s}`)
    }
    await page.locator('[data-switch-open]').click()
    await page.waitForTimeout(300)
    await page.locator('[data-switch-menu] [data-open="legacy-coaching-course"]').click()
    await page.waitForTimeout(700)

    for (const section of ['tasks', 'contacts', 'sources']) {
      await page.locator(`[data-tab="${section}"]`).click()
      await page.waitForTimeout(500)
      await shoot(section)
    }

    /*
      Signed-in sites (#135), which nothing else can photograph.

      The block draws only when the project HAS a session, and the page will
      never invent one: an invented signed-in session is a claim that the
      office holds a credential for a site, and a screenshot of that would be
      believed. So the demonstration rows are injected HERE, in the capture
      harness, where they cannot reach a person -- and a screen with no capture
      is a screen nobody is watching, which this repository has paid for once
      already in the same week.
    */
    // Strings, not closures: this file has no DOM lib, so `window` and
    // `document` are not names at compile time. Playwright evaluates either.
    await page.evaluate(`(() => {
      const w = window.__shots
      if (w === undefined) throw new Error('the capture door is not open')
      const slug = 'legacy-coaching-course'
      const hour = 3600000
      w.browserSites[slug] = [
        { site: 'suppliers.example.com',
          purpose: 'Read the trade price list every Monday morning.',
          state: 'live', has_credential: true,
          last_alive_at: new Date(Date.now() - 2 * hour).toISOString() },
        { site: 'portal.example.org',
          purpose: 'Check the accreditation renewal dates each quarter.',
          state: 'needs_sign_in', has_credential: false, last_alive_at: null },
      ]
      w.browserSeen[slug] = [
        { at: new Date(Date.now() - 2 * hour).toISOString(), verb: 'read',
          url: 'https://suppliers.example.com/prices', ok: true, detail: 'read', ms: 4200 },
        { at: new Date(Date.now() - 26 * hour).toISOString(), verb: 'shot',
          url: 'https://suppliers.example.com/prices', ok: false,
          detail: 'the screenshot came back 500', ms: 900 },
      ]
      w.render()
    })()`)
    await page.waitForTimeout(400)
    /*
      Scrolled to, not merely drawn.

      The first capture put this block a long way below a 900px fold, which is
      the same as no capture at all -- CLAUDE.md's own rule, learned on the
      history panel two days ago.
    */
    await page.evaluate(
      `(() => { const el = document.querySelector('.bsites');
                if (el !== null) el.scrollIntoView({ block: 'center' }); })()`,
    )
    await page.waitForTimeout(400)
    await shoot('sources-signed-in')

    /*
      Project Settings, all four panes (#36).

      Every one, not a representative one. `verify:layouts` walked seven
      project tabs for weeks and had never opened the office settings sheet;
      pointed at one tab of it, it found three defects in the first run. An
      audit that has never opened a surface says nothing about it, and four
      panes is four surfaces.

      The pane fetches its own payload, so the wait is longer than a tab
      switch: the page draws "Reading the office…" first and capturing that
      would be capturing a spinner.
    */
    await page.locator('[data-tab="settings"]').click()
    await page.waitForTimeout(900)
    for (const pane of ['people', 'automations', 'labels', 'project']) {
      await page.locator(`[data-setpane="${pane}"]`).click()
      await page.waitForTimeout(450)
      await shoot(`settings-project-${pane}`)
    }

    await page.locator('[data-tab="documents"]').click()
    await page.waitForTimeout(500)

    // And a document, which is the second one.
    await page.locator('[data-doc="0"]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await page.locator('[data-doc="0"]').click()
    await page.waitForTimeout(700)
    await shoot('document')

    /*
      Coming back from Google (0486). LAST, because it is a fresh navigation.

      Supabase will not serve HTML from the shared functions domain, so the
      OAuth callback redirects here with the outcome in the query string and
      the studio says it. That banner is drawn on exactly one condition — a
      parameter no other capture carries — so without this it is a surface
      nobody has ever looked at, which is how the unreadable page it replaces
      survived for as long as it did.

      Asserted as well as photographed: the banner is the whole point of the
      redirect, and a capture cannot tell the difference between a banner that
      is missing and a capture taken before it drew.
    */
    await page.goto(
      `http://127.0.0.1:${String(PORT)}/?google=connected&with=Gmail,Calendar,Drive`,
      { waitUntil: 'networkidle', timeout: 30_000 },
    )
    await page.waitForTimeout(900)
    const saidBack = await page.evaluate(`(() => {
      const el = document.querySelector('.saidback')
      if (el === null) return 'NO BANNER'
      const r = el.getBoundingClientRect()
      if (r.width * r.height < 400) return 'BANNER HAS NO BOX'
      if (location.search !== '') return 'THE QUERY STRING WAS NOT CLEARED'
      return el.textContent ?? ''
    })()`)
    if (typeof saidBack !== 'string' || !saidBack.includes('Gmail, Calendar, Drive')) {
      console.error(`  ${size}/${scheme} came back from Google badly: ${String(saidBack)}`)
    }
    await shoot('back-from-google')

    // Anything thrown while doing all that is a defect, not a note.
    if (errors.length > 0) {
      console.error(`  ${size}/${scheme} threw: ${errors.join(' · ')}`)
    }

    // Overflow is the failure that only shows on a phone.
    const wide = await page.evaluate(
      'document.documentElement.scrollWidth > document.documentElement.clientWidth + 2',
    )
    if (wide === true) console.error(`  ${size}/${scheme} OVERFLOWS sideways`)

    await ctx.close()
  }
}

await browser.close()
server.close()
console.log(shots.join('\n'))
