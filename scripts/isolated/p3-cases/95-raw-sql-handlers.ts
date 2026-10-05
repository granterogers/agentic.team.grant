/**
 * The inline SQL of the handlers and agents, confined to the claimed job's office (multi-user P3, raw-SQL ratchet).
 *
 * The function conversions fixed database functions; the TypeScript layer also issues statements that read or write an
 * owned table directly. Each runs inside ONE claimed job (or one press, one workspace) whose office is fixed, so each has
 * to be confined to that office in the SQL itself. This file calls the REAL exported TypeScript functions against the
 * clone, as Person A, with Person B holding the same kind of data under distinct canary text, and asserts:
 *
 *   - B's canary and B's ids never appear in what A is given (and A's own does - a reader returning nothing proves
 *     nothing),
 *   - B's rows are byte-identical afterwards (ctx.snapshot),
 *   - the other direction too, where it is cheap.
 *
 * Sites inside closures that cannot be called from outside are covered by the source-level property test
 * tests/handlers/raw-sql-names-the-claimed-office.test.ts, and the ratchet (npm run check:office-raw-sql).
 */
import { guidanceFor } from '../../../src/agents/guidance.ts'
import { EXECUTORS } from '../../../src/agents/perform.ts'
import { remember } from '../../../src/agents/remember.ts'
import { recordDecision, route, scanForDuplicates } from '../../../src/agents/router.ts'
import { readTeaching } from '../../../src/agents/teaching.ts'
import { generateBriefing } from '../../../src/briefings/compose.ts'
import { processCallbacks } from '../../../src/channels/callbacks.ts'
import { applyPreference, clearPreference } from '../../../src/channels/preference-store.ts'
import { parseInstruction } from '../../../src/channels/preferences.ts'
import { CAPACITY_WINDOW_SQL } from '../../../src/handlers/capacity.ts'
import { raiseBlocker, recordUsage } from '../../../src/inference/record.ts'
import { SlackClient } from '../../../src/slack/api.ts'
import { narrateHandoffs, narrateOutcomes } from '../../../src/slack/narrate.ts'
import { resolveTarget } from '../../../src/slack/notifier.ts'
import type { SlackOffice } from '../../../src/slack/office.ts'
import { ChannelProvisioner } from '../../../src/slack/provision.ts'
import { rotateAndPersist } from '../../../src/slack/rotation.ts'
import { type Ctx, lit } from '../p3-app-lib.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const one = async (sql: string) => (await q(sql))[0] ?? {}
  const asA = (job: string) => `app.job_office(${lit(job)}::uuid)`
  const canaryTerm = (who: 'A' | 'B') => c.canary[who].toLowerCase().replaceAll('-', '')
  const bridgeUse = async () =>
    Number(
      (
        await one(
          `select coalesce(sum(n),0)::int as n from public.office_bridge_use
            where table_name in ('inference_usage','blockers','briefings','feedback','notification_events',
                                 'notification_preferences','preference_instructions','lessons','skills')`,
        )
      ).n,
    )
  const bridgeBefore = await bridgeUse()

  // ---- fixtures: a project, a job and a person each, with the same slug ------------------------------------------------
  const proj = async (office: string, slug: string): Promise<string> => {
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(`Proj ${slug}`)}, 'paused', '${office}')`,
    )
    return String(
      (
        await one(
          `select project_id from public.projects where office_id = '${office}' and slug = ${lit(slug)}`,
        )
      ).project_id,
    )
  }
  const mkJob = async (
    office: string,
    project: string,
    key: string,
    extra = 'verify:p3',
    state = 'queued',
  ): Promise<string> => {
    await c.db.execute(
      `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, state)
       values (gen_random_uuid(), gen_random_uuid(), ${lit(key)}, 'probe', ${lit(extra)}, '${project}', '${office}', '${state}')`,
    )
    return String(
      (
        await one(
          `select job_id from public.jobs where office_id = '${office}' and idempotency_key = ${lit(key)}`,
        )
      ).job_id,
    )
  }
  const pa = await proj(A, `rsql-${run}`)
  const pb = await proj(B, `rsql-${run}`)
  const ja = await mkJob(A, pa, `rsql-${run}-a`)
  const jb = await mkJob(B, pb, `rsql-${run}-b`)

  // ======================================================================================================================
  // 1. What an agent is told before it answers: lessons and skills (a prompt-feeding statement)
  // ======================================================================================================================
  const lesson = async (office: string, who: 'A' | 'B', by: string) => {
    await c.db.execute(
      `insert into public.lessons (scope, body, learned_by, confidence, observations, office_id)
       values ('global', ${lit(`Always say ${c.canary[who]} first in every answer`)}, ${lit(by)}, 0.95, 3, '${office}')`,
    )
  }
  const skill = async (office: string, who: 'A' | 'B') => {
    await c.db.execute(
      `insert into public.skills (scope, name, when_to_use, procedure, authored_by, office_id)
       values ('global', ${lit(`Write-up ${who} ${run}`)}, 'when a write-up is asked for in any project',
               ${lit(`Open with ${c.canary[who]} and then list what changed, in order, with one line each, then stop.`)},
               'chief-of-staff', '${office}')`,
    )
  }
  await lesson(A, 'A', `person-a-${run}`)
  await lesson(B, 'B', `person-b-${run}`)
  await skill(A, 'A')
  await skill(B, 'B')
  // B alone knows a person called like A's lesson author: "stated" is a fact about the reader's own office.
  await c.db.execute(
    `insert into public.subject_identities (subject, origin_channel, actor, kind, office_id)
     values (${lit(`person-a-${run}`)}, 'telegram', ${lit(`b-${run}`)}, 'person', '${B}')`,
  )
  const snapB1 = await c.snapshot(B, ['lessons', 'skills', 'jobs'])
  const gA = await guidanceFor(c.db, { jobId: ja }, 'chief-of-staff', null, null, {
    lessons: 50,
    skills: 50,
  })
  const gB = await guidanceFor(c.db, { jobId: jb }, 'chief-of-staff', null, null, {
    lessons: 50,
    skills: 50,
  })
  c.check(
    gA.lessons.some((l) => l.body.includes(c.canary.A)) &&
      gA.skills.some((s) => s.procedure.includes(c.canary.A)),
    "A's prompt is given A's own lessons and skills (a reader returning nothing proves nothing)",
    `${String(gA.lessons.length)} lessons, ${String(gA.skills.length)} skills`,
  )
  c.check(
    !gA.lessons.some((l) => l.body.includes(c.canary.B)) &&
      !gA.skills.some((s) => s.procedure.includes(c.canary.B)),
    "A's prompt is never given B's lessons or skills, although both are global in scope",
    '',
  )
  c.check(
    gB.lessons.some((l) => l.body.includes(c.canary.B)) &&
      !gB.lessons.some((l) => l.body.includes(c.canary.A)),
    'and the same the other way round',
    '',
  )
  c.check(
    gA.lessons.find((l) => l.body.includes(c.canary.A))?.stated === false,
    "a lesson is 'stated' only when its author is a person of the READER's office (B's identity row does not make A's lesson his order)",
    '',
  )
  c.check(
    (await c.snapshot(B, ['lessons', 'skills', 'jobs'])) === snapB1,
    "reading guidance wrote nothing in B's office",
    '',
  )

  // ======================================================================================================================
  // 2. The duplicate scan: live jobs of one office only (its candidates are linked and recorded)
  // ======================================================================================================================
  const scanText = `research the ${canaryTerm('A')} ${canaryTerm('B')} procurement approach`
  const jla = await mkJob(A, pa, `rsql-${run}-la`)
  const jlb = await mkJob(B, pb, `rsql-${run}-lb`)
  for (const job of [jla, jlb]) {
    const scan = await scanForDuplicates(c.db, scanText, { office: asA(job) })
    await recordDecision(c.db, job, route(scanText, scan))
  }
  const scanA = await scanForDuplicates(c.db, scanText, { office: asA(ja) })
  const scanB = await scanForDuplicates(c.db, scanText, { office: asA(jb) })
  c.check(
    scanA.candidates.some((x) => x.jobId === jla) && !scanA.candidates.some((x) => x.jobId === jlb),
    "the duplicate scan for A finds A's live job and never B's (B's routing decision shares every term)",
    c.json(scanA.candidates.map((x) => x.jobId === jla)),
  )
  c.check(
    scanB.candidates.some((x) => x.jobId === jlb) && !scanB.candidates.some((x) => x.jobId === jla),
    'and the same the other way round',
    '',
  )

  // ======================================================================================================================
  // 3. Usage and blockers are written against the claimed job's office, explicitly
  // ======================================================================================================================
  const snapB3 = await c.snapshot(B, ['inference_usage', 'blockers', 'jobs'])
  // other cases in the same clone raise blockers in both offices: the capacity window is compared before and after
  const dayA0 = await one(CAPACITY_WINDOW_SQL(asA(ja)))
  const dayB0 = await one(CAPACITY_WINDOW_SQL(asA(jb)))
  const corr = String(
    (await one(`select correlation_id from public.jobs where job_id = '${ja}'`)).correlation_id,
  )
  await recordUsage(c.db, {
    provider: 'openrouter',
    modelId: 'p3-model',
    correlationId: corr,
    jobId: ja,
    outcome: 'ok',
    providerReportedCost: null,
  })
  const usage = await one(
    `select office_id::text as o from public.inference_usage where job_id = '${ja}' and model_id = 'p3-model'`,
  )
  c.check(
    usage.o === A,
    'a usage record is filed under the office of the job it was spent for',
    String(usage.o),
  )
  const blocked = await raiseBlocker(c.db, {
    requestedAction: `Approve the ${c.canary.A} thing`,
    whyNeeded: 'because a probe says so, at some length',
    consequencesOfDelay: 'nothing happens',
    approvalOptions: ['Yes', 'No'],
    originatingAgent: 'chief-of-staff',
    workCanContinue: true,
    projectId: pa,
    jobId: ja,
  })
  c.check(
    (await one(`select office_id::text as o from public.blockers where blocker_id = '${blocked}'`))
      .o === A,
    "a question raised by A's job is A's",
    '',
  )
  const ghost = await raiseBlocker(c.db, {
    requestedAction: 'Approve a ghost',
    whyNeeded: 'a job that does not exist',
    consequencesOfDelay: 'nothing',
    approvalOptions: ['Yes'],
    originatingAgent: 'chief-of-staff',
    workCanContinue: true,
    jobId: c.nobody(),
  }).then(
    () => 'accepted',
    (e: Error) => e.message,
  )
  c.check(
    ghost.includes('no_office'),
    'a question for a job that has no office is refused outright, not filed under a default',
    ghost.slice(0, 80),
  )
  c.check(
    (await c.snapshot(B, ['inference_usage', 'blockers', 'jobs'])) === snapB3,
    "none of it touched B's office",
    '',
  )

  // ======================================================================================================================
  // 4. A briefing is written for the office it is generated for (the unique key is global: reported, not widened)
  // ======================================================================================================================
  const date = '2031-02-03'
  const snapB4 = await c.snapshot(B, ['briefings'])
  const bA = await generateBriefing(c.db, 'morning', date, null, A).then(
    (x) => x,
    (e: Error) => `error: ${e.message}`,
  )
  c.check(
    typeof bA !== 'string',
    'generateBriefing runs for A in A',
    typeof bA === 'string' ? bA.slice(0, 200) : '',
  )
  const rowsA = await q(
    `select office_id::text as o, scope_ref from public.briefings where for_date = '${date}' and office_id = '${A}'`,
  )
  c.check(
    rowsA.length === 1 && rowsA[0]?.scope_ref !== 'grant',
    "the briefing is A's and is addressed to A's own person, never to the literal 'grant'",
    String(rowsA[0]?.scope_ref),
  )
  c.check((await c.snapshot(B, ['briefings'])) === snapB4, "and B's briefings did not move", '')

  // ======================================================================================================================
  // 5. Notification preferences: the office comes from the press / job, the person from the office
  // ======================================================================================================================
  const subj = `subj-${run}`
  const snapB5 = await c.snapshot(B, ['notification_preferences', 'preference_instructions'])
  await applyPreference(c.db, parseInstruction('leave me alone today'), {
    office: B,
    subject: subj,
    originChannel: 'telegram',
    instruction: 'mute 24h (B)',
  })
  const snapB5b = await c.snapshot(B, ['notification_preferences', 'preference_instructions'])
  await applyPreference(c.db, parseInstruction('only tell me about important things'), {
    office: A,
    subject: subj,
    originChannel: 'telegram',
    instruction: 'only important (A)',
  })
  c.check(
    (await c.snapshot(B, ['notification_preferences', 'preference_instructions'])) === snapB5b,
    "A setting a preference for the same subject name does not overwrite B's row (the unique key is global: the guarded upsert does nothing)",
    '',
  )
  const own = await q(
    `select office_id::text as o from public.preference_instructions where instruction = 'only important (A)'`,
  )
  c.check(
    own.length === 1 && own[0]?.o === A,
    "the audit row is A's, filed under A",
    String(own[0]?.o),
  )
  const withoutSubject = await applyPreference(c.db, parseInstruction('leave me alone today'), {
    office: A,
    originChannel: 'telegram',
    instruction: 'mute (A, no subject)',
  })
  const defaulted = await one(
    `select subject from public.preference_instructions where instruction_id = '${withoutSubject.instructionId}'`,
  )
  c.check(
    defaulted.subject === (await one(`select app.office_actor('${A}') as s`)).s &&
      defaulted.subject !== 'grant',
    "with no subject named, the person is the office's own - never the literal 'grant'",
    String(defaulted.subject),
  )
  await clearPreference(c.db, A, subj)
  c.check(
    (await c.snapshot(B, ['notification_preferences'])) !== snapB5 &&
      Number(
        (
          await one(
            `select count(*)::int as n from public.notification_preferences where office_id = '${B}' and subject = ${lit(subj)}`,
          )
        ).n,
      ) === 1,
    "clearing A's preference for that subject leaves B's row standing",
    '',
  )

  // ======================================================================================================================
  // 6. A button press is handled inside the office of the press itself
  // ======================================================================================================================
  const origin = { chat: '777000111', ts: '4242' }
  const mkPress = async (
    office: string,
    job: string,
    project: string,
    tag: string,
    receivedAt: string,
  ) => {
    // the SAME chat and message id in both offices: only the office predicate tells the two deliveries apart
    await c.db.execute(
      `insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, purpose, state, lease_expires_at,
                                      message_ref, sent_at, office_id, correlation_id)
       select 'telegram', ${lit(`press:${run}:${tag}`)}, 'bot-p3', ${lit(origin.chat)}, '${job}', 'result', 'sent',
              app.now_utc(), ${lit(origin.ts)}, app.now_utc(), '${office}', correlation_id from public.jobs where job_id = '${job}'`,
    )
    await c.db.execute(
      `insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic)
       values ('${job}', ${lit(`answer ${tag}`)}, 'high', 'verified', '["job:x"]'::jsonb, true)`,
    )
    await c.db.execute(
      // 'grant' is a principal the office knows (app.principal_known): the press is taken as a person's, which is the
      // path under test; the office predicate, not the principal, is what separates the two deliveries
      `insert into public.inbound_commands (origin_channel, origin_ref, actor, subject, instruction, callback_action, dedupe_key, project_id, office_id, received_at)
       values ('telegram', ${lit(`${origin.chat}:${origin.ts}`)}, ${lit(origin.chat)}, 'grant', '', 'useful', ${lit(`telegram:callback:press${tag}${run}`)}, '${project}', '${office}', ${lit(receivedAt)})`,
    )
  }
  // The clone is a copy of the replica and may hold presses nobody processed: settle them first, so that "the oldest
  // pending press" is the one this section made (the clone is throwaway; production is never touched).
  await c.db.execute(
    `update public.inbound_commands set processed_at = app.now_utc() where callback_action is not null and processed_at is null`,
  )
  // jobs of their own: a job with a recorded inference attempt cannot carry a deterministic output (section 3 spent one)
  const pressA = await mkJob(A, pa, `rsql-${run}-press-a`)
  const pressB = await mkJob(B, pb, `rsql-${run}-press-b`)
  await mkPress(A, pressA, pa, 'a', '2031-01-01T00:00:00Z')
  await mkPress(B, pressB, pb, 'b', '2031-01-01T00:00:01Z')
  const outA = await one(
    `select output_id::text as o from public.outputs where job_id = '${pressA}' order by created_at desc limit 1`,
  )
  const outB = await one(
    `select output_id::text as o from public.outputs where job_id = '${pressB}' order by created_at desc limit 1`,
  )
  if (outA.o === undefined || outB.o === undefined) {
    c.check(
      false,
      'the press fixtures could be built (an output for each job)',
      'no output row could be inserted',
    )
  } else {
    const pressTables = [
      'feedback',
      'notification_events',
      'inbound_commands',
      'deliveries',
      'jobs',
    ]
    const snapB6 = await c.snapshot(B, pressTables)
    const done1 = await processCallbacks(c.db, { limit: 1 })
    const fbA = await q(
      `select office_id::text as o, subject_ref::text as r from public.feedback where subject_ref in ('${outA.o}', '${outB.o}')`,
    )
    c.check(
      done1.length === 1 && fbA.length === 1 && fbA[0]?.o === A && fbA[0]?.r === outA.o,
      "A's press (the older) resolves to A's output only, although B holds a delivery on the same chat and message id",
      c.json(fbA),
    )
    c.check(
      (await c.snapshot(B, pressTables)) === snapB6,
      "and nothing of B's moved - B's own press is still waiting",
      '',
    )
    const done2 = await processCallbacks(c.db, { limit: 1 })
    const fbB = await q(
      `select office_id::text as o, subject_ref::text as r from public.feedback where subject_ref = '${outB.o}'`,
    )
    c.check(
      done2.length === 1 && fbB.length === 1 && fbB[0]?.o === B,
      "B's press, processed next, is recorded against B's output under B",
      c.json(fbB),
    )
    c.check(
      !(
        await q(
          `select 1 from public.feedback where office_id = '${A}' and subject_ref = '${outB.o}'`,
        )
      ).length,
      "no feedback of A's names B's output",
      '',
    )
  }

  // ======================================================================================================================
  // 7. The capacity report counts one office's day
  // ======================================================================================================================
  const dayA = await one(CAPACITY_WINDOW_SQL(asA(ja)))
  const dayB = await one(CAPACITY_WINDOW_SQL(asA(jb)))
  c.check(
    Number(dayA.blockers) - Number(dayA0.blockers) === 1 &&
      Number(dayB.blockers) - Number(dayB0.blockers) === 0,
    "the blocker A's job raised is counted for A and not for B (the window moved by one in A and by none in B)",
    c.json([
      Number(dayA.blockers) - Number(dayA0.blockers),
      Number(dayB.blockers) - Number(dayB0.blockers),
    ]),
  )
  // The property, not a comparison with the deployment's total (which equals A's own when no other office holds one):
  // each office's window is exactly the open questions that office holds.
  const openQuestionsOf = async (office: string) =>
    Number(
      (
        await one(
          `select count(*)::int as n from public.blockers where state = 'open' and office_id = '${office}'`,
        )
      ).n,
    )
  c.check(
    Number(dayA.blockers) === (await openQuestionsOf(A)) &&
      Number(dayB.blockers) === (await openQuestionsOf(B)),
    "the capacity window answers each office's own count of open questions, not the deployment's",
    c.json([dayA.blockers, await openQuestionsOf(A), dayB.blockers, await openQuestionsOf(B)]),
  )

  // ======================================================================================================================
  // 8. The 'db.read' step reads the claimed job's office
  // ======================================================================================================================
  const read = EXECUTORS['db.read']
  if (read === undefined) {
    c.check(false, "the 'db.read' executor is exported", '')
  } else {
    await c.db.execute(
      `insert into public.tasks (title, project_id, office_id, detail, added_by) values (${lit(`task ${c.canary.B}`)}, '${pb}', '${B}', '', 'verify:p3')`,
    )
    c.check(
      Number(
        (
          await one(
            `select count(*)::int as n from public.tasks where project_id = '${pb}' and title like ${lit(`%${c.canary.B}%`)}`,
          )
        ).n,
      ) === 1,
      "precondition: B's project really holds a task carrying B's canary (so reading nothing is the office predicate's doing)",
      '',
    )
    const mine = await read.run({ db: c.db, jobId: ja, projectId: pa } as never)
    const foreign = await read.run({ db: c.db, jobId: ja, projectId: pb } as never)
    c.check(
      !JSON.stringify(foreign).includes(c.canary.B) &&
        (foreign as { found?: boolean }).found === false,
      "a project id of B's read by A's job finds nothing - exactly what a missing project reads",
      c.json((foreign as { saw?: string }).saw),
    )
    c.check(
      (mine as { found?: boolean }).found !== undefined,
      "and A's own project is read (control)",
      '',
    )
  }

  // ======================================================================================================================
  // 9. Standing rules are withdrawn inside the office that holds them
  // ======================================================================================================================
  const RULE = 'From now on, always paste the screenshot links into every reply you send me.'
  const WITHDRAW = 'Stop putting the screenshot links in the replies any more, everywhere.'
  const teach = (said: string) => {
    const t = readTeaching(said)
    if (t === null) throw new Error(`not a teaching: ${said}`)
    return t
  }
  const byB = `person-b-rule-${run}`
  const byA = `person-a-rule-${run}`
  // Real traffic (a person's turn): the lessons reader leaves out whatever a harness job taught, so a rule taught from a
  // suite's job would be invisible to the very lookup under test.
  const ruleA = await mkJob(A, pa, `rsql-${run}-rule-a`, 'teamhq:person')
  const ruleB = await mkJob(B, pb, `rsql-${run}-rule-b`, 'teamhq:person')
  // stated with no project in scope, which is how a global rule is made
  await remember(c.db, { jobId: ruleB }, teach(RULE), byB, null, ruleB, null)
  const liveB = async () =>
    Number(
      (
        await one(
          `select count(*)::int as n from public.lessons_live v join public.lessons l on l.lesson_id = v.lesson_id
            where l.office_id = '${B}' and l.learned_by = ${lit(byB)}`,
        )
      ).n,
    )
  c.check(
    (await liveB()) >= 1,
    "B's standing rule is stored and live (control: the lookup has something to find)",
    String(await liveB()),
  )
  const snapB9 = await c.snapshot(B, ['lessons'])
  const said = await remember(c.db, { jobId: ruleA }, teach(WITHDRAW), byA, null, ruleA, pa)
  c.check(
    (await liveB()) >= 1 && (await c.snapshot(B, ['lessons'])) === snapB9,
    "A withdrawing 'the screenshot links' everywhere retires nothing of B's, although B's rule is global and says the same",
    said.said.slice(0, 120),
  )
  // Control, without the retraction (the retract function is a database function outside this file's share): the
  // same sentence, not saying "everywhere", from B's own job names B's rule - the lookup finds it inside its office.
  const softB = await remember(
    c.db,
    { jobId: ruleB },
    teach('Stop putting the screenshot links in the replies any more.'),
    byB,
    null,
    ruleB,
    pb,
  )
  c.check(
    softB.said.includes('screenshot links') && softB.said.includes('for everything'),
    "control: the same withdrawal from B's own job finds and names B's rule (the lookup works inside its office)",
    softB.said.slice(0, 120),
  )
  const softA = await remember(
    c.db,
    { jobId: ruleA },
    teach('Stop putting the screenshot links in the replies any more.'),
    byA,
    null,
    ruleA,
    pa,
  )
  c.check(
    !softA.said.includes('screenshot links'),
    "and from A's job the same sentence names nothing - B's rule is not A's to quote back",
    softA.said.slice(0, 120),
  )

  // ======================================================================================================================
  // 10. The Slack floor channel narrates ONE office's day, into that office's workspace
  // ======================================================================================================================
  const TA = `T0A${run.toUpperCase().replaceAll(/[^A-Z0-9]/g, 'X')}P3`
  const TB = `T0B${run.toUpperCase().replaceAll(/[^A-Z0-9]/g, 'X')}P3`
  for (const [team, office] of [
    [TA, A],
    [TB, B],
  ] as const) {
    await c.db.execute(
      `insert into public.slack_workspaces (team_id, team_name, bot_user_id, office_id) values (${lit(team)}, ${lit(`ws ${team}`)}, 'U0P3BOT01', '${office}')`,
    )
  }
  const slackStub = (channelId: string) => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      const method = String(url).split('/').pop() ?? ''
      calls.push(method)
      const body =
        method === 'conversations.create'
          ? { ok: true, channel: { id: channelId, name: 'the_floor' } }
          : { ok: true }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    return {
      slack: new SlackClient(['xoxb', 'p3-not-a-token'].join('-'), {
        fetchImpl,
        sleep: async () => {},
      }),
      calls,
    }
  }
  const spoken: { jobId: string; body: string; teamId: string }[] = []
  const floorOffice = {
    deliver: async (m: { jobId: string; teamId: string; message: { body: string } }) => {
      spoken.push({ jobId: m.jobId, body: m.message.body, teamId: m.teamId })
      return { outcome: 'sent' }
    },
  } as unknown as SlackOffice
  // Real-looking jobs (a person's turn, not a suite's), each with a routing decision and its own words.
  const realJob = async (office: string, project: string, key: string, words: string) => {
    const id = await mkJob(office, project, key, 'teamhq:person')
    await c.db.execute(
      `update public.jobs set pinned_config = jsonb_build_object('instruction', ${lit(words)}) where job_id = '${id}'`,
    )
    const text = `please look into ${words}`
    await recordDecision(
      c.db,
      id,
      route(text, await scanForDuplicates(c.db, text, { office: asA(id) })),
    )
    return id
  }
  const nA = await realJob(A, pa, `rsql-${run}-nar-a`, `the ${c.canary.A} renewal`)
  const nB = await realJob(B, pb, `rsql-${run}-nar-b`, `the ${c.canary.B} renewal`)
  const real = await q(
    `select job_id::text as j, app.harness_job(job_id) as h from public.jobs where job_id in ('${nA}', '${nB}')`,
  )
  c.check(
    real.length === 2 && real.every((r) => r.h === false),
    "the narrated jobs are real traffic by the product's own predicate (a fixture that was harness would prove nothing)",
    c.json(real.map((r) => r.h)),
  )
  const { slack: floorSlack } = slackStub('C0P3FLOORA1')
  const heard = await narrateHandoffs(c.db, floorSlack, floorOffice, TA, 50)
  const mineSpoken = spoken.filter((s) => s.teamId === TA)
  c.check(
    mineSpoken.some((s) => s.jobId === nA && s.body.includes(c.canary.A)),
    "A's floor channel narrates A's own job, in A's own words (control)",
    String(heard.length),
  )
  c.check(
    !spoken.some((s) => s.jobId === nB || s.body.includes(c.canary.B)),
    "and never B's job nor B's words - the sweep reads one office, because it posts a job's instruction",
    c.json(spoken.map((s) => s.jobId === nB)),
  )
  // outcomes: a finished job narrated earlier is threaded; B's finished job is not A's to tell
  for (const [job, office, tag] of [
    [nA, A, 'a'],
    [nB, B, 'b'],
  ] as const) {
    await c.db.execute(
      `insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, purpose, state, lease_expires_at, message_ref, sent_at, office_id)
       values ('slack', ${lit(`narration:${job}`)}, 'slack-p3', 'C0P3FLOORA1', '${job}', 'notice', 'sent', app.now_utc(), '1700000000.0001', app.now_utc(), '${office}')`,
    )
    await c.db.execute(
      `insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic)
       values ('${job}', ${lit(`the answer on ${c.canary[tag === 'a' ? 'A' : 'B']}`)}, 'high', 'verified', '["job:x"]'::jsonb, false)`,
    )
    // The lifecycle triggers walk a job through its states; the clone is throwaway, so the fixture steps over them.
    await c.db.execute(
      `begin; set local session_replication_role = replica;
       update public.jobs set state = 'complete', started_at = app.now_utc(), finished_at = app.now_utc() where job_id = '${job}';
       commit`,
    )
  }
  spoken.length = 0
  await narrateOutcomes(c.db, floorSlack, floorOffice, TA, 50)
  c.check(
    spoken.some((s) => s.jobId === nA) &&
      !spoken.some((s) => s.jobId === nB || s.body.includes(c.canary.B)),
    "A's outcomes narration tells A's finished job and never B's (nor B's answer text)",
    c.json(spoken.map((s) => s.jobId === nA)),
  )

  // ======================================================================================================================
  // 11. A channel is provisioned for a project of the workspace's own office only
  // ======================================================================================================================
  const tmapB = async () =>
    c.json(
      (
        await q(
          `select channel_id, project_id, channel_name, active from public.slack_channel_map where team_id = ${lit(TB)} order by channel_id`,
        )
      ).map((r) => ({ ...r })),
    )
  const sB = slackStub('C0P3PROJB001')
  const madeB = await new ChannelProvisioner(c.db, sB.slack, TB).ensureChannel(pb, `proj b ${run}`)
  c.check(
    madeB.outcome === 'created',
    "B's workspace makes a channel for B's project (control)",
    madeB.outcome,
  )
  const mapBefore = await tmapB()
  const sA = slackStub('C0P3PROJA001')
  const provA = new ChannelProvisioner(c.db, sA.slack, TA)
  const foreignTry = await provA.ensureChannel(pb, `proj b ${run}`)
  c.check(
    foreignTry.outcome === 'failed' &&
      foreignTry.errorCode === 'no_such_project' &&
      !sA.calls.includes('conversations.create'),
    "A's workspace asked to make a channel for B's project makes nothing in Slack and says 'no such project'",
    `${foreignTry.outcome} ${String(foreignTry.errorCode)}`,
  )
  const missingTry = await provA.ensureChannel(c.nobody(), 'nobody')
  c.check(
    missingTry.outcome === foreignTry.outcome && missingTry.errorCode === foreignTry.errorCode,
    'a foreign project and a nonexistent project get the same answer',
    '',
  )
  c.check(
    (await provA.hasChannel(pb)) === false,
    "A's workspace does not see B's project as having a channel",
    '',
  )
  c.check((await provA.hasChannel(pa)) === false, "control: and A's own project has none yet", '')
  const madeA = await provA.ensureChannel(pa, `proj a ${run}`)
  c.check(
    madeA.outcome === 'created' && (await provA.hasChannel(pa)) === true,
    "A's project gets its channel in A's workspace",
    madeA.outcome,
  )
  // the same Slack channel id offered to two workspaces: the second may not rebind the first's row
  const clash = new ChannelProvisioner(c.db, slackStub('C0P3PROJB001').slack, TA)
  await clash.ensureNamedChannel(`clash_${run}`, 'general').catch(() => undefined)
  c.check(
    (await tmapB()) === mapBefore,
    "B's channel mappings are byte-identical after everything A's workspace did",
    '',
  )

  // ======================================================================================================================
  // 12. Replying inside a Slack thread: only the claimed job's office's commands count
  // ======================================================================================================================
  const shared = String(
    (await one(`select correlation_id from public.jobs where job_id = '${ja}'`)).correlation_id,
  )
  const jbShare = await mkJob(B, pb, `rsql-${run}-share-b`)
  await c.db.execute(
    `update public.jobs set correlation_id = '${shared}' where job_id = '${jbShare}'`,
  )
  const cmd = async (
    office: string,
    project: string,
    job: string,
    tag: string,
    channel: string,
    at: string,
  ) => {
    await c.db.execute(
      `insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id, office_id, job_id, received_at)
       values ('slack', ${lit(`${channel}:${tag}`)}, ${lit(`U0${tag}`)}, 'hello', ${lit(`slack:event:${tag}${run}`)}, '${project}', '${office}', '${job}', ${lit(at)})`,
    )
    const id = String(
      (
        await one(
          `select command_id from public.inbound_commands where dedupe_key = ${lit(`slack:event:${tag}${run}`)}`,
        )
      ).command_id,
    )
    await c.db.execute(
      `insert into public.inbound_commands_slack (command_id, team_id, channel_id, thread_ts) values ('${id}', ${lit(office === A ? TA : TB)}, ${lit(channel)}, null)`,
    )
  }
  await cmd(A, pa, ja, 'AA1', 'C0P3THREADA', '2031-05-01T00:00:00Z')
  await cmd(B, pb, jbShare, 'BB1', 'C0P3THREADB', '2031-05-02T00:00:00Z')
  const target = await resolveTarget(
    c.db,
    {
      jobId: ja,
      correlationId: shared,
      projectId: pa,
      kind: 'probe',
      idempotencyKey: 'k',
      attempt: 1,
    },
    null,
    TA,
  )
  c.check(
    target?.channelId === 'C0P3THREADA',
    "the reply target for A's job is A's channel - B's newer command shares the correlation and is not A's to answer",
    String(target?.channelId),
  )

  // ======================================================================================================================
  // 13. The Slack config-token rotation touches the installation of its own office
  // ======================================================================================================================
  const appA = `A0P3${run.toUpperCase().replaceAll(/[^A-Z0-9]/g, 'X')}AA`
  await c.db.execute(
    `insert into public.slack_app_credentials (slack_app_id, team_id, app_name, office_id) values (${lit(appA)}, ${lit(TA)}, 'p3 app', '${A}')`,
  )
  const refuses = (async () =>
    new Response(JSON.stringify({ ok: false, error: 'invalid_refresh_token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
  const failures = async () =>
    Number(
      (
        await one(
          `select rotation_failures as n from public.slack_app_credentials where slack_app_id = ${lit(appA)}`,
        )
      ).n,
    )
  await rotateAndPersist(
    { office: `'${B}'::uuid`, execute: (s) => c.db.execute(s), fetchImpl: refuses },
    appA,
    ['xoxe', '1', 'p3-not-a-token'].join('-'),
  )
  c.check(
    (await failures()) === 0,
    "a rotation run for B's office cannot record its failure on A's installation",
    String(await failures()),
  )
  await rotateAndPersist(
    { office: `'${A}'::uuid`, execute: (s) => c.db.execute(s), fetchImpl: refuses },
    appA,
    ['xoxe', '1', 'p3-not-a-token'].join('-'),
  )
  c.check(
    (await failures()) === 1,
    "control: the same run for A's office records it",
    String(await failures()),
  )

  // ---- the writers added no bridge rows -----------------------------------------------------------------------------------
  c.check(
    (await bridgeUse()) === bridgeBefore,
    'none of the converted writers fell back to the ambient bridge (office_bridge_use did not move)',
    `${String(bridgeBefore)} -> ${String(await bridgeUse())}`,
  )
}
