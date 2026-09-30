/**
 * The approval policy, driven rather than described (#15).
 *
 *   npm run verify:approval
 *
 * Migrations 0421 and 0422.
 *
 * ## What is worth asserting, and what would pass for the wrong reason
 *
 * #15's acceptance criteria are five sentences, and four of them are easy to
 * satisfy in a way that looks green and means nothing:
 *
 *   * *"policy expressible per action class"* — satisfied by a table existing.
 *     Asserted here by DRIVING all sixteen cells and comparing the verdict to
 *     what the matrix says, at every autonomy level, which is the only thing
 *     that can tell a resolver that reads the matrix from one that ignores it.
 *   * *"standing authorizations Grant can grant and revoke without a code
 *     change"* — satisfied by an INSERT. Asserted here by watching a verdict
 *     move `ask` -> `proceed` -> `ask` across a grant and a revoke.
 *   * *"destructive or externally-visible actions cannot bypass it"* — this is
 *     the one that matters, and a comment claiming it is worth nothing. There
 *     are three doors and all three are pushed: editing the matrix, granting a
 *     standing authorization on a level-3 tool, and asking whether a standing
 *     authorization can turn `refuse` into `proceed`. Each asserts on the
 *     MESSAGE, because a refusal for the wrong reason looks exactly like the
 *     rule working.
 *   * *"approvals surface in one place"* — `public.blockers`, which already
 *     worked. What is new is that answering "from now on" WRITES the row, so
 *     that loop is driven end to end.
 *
 * ## Subjects
 *
 * Global autonomy is a real setting, so every matrix check sets it and reads
 * it back inside ONE statement ending in `rollback` — #210's rule, wrap the
 * CALL rather than the assertion, because a wrapper cannot know a call was
 * destructive until it already has been.
 *
 * The standing-authorization loop cannot be one statement, so it uses a
 * FIXTURE TOOL of its own rather than a real one. A crashed run must not be
 * able to leave a live permission behind on a real capability, and that is not
 * a thing a teardown can promise — only the choice of subject can.
 */

import { mayAct, recordRefusal } from '../../src/agents/approval.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { raiseBlocker } from '../../src/inference/record.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Date.now().toString(36)
const TOOL = `verification.standing.${run}`
const WHO = 'growth-director'

const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

/** The error a statement raised, or '' if it did not raise. */
const refusedBy = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (error) {
    return (error as Error).message.replace(/\s+/g, ' ')
  }
}

console.log(`\nverify:approval — ${run}`)

// ===========================================================================
// 1. The matrix decides, at every level
// ===========================================================================

console.log('\nthe dial decides, and the matrix is what it consults')

/*
  Every cell, driven.

  One statement per autonomy level: set the global setting, ask about one tool
  of each action level, roll back. `app.may_act` is STABLE, so it sees the
  snapshot of the statement it runs in — which is why the set and the reads are
  separate statements inside the same transaction rather than one select.
*/
const LEVEL_TOOL: Record<number, string> = {
  0: 'db.read',
  1: 'task.create',
  2: 'notion.write',
  3: 'gmail.send',
}

/*
  `gmail.send` is DISABLED, and a disabled tool is refused before the dial is
  consulted — correctly, and it would make every level-3 cell read `refuse`
  whatever the matrix says. So the level-3 probe is a tool that is enabled and
  level 3, and the registry has none: every one of the five is off. The suite
  makes one, inside the same transaction, so nothing outside it ever sees an
  enabled level-3 capability.
*/
const LIVE_THREE = `verification.consequential.${run}`

const expected: Record<string, Record<number, string>> = {
  observe: { 0: 'proceed', 1: 'refuse', 2: 'refuse', 3: 'refuse' },
  // 0612, Grant's decision: internal office work proceeds at suggest. Level 2 and 3 still ask.
  suggest: { 0: 'proceed', 1: 'proceed', 2: 'ask', 3: 'ask' },
  act_with_review: { 0: 'proceed', 1: 'proceed', 2: 'ask', 3: 'ask' },
  act: { 0: 'proceed', 1: 'proceed', 2: 'proceed', 3: 'ask' },
}

for (const [autonomy, wants] of Object.entries(expected)) {
  const got = await one(`
    begin;
    insert into public.tool_permissions (tool, level, description, enabled, verbs, delivered_by)
    values (${lit(LIVE_THREE)}, 3, 'A fixture level-3 capability, alive only inside this transaction.',
            true, array['be consequential'], 'scripts/verify/approval.ts');
    insert into public.autonomy_settings (project_id, level, set_by, reason)
    values (null, ${lit(autonomy)}::public.autonomy_level, 'verify:approval', 'driving the matrix');
    select (app.may_act(null, ${lit(LEVEL_TOOL[0] ?? '')}) ->> 'verdict') as l0,
           (app.may_act(null, ${lit(LEVEL_TOOL[1] ?? '')}) ->> 'verdict') as l1,
           (app.may_act(null, ${lit(LEVEL_TOOL[2] ?? '')}) ->> 'verdict') as l2,
           (app.may_act(null, ${lit(LIVE_THREE)}) ->> 'verdict') as l3;
    rollback;
  `)
  const said = [0, 1, 2, 3].map((n) => String(got[`l${String(n)}`])).join(' / ')
  const want = [0, 1, 2, 3].map((n) => wants[n]).join(' / ')
  check(`at ${autonomy}, levels 0-3 resolve`, `${said}  (wanted ${want})`, said === want)
}

/*
  CONTROL. The four rows above must not be the same four answers.

  A resolver that ignored the dial entirely and always said `ask` would pass
  three of the sixteen cells and fail the rest — but a resolver that ignored it
  and returned the SUGGEST row would look plausible. What discriminates is that
  the rows differ from each other, which is a property of the matrix being
  read rather than of any one answer.
*/
{
  const rows = new Set(Object.values(expected).map((w) => [0, 1, 2, 3].map((n) => w[n]).join('/')))
  /*
    THREE, not four, since 0612: with internal writes proceeding at suggest, suggest and
    act_with_review resolve identically. That is a recorded consequence of Grant's decision,
    and this control still does its job - a resolver that ignored the dial would return one
    row, and one that ignored everything but level would not produce observe's refusals.
  */
  check(
    'CONTROL: the autonomy levels are not all one answer (three distinct rows since 0612)',
    `${String(rows.size)} distinct rows`,
    rows.size === 3,
  )
}

// A disabled tool is refused whatever the dial says — the registry outranks it.
{
  const got = await one(`
    begin;
    insert into public.autonomy_settings (project_id, level, set_by, reason)
    values (null, 'act', 'verify:approval', 'driving the matrix');
    select (app.may_act(null, 'web.search'))::text as d;
    rollback;
  `)
  const d = JSON.parse(String(got.d)) as { verdict?: string; because?: string }
  check(
    'a switched-off tool is refused even at act, with the registry reason',
    `${String(d.verdict)} — ${String(d.because).slice(0, 60)}…`,
    d.verdict === 'refuse' && String(d.because ?? '').includes('Nothing implements this'),
  )
}

{
  const d = JSON.parse(
    String((await one(`select (app.may_act(null,'nope.nope'))::text as d`)).d),
  ) as {
    verdict?: string
    because?: string
  }
  check(
    'a capability that does not exist is refused, and says so',
    `${String(d.verdict)} — ${String(d.because)}`,
    d.verdict === 'refuse' && String(d.because ?? '').includes('no such capability'),
  )
}

// ===========================================================================
// 1b. Work a person asked for does not stop to ask them again (0423)
// ===========================================================================

console.log('\nwho asked: a person, or a schedule')

/*
  One transaction, three jobs, one enabled level-3 capability.

  `jobs.requested_by` is what decides, and it is composed rather than chosen:
  `duty:<name>` for a schedule and `<channel>:<actor>` for a person. Both are
  written here so the difference is driven rather than assumed, and the whole
  thing rolls back so neither job survives.
*/
{
  const got = await one(`
    begin;
    insert into public.tool_permissions (tool, level, description, enabled, verbs, delivered_by)
    values (${lit(LIVE_THREE)}, 3, 'A fixture level-3 capability, alive only inside this transaction.',
            true, array['be consequential'], 'scripts/verify/approval.ts');
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), null, ${lit(`verify-approval-duty-${run}`)},
            'research', 'duty:fixture-schedule');
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), null, ${lit(`verify-approval-person-${run}`)},
            'research', 'telegram:grant');
    select
      (app.may_act(null, 'notion.write',
        (select job_id from public.jobs where idempotency_key = ${lit(`verify-approval-duty-${run}`)}))
        ->> 'verdict') as by_duty,
      (app.may_act(null, 'notion.write',
        (select job_id from public.jobs where idempotency_key = ${lit(`verify-approval-person-${run}`)}))
        ->> 'verdict') as by_person,
      (app.may_act(null, ${lit(LIVE_THREE)},
        (select job_id from public.jobs where idempotency_key = ${lit(`verify-approval-person-${run}`)}))
        ->> 'verdict') as person_level_three,
      (app.may_act(null, 'notion.write', null) ->> 'verdict') as no_job;
    rollback;
  `)
  check('a duty writing outward still asks', `duty → ${String(got.by_duty)}`, got.by_duty === 'ask')
  check(
    'and work a person asked for does not',
    `person → ${String(got.by_person)}`,
    got.by_person === 'proceed',
  )
  check(
    'CONTROL: but a person asking does NOT reach a level-3 action',
    `person + level 3 → ${String(got.person_level_three)}`,
    got.person_level_three === 'ask',
  )
  check(
    'CONTROL: and no job at all reads as unprompted, never as permission',
    `no job → ${String(got.no_job)}`,
    got.no_job === 'ask',
  )
}

/*
  CONTROL for the control: `observe` refuses even work a person asked for.

  A project set to watch only and then asked to write is a contradiction
  between two things Grant said, and the office must surface it rather than
  quietly deciding which one it preferred.
*/
{
  const got = await one(`
    begin;
    insert into public.autonomy_settings (project_id, level, set_by, reason)
    values (null, 'observe', 'verify:approval', 'driving the asked-for rule');
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), null, ${lit(`verify-approval-observe-${run}`)},
            'research', 'telegram:grant');
    select (app.may_act(null, 'notion.write',
      (select job_id from public.jobs where idempotency_key = ${lit(`verify-approval-observe-${run}`)}))
      ->> 'verdict') as v;
    rollback;
  `)
  check(
    'CONTROL: watch only refuses even work a person asked for',
    `observe + a person asking → ${String(got.v)}`,
    got.v === 'refuse',
  )
}

// ===========================================================================
// 2. The floor: a level-3 action can never become automatic
// ===========================================================================

console.log('\nthe floor, pushed at all three doors')

{
  const said = await refusedBy(`
    begin;
    update public.autonomy_policy set verdict = 'proceed'
     where autonomy = 'act' and action_level = 3;
    rollback;
  `)
  check(
    'the matrix itself cannot be edited to make a level-3 action automatic',
    said === '' ? 'IT WAS ALLOWED' : said.slice(0, 120),
    said.includes('autonomy_policy_level_three_always_asks'),
  )
}

{
  const said = await refusedBy(`
    begin;
    insert into public.standing_authorizations (tool, reason, granted_by)
    values ('gmail.send', 'should be refused', 'grant');
    rollback;
  `)
  check(
    'a standing authorization cannot cover a level-3 tool',
    said === '' ? 'IT WAS ALLOWED' : said.slice(0, 140),
    said.includes('level-3 action'),
  )
}

/*
  And the third door, which is the subtle one: a standing authorization
  upgrades `ask`, and must not touch `refuse`. `observe` + level 1 is `refuse`,
  so a row that granted it would be the office writing to a project Grant said
  to watch only.
*/
{
  const got = await one(`
    begin;
    insert into public.autonomy_settings (project_id, level, set_by, reason)
    values (null, 'observe', 'verify:approval', 'driving the floor');
    insert into public.standing_authorizations (tool, reason, granted_by)
    values ('task.create', 'should not be enough', 'grant');
    select (app.may_act(null, 'task.create'))::text as d;
    rollback;
  `)
  const d = JSON.parse(String(got.d)) as { verdict?: string }
  check(
    'a standing authorization does NOT turn refuse into proceed',
    `observe + a live standing row still says ${String(d.verdict)}`,
    d.verdict === 'refuse',
  )
}

// ===========================================================================
// 3. Grant and revoke, on a fixture capability
// ===========================================================================

console.log('\ngranting and revoking, on a capability of its own')

const clean = async (): Promise<void> => {
  await db.execute(
    `delete from public.standing_authorizations where tool in (${lit(TOOL)}, ${lit(LIVE_THREE)})`,
  )
  await db.execute(`delete from public.blockers where standing_tool = ${lit(TOOL)}`)
  await db.execute(
    `delete from public.tool_permissions where tool in (${lit(TOOL)}, ${lit(LIVE_THREE)})`,
  )
}
await clean()
await db.execute(`
  insert into public.tool_permissions (tool, level, description, enabled, verbs, delivered_by)
  values (${lit(TOOL)}, 1,
          'A fixture capability created by verify:approval, and removed by it.',
          true, array['stand in for a real capability'], 'scripts/verify/approval.ts')
`)

const verdictFor = async (): Promise<string> =>
  (await mayAct(db, { projectId: null, tool: TOOL })).verdict

check('before any grant, the office asks', await verdictFor(), (await verdictFor()) === 'ask')

const granted = JSON.parse(
  String(
    (
      await one(
        `select (public.hq_grant_standing(${lit(TOOL)}, 'Stop asking me about this.', p_by => 'grant'))::text as d`,
      )
    ).d,
  ),
) as { ok?: boolean; authorization?: string }
const after = await mayAct(db, { projectId: null, tool: TOOL })
check(
  'a standing authorization turns ask into proceed, and says whose words',
  `${after.verdict} — ${after.because}`,
  after.verdict === 'proceed' && after.because.includes('Stop asking me about this.'),
)
check(
  'and the decision carries the authorization that made it',
  after.standing === null ? 'NOTHING NAMED' : `${after.standing.scope} · ${after.standing.id}`,
  after.standing !== null && after.standing.id === granted.authorization,
)

// A reason is required, the same rule declining a tool request obeys.
{
  const said = JSON.parse(
    String(
      (
        await one(
          `select (public.hq_grant_standing(${lit(TOOL)}, '   ', p_by => 'grant'))::text as d`,
        )
      ).d,
    ),
  ) as { ok?: boolean; error?: string }
  check(
    'a standing authorization with no reason is refused',
    String(said.error ?? 'IT WAS ALLOWED'),
    said.ok !== true && String(said.error ?? '').includes('needs a reason'),
  )
}

{
  const said = JSON.parse(
    String(
      (
        await one(
          `select (public.hq_revoke_standing(${lit(String(granted.authorization))}::uuid, 'done', p_by => 'grant'))::text as d`,
        )
      ).d,
    ),
  ) as { ok?: boolean }
  const back = await verdictFor()
  check(
    'revoking it puts the question back',
    `revoke ok=${String(said.ok)} → ${back}`,
    said.ok === true && back === 'ask',
  )
}

// 0350's rule: a revoke that matched nothing must say so rather than reporting
// success about a row it never found.
{
  const said = JSON.parse(
    String(
      (
        await one(
          `select (public.hq_revoke_standing(${lit(String(granted.authorization))}::uuid, 'again', p_by => 'grant'))::text as d`,
        )
      ).d,
    ),
  ) as { ok?: boolean; error?: string }
  check(
    'revoking it twice is refused rather than reported as success',
    String(said.error ?? 'IT SAID OK'),
    said.ok !== true && String(said.error ?? '').includes('no live standing authorization'),
  )
}

// ===========================================================================
// 4. Answering "from now on" writes the row
// ===========================================================================

console.log('\nthe loop Grant actually uses: he answers, and it stops asking')

const projectId = String(
  (
    await one(`
      select project_id::text as id from public.projects
       where status = 'active' and not is_fixture order by slug limit 1
    `)
  ).id ?? '',
)
const jobId = String(
  (
    await one(`
      insert into public.jobs
        (correlation_id, project_id, idempotency_key, kind, requested_by, recipient_agent)
      values (extensions.gen_random_uuid(), ${lit(projectId)}::uuid,
              ${lit(`verify-approval-${run}`)}, 'research', 'verify:approval', ${lit(WHO)})
      returning job_id::text as id
    `)
  ).id,
)

const OPTION = 'Do that from now on without asking me'
const blockerId = await raiseBlocker(db, {
  projectId,
  jobId,
  requestedAction: `A fixture question from verify:approval (${run}). What would you like?`,
  whyNeeded: 'Driving the standing-authorization loop end to end.',
  consequencesOfDelay: 'None. This is a fixture.',
  approvalOptions: ['Just this once', OPTION, 'Leave it'],
  originatingAgent: 'chief-of-staff',
  workCanContinue: true,
  standingTool: TOOL,
  standingOption: OPTION,
})

/*
  An offer may only promise what the press can perform. A `standingOption` that
  is not one of the options is a permission nobody could ever grant, because
  `hq_answer_blocker` refuses an answer outside the list — so `raiseBlocker`
  throws rather than writing it.
*/
{
  let threw = ''
  try {
    await raiseBlocker(db, {
      projectId,
      jobId,
      requestedAction: 'should never be written',
      whyNeeded: 'control',
      consequencesOfDelay: 'none',
      approvalOptions: ['Just this once'],
      originatingAgent: 'chief-of-staff',
      workCanContinue: true,
      standingTool: TOOL,
      standingOption: 'an option nobody offered',
    })
  } catch (error) {
    threw = (error as Error).message
  }
  check(
    'CONTROL: a standing offer that is not one of the options is refused at the source',
    threw === '' ? 'IT WAS WRITTEN' : threw.slice(0, 90),
    threw.includes('is not one of the approval options'),
  )
}

const answered = JSON.parse(
  String(
    (
      await one(
        `select (public.hq_answer_blocker(${lit(blockerId)}::uuid, ${lit(OPTION)}, 'grant'))::text as d`,
      )
    ).d,
  ),
) as { ok?: boolean; standing?: { ok?: boolean; authorization?: string } | null }

const nowScoped = await mayAct(db, { projectId, tool: TOOL })
const stillGlobal = await mayAct(db, { projectId: null, tool: TOOL })
check(
  'answering with that option writes the standing authorization',
  `answer ok=${String(answered.ok)}, grant ok=${String(answered.standing?.ok)}`,
  answered.ok === true && answered.standing?.ok === true,
)
check(
  'and the office stops asking, in that project',
  `${nowScoped.verdict} — ${nowScoped.because.slice(0, 70)}`,
  nowScoped.verdict === 'proceed',
)
check(
  'CONTROL: and only in that project — a question about one project is not consent for every project',
  `elsewhere it still says ${stillGlobal.verdict}`,
  stillGlobal.verdict === 'ask',
)

// ===========================================================================
// 4b. And answering can PERFORM the thing, not merely permit it (#257)
// ===========================================================================

console.log('\nanswering "add them" adds them')

/*
  The dead option, and why it was dead.

  `handlers/drive.ts` has offered "Add them to the project as source documents"
  since #62. `app.drive_watch_checked` advances the page token whether or not
  Grant was asked, so by the time he answers those files are no longer in the
  change list and the next run has nothing to act on. Answering it did nothing,
  visibly, on a question he can see.

  0428 puts what answering PERFORMS on the blocker — a kind and one payload per
  thing, written by the handler rather than read out of the option text. Driven
  here because reading the migration proves it parses.
*/
{
  const DO_IT = 'Add them to the project as source documents'
  const performed = await one(`
    begin;
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), ${lit(projectId)}::uuid,
            ${lit(`verify-approval-perform-${run}`)}, 'drive.watch',
            ${lit(`teamhq:verify-approval-${run}`)});
    insert into public.blockers
      (project_id, job_id, requested_action, why_needed, consequences_of_delay,
       approval_options, originating_agent, work_can_continue, on_answer)
    values (${lit(projectId)}::uuid,
            (select job_id from public.jobs
              where idempotency_key = ${lit(`verify-approval-perform-${run}`)}),
            ${lit(`Two files have appeared (${run}). What would you like me to do?`)},
            'Nothing has been opened or read yet.', 'Nothing happens until you say.',
            array[${lit(DO_IT)}, 'Ignore these'], 'chief-of-staff', true,
            jsonb_build_object('option', ${lit(DO_IT)}, 'kind', 'drive.read_file',
              'payloads', jsonb_build_array(
                jsonb_build_object('file_id', 'fixture-one', 'folder_id', 'fixture-folder'),
                jsonb_build_object('file_id', 'fixture-two', 'folder_id', 'fixture-folder'))));
    select app.hq_answer_blocker(
      (select blocker_id from public.blockers
        where requested_action = ${lit(`Two files have appeared (${run}). What would you like me to do?`)}),
      ${lit(DO_IT)}, 'grant');
    select
      (select count(*)::int from public.jobs
        where kind = 'drive.read_file'
          and requested_by = ${lit(`teamhq:verify-approval-${run}`)}) as enqueued,
      (select string_agg(pinned_config ->> 'file_id', ',' order by pinned_config ->> 'file_id')
         from public.jobs
        where kind = 'drive.read_file'
          and requested_by = ${lit(`teamhq:verify-approval-${run}`)}) as files;
    rollback;
  `)
  check(
    'answering the option that promises work starts exactly that work',
    `${String(performed.enqueued)} job(s): ${String(performed.files)}`,
    Number(performed.enqueued) === 2 && String(performed.files) === 'fixture-one,fixture-two',
  )

  /*
    CONTROL. Answering a DIFFERENT option starts nothing.

    Without it the check above would pass against a blocker that enqueued its
    payloads whatever Grant said, which is worse than the dead option it
    replaces: work he declined, done anyway.
  */
  const ignored = await one(`
    begin;
    insert into public.jobs (correlation_id, project_id, idempotency_key, kind, requested_by)
    values (extensions.gen_random_uuid(), ${lit(projectId)}::uuid,
            ${lit(`verify-approval-ignore-${run}`)}, 'drive.watch',
            ${lit(`teamhq:verify-ignore-${run}`)});
    insert into public.blockers
      (project_id, job_id, requested_action, why_needed, consequences_of_delay,
       approval_options, originating_agent, work_can_continue, on_answer)
    values (${lit(projectId)}::uuid,
            (select job_id from public.jobs
              where idempotency_key = ${lit(`verify-approval-ignore-${run}`)}),
            ${lit(`Ignore probe (${run})`)},
            'Driving the control: answering a different option must start nothing.',
            'Nothing happens at all, which is the point of this probe.',
            array[${lit(DO_IT)}, 'Ignore these'], 'chief-of-staff', true,
            jsonb_build_object('option', ${lit(DO_IT)}, 'kind', 'drive.read_file',
              'payloads', jsonb_build_array(jsonb_build_object('file_id', 'fixture-one'))));
    select app.hq_answer_blocker(
      (select blocker_id from public.blockers
        where requested_action = ${lit(`Ignore probe (${run})`)}), 'Ignore these', 'grant');
    select (select count(*)::int from public.jobs
             where kind = 'drive.read_file'
               and requested_by = ${lit(`teamhq:verify-ignore-${run}`)}) as enqueued;
    rollback;
  `)
  check(
    'CONTROL: answering a different option starts nothing',
    `${String(ignored.enqueued)} job(s)`,
    Number(ignored.enqueued) === 0,
  )
}

// ===========================================================================
// 5. A refusal is never silent
// ===========================================================================

console.log('\na refusal is written down where Grant looks')

await recordRefusal(db, {
  jobId,
  tool: TOOL,
  because: 'Driving #211: a gate that refuses without recording is a lost answer.',
  noticedBy: WHO,
})
{
  const got = await one(`
    select count(*)::int as n from public.job_impediments
     where job_id = ${lit(jobId)}::uuid and kind = 'needs_permission' and needed = ${lit(TOOL)}
  `)
  check(
    'a policy refusal writes a needs_permission impediment',
    `${String(got.n)} row(s)`,
    Number(got.n) === 1,
  )
}

// ===========================================================================
// 6. Put it back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

let sweptSaid = ''
let sweptClean = false
try {
  /*
    The job is CANCELLED, not deleted — a job can never be deleted, and this
    one was left `queued` by `hq_answer_blocker` putting it back in the queue,
    which is the state cancelling is the teardown for.

    The impediment stays: `job_impediments` refuses DELETE, and the row is a
    fixture by inheritance from a `verify:` job, so it is permanent AND
    uncountable, which is what a suite wants.
  */
  await db.execute(`
    update public.jobs set state = 'cancelled', state_reason = 'verify:approval teardown'
     where job_id = ${lit(jobId)}::uuid and state not in ('complete', 'cancelled', 'failed')
  `)
  await clean()
  const left = (
    await db.execute(`
      select (select count(*) from public.standing_authorizations
               where tool in (${lit(TOOL)}, ${lit(LIVE_THREE)}) and revoked_at is null)
           + (select count(*) from public.tool_permissions
               where tool in (${lit(TOOL)}, ${lit(LIVE_THREE)}))
           + (select count(*) from public.blockers where standing_tool = ${lit(TOOL)})
           + (select count(*) from public.jobs
               where job_id = ${lit(jobId)}::uuid and state not in ('cancelled', 'complete', 'failed'))
           as n
    `)
  ).rows[0] as { n: number }
  sweptClean = Number(left.n) === 0
  sweptSaid = `${String(left.n)} fixture row(s) left behind`
} catch (error) {
  sweptSaid = (error as Error).message.replace(/\s+/g, ' ').slice(0, 140)
}
check('no live permission, no fixture capability, no open job', sweptSaid, sweptClean)

// And the office's real autonomy is untouched: every matrix check rolled back.
{
  const got = await one(`select count(*)::int as n from public.autonomy_settings
                          where set_by = 'verify:approval'`)
  check(
    'and the global autonomy setting was never actually changed',
    `${String(got.n)} row(s) written by this suite survive`,
    Number(got.n) === 0,
  )
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)
