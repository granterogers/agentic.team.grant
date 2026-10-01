/**
 * A module is a milestone that gathers, and the page draws it.
 *
 *   npm run verify:modules
 *
 * Issue #71, migrations 0286 and 0287.
 *
 * ## What the Issue asked for, and what it got
 *
 * It asked for a `public.modules` table. Reading the specification it cites
 * says otherwise: the canonical IA does not contain the word "module" at all,
 * and the frontend prompt uses it for the dashboard's PANELS — which are built
 * (#81, 0250). The section the studio renders is a third thing, and the
 * prototype's own data says what: numbered, named parts of the work with a
 * state and counts of documents and tasks.
 *
 * Every piece of that already exists — `tasks.is_milestone`, `tasks.priority`,
 * `tasks.parent_task_id`, `collections` — so 0286 added the one missing join
 * (`collections.for_task_id`) and derives the rest. 0286's header has the
 * mapping.
 *
 * ## Which means the risk is different, and this suite is aimed at it
 *
 * A derived projection cannot go stale, which removes the usual failure. What
 * it CAN do is count the wrong things — a milestone from another project, a
 * fixture task, a child of a child, a document filed in a collection that
 * belongs to a different milestone. Every one of those is a plausible join and
 * every one produces a number that looks fine.
 *
 * So each count is checked against a subject built to have a decoy: the
 * project holds a second milestone, a fixture task, and a collection that is
 * nobody's shelf. A projection that ignores `for_task_id`, or forgets
 * `is_fixture`, or counts grandchildren, reports a different number.
 *
 * ## And then the page, because a function with no mouth is #72's shape
 *
 * The Issue is explicit: *"the definition of done here includes a caller in
 * `app.js`... not that the function returns rows."* The second half drives the
 * real page in real Chromium with the projection's own output planted in the
 * payload, and asserts the panel draws it.
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { namesAnOffice } from './lib/office-seam.ts'

const PORT = 4623
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
/*
  A REAL subject, not a `fixture-` one, and #45's trap is exactly why.

  `hq_task_add` filters `not is_fixture`, and `projects.is_fixture` is GENERATED
  from the slug — so a suite named `fixture-modules-…` gets "no dashboard
  project called …" from the very function it is testing, against code that
  works. That cost `verify:identity` eleven red checks and it cost this suite
  two on its first run.

  `probe-` because `app.project_debris()` lists that prefix: if the teardown
  below ever fails, `npm run check:leaks` sees it the same day. A real name with
  no leak check behind it is how thirty debris projects accumulated.
*/
const slug = `probe-modules-${run}`

let projectId = ''
let moduleId = ''

/*
  The subject, and its decoys.

  A fixture name is right here: nothing in this path filters `is_fixture` on the
  project, so `purge:fixtures` can collect it and the teardown below is a belt
  as well as braces (#45).
*/
async function setUp(): Promise<void> {
  projectId = String(
    (
      await one(`
        insert into public.projects (name, slug, status)
        values ('Fixture modules ${run}', ${lit(slug)}, 'paused')
        returning project_id
      `)
    ).project_id,
  )

  // Two milestones, so ordering and the per-module counts have something to get
  // wrong. Priority decides `n`, and the second is deliberately created FIRST
  // so a projection ordering by `created_at` alone comes out backwards.
  const second = String(
    (
      await one(`
        insert into public.tasks (project_id, title, is_milestone, priority, state, added_by)
        values (${lit(projectId)}::uuid, 'Second module ${run}', true, 10, 'todo', 'grant')
        returning task_id
      `)
    ).task_id,
  )
  moduleId = String(
    (
      await one(`
        insert into public.tasks (project_id, title, is_milestone, priority, state, added_by)
        values (${lit(projectId)}::uuid, 'First module ${run}', true, 90, 'doing', 'grant')
        returning task_id
      `)
    ).task_id,
  )

  // Three children of the first, one of the second, and a FIXTURE child that
  // must not be counted — `tasks.is_fixture` is generated from `added_by`.
  await db.execute(`
    insert into public.tasks (project_id, title, parent_task_id, added_by) values
      (${lit(projectId)}::uuid, 'child a', ${lit(moduleId)}::uuid, 'grant'),
      (${lit(projectId)}::uuid, 'child b', ${lit(moduleId)}::uuid, 'grant'),
      (${lit(projectId)}::uuid, 'child c', ${lit(moduleId)}::uuid, 'grant'),
      (${lit(projectId)}::uuid, 'other child', ${lit(second)}::uuid, 'grant'),
      (${lit(projectId)}::uuid, 'harness child', ${lit(moduleId)}::uuid, 'verify:modules')
  `)

  // A grandchild. Counted by a projection that walks the tree; not a task of
  // this module.
  await db.execute(`
    insert into public.tasks (project_id, title, parent_task_id, added_by)
    select ${lit(projectId)}::uuid, 'grandchild', task_id, 'grant'
      from public.tasks where parent_task_id = ${lit(moduleId)}::uuid and title = 'child a'
  `)

  // Two documents on the first module's shelf, one on a collection that is
  // nobody's shelf — which a projection ignoring `for_task_id` would add in.
  const shelf = String(
    (
      await one(`
        insert into public.collections (project_id, name, for_task_id)
        values (${lit(projectId)}::uuid, 'First module docs', ${lit(moduleId)}::uuid)
        returning collection_id
      `)
    ).collection_id,
  )
  const loose = String(
    (
      await one(`
        insert into public.collections (project_id, name)
        values (${lit(projectId)}::uuid, 'Not a module shelf')
        returning collection_id
      `)
    ).collection_id,
  )
  const docs = (
    await db.execute(`
      insert into public.documents (project_id, title, origin, content, content_fingerprint,
                                    content_chars, fetched_at)
      values (${lit(projectId)}::uuid, 'doc one', 'yours', 'one', repeat('1', 64), 3, app.now_utc()),
             (${lit(projectId)}::uuid, 'doc two', 'yours', 'two', repeat('2', 64), 3, app.now_utc()),
             (${lit(projectId)}::uuid, 'doc three', 'yours', 'three', repeat('3', 64), 5, app.now_utc())
      returning document_id
    `)
  ).rows.map((r) => String(r.document_id))

  await db.execute(`
    insert into public.document_collections (document_id, collection_id) values
      (${lit(String(docs[0]))}::uuid, ${lit(shelf)}::uuid),
      (${lit(String(docs[1]))}::uuid, ${lit(shelf)}::uuid),
      (${lit(String(docs[2]))}::uuid, ${lit(loose)}::uuid)
  `)
}

async function tearDown(): Promise<void> {
  /*
    Order matters and is not obvious. `documents` is RESTRICT since 0283, and
    `collections` cascades from the project — but a document in a collection
    holds nothing, so the documents go first and the rest follows the project.
    Tasks cascade. `project_delete` refuses a project holding documents, which
    is why they are removed by hand rather than left to it.
  */
  await db.execute(`delete from public.documents where project_id = ${lit(projectId)}::uuid`)
  await db.execute(`delete from public.tasks where project_id = ${lit(projectId)}::uuid`)
  const said = (await one(`select public.project_delete(${lit(slug)}) as r`)).r as {
    ok?: boolean
    error?: string
  }
  const left = Number(
    (await one(`select count(*)::int as n from public.projects where slug = ${lit(slug)}`)).n,
  )
  check('teardown', said.ok === true ? 'the subject is gone' : String(said.error), left === 0)
}

interface Module {
  id: string
  n: number
  name: string
  state: string
  docs: number
  tasks: number
}

console.log(`\nverify:modules — ${slug}\n`)
await setUp()

let drawnPayload: Module[] = []

try {
  console.log('what the projection derives')

  const mods = (await one(`select app.studio_modules(${lit(projectId)}::uuid) as m`)).m as Module[]
  drawnPayload = mods

  check(
    'the milestones are the modules',
    mods.map((m) => `${String(m.n)}. ${m.name} (${m.state})`).join(' · ') || 'none',
    mods.length === 2,
  )
  check(
    'ordered by priority, not by when they were made',
    mods.map((m) => m.name.split(' ')[0]).join(', '),
    mods[0]?.name.startsWith('First') === true && mods[1]?.name.startsWith('Second') === true,
  )

  const first = mods[0]
  /*
    Three children: not four (the harness one is a fixture) and not five (the
    grandchild belongs to `child a`). Both wrong answers come from a join a
    reasonable person would write.
  */
  check(
    'a module counts its own tasks, not fixtures and not grandchildren',
    `${String(first?.tasks)} (3 real children, 1 fixture, 1 grandchild present)`,
    first?.tasks === 3,
  )
  /*
    Two documents: not three. The third is in a collection on the same project
    that is nobody's shelf, which is what `for_task_id` is for.
  */
  check(
    'and counts the documents on its own shelf',
    `${String(first?.docs)} (3 documents on the project, 1 in a loose collection)`,
    first?.docs === 2,
  )
  check(
    'a module with no shelf and no children counts zero rather than nothing',
    `docs=${String(mods[1]?.docs)} tasks=${String(mods[1]?.tasks)}`,
    mods[1]?.docs === 0 && mods[1]?.tasks === 1,
  )
  /*
    Its own state, deliberately, not its children's average — see 0286. `doing`
    with three open children is the case that separates the two.
  */
  check('a module wears its own state', String(first?.state), first?.state === 'doing')

  // --- one shelf per milestone ---------------------------------------------
  let refused = '(accepted)'
  try {
    await db.execute(`
      insert into public.collections (project_id, name, for_task_id)
      values (${lit(projectId)}::uuid, 'A second shelf', ${lit(moduleId)}::uuid)
    `)
  } catch {
    refused = 'refused'
  }
  check('a milestone cannot have two shelves', refused, refused === 'refused')

  // --- the write path -------------------------------------------------------
  console.log('\nand a module can be made')

  const made = (
    await one(
      `select public.hq_task_add(${lit(slug)}, 'Made through the RPC', null, null, null, true) as r`,
    )
  ).r as { id?: string; milestone?: boolean; error?: string }
  check(
    'hq_task_add can make one in a single call',
    made.error ?? `milestone=${String(made.milestone)}`,
    made.milestone === true,
  )
  check(
    'and it appears as a module immediately',
    `${String(((await one(`select app.studio_modules(${lit(projectId)}::uuid) as m`)).m as Module[]).length)} module(s)`,
    ((await one(`select app.studio_modules(${lit(projectId)}::uuid) as m`)).m as Module[])
      .length === 3,
  )
  /*
    A module belongs to a project. Refused rather than written, because
    `studio_modules` is asked for ONE project's milestones and one filed nowhere
    could never appear on any board — a row nobody can ever see is worse than a
    refusal that says why.
  */
  const nowhere = (
    await one(
      `select public.hq_task_add(app.test_office(), '', 'Homeless module', null, null, null, true) as r`,
    )
  ).r as { error?: string }
  check(
    'a module with no project is refused, not filed nowhere',
    nowhere.error ?? '(accepted)',
    String(nowhere.error ?? '').includes('dashboard project'),
  )
} finally {
  // --- and the page draws it ------------------------------------------------
  //
  // Outside the try's success path is wrong; inside `finally` before teardown
  // is right — the browser half must run even if a projection check failed, so
  // one red check does not hide a second bug in the other half.
  console.log('\nand the page draws it')

  const studio = (await one('select app.hq_studio(app.sole_person_office()) as d')).d as {
    projects: { slug: string; layout: unknown; modules: unknown }[]
  }
  const subject = studio.projects[0]
  if (subject === undefined) {
    check('a project to draw', 'the office has no active dashboard project', false)
  } else {
    /*
      The projection's own output, planted into the payload, and the layout
      forced to show ONLY the modules panel — the default arrangement hides it
      on a project with no modules, which would make this pass by drawing
      nothing on a page that never had the panel.
    */
    subject.modules = drawnPayload
    subject.layout = [{ id: 'modules', x: 0, y: 0, w: 3, h: 320 }]

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
    const page = await (
      await browser.newContext({ viewport: { width: 1440, height: 900 } })
    ).newPage()
    const crashes: string[] = []
    page.on('pageerror', (e) => crashes.push(e.message.slice(0, 140)))

    // The page has to know which office it belongs to before its first line

    // runs, or the shim below never sees a URL with hq-api in it. ADR-0048.

    await page.addInitScript(namesAnOffice())

    await page.addInitScript(`
      window.__SECTIONS = ${JSON.stringify({ studio })};
      window.__SENT = [];
      try { localStorage.setItem('hq.token', 'verify-modules'); } catch (e) {}
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

    const shown = (await page.evaluate(
      `[...document.querySelectorAll('.module')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`,
    )) as string[]
    check(
      'the panel draws the modules the office holds',
      shown.join(' | ').slice(0, 150) || 'nothing',
      shown.length === drawnPayload.length && shown.length > 0,
    )
    check(
      'each one carries its state and its counts',
      shown[0] ?? 'nothing',
      /In hand/.test(shown[0] ?? '') &&
        /2 docs/.test(shown[0] ?? '') &&
        /3 tasks/.test(shown[0] ?? ''),
    )

    /*
      And the write path from the page, which is the half #71 calls the
      definition of done: *"a caller in app.js"*.

      Via the Tasks TAB, not the dashboard. `addTaskForm` is rendered by
      `tasksSection`, so on a board showing only the modules panel there is no
      form in the DOM at all — the first version of this check pressed a button
      that was not there and reported "nothing was sent", which reads exactly
      like a broken handler.

      This is the route a person takes: open Tasks, open the form, tick the box
      that says it is a module, add it.
    */
    await page.evaluate(`document.querySelector('[data-tab="tasks"]')?.click()`)
    await page.waitForTimeout(900)
    await page.evaluate(`
      document.querySelector('[data-empty-do="task"]')?.click();
      const f = document.querySelector('[data-task-form]');
      if (f) { f.hidden = false; }
    `)
    await page.waitForTimeout(400)

    const tickable = await page.evaluate(`document.querySelector('[data-task-milestone]') !== null`)
    check(
      'the add-task form offers to make it a module',
      tickable === true ? 'the tick box is there' : 'no tick box in the form',
      tickable === true,
    )

    await page.evaluate(`
      const t = document.querySelector('[data-task-milestone]');
      if (t) { t.checked = true; }
      const i = document.querySelector('[data-task-title]');
      if (i) { i.value = 'A module from the page'; }
      document.querySelector('[data-task-go]')?.click();
    `)
    await page.waitForTimeout(1_500)
    const sent = (await page.evaluate('window.__SENT')) as {
      action: string
      args: Record<string, unknown>
    }[]
    const added = sent.find((x) => x.action === 'task_add')
    check(
      'and the page can make one, in one call',
      added === undefined ? 'nothing was sent' : JSON.stringify(added.args),
      added?.args.p_milestone === true,
    )
    check('no uncaught JavaScript', crashes.join(' | ') || 'none', crashes.length === 0)

    await browser.close()
    server.close()
  }

  console.log('')
  await tearDown()
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
