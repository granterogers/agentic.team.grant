/**
 * The office does not deny holding a rule it holds (#320's invariant family).
 *
 *   npm run verify:withdraw
 *
 * `believed` in `remember()` is scoped to the level the turn is AT —
 * deliberately, because a project rule must not retire a global one. So from
 * inside a project a global or staff rule is invisible to the withdrawal
 * lookup, and taking one back produced *"I do not have a standing rule about
 * that"* about a rule sitting in the prompt that composed the sentence.
 *
 * Grant works mostly on Telegram, where a project is usually in scope, so
 * that is the ordinary way he would try to turn a rule off.
 *
 * ## Containment
 *
 * Every row is written by a `verify-` author, so `app.harness_author` is true
 * and `remember()` reads and retires the HARNESS lesson set — 0546 exists for
 * exactly this, after a suite's *"do not put screenshots in anymore"* retired
 * Grant's real *"always paste the image URLs"*. Asserted rather than assumed.
 * The fixture project is created and removed inside one run, so 0419's
 * fifteen-minute rule means no Slack channel is provisioned for it.
 */

import { remember } from '../../src/agents/remember.ts'
import { readTeaching } from '../../src/agents/teaching.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const checks: { what: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
const BY = `verify-withdraw-${run}`
const SLUG = `fixture-withdraw-${run}`

console.log('a rule he cannot see from here is still a rule the office holds —\n')

const authored = await one(`select app.harness_author(${lit(BY)}) as h`)
check(
  'this suite writes to the harness lesson set, asserted rather than assumed',
  `harness_author=${String(authored.h)}`,
  authored.h === true,
)

const project = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(SLUG)}, ${lit(`Withdraw proof ${run}`)}, 'Removed at the end of this run', 'paused')
  returning project_id::text as id`)
const projectId = String(project.id)
await db.execute(`
  insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
  values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`nb-${run}`)}, 'A linked Google Notebook', 'source');
  update public.projects set status = 'active' where project_id = ${lit(projectId)}::uuid;`)

/*
  A TEARDOWN THAT ONLY RUNS ON SUCCESS IS NOT A TEARDOWN.

  Two aborted runs of this suite left four ACTIVE fixture projects behind, and
  the office listed them back in an answer -- correctly, because the project
  spine shows a harness job the harness's own world. They were still four rows
  nothing was going to remove, which is the pile CLAUDE.md records being
  rebuilt by whoever quotes the rule about it.

  Defined and armed HERE, the moment there is something to sweep, rather than
  at the bottom where a failure in the middle never reaches it. Lessons are
  RETIRED through the sanctioned path: public.lessons refuses DELETE, and a
  retraction is a row rather than a column.
*/
const sweep = async (): Promise<void> => {
  for (const row of (
    await db.execute(`select lesson_id::text as id from public.lessons_live
                       where learned_by = ${lit(BY)}`)
  ).rows as { id: string }[]) {
    await db
      .execute(`select app.retract_lesson(${lit(row.id)}::uuid,
                  'verify:withdraw teardown -- nothing this run stated outlives it.',
                  ${lit(BY)}) as r`)
      .catch(() => undefined)
  }
  await db
    .execute(`delete from public.projects where project_id = ${lit(projectId)}::uuid`)
    .catch(async () => {
      await db
        .execute(`update public.projects set status = 'archived'
                   where project_id = ${lit(projectId)}::uuid`)
        .catch(() => undefined)
    })
}
const sweepOnFailure = (error: unknown): void => {
  console.error(`\nthe suite failed -- sweeping anyway\n${String(error)}`)
  // exitCode rather than exit, so the sweep is allowed to finish.
  void sweep().finally(() => {
    process.exitCode = 1
  })
}
process.on('unhandledRejection', sweepOnFailure)
process.on('uncaughtException', sweepOnFailure)

const teach = (said: string) => {
  const t = readTeaching(said)
  if (t === null) throw new Error(`the harness's own sentence is not a teaching: ${said}`)
  return t
}

/* A rule stated with no project in scope, which is how a global one is made. */
const RULE = 'From now on, always paste the screenshot links into every reply you send me.'
const stored = await remember(db, teach(RULE), BY, null, null, null)
check(
  'a rule stated with no project in scope is stored',
  stored.stored ?? 'nothing',
  stored.stored === 'lesson',
)

const live = async (): Promise<number> =>
  Number(
    (
      await one(`select count(*)::int as n from public.lessons_live
                  where learned_by = ${lit(BY)} and scope = 'global'`)
    ).n,
  )
check('and it is live at global scope', `${String(await live())} live`, (await live()) === 1)

/*
  THE DEFECT. Withdrawn from inside a project, where the level-scoped lookup
  cannot see it.
*/
const WITHDRAW = 'Stop putting the screenshot links in the replies any more.'
const fromProject = await remember(db, teach(WITHDRAW), BY, null, null, projectId)
check(
  'withdrawing it from inside a project does not deny it',
  `“${fromProject.said.slice(0, 110)}”`,
  !fromProject.said.includes('do not have a standing rule about that'),
)
check(
  'it names the rule it actually holds',
  fromProject.said.includes('screenshot links') ? 'quoted back' : 'not named',
  fromProject.said.includes('screenshot links'),
)
check(
  'and it does not take it off every project on an ambiguous sentence',
  `${String(await live())} still live`,
  (await live()) === 1,
)

/* And when he says he means everywhere, it goes. */
const everywhere = await remember(
  db,
  teach('Stop putting the screenshot links in the replies any more, everywhere.'),
  BY,
  null,
  null,
  projectId,
)
check(
  'saying he means everywhere takes it off',
  `“${everywhere.said.slice(0, 90)}”`,
  (await live()) === 0,
)

/*
  AND THE RETRACTION IT WROTE SAYS WHO DID IT AND WHY, IN THAT ORDER.

  `app.retract_lesson(p_lesson_id, p_why, p_by)` writes `body = p_why` and
  `learned_by = p_by`. `remember()` passed the author second, so the AUTHOR
  went into the reason column and the REASON into the author column, on every
  retraction the office has ever written -- and `lessons.is_fixture` is
  GENERATED from `learned_by`, so a harness retraction was attributed as
  Grant's own. `public.lessons` refuses UPDATE, so the rows written before
  this are permanently the wrong way round; that is recorded in 0567's
  comments rather than fixed.
*/
const wrote = await one(`
  select left(body, 40) as why, learned_by as who, is_fixture as f
    from public.lessons
   where row_kind = 'retraction' and learned_by = ${lit(BY)}
   order by created_at desc limit 1`)
check(
  'the retraction records the author in the author column',
  `learned_by=${String(wrote.who)}`,
  String(wrote.who) === BY,
)
check(
  'and the reason in the reason column',
  `body=“${String(wrote.why)}”`,
  String(wrote.why).startsWith('Withdrawn'),
)
check(
  'so the harness attribution the generated column reads is right',
  `is_fixture=${String(wrote.f)}`,
  wrote.f === true,
)

/*
  CONTROL: a withdrawal of something the office really does not hold still
  says so. A suite made only of the new branch passes against a change that
  routes every withdrawal through it.
*/
const nothing = await remember(
  db,
  teach('Stop putting due dates on the things you make for me any more.'),
  BY,
  null,
  null,
  projectId,
)
check(
  'CONTROL: a rule it genuinely does not hold is still reported as absent',
  `“${nothing.said.slice(0, 80)}”`,
  nothing.said.includes('do not have a standing rule about that'),
)

console.log('\nand the suite leaves nothing behind')
await sweep()
const left = await one(`
  select count(*)::int as n from public.lessons_live where learned_by = ${lit(BY)}`)
check('no rule of this run is still live', `${String(left.n)} live`, Number(left.n) === 0)

const stray = await one(`
  select count(*)::int as n from public.projects
   where project_id = ${lit(projectId)}::uuid and status <> 'archived'`)
check(
  'nothing of this run is left in Grant’s project list',
  `${String(stray.n)} live`,
  stray.n === 0,
)

const failed = checks.filter((c) => !c.passed).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
