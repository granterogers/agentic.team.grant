/**
 * Migration 0899: what a Sample visitor sees is the Sample's own work and their own thread, and nobody else's.
 *
 *   npx tsx scripts/isolated/sample-showcase-readers.ts <replica-db>
 *
 * One transaction, rolled back. It builds a sample office with a seeded turn (made while the office was open for seeding),
 * two visitors who each asked a question, and a piece of the sample's own housekeeping; then asks the two readers what a
 * visitor can see:
 *
 *   1. app.studio_requests (the Agentic Team tool): the seeded team work is shown; a visitor's turn is not; the sample's
 *      housekeeping is not; and the CONTROLS - the same housekeeping in a person's office, and a person's own work - still are.
 *   2. app.sample_conversation (Chat): a visitor reads the seeded thread AND their own turn, never another visitor's, and a
 *      non-sample office reads nothing through it.
 *   3. SABOTAGE: make harness_job answer false inside a savepoint, and the visitor's turn must appear in the Agentic Team list.
 */
import { readFile } from 'node:fs/promises'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string) => (await rows(sql))[0] ?? {}
const run = Date.now().toString(36)
const VISITOR_A = `a${run}${'x'.repeat(20)}`
const VISITOR_B = `b${run}${'y'.repeat(20)}`
const asObj = (v: unknown) =>
  (typeof v === 'string' ? JSON.parse(v) : v) as { ok?: boolean; job?: string; error?: string }
const asList = (v: unknown) =>
  (typeof v === 'string' ? JSON.parse(v) : v) as {
    kind?: string
    name?: string
    body?: string
    output?: { body?: string }
  }[]

try {
  await db.execute('begin')
  const op = String((await one(`select app.operator_office()::text as o`)).o)
  const email = `sample-${run}@example.invalid`
  const key = `sample-${run}`
  await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
  const made = (await one(
    `select app.provision_sample_office('Jordan Reyes (Sample Office)', ${lit(email)}, ${lit(key)}) as r`,
  )) as { r: { office_id?: string } | string }
  const S = String((typeof made.r === 'string' ? JSON.parse(made.r) : made.r).office_id ?? '')
  const P = String(
    (
      await one(
        `insert into public.projects (slug, name, status, office_id) values ('sr-p-${run}', 'Sample project', 'active', ${lit(S)}::uuid) returning project_id::text as id`,
      )
    ).id,
  )
  const PX = String(
    (
      await one(
        `insert into public.projects (slug, name, status, office_id) values ('sr-q-${run}', 'A person project', 'active', ${lit(op)}::uuid) returning project_id::text as id`,
      )
    ).id,
  )
  const output = async (job: string, body: string) =>
    rows(
      `insert into public.outputs (job_id, body, confidence, evidence) values (${lit(job)}::uuid, ${lit(body)}, 'medium', 'inferred')`,
    )

  // The seeded turn: made while the office is OPEN, by its owner, the way a person speaks through PostgREST.
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, true)`)
  const seeded = asObj(
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select app.say_in_project(${lit(S)}::uuid, ${lit(P)}::uuid, 'SEEDED QUESTION ${run}', null, '{}', ${lit(key)}) as r`,
      )
    ).r,
  )
  check(
    'the seeded turn was made while the office was open',
    seeded.ok === true,
    String(seeded.error ?? seeded.job),
  )
  await output(String(seeded.job), `SEEDED ANSWER ${run}`)
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, false)`)

  // Two visitors, each asks, each gets an answer.
  const say = async (visitor: string, text: string) =>
    asObj(
      (
        await one(
          `set local application_name = 'PostgREST 14.5'; select app.sample_say(${lit(S)}::uuid, ${lit(P)}::uuid, ${lit(text)}, ${lit(visitor)}, ${lit(key)}) as r`,
        )
      ).r,
    )
  const a = await say(VISITOR_A, `QUESTION FROM A ${run}`)
  const b = await say(VISITOR_B, `QUESTION FROM B ${run}`)
  check(
    'both visitors asked',
    a.ok === true && b.ok === true,
    `${String(a.error)} ${String(b.error)}`,
  )
  await output(String(a.job), `ANSWER TO A ${run}`)
  await output(String(b.job), `ANSWER TO B ${run}`)

  // The sample's own housekeeping, and the same thing in a person's office as the control.
  const house = async (office: string, project: string, body: string) => {
    const j = String(
      (
        await one(
          `insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority) values (${lit(office)}::uuid, gen_random_uuid(), ${lit(project)}::uuid, 'house-${run}-${project.slice(0, 6)}', 'office.provision_channels', 'hq', 300) returning job_id::text as id`,
        )
      ).id,
    )
    await output(j, body)
    return j
  }
  await house(S, P, `HOUSEKEEPING IN SAMPLE ${run}`)
  await house(op, PX, `HOUSEKEEPING IN A PERSON OFFICE ${run}`)

  // ---- 1. the Agentic Team list ------------------------------------------------------------------------------------
  const made_ = async (project: string) =>
    asList((await one(`select app.studio_requests(${lit(project)}::uuid, 20) as r`)).r)
      .map((x) => x.output?.body ?? '')
      .join(' | ')
  const sampleList = await made_(P)
  check(
    "the sample's own seeded team work is shown",
    sampleList.includes(`SEEDED ANSWER ${run}`),
    sampleList.slice(0, 80),
  )
  check(
    "a visitor's question and answer are NOT in the Agentic Team list",
    !sampleList.includes(`ANSWER TO A ${run}`) && !sampleList.includes(`ANSWER TO B ${run}`),
    sampleList.includes('ANSWER TO') ? 'visitor work is visible' : 'hidden',
  )
  check(
    "the sample's housekeeping is NOT shown as work the team made",
    !sampleList.includes('HOUSEKEEPING'),
    'hidden',
  )
  const personList = await made_(PX)
  check(
    'CONTROL: the same housekeeping in a PERSON office is still shown (the rule is for samples only)',
    personList.includes(`HOUSEKEEPING IN A PERSON OFFICE ${run}`),
    personList.slice(0, 70),
  )

  // ---- 2. the visitor's chat ---------------------------------------------------------------------------------------
  const chat = async (visitor: string, office = S, project = P) =>
    asList(
      (
        await one(
          `select app.sample_conversation(${lit(office)}::uuid, ${lit(project)}::uuid, ${lit(visitor)}, 50) as r`,
        )
      ).r,
    )
  const bodies = (l: { body?: string }[]) => l.map((m) => m.body ?? '').join(' | ')
  const cA = await chat(VISITOR_A)
  check(
    "visitor A reads the seeded thread, as the owner's persona and not as 'You'",
    cA.some((m) => m.body === `SEEDED QUESTION ${run}` && m.name === 'Jordan Reyes') &&
      cA.some((m) => m.body === `SEEDED ANSWER ${run}`),
    bodies(cA).slice(0, 90),
  )
  check(
    'and their own question and its answer, as You',
    cA.some((m) => m.body === `QUESTION FROM A ${run}` && m.name === 'You') &&
      cA.some((m) => m.body === `ANSWER TO A ${run}`),
    `${String(cA.length)} message(s)`,
  )
  check(
    'and nothing of visitor B',
    !bodies(cA).includes('FROM B') && !bodies(cA).includes('ANSWER TO B'),
    'B is not in A',
  )
  const cB = await chat(VISITOR_B)
  check(
    'visitor B reads the seeded thread and their own, and nothing of A',
    bodies(cB).includes(`SEEDED ANSWER ${run}`) &&
      bodies(cB).includes(`ANSWER TO B ${run}`) &&
      !bodies(cB).includes('FROM A') &&
      !bodies(cB).includes('ANSWER TO A'),
    `${String(cB.length)} message(s)`,
  )
  check(
    'a malformed visitor id reads nothing at all, not even the seeded thread',
    (await chat('short')).length === 0,
    '0 messages',
  )
  check(
    'a person office reads nothing through the sample door',
    (await chat(VISITOR_A, op, PX)).length === 0,
    '0 messages',
  )
  check(
    "the sample project's ordinary conversation reader is still empty",
    asList(
      (
        await one(
          `select app.conversation_history(${lit(S)}::uuid, ${lit(P)}::uuid, 50, null) as r`,
        )
      ).r,
    ).length === 0,
    '0 messages',
  )

  // ---- 2b. 0901: a sample shows only work that completed -----------------------------------------------------------
  // A seeded attempt that failed (made while open, like the real ones were), with the office's apology as its output.
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, true)`)
  const failedSeed = asObj(
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select app.say_in_project(${lit(S)}::uuid, ${lit(P)}::uuid, 'FAILED SEEDED QUESTION ${run}', null, '{}', ${lit(key)}) as r`,
      )
    ).r,
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, false)`)
  await output(String(failedSeed.job), `SEEDED APOLOGY ${run}`)
  await db.execute(
    `update public.jobs set state = 'failed' where job_id = ${lit(String(failedSeed.job))}::uuid`,
  )
  // A visitor whose OWN turn failed.
  const VISITOR_C = `c${run}${'w'.repeat(20)}`
  const c = await say(VISITOR_C, `QUESTION FROM C ${run}`)
  await output(String(c.job), `APOLOGY TO C ${run}`)
  await db.execute(
    `update public.jobs set state = 'failed' where job_id = ${lit(String(c.job))}::uuid`,
  )
  // The same shape in a person's office.
  const pj = String(
    (
      await one(
        `insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, state) values (${lit(op)}::uuid, gen_random_uuid(), ${lit(PX)}::uuid, 'fp-${run}', 'office.instruction', 'hq', 300, 'queued') returning job_id::text as id`,
      )
    ).id,
  )
  await output(pj, `FAILED IN A PERSON OFFICE ${run}`)
  await db.execute(`update public.jobs set state = 'failed' where job_id = ${lit(pj)}::uuid`)

  const list2 = await made_(P)
  check(
    "a sample's failed seeded work is NOT in the Agentic Team list",
    !list2.includes('SEEDED APOLOGY'),
    'hidden',
  )
  check('and the completed seeded work still is', list2.includes(`SEEDED ANSWER ${run}`), 'shown')
  check(
    'CONTROL: a failed job in a PERSON office is still listed (a person should be able to see it)',
    (await made_(PX)).includes(`FAILED IN A PERSON OFFICE ${run}`),
    'shown',
  )
  const cA2 = await chat(VISITOR_A)
  check(
    'the seeded thread leaves out the failed seeded question and its apology',
    !bodies(cA2).includes('FAILED SEEDED') &&
      !bodies(cA2).includes('SEEDED APOLOGY') &&
      bodies(cA2).includes(`SEEDED ANSWER ${run}`),
    `${String(cA2.length)} message(s)`,
  )
  const cC = await chat(VISITOR_C)
  check(
    "but a visitor's OWN failed turn still shows them the apology",
    bodies(cC).includes(`QUESTION FROM C ${run}`) && bodies(cC).includes(`APOLOGY TO C ${run}`),
    `${String(cC.length)} message(s)`,
  )

  // ---- 2c. 0903: the operator can leave out a completed turn that demonstrated nothing -----------------------------
  // The replica may predate the migration, so its own text is applied (idempotent: create or replace).
  await db.execute(
    await readFile(
      'migrations/0903_a_sample_can_leave_out_a_turn_that_did_not_demonstrate_anything.sql',
      'utf8',
    ),
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, true)`)
  const weak = asObj(
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select app.say_in_project(${lit(S)}::uuid, ${lit(P)}::uuid, 'WEAK SEEDED QUESTION ${run}', null, '{}', ${lit(key)}) as r`,
      )
    ).r,
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, false)`)
  await output(String(weak.job), `WEAK SEEDED ANSWER ${run}`)
  const weakTeam = (await made_(P)).includes(`WEAK SEEDED ANSWER ${run}`)
  const weakChat = bodies(await chat(VISITOR_A)).includes(`WEAK SEEDED ANSWER ${run}`)
  check(
    'before it is flagged, the weak turn is shown in both views',
    weakTeam && weakChat,
    `team list ${String(weakTeam)}, chat ${String(weakChat)}`,
  )
  await db.execute(
    `update public.inbound_commands set context = coalesce(context, '{}'::jsonb) || '{"showcase_hidden": true}'::jsonb where job_id = ${lit(String(weak.job))}::uuid`,
  )
  check(
    'flagged, it leaves the Agentic Team list and the thread, with its answer',
    !(await made_(P)).includes('WEAK SEEDED') &&
      !bodies(await chat(VISITOR_A)).includes('WEAK SEEDED'),
    'hidden',
  )
  check(
    'and the good seeded work beside it is still shown',
    (await made_(P)).includes(`SEEDED ANSWER ${run}`) &&
      bodies(await chat(VISITOR_A)).includes(`SEEDED ANSWER ${run}`),
    'shown',
  )
  // The flag on a visitor's own turn is ignored: a visitor can never lose their own answer.
  await db.execute(
    `update public.inbound_commands set context = context || '{"showcase_hidden": true}'::jsonb where job_id = ${lit(String(a.job))}::uuid`,
  )
  check(
    "a flag on a VISITOR's own turn is ignored",
    bodies(await chat(VISITOR_A)).includes(`ANSWER TO A ${run}`),
    'still shown to them',
  )

  // ---- 2d. 0904: a sample shows its own seeded work, not a scheduled run -------------------------------------------
  await db.execute(await readFile('migrations/0904_a_sample_shows_its_own_seeded_work.sql', 'utf8'))
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, true)`)
  const labelled = asObj(
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select app.say_in_project(${lit(S)}::uuid, ${lit(P)}::uuid, 'LABELLED SEEDED QUESTION ${run}', null, '{}', ${lit(key)}) as r`,
      )
    ).r,
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, false)`)
  await output(String(labelled.job), `LABELLED SEEDED ANSWER ${run}`)
  // The way the real seeded turns arrive: a voice session label the page did not mint, which 0598 calls harness.
  await db.execute(
    `update public.inbound_commands set dedupe_key = 'voice:turn:showcase-label:${run}' where job_id = ${lit(String(labelled.job))}::uuid`,
  )
  const isHarness = (await one(`select app.harness_job(${lit(String(labelled.job))}::uuid) as h`)).h
  check(
    'PRECONDITION: that seeded turn IS harness by the 0598 rule (so the exception is what shows it)',
    isHarness === true,
    String(isHarness),
  )
  check(
    "a sample's own seeded turn is shown even though its session label is harness",
    (await made_(P)).includes(`LABELLED SEEDED ANSWER ${run}`),
    'shown',
  )
  check(
    "and a visitor's turn is STILL hidden",
    !(await made_(P)).includes(`ANSWER TO B ${run}`),
    'hidden',
  )
  const duty = String(
    (
      await one(
        `insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority) values (${lit(S)}::uuid, gen_random_uuid(), ${lit(P)}::uuid, 'duty-${run}', 'office.instruction', 'duty:sample-auto', 300) returning job_id::text as id`,
      )
    ).id,
  )
  await output(duty, `SCHEDULED RUN ${run}`)
  check(
    "a sample's own scheduled run is not listed",
    !(await made_(P)).includes(`SCHEDULED RUN ${run}`),
    'hidden',
  )
  check(
    'CONTROL: the same scheduled run in a PERSON office IS listed',
    await (async () => {
      const pj = String(
        (
          await one(
            `insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority) values (${lit(op)}::uuid, gen_random_uuid(), ${lit(PX)}::uuid, 'duty-p-${run}', 'office.instruction', 'duty:person-auto', 300) returning job_id::text as id`,
          )
        ).id,
      )
      await output(pj, `PERSON SCHEDULED RUN ${run}`)
      return (await made_(PX)).includes(`PERSON SCHEDULED RUN ${run}`)
    })(),
    'shown',
  )
  const marked = String(
    (
      await one(
        `insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config) values (${lit(S)}::uuid, gen_random_uuid(), ${lit(P)}::uuid, 'mark-${run}', 'office.instruction', 'teamhq:sample', 300, '{"showcase_hidden": true}'::jsonb) returning job_id::text as id`,
      )
    ).id,
  )
  await output(marked, `MARKED JOB ${run}`)
  check(
    'a job the operator marked is not listed',
    !(await made_(P)).includes(`MARKED JOB ${run}`),
    'hidden',
  )

  // ---- 2e. 0905: one job from a hidden thread can be shown --------------------------------------------------------
  await db.execute(
    await readFile(
      'migrations/0905_a_sample_can_show_one_piece_of_work_from_a_hidden_thread.sql',
      'utf8',
    ),
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, true)`)
  const thread = asObj(
    (
      await one(
        `set local application_name = 'PostgREST 14.5'; select app.say_in_project(${lit(S)}::uuid, ${lit(P)}::uuid, 'REPORT THREAD QUESTION ${run}', null, '{}', ${lit(key)}) as r`,
      )
    ).r,
  )
  await db.execute(`select app.sample_office_open(${lit(S)}::uuid, false)`)
  await output(String(thread.job), `CONTRADICTORY THREAD ANSWER ${run}`)
  const child = String(
    (
      await one(
        `insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority, parent_job_id, root_job_id) select office_id, correlation_id, project_id, 'report-${run}', 'artifact.report', requested_by, priority, job_id, job_id from public.jobs where job_id = ${lit(String(thread.job))}::uuid returning job_id::text as id`,
      )
    ).id,
  )
  await output(child, `THE MADE REPORT ${run}`)
  await db.execute(
    `update public.inbound_commands set dedupe_key = 'voice:turn:showcase-report:${run}', context = coalesce(context, '{}'::jsonb) || '{"showcase_hidden": true}'::jsonb where job_id = ${lit(String(thread.job))}::uuid`,
  )
  const hiddenTeam = await made_(P)
  check(
    'a thread left out of the demonstration hides its report as well (the defect 0905 answers)',
    !hiddenTeam.includes(`THE MADE REPORT ${run}`) &&
      !hiddenTeam.includes(`CONTRADICTORY THREAD ANSWER ${run}`),
    'both hidden',
  )
  await db.execute(
    `update public.jobs set pinned_config = pinned_config || '{"showcase_shown": true}'::jsonb where job_id = ${lit(child)}::uuid`,
  )
  const shownTeam = await made_(P)
  check(
    'marked as one to show, the report is listed',
    shownTeam.includes(`THE MADE REPORT ${run}`),
    'shown',
  )
  check(
    'and the contradictory answer beside it stays hidden',
    !shownTeam.includes(`CONTRADICTORY THREAD ANSWER ${run}`),
    'hidden',
  )
  check(
    'and the thread stays out of the chat',
    !bodies(await chat(VISITOR_A)).includes(`THE MADE REPORT ${run}`) &&
      !bodies(await chat(VISITOR_A)).includes(`CONTRADICTORY THREAD ANSWER ${run}`),
    'hidden',
  )
  // A mark cannot show a failed attempt: the sample's completed-only rule still applies.
  await db
    .execute(`update public.jobs set state = 'failed' where job_id = ${lit(child)}::uuid`)
    .catch(() => undefined)
  const stateNow = (await one(`select state from public.jobs where job_id = ${lit(child)}::uuid`))
    .state
  if (stateNow === 'failed')
    check(
      'a job marked to show is still not listed when it failed',
      !(await made_(P)).includes(`THE MADE REPORT ${run}`),
      'hidden',
    )
  else
    console.log(
      `     (the failed-state control did not apply here: ${String(stateNow)}; the rule is proved in 2b)`,
    )
  // The mark does nothing in a person's office: nobody is left out there, so the report is simply listed either way.
  // (Nothing to prove beyond the 2d control, which shows a person's own work is listed with no mark at all.)

  // ---- 3. SABOTAGE: take harness_job away and the visitor's turn must show up --------------------------------------
  await db.execute('savepoint sab')
  await db.execute(`alter function app.harness_job(uuid) rename to harness_job_real`)
  await db.execute(
    `create function app.harness_job(p_job uuid) returns boolean language sql as $$ select false $$`,
  )
  const sabotaged = await made_(P)
  check(
    'SABOTAGE: with harness_job answering false, the visitor turn appears (so the check above can fail)',
    sabotaged.includes(`ANSWER TO A ${run}`),
    sabotaged.includes('ANSWER TO A')
      ? 'visible, as it must be'
      : 'STILL HIDDEN - the filter is not what hides it',
  )
  await db.execute('rollback to savepoint sab')
  check(
    'restored: the visitor turn is hidden again',
    !(await made_(P)).includes(`ANSWER TO A ${run}`),
    'hidden',
  )
} finally {
  await db.execute('rollback').catch(() => undefined)
}
const passed = results.filter(Boolean).length
console.log(`\n${String(passed)}/${String(results.length)} passed`)
process.exit(passed === results.length ? 0 : 1)
