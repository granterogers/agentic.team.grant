/**
 * Team Chat as the Sample Person, through the real page, the real gateway, the real worker and the real model.
 *   npm run sample:chat [label]
 *
 * THREE messages, because every one is a paid model call and this is acceptance, not a corpus (CLAUDE.md: do not write
 * another synthetic final examination). Each is a harmless question about the Sample's own fictional projects:
 *   1. across projects: what to focus on today          (Claire; reads the office)
 *   2. one project:    what travel tasks are overdue    (Claire, scoped to the project)
 *   3. delegation:     ask the finance specialist to summarise the budget assumptions
 * For each: the message goes under the Sample's office, a reply arrives, the reply is about the Sample's work and names
 * nothing of Grant's, the conversation is still there after a reload, and the job row belongs to the Sample's office.
 * Judged by reading the answers and by facts in the database, never by a wording list; the answers are printed.
 *
 * Contacts nobody: nothing here can send email, Slack or Telegram (the Sample has none connected), and the delegation is
 * internal. No credential is printed.
 */
import { mkdirSync } from 'node:fs'
import type { Page } from 'playwright'
import { newPage, signIn, startStudio } from './browser.ts'
import { rows, sampleOffice, session } from './lib.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/chat-${label}`
mkdirSync(out, { recursive: true })
const office = await sampleOffice()
const O = office.officeId

// What must never appear in a Sample answer: names that exist only in Grant's office. Read from his projects at run time
// (not typed here), so the list is true today and a leak is caught by name.
const grantNames = (
  await rows(
    `select name from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and char_length(name) > 8 limit 12`,
  )
).map((r) => String(r.name))

const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

const studio = await startStudio(4790)
const s = await session()
// PHONE=1 drives Team Chat on an iPhone-sized touch screen (390x844): the Chat button in the bottom bar, the composer, a
// shrunken viewport standing in for the soft keyboard (a real keyboard is NOT exercised here), the thread after a reload.
const PHONE = process.env.PHONE === '1'
const { page, errors } = await newPage(
  studio,
  PHONE ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  PHONE,
)
const thread = async (p: Page): Promise<string[]> =>
  (await p.locator('[data-dockthread] .msg').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  )

/**
 * Let the previous turn's work finish before the next is asked. A delegation answers at once with "put to the team" and the
 * real answer lands minutes later; without this the NEXT turn read the previous turn's answer as its own (found when turn 3
 * was reported as answering about the Japan trip). Bounded, and it says if the office never went quiet.
 */
const settle = async (): Promise<void> => {
  const end = Date.now() + 240000
  while (Date.now() < end) {
    const n = Number(
      (
        await rows(
          `select count(*) n from public.jobs where office_id = '${O}' and state not in ('complete','failed','cancelled')`,
        )
      )[0]?.n ?? 0,
    )
    if (n === 0) return
    await sleep(4000)
  }
  console.log('  (the office still had live work when the next turn was asked)')
}

/** Send one message through the dock and wait (bounded) for a reply that is not the waiting row. */
const ask = async (
  path: string,
  words: string,
  waitMs: number,
): Promise<{ reply: string; seconds: number }> => {
  await settle()
  await page.goto(`${studio.base}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => null)
  await sleep(3500)
  if (
    !(await page
      .locator('[data-docksay]')
      .isVisible()
      .catch(() => false))
  )
    await page.locator('[data-bc-dock]').first().click()
  await page.waitForSelector('[data-docksay]', { state: 'visible', timeout: 15000 })
  // A dock left open from an earlier project files under THAT project (#376). A person standing here who wants to ask about
  // this project presses the one control that says so; the harness does the same, and the run checks it was offered.
  const here = page.locator('[data-dock-here]').first()
  if (await here.isVisible().catch(() => false)) {
    await here.click()
    await sleep(1200)
    movedDock += 1
  }
  // The thread now loads the office's record, so it may already hold earlier days. A reply to THIS message is whatever
  // comes after the last place these words appear, never an index taken before sending.
  const squashed = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const key = squashed(words).slice(0, 30)
  // The same words may already be in the record from an earlier run: only a NEW occurrence is this message.
  const already = (await thread(page)).filter((m) => squashed(m).includes(key)).length
  await page.fill('[data-docksay]', words)
  if (PHONE) {
    // Stand-in for the soft keyboard: the visible height shrinks to about what is left above it. The composer must stay in view
    // (#197), and its text must be 16px or more or iOS zooms the page when it takes focus.
    const atBottom =
      "(() => { const t = document.querySelector('[data-dockthread]'); return t === null ? -1 : Math.round(t.scrollHeight - t.scrollTop - t.clientHeight) })()"
    const gapBefore = Number(await page.evaluate(atBottom))
    await page.locator('[data-docksay]').focus()
    await page.setViewportSize({ width: 390, height: 520 })
    await sleep(1500)
    const gapAfter = Number(await page.evaluate(atBottom))
    check(
      'phone: with the keyboard up the thread is still showing its latest message',
      gapAfter >= 0 && gapAfter <= 8,
      `distance from the end: ${gapBefore}px before, ${gapAfter}px after`,
    )
    const box = await page.locator('[data-docksay]').boundingBox()
    const size = Number.parseFloat(
      String(
        await page.evaluate("getComputedStyle(document.querySelector('[data-docksay]')).fontSize"),
      ),
    )
    await page.screenshot({ path: `${out}/phone-keyboard-${asked.length + 1}.png` })
    check(
      'phone: with the keyboard up the composer is still on screen',
      box !== null && box.y >= 0 && box.y + box.height <= 521,
      box === null ? 'no box' : `y ${Math.round(box.y)} h ${Math.round(box.height)} of 520`,
    )
    check('phone: the composer text is 16px or more (no iOS zoom)', size >= 16, `${size}px`)
    await page.setViewportSize({ width: 390, height: 844 })
    await sleep(400)
  }
  const began = Date.now()
  await page.locator('[data-dockform] button[type=submit]').click()
  const end = began + waitMs
  while (Date.now() < end) {
    await sleep(3000)
    const now = await thread(page)
    let at = -1
    let seen = 0
    now.forEach((m, i) => {
      if (squashed(m).includes(key)) {
        at = i
        seen += 1
      }
    })
    if (at < 0 || seen <= already) continue
    const fresh = now.slice(at + 1)
    const answer = fresh.find(
      (m) =>
        !/^you\b/i.test(m) &&
        m.length > 25 &&
        !/working on it|thinking|waiting|needs something from you/i.test(m),
    )
    if (answer !== undefined) {
      // Say everything that arrived, and what the office did about it, so a reply that is not an answer to THIS message
      // (a duty's report landing in the same thread, say) cannot be mistaken for one.
      const doing = await rows(
        `select j.kind, j.state, coalesce(j.recipient_agent,'') who from public.jobs j where j.office_id = '${O}' and j.created_at > now() - interval '${Math.round((Date.now() - began) / 1000) + 20} seconds' order by j.created_at`,
      )
      console.log(`  all that arrived: ${fresh.map((m) => m.slice(0, 160)).join(' || ')}`)
      console.log(
        `  jobs since: ${doing.map((d) => `${d.kind}/${d.state}/${d.who}`).join(', ') || 'none'}`,
      )
      return { reply: answer, seconds: Math.round((Date.now() - began) / 1000) }
    }
  }
  const last = (await thread(page)).slice(-2).join(' || ')
  return {
    reply: `(no answer within ${waitMs / 1000}s) ${last}`,
    seconds: Math.round(waitMs / 1000),
  }
}

const turns: {
  path: string
  words: string
  wait: number
  project?: string
  /** What the answer (or the delegated answer) must say, and must not, judged on the words and never a canned list */
  expect?: RegExp
  forbid?: RegExp
  /**
   * A delegation to a named or role-described colleague, asserted on the job TREE the real worker produced (#408): which
   * specialists were convened (exactly these, or for an open-ended request, exactly one of `among`), that every job belongs
   * to the Sample's office and the page's project, and that the result is in the conversation and survives a reload.
   */
  tree?: { only?: string; among?: string[]; project: string }
}[] = [
  { path: '/', words: 'What should I focus on today across my projects?', wait: 150000 },
  {
    path: '/p/japan-spring-trip',
    words: 'What travel tasks are overdue?',
    wait: 150000,
    project: 'japan-spring-trip',
    expect: /return flight/i,
  },
  {
    path: '/p/2027-financial-plan',
    words:
      'Ask the finance specialist to summarise the assumptions in the budget documents in this project.',
    wait: 240000,
    project: '2027-financial-plan',
    expect: /budget|cash|income|spending|assumption|saving/i,
    forbid: /Japan|rail pass|ryokan/i,
  },
  {
    path: '/p/wellness-studio-launch',
    // A fact in a BASELINE document (the preview evening run sheet). This case used to ask for a word in a file the product
    // harness uploads, which a reset archives, so it failed on every run after a reset for a reason that was not the product.
    words: 'What time does the taster class start at the preview evening?',
    wait: 150000,
    project: 'wellness-studio-launch',
    expect: /18[:.]30|6[:.]30\s*(?:pm)?/i,
  },
  {
    path: '/p/2027-financial-plan',
    words:
      'Ask the finance director to review the outstanding work in this project and tell me what needs attention first.',
    wait: 300000,
    project: '2027-financial-plan',
    expect: /budget|savings|emergency fund|self-assessment|lock-in|fixed-rate/i,
    forbid: /Japan|ryokan|rail pass|sprung|signage|instructor|Haneda/i,
    tree: { only: 'finance-director', project: '2027-financial-plan' },
  },
  {
    path: '/p/japan-spring-trip',
    words:
      'Have the research director review the unresolved travel work and identify the most important next steps.',
    wait: 300000,
    project: 'japan-spring-trip',
    expect: /flight|passport|ryokan|ticket|insurance|booking|rail pass|eSIM|cherry/i,
    forbid: /sprung|signage|instructor|self-assessment|savings account|lock-in/i,
    tree: { only: 'research-director', project: 'japan-spring-trip' },
  },
  {
    path: '/p/wellness-studio-launch',
    words:
      'Ask the appropriate person on the team to review our launch preparation and identify anything important that is still unfinished.',
    wait: 300000,
    project: 'wellness-studio-launch',
    expect:
      /sprung|signage|timetable|instructor|venue|hire agreement|supplier|quote|pay rate|launch/i,
    forbid: /Japan|ryokan|rail pass|Haneda|self-assessment|savings account/i,
    tree: { project: 'wellness-studio-launch', among: [] },
  },
]
const asked: string[] = []
let movedDock = 0
try {
  await signIn(studio, page, s)
  const jobsBefore = Number(
    (await rows(`select count(*) n from public.jobs where office_id = '${O}'`))[0]?.n ?? 0,
  )
  // `npm run sample:chat -- <label> 1,2` runs only those turns: three real model answers can outlast the shell's ceiling.
  const only = (process.argv[3] ?? '1,2,3').split(',').map(Number)
  for (const [i, t] of turns.entries()) {
    if (!only.includes(i + 1)) continue
    // Settled FIRST: `since` taken before the previous turn's work finished let that work's answer be read as this turn's.
    await settle()
    const since = new Date(Date.now() - 5000).toISOString()
    const r = await ask(t.path, t.words, t.wait)
    asked.push(t.words)
    console.log(`\n> ${t.words}\n< (${r.seconds}s) ${r.reply.slice(0, 700)}\n`)
    // A delegation answers at once with "put to the team"; the real answer is a later output. Wait for it, bounded, and read it.
    let lastBody = ''
    if (/put (that|it) to the team/i.test(r.reply)) {
      const end = Date.now() + t.wait
      let body = ''
      // What the chat SAID while the team worked: only states the office reported (turn_status), seen on the page.
      const statesSeen = new Set<string>()
      while (Date.now() < end && body === '') {
        await sleep(5000)
        const now = (await thread(page)).join(' || ')
        for (const m of now.matchAll(
          /(Waiting its turn[^|]*|[A-Z][a-z]+(?: and [A-Z][a-z]+)? (?:is|are) working on it\.|Waiting: [^|]*|It needs something from you[^|]*)/g,
        ))
          statesSeen.add(m[1]?.trim() ?? '')
        body = String(
          (
            await rows(
              `select o.body b from public.outputs o join public.jobs j on j.job_id = o.job_id
                where j.office_id = '${O}' and o.created_at > '${since}'
                  and (j.job_id = (select c.job_id from public.inbound_commands c where c.office_id = '${O}' and c.instruction = '${t.words.replace(/'/g, "''")}' order by c.received_at desc limit 1)
                    or j.root_job_id = (select c.job_id from public.inbound_commands c where c.office_id = '${O}' and c.instruction = '${t.words.replace(/'/g, "''")}' order by c.received_at desc limit 1))
                order by o.created_at desc limit 1`,
            )
          )[0]?.b ?? '',
        )
      }
      console.log(
        `  the team's answer: ${body === '' ? '(none within the wait)' : body.slice(0, 900)}\n`,
      )
      lastBody = body
      check('the delegated work produced an answer', body !== '')
      console.log(
        `  states the chat showed while it worked: ${[...statesSeen].join(' | ') || '(none seen)'}`,
      )
      check(
        'while it worked the chat said what was happening, in states the office reported',
        statesSeen.size > 0,
        [...statesSeen].join(' | ').slice(0, 160),
      )
      // The answer must reach the conversation WITHOUT a reload: compare on letters and digits only, so formatting does not matter.
      const squash = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const want = squash(body).slice(0, 40)
      let inChat = false
      const till = Date.now() + 90000
      while (Date.now() < till && !inChat) {
        inChat = squash((await thread(page)).join(' ')).includes(want)
        if (!inChat) await sleep(3000)
      }
      check('the answer arrived IN the chat thread, with no reload', inChat, body.slice(0, 80))
      await page.screenshot({ path: `${out}/answer-in-chat-${asked.length}.png` })
      const leakLater = grantNames.find((n) => body.toLowerCase().includes(n.toLowerCase()))
      check(
        'and that answer names nothing from Grant’s office',
        leakLater === undefined,
        leakLater ?? '',
      )
    }
    // A tree turn judges the RESULT further down; the immediate reply is the specialist's acknowledgement and plan.
    if (t.tree === undefined && (t.expect !== undefined || t.forbid !== undefined)) {
      const said = `${r.reply} ${lastBody}`
      if (t.expect !== undefined)
        check(
          `the answer is about the right thing (${t.expect.source})`,
          t.expect.test(said),
          said.slice(0, 120),
        )
      if (t.forbid !== undefined)
        check(
          `and not about another project (${t.forbid.source})`,
          !t.forbid.test(said),
          said.slice(0, 120),
        )
    }
    check(
      `a reply arrived: "${t.words.slice(0, 40)}…"`,
      !r.reply.startsWith('(no answer'),
      `${r.seconds}s`,
    )
    const leak = grantNames.find((n) => r.reply.toLowerCase().includes(n.toLowerCase()))
    check('and it names nothing from Grant’s office', leak === undefined, leak ?? '')
    check(
      'and it is not an error sentence',
      !/could not record|unauthori[sz]ed|not signed in/i.test(r.reply),
    )
    if (t.tree !== undefined) {
      const q = t.words.replace(/'/g, "''")
      const rootOf = async (): Promise<string> =>
        String(
          (
            await rows(
              `select c.job_id::text id from public.inbound_commands c where c.office_id = '${O}' and c.instruction = '${q}' order by c.received_at desc limit 1`,
            )
          )[0]?.id ?? '',
        )
      const root = await rootOf()
      const family = `(j.job_id = '${root}'::uuid or j.root_job_id = '${root}'::uuid)`
      const till = Date.now() + t.wait
      let live = 1
      while (Date.now() < till && live > 0) {
        live = Number(
          (
            await rows(
              `select count(*) n from public.jobs j where ${family} and j.state not in ('complete','failed','cancelled')`,
            )
          )[0]?.n ?? 0,
        )
        if (live > 0) await sleep(5000)
      }
      check('the whole delegation tree finished', live === 0)
      const tree = await rows(
        `select j.kind, j.state::text state, coalesce(j.recipient_agent,'') who, j.office_id::text office, coalesce(p.slug,'') project
           from public.jobs j left join public.projects p on p.project_id = j.project_id
          where ${family} order by j.created_at`,
      )
      console.log(`  tree: ${tree.map((x) => `${x.kind}/${x.state}/${x.who || '-'}`).join(', ')}`)
      const specialists = [
        ...new Set(
          tree.map((x) => String(x.who)).filter((w) => w !== '' && w !== 'chief-of-staff'),
        ),
      ]
      console.log(`  specialists convened: ${specialists.join(', ') || '(none)'}`)
      if (t.tree.only !== undefined)
        check(
          `Claire delegated to ${t.tree.only} and to nobody else`,
          specialists.length === 1 && specialists[0] === t.tree.only,
          specialists.join(', '),
        )
      else
        check(
          'Claire delegated to exactly one specialist, chosen from the request',
          specialists.length === 1,
          specialists.join(', '),
        )
      check(
        'every job in the tree belongs to the Sample office',
        tree.every((x) => x.office === O),
      )
      check(
        `and to the project the page was on (${t.tree.project})`,
        tree.every((x) => x.project === t.tree?.project),
        [...new Set(tree.map((x) => x.project))].join(', '),
      )
      const result = await rows(
        `select o.body b, coalesce(j.recipient_agent,'') who from public.outputs o join public.jobs j on j.job_id = o.job_id
          where ${family} and o.body is not null and j.kind = 'office.instruction' and coalesce(j.recipient_agent,'') not in ('', 'chief-of-staff')
          order by o.created_at desc`,
      )
      const final = String(result[0]?.b ?? '')
      console.log(
        `  result (${String(result[0]?.who)}): ${final.slice(0, 500).replace(/\s+/g, ' ')}`,
      )
      const filed = Number(
        (
          await rows(
            `select count(*) n from public.tasks t where t.office_id = '${O}' and t.job_id is not null and t.created_at > '${since}'::timestamptz`,
          )
        )[0]?.n ?? 0,
      )
      check(
        'a review wrote no tasks into the project',
        filed === 0,
        `${filed} task(s) filed by jobs`,
      )
      check('a result was written', final.length > 60)
      if (t.expect !== undefined)
        check('result is about this project’s work', t.expect.test(final), final.slice(0, 100))
      if (t.forbid !== undefined)
        check('result names nothing from the other projects', !t.forbid.test(final), '')
      const gleak = grantNames.find((n) => final.toLowerCase().includes(n.toLowerCase()))
      check('result names nothing from Grant’s office', gleak === undefined, gleak ?? '')
      // in the chat now, and after a reload
      const squash2 = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const want2 = squash2(final).slice(0, 40)
      await sleep(4000)
      check(
        'the result is in the Team Chat thread',
        squash2((await thread(page)).join(' ')).includes(want2),
      )
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => null)
      await sleep(3500)
      if (
        !(await page
          .locator('[data-docksay]')
          .isVisible()
          .catch(() => false))
      )
        await page.locator('[data-bc-dock]').first().click()
      await sleep(2500)
      check(
        'and it is still there after a reload',
        squash2((await thread(page)).join(' ')).includes(want2),
      )
    }
    await page.screenshot({ path: `${out}/turn-${asked.length}.png`, fullPage: false })
  }
  if (only.length > 1)
    check(
      'a dock left on an earlier project offered a one-press move to the page’s project, and it was used',
      movedDock >= 1,
      `${movedDock} move(s)`,
    )
  const jobsAfter = Number(
    (await rows(`select count(*) n from public.jobs where office_id = '${O}'`))[0]?.n ?? 0,
  )
  check(
    'the work was recorded as jobs of the Sample office',
    jobsAfter > jobsBefore,
    `${jobsBefore} -> ${jobsAfter}`,
  )
  const stray = Number(
    (
      await rows(
        `select count(*) n from public.jobs j where j.created_at > now() - interval '30 minutes' and j.requested_by like '%grant%' and j.office_id <> '${O}'`,
      )
    )[0]?.n ?? 0,
  )
  check('nothing was filed under Grant’s office by this run', stray === 0, `${stray}`)
  const routed = await rows(
    `select jsonb_pretty(coalesce(rd.roster::jsonb, '[]'::jsonb)) r from public.routing_decisions rd join public.jobs j on j.job_id = rd.job_id where j.office_id = '${O}' order by rd.created_at desc limit 3`,
  ).catch(() => [])
  console.log(
    `routing decisions (latest 3): ${routed.map((r) => String(r.r).replace(/\s+/g, ' ')).join(' ; ')}`,
  )

  // The conversation is still there after a reload.
  const lastTurn = turns.filter((_, i) => only.includes(i + 1)).at(-1) ?? turns[0]
  await page.goto(`${studio.base}${lastTurn?.path ?? '/'}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => null)
  await sleep(3500)
  if (
    !(await page
      .locator('[data-docksay]')
      .isVisible()
      .catch(() => false))
  )
    await page.locator('[data-bc-dock]').first().click()
  await sleep(2500)
  const after = await thread(page)
  check(
    'after a reload the conversation is still there',
    after.some((m) => m.includes((lastTurn?.words ?? 'x').slice(0, 25))),
    `${after.length} messages`,
  )
  await page.screenshot({ path: `${out}/after-reload.png` })
} finally {
  await studio.close()
}
console.log(
  `\nerrors on the page: ${errors.length === 0 ? 'none' : errors.slice(0, 3).join(' || ')}`,
)
const failed = results.filter((r) => !r.ok)
console.log(
  `sample:chat ${label}: ${results.length - failed.length}/${results.length}   (images in ${out})`,
)
if (failed.length > 0 || errors.length > 0) process.exitCode = 1
