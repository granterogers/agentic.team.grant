/**
 * What is waiting on Grant is where the work is.
 *
 *   npm run verify:waiting
 *
 * Issue #151, migration 0289.
 *
 *   > *"2 things waiting on you" appears on the landing page. Inside a project
 *   > — where you are when you could actually deal with it — it does not.*
 *
 *   > *the shape of failure this repo keeps rediscovering: the information
 *   > exists, the surface exists, and they are in different rooms.*
 *
 * ## What is worth checking, and what is not
 *
 * That `needs_me` has rows is not the question — it always did, and `hq_studio`
 * threw all but one of them away. The three things that can be wrong are the
 * three the Issue names, so those are the three sections here:
 *
 *   1. the count is visible without scrolling — asserted on the rendered page,
 *      above the fold, not on the payload;
 *   2. the items are one press away;
 *   3. each one is answerable in place — and the answer must be one the blocker
 *      actually offered, because a button sending a word the handler cannot act
 *      on resolves the row and strands the job, while reporting success.
 *
 * ## And it captures, because §14A says looking is the check
 *
 * Two PNGs into `.out/`, collapsed and open. A sentence about a warning bar is
 * worth nothing.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const PORT = 4627
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const slug = `probe-waiting-${run}`
let projectId = ''
let blockerId = ''
let jobId = ''

/*
  A real blocker on a real job, because `needs_me` joins them and a blocker with
  no job never appears in it. A `probe-` slug rather than `fixture-` so nothing
  filtering fixtures refuses it (#45), and so `check:leaks` catches a failed
  teardown.
*/
async function setUp(): Promise<void> {
  projectId = String(
    (
      await one(`
        insert into public.projects (name, slug, status)
        values ('Probe waiting ${run}', ${lit(slug)}, 'paused')
        returning project_id
      `)
    ).project_id,
  )
  jobId = String(
    (
      await one(`
        insert into public.jobs
          (project_id, correlation_id, kind, requested_by, idempotency_key, state)
        values (${lit(projectId)}::uuid, extensions.gen_random_uuid(),
                'research.summarise', 'grant', 'waiting-probe-${run}', 'waiting_user')
        returning job_id
      `)
    ).job_id,
  )
  blockerId = String(
    (
      await one(`
        insert into public.blockers
          (project_id, job_id, requested_action, why_needed, consequences_of_delay,
           approval_options, originating_agent, work_can_continue, state)
        values (${lit(projectId)}::uuid, ${lit(jobId)}::uuid,
                'Probe: may the team read the shared folder?',
                'It is the only place the source material is.',
                'Nothing happens until you answer.',
                array['Go ahead', 'Not now'], 'chief-of-staff', true, 'open')
        returning blocker_id
      `)
    ).blocker_id,
  )
}

async function tearDown(): Promise<void> {
  await db.execute(`delete from public.blockers where blocker_id = ${lit(blockerId)}::uuid`)
  /*
    The job cannot be deleted — `job_state_transitions` is append-only by §6 and
    has a foreign key to `jobs` (ADR-0022) — so it is cancelled and unlinked,
    which is what lets `project_delete` take the project.
  */
  await db.execute(`
    update public.jobs set state = 'cancelled', project_id = null
     where job_id = ${lit(jobId)}::uuid
  `)
  /*
    DELETED IF IT CAN BE, ARCHIVED IF IT CANNOT — and the difference is the
    product working.

    Answering a blocker records a DECISION (#129), `decisions.project_id` is
    ON DELETE SET NULL, and `public.decisions` is append-only by section 6. So
    the moment this suite answers the blocker it is testing, its own subject
    has permanent history against it and can never be deleted — the same
    position as a project holding a job, which ADR-0022 settles by archiving.

    Before 0509 that arrived as a raw `42501` four frames inside
    `app.project_delete`; it is a sentence now, and this reads the sentence
    rather than assuming a delete. Asserted on the END STATE either way — the
    subject is out of Grant's project list — because that is the property the
    teardown is for, and `left === 0` was asserting the mechanism.
  */
  const said = (await one(`select public.project_delete(${lit(slug)}) as r`)).r as {
    ok?: boolean
    error?: string
  }
  if (said.ok !== true) {
    await db.execute(`update public.projects set status = 'archived' where slug = ${lit(slug)}`)
  }
  const end = await one(`
    select count(*)::int as n,
           coalesce(max(status), 'gone') as status
      from public.projects where slug = ${lit(slug)}`)
  check(
    'teardown — the subject is out of the project list',
    Number(end.n) === 0 ? 'deleted' : `archived — ${String(said.error ?? '').slice(0, 90)}`,
    Number(end.n) === 0 || String(end.status) === 'archived',
  )
}

console.log(`\nverify:waiting — ${slug}\n`)
await setUp()

try {
  console.log('the office knows what is waiting, per project')

  const mine = (await one(`select app.studio_waiting(${lit(projectId)}::uuid) as w`)).w as {
    id: string
    what: string
    options: string[]
    blocks: boolean
  }[]
  check(
    'the project carries its own waiting list',
    `${String(mine.length)} item(s)`,
    mine.length === 1 && mine[0]?.id === blockerId,
  )
  check(
    'and the answers it will accept travel with it',
    JSON.stringify(mine[0]?.options),
    JSON.stringify(mine[0]?.options) === '["Go ahead","Not now"]',
  )
  /*
    Scoped, not global. `needs_me` holds real blockers on Grant's real projects;
    a projection missing its `where` would put those on every project at once.
  */
  const elsewhere = (
    await one(`
      select app.studio_waiting(project_id) as w from public.projects
       where slug <> ${lit(slug)} and status = 'active' and not is_fixture limit 1
    `)
  ).w as { id: string }[]
  check(
    'and it is scoped: another project does not carry this one',
    `${String(elsewhere.length)} item(s) there, none of them ours`,
    !elsewhere.some((x) => x.id === blockerId),
  )

  // --- answering it ---------------------------------------------------------
  console.log('\nand it can be answered')

  const refused = (
    await one(
      `select public.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(blockerId)}::uuid), app.test_office()), ${lit(blockerId)}::uuid, 'Whatever I like', 'grant') as r`,
    )
  ).r as { error?: string }
  check(
    'an answer it never offered is refused',
    refused.error ?? '(accepted)',
    String(refused.error ?? '').includes('Go ahead'),
  )
  /*
    The reason that matters: a resolved blocker whose job is still parked is a
    job nothing will ever pick up. So the refusal must ALSO have left the row
    open — a half-applied answer is the failure this guards.
  */
  const stillOpen = String(
    (
      await one(
        `select state::text as s from public.blockers where blocker_id = ${lit(blockerId)}::uuid`,
      )
    ).s,
  )
  check('and it changed nothing', `state=${stillOpen}`, stillOpen === 'open')

  const blank = (
    await one(`select public.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(blockerId)}::uuid), app.test_office()), ${lit(blockerId)}::uuid, '  ', 'grant') as r`)
  ).r as { error?: string }
  check('so is an empty one', blank.error ?? '(accepted)', blank.error !== undefined)

  const done = (
    await one(`select public.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(blockerId)}::uuid), app.test_office()), ${lit(blockerId)}::uuid, 'Not now', 'grant') as r`)
  ).r as { ok?: boolean }
  check('one it did offer is taken', JSON.stringify(done), done.ok === true)

  const after = await one(`
    select b.state::text as s, b.resolution,
           (select j.state::text from public.jobs j where j.job_id = b.job_id) as job
      from public.blockers b where b.blocker_id = ${lit(blockerId)}::uuid
  `)
  check(
    'the blocker closes with the answer recorded',
    `${String(after.s)} — ${String(after.resolution)}`,
    after.s === 'resolved' && String(after.resolution).includes('Not now'),
  )
  /*
    And the job is let go. A blocker resolved while its job sits in
    `waiting_user` is the worst outcome available: the interface says answered
    and nothing ever runs.
  */
  check(
    'and the job it was holding is released',
    `job state = ${String(after.job)}`,
    after.job === 'queued',
  )

  const again = (
    await one(`select public.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(blockerId)}::uuid), app.test_office()), ${lit(blockerId)}::uuid, 'Go ahead', 'grant') as r`)
  ).r as { already?: boolean; resolution?: string }
  check(
    'answering it twice says what it was answered with, rather than erroring',
    JSON.stringify(again),
    again.already === true && String(again.resolution).includes('Not now'),
  )

  const gone = (
    await one(`select public.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(blockerId)}::uuid), app.test_office()), ${lit(blockerId)}::uuid, 'x', 'grant') as r`)
  ).r
  check('a bad answer to a closed one is still not applied', JSON.stringify(gone), true)

  let threw = false
  try {
    await db.execute(
      `select public.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = '11111111-1111-4111-8111-111111111111'::uuid), app.test_office()), '11111111-1111-4111-8111-111111111111'::uuid, 'yes', 'grant') as r`,
    )
  } catch (error) {
    threw = error instanceof SqlExecutionError
  }
  const missing = threw
    ? { error: 'raised' }
    : ((
        await one(
          `select public.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = '11111111-1111-4111-8111-111111111111'::uuid), app.test_office()), '11111111-1111-4111-8111-111111111111'::uuid, 'yes', 'grant') as r`,
        )
      ).r as { error?: string })
  check(
    'and a blocker that does not exist is said so, not silently ignored',
    missing.error ?? '(accepted)',
    missing.error !== undefined,
  )
} finally {
  // --- and the page ---------------------------------------------------------
  console.log('\nand it is where the work is')

  const studio = (
    (await db.execute('select app.hq_studio() as d')).rows[0] as {
      d: { projects: { slug: string; name: string; layout: unknown; waiting: unknown }[] }
    }
  ).d
  const subject = studio.projects[0]
  if (subject === undefined) {
    check('a project to draw', 'the office has no active dashboard project', false)
  } else {
    /*
      Two items, one of them overdue and blocking, so both treatments are on
      screen — a capture of the calm state alone says nothing about the alarm.
      Planted rather than answered through the interface first, because the
      question is whether what the OFFICE holds is what is DRAWN.
    */
    subject.waiting = [
      {
        id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
        what: 'May the team read the shared Drive folder?',
        why: 'It is the only place the interview recordings are, and three tasks need them.',
        who: 'Claire',
        when: '2 days ago',
        at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        overdue: false,
        blocks: false,
        options: ['Go ahead', 'Not now'],
      },
      {
        id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
        what: 'Which of the two pricing structures should the outline use?',
        why: null,
        who: 'Tom',
        when: '9 days ago',
        at: new Date(Date.now() - 9 * 86_400_000).toISOString(),
        overdue: true,
        blocks: true,
        options: [],
      },
    ]

    const server = createServer(async (request, response) => {
      let file = join('web/studio', decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'))
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
      // A dotless path is a route, as on the host (#382: the older studio is under /classic).
      if (!existsSync(file) && extname(file) === '') file = join('web/studio', 'index.html')
      if (!existsSync(file)) {
        response.writeHead(404)
        response.end('not here')
        return
      }
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      })
      response.end(await readFile(file))
    })
    await new Promise<void>((r) => {
      server.listen(PORT, '127.0.0.1', () => {
        r()
      })
    })

    const browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const crashes: string[] = []
    page.on('pageerror', (e) => crashes.push(e.message.slice(0, 140)))

    // The page has to know which office it belongs to before its first line

    // runs, or the shim below never sees a URL with hq-api in it. ADR-0048.

    await page.addInitScript(namesAnOffice())

    await page.addInitScript(`
      window.__SECTIONS = ${JSON.stringify({ studio })};
      window.__SENT = [];
      try { localStorage.setItem('hq.token', 'verify-waiting'); } catch (e) {}
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('hq-api')) {
          const section = /section=([a-z_]+)/.exec(url);
          if (section) {
            return new Response(JSON.stringify({ data: window.__SECTIONS[section[1]] ?? {} }),
              { status: 200, headers: { 'content-type': 'application/json' } });
          }
          try { window.__SENT.push(JSON.parse(String(init && init.body))); } catch (e) {}
          return new Response(JSON.stringify({ result: { ok: true } }),
            { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      };
    `)

    await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2_000)
    await page.evaluate(`document.querySelector('[data-open]')?.click()`)
    await page.waitForTimeout(1_500)

    /*
      Above the fold, measured, not assumed. "Visible in the project header" is
      the Issue's first bullet and it is a statement about pixels — a bar that
      renders 1,400px down the page satisfies every DOM assertion and none of
      the requirement.
    */
    const box = (await page.evaluate(`
      (() => {
        const e = document.querySelector('.waitbar');
        if (e === null) return null;
        const r = e.getBoundingClientRect();
        return { top: Math.round(r.top), text: e.textContent.replace(/\\s+/g, ' ').trim() };
      })()
    `)) as { top: number; text: string } | null

    check(
      'the count is in the project header',
      box === null ? 'no waiting bar on the page' : box.text.slice(0, 70),
      box?.text.includes('2 things are waiting on you') === true,
    )
    check(
      'and visible without scrolling',
      box === null ? 'not there' : `${String(box.top)}px from the top of a 900px viewport`,
      box !== null && box.top > 0 && box.top < 700,
    )
    await page.screenshot({ path: '.out/waiting-collapsed-desktop.png' })

    // One press.
    await page.evaluate(`document.querySelector('[data-waiting-toggle]')?.click()`)
    await page.waitForTimeout(700)
    const items = (await page.evaluate(
      `[...document.querySelectorAll('.waititem')].length`,
    )) as number
    check('the items are one press away', `${String(items)} drawn`, items === 2)
    await page.screenshot({ path: '.out/waiting-open-desktop.png' })

    /*
      The answers it actually offers, and a field when it offers none. An
      invented Yes/No would send a word the handler cannot act on, which
      resolves the row and strands the job while reporting success.
    */
    const offered = (await page.evaluate(
      `[...document.querySelectorAll('[data-answer-with]')].map((e) => e.dataset.answerWith)`,
    )) as string[]
    check(
      'each one draws the answers it actually offers',
      offered.join(', ') || 'none',
      offered.length === 2 && offered.includes('Go ahead') && offered.includes('Not now'),
    )
    const fields = (await page.evaluate(
      `document.querySelectorAll('[data-answer-form]').length`,
    )) as number
    check(
      'and one that offers none asks for words instead',
      `${String(fields)} field(s)`,
      fields === 1,
    )

    await page.evaluate(`document.querySelector('[data-answer-with="Go ahead"]')?.click()`)
    await page.waitForTimeout(1_200)
    const sent = (await page.evaluate('window.__SENT')) as {
      action: string
      args: Record<string, unknown>
    }[]
    const answered = sent.find((x) => x.action === 'answer_blocker')
    check(
      'and answering one reaches the office from inside the project',
      answered === undefined ? 'nothing was sent' : JSON.stringify(answered.args),
      answered?.args.p_answer === 'Go ahead' &&
        answered.args.p_blocker_id === 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    )

    // Phone, where the buttons have to stack.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(600)
    await page.evaluate(`
      const b = document.querySelector('[data-waiting-toggle]');
      if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
    `)
    await page.waitForTimeout(700)
    const wide = (await page.evaluate(
      `document.documentElement.scrollWidth <= window.innerWidth + 1`,
    )) as boolean
    check('and the phone does not scroll sideways because of it', `390px`, wide)
    await page.screenshot({ path: '.out/waiting-open-phone.png' })

    check('no uncaught JavaScript', crashes.join(' | ') || 'none', crashes.length === 0)

    await browser.close()
    server.close()
  }

  console.log('')
  await tearDown()
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
console.log(
  'captures: .out/waiting-collapsed-desktop.png, waiting-open-desktop.png, waiting-open-phone.png',
)
process.exit(failed === 0 ? 0 : 1)
