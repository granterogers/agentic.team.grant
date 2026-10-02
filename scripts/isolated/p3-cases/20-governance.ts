/**
 * Governance (migrations 0740-0742): the approval door, proposals, suggestions, tool requests, standing authorizations,
 * the autonomy dial, the team page, routing, connections, settings and the trigger board.
 *
 * Person A and Person B each own a full set of governance rows. Every converted function is driven as A against B's ids
 * and B's slugs, and the proof is the same three-way one the other clusters use: a foreign id answers EXACTLY like a
 * nonexistent one (modulo the id the caller typed), nothing of B's moved, and B's canary never appears in what A reads.
 * Grant is the deployment operator; A and B are not.
 */
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

const S = 'service_role'

export async function cases(c: Ctx): Promise<void> {
  const { A, B, G, canary } = c
  const q = lit
  const exec = (sql: string) => c.db.execute(sql)

  // The calls into other clusters that this clone may not have yet: a stand-in, created only if it is absent, so the
  // studio-settings reader can be driven. (hq_studio_settings calls app.usage_overview(p_office), which the views
  // cluster converts.)
  const hasUsage = (
    await exec(
      `select count(*)::int as n from pg_proc where proname = 'usage_overview' and pronamespace = 'app'::regnamespace and (pg_get_function_arguments(oid) like 'p_office uuid%')`,
    )
  ).rows[0] as { n: number }
  if (hasUsage.n === 0)
    await exec(
      `create function app.usage_overview(p_office uuid, p_days integer default 30) returns jsonb language sql as $f$ select '{}'::jsonb $f$`,
    )

  // ---- two people the office admits, and what each owns --------------------------------------------------------------------
  await exec(`
    insert into public.office_members (email, owner_key, kind) values
      ('person.a@example.invalid', 'person-a', 'person'), ('person.b@example.invalid', 'person-b', 'person')
    on conflict do nothing`)
  const chief = (
    (await exec(`select staff_id from public.staff where slug = 'chief-of-staff'`)).rows[0] as {
      staff_id: string
    }
  ).staff_id

  type Seed = {
    who: 'A' | 'B'
    office: string
    by: string
    project: string
    job: string
    plain: string
    standing: string
    level3: string
    declined: string
    standingRow: string
    proposal: string
    suggestion: string
    request: string
    request2: string
    lesson: string
    skill: string
    trigger: string
    duty: string
  }
  const seed = async (who: 'A' | 'B'): Promise<Seed> => {
    const office = who === 'A' ? A : B
    const by = who === 'A' ? 'person-a' : 'person-b'
    const can = canary[who]
    const ins = async (sql: string): Promise<string> =>
      String(Object.values((await exec(sql)).rows[0] as Record<string, unknown>)[0])
    await exec(
      `insert into public.projects (slug, name, status, office_id) values ('gov', 'Gov ${who}', 'paused', ${q(office)}) on conflict do nothing`,
    )
    const project = await ins(
      `select project_id as v from public.projects where slug = 'gov' and office_id = ${q(office)}`,
    )
    const job = await ins(
      `insert into public.jobs (office_id, project_id, correlation_id, idempotency_key, kind, requested_by)
       values (${q(office)}, ${q(project)}, gen_random_uuid(), ${q(`gov-${who}-${can}`)}, 'office.instruction', ${q(`teamhq:${by}`)}) returning job_id as v`,
    )
    const blocker = (tag: string, opts: string, standing: string) =>
      ins(
        `insert into public.blockers (office_id, project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option ${standing === '' ? '' : ', standing_tool, standing_option'})
         values (${q(office)}, ${q(project)}, ${q(job)}, ${q(`${can} ${tag}`)}, 'it needs a person to say', 'it waits', ${opts}, 'chief-of-staff', false, 'No' ${standing})
         returning blocker_id as v`,
      )
    const plain = await blocker('plain', `array['Yes','No']`, '')
    const standing = await blocker(
      'standing',
      `array['Yes','Yes, always','No']`,
      `, 'drive.ingest', 'Yes, always'`,
    )
    const level3 = await blocker(
      'level three',
      `array['Yes','Yes, always','No']`,
      `, 'slack.channel', 'Yes, always'`,
    )
    const declined = await blocker('to be declined', `array['Yes','No']`, '')
    const standingRow = await ins(
      `insert into public.standing_authorizations (office_id, tool, reason, granted_by)
       values (${q(office)}, 'calendar.write', ${q(`Standing ${can} because it was asked`)}, ${q(by)}) returning authorization_id as v`,
    )
    const proposal = await ins(
      `insert into public.proposals (office_id, staff_slug, kind, needed, title, remedy, argument)
       values (${q(office)}, 'chief-of-staff', 'not_capable', ${q(`need-${can}`)}, ${q(`Title ${can}`)}, ${q(`Remedy ${can}`)}, ${q(`Argument ${can}`)}) returning proposal_id as v`,
    )
    const suggestion = await ins(
      `insert into public.suggestions (office_id, kind, subject_ref, body, offer_kind, offer_args)
       values (${q(office)}, ${q(`p3gov-${who}`)}, ${q(can)}, ${q(`Suggestion ${can} take note`)}, 'learn',
               jsonb_build_object('scope', 'global')) returning suggestion_id as v`,
    )
    const request = await ins(
      `insert into public.tool_requests (office_id, tool, asked_by, what_for)
       values (${q(office)}, 'drive.ingest', ${q(who === 'A' ? 'chief-of-staff' : 'finance-director')}, ${q(`Request ${can} for reading the folder`)}) returning request_id as v`,
    )
    const request2 = await ins(
      `insert into public.tool_requests (office_id, tool, asked_by, what_for)
       values (${q(office)}, 'calendar.write', ${q(who === 'A' ? 'chief-of-staff' : 'finance-director')}, ${q(`Second request ${can} to write diaries`)}) returning request_id as v`,
    )
    const lesson = await ins(
      `insert into public.lessons (office_id, row_kind, scope, body, learned_by)
       values (${q(office)}, 'lesson', 'global', ${q(`Lesson ${can}`)}, ${q(by)}) returning lesson_id as v`,
    )
    const skill = await ins(
      `insert into public.skills (office_id, row_kind, scope, name, when_to_use, procedure, authored_by)
       values (${q(office)}, 'skill', 'global', ${q(`Skill ${can}`)}, 'when the thing comes up here', ${q(`Do the thing in order, one step at a time, and tell the person ${can}`)}, ${q(by)}) returning skill_id as v`,
    )
    const trigger = await ins(
      `insert into public.event_triggers (office_id, name, source, event_type, job_kind)
       values (${q(office)}, ${q(`trigger-${can}`)}, 'slack', 'message', 'office.instruction') returning trigger_id as v`,
    )
    const duty = `p3-duty-${who.toLowerCase()}`
    await exec(
      `insert into public.responsibilities (office_id, slug, staff_id, description, job_kind, period_minutes)
       values (${q(office)}, ${q(duty)}, ${q(chief)}, ${q(`Duty ${can}`)}, 'office.noop', 60) on conflict do nothing`,
    )
    await exec(
      `insert into public.connection_health (office_id, service, credential, state, detail, owner)
       values (${q(office)}, 'Slack', ${q(`cred-${who}`)}, 'ok', ${q(`Health ${can}`)}, 'x') on conflict do nothing`,
    )
    return {
      who,
      office,
      by,
      project,
      job,
      plain,
      standing,
      level3,
      declined,
      standingRow,
      proposal,
      suggestion,
      request,
      request2,
      lesson,
      skill,
      trigger,
      duty,
    }
  }
  // The deployment's own infrastructure credential lives in the system office; only an operator sees it.
  await exec(
    `insert into public.connection_health (office_id, service, credential, state, detail, owner)
     values (${q(c.SYS)}, 'P3Shared', 'p3 shared key', 'ok', 'Shared infrastructure P3', 'x') on conflict do nothing`,
  )
  // Re-runnable on the same clone: an earlier run's open requests would collide on the (tool, asked_by) open-request key.
  await exec(
    `delete from public.tool_requests where what_for like 'Request CANARY-%' or what_for like 'Second request CANARY-%'`,
  )
  await exec(`
    delete from public.standing_authorizations where office_id in (${q(A)}, ${q(B)});
    delete from public.autonomy_settings where office_id in (${q(A)}, ${q(B)});
    delete from public.staff_tools where office_id in (${q(A)}, ${q(B)});
    delete from public.connection_health where office_id in (${q(A)}, ${q(B)}) and credential like 'cred-%'`)
  const a = await seed('A')
  const b = await seed('B')

  const TABLES = [
    'blockers',
    'jobs',
    'standing_authorizations',
    'decisions',
    'events',
    'tool_requests',
    'proposals',
    'suggestions',
    'lessons',
    'skills',
    'staff_tools',
    'autonomy_settings',
    'appearance_settings',
    'connection_health',
    'responsibilities',
    'event_triggers',
    'undoable_actions',
  ] as const
  const bridgeBefore = (
    await exec(
      `select coalesce(sum(n),0)::int as n from public.office_bridge_use where table_name = any(array[${TABLES.map(q).join(',')}])`,
    )
  ).rows[0] as { n: number }

  // A foreign id and a nonexistent id answer alike. The id the caller typed is the only thing that may differ, so it is
  // masked before the comparison (a message may echo it; that is the caller's own input, not B's data).
  const mask = (v: unknown, id: string) => c.json(v).replaceAll(id, '<id>')
  const same = async (what: string, mk: (id: string) => string, foreignId: string) => {
    const nobody = c.nobody()
    const f = await c.try_(S, mk(foreignId))
    const m = await c.try_(S, mk(nobody))
    const fs = f.ok ? mask(f.value, foreignId) : `ERR ${f.error.replaceAll(foreignId, '<id>')}`
    const ms = m.ok ? mask(m.value, nobody) : `ERR ${m.error.replaceAll(nobody, '<id>')}`
    c.check(
      fs === ms,
      `${what}: B's id and a nonexistent id answer A alike`,
      fs === ms ? fs.slice(0, 90) : `${fs.slice(0, 70)} vs ${ms.slice(0, 70)}`,
    )
  }

  await c.exec(
    S,
    `select public.hq_answer_blocker(${q(B)}, ${q(b.declined)}::uuid, 'No', 'person-b')`,
  )
  await c.exec(S, `select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)

  // ======== the approval door ======================================================================================================
  const before = await c.snapshot(B, TABLES)
  await same(
    'hq_answer_blocker (plain)',
    (id) => `select public.hq_answer_blocker(${q(A)}, ${q(id)}::uuid, 'Yes', 'person-a')`,
    b.plain,
  )
  await same(
    'hq_answer_blocker (standing grant)',
    (id) => `select public.hq_answer_blocker(${q(A)}, ${q(id)}::uuid, 'Yes, always', 'person-a')`,
    b.standing,
  )
  await same(
    'hq_answer_blocker (decline)',
    (id) => `select public.hq_answer_blocker(${q(A)}, ${q(id)}::uuid, 'No', 'person-a')`,
    b.plain,
  )
  await same(
    'hq_answer_blocker (level three)',
    (id) => `select public.hq_answer_blocker(${q(A)}, ${q(id)}::uuid, 'Yes, always', 'person-a')`,
    b.level3,
  )
  await same(
    'decide_proposal',
    (id) =>
      `select public.decide_proposal(${q(A)}, ${q(id)}::uuid, 'approved', 'no thanks', 'person-a')`,
    b.proposal,
  )
  await same(
    'decide_suggestion (accept)',
    (id) => `select public.decide_suggestion(${q(A)}, ${q(id)}::uuid, true, 'person-a')`,
    b.suggestion,
  )
  await same(
    'decide_suggestion (dismiss)',
    (id) => `select public.decide_suggestion(${q(A)}, ${q(id)}::uuid, false, 'person-a')`,
    b.suggestion,
  )
  await same(
    'hq_approve_tool',
    (id) => `select public.hq_approve_tool(${q(A)}, ${q(id)}::uuid, null, 'person-a')`,
    b.request,
  )
  await same(
    'hq_decline_tool',
    (id) =>
      `select public.hq_decline_tool(${q(A)}, ${q(id)}::uuid, 'not at this time', 'person-a')`,
    b.request,
  )
  await same(
    'retract_lesson',
    (id) =>
      `select public.retract_lesson(${q(A)}, ${q(id)}::uuid, 'take it back please', 'person-a')`,
    b.lesson,
  )
  await same(
    'hq_retire_skill',
    (id) => `select public.hq_retire_skill(${q(A)}, ${q(id)}::uuid, 'no longer needed here')`,
    b.skill,
  )
  await same(
    'request_stop',
    (id) => `select public.request_stop(${q(A)}, ${q(id)}::uuid, 'person-a')`,
    b.job,
  )
  await same('job_progress', (id) => `select public.job_progress(${q(A)}, ${q(id)}::uuid)`, b.job)
  await same(
    "hq_autonomy_set (a project that is B's)",
    (id) => `select public.hq_autonomy_set(${q(A)}, 'act', ${q(id)}::uuid, 'because', 'person-a')`,
    b.project,
  )
  await same(
    'hq_revoke_standing',
    (id) => `select public.hq_revoke_standing(${q(A)}, ${q(id)}::uuid, 'not yours', 'person-a')`,
    b.standingRow,
  )
  await same(
    'hq_withdraw_refusal',
    (id) => `select public.hq_withdraw_refusal(${q(A)}, ${q(id)}::uuid, 'person-a')`,
    b.declined,
  )
  await same(
    'hq_revoke_tool (not held here)',
    (_id) =>
      `select public.hq_revoke_tool(${q(A)}, 'finance-director', 'drive.ingest', 'person-a')`,
    b.request,
  )
  c.check(
    before === (await c.snapshot(B, TABLES)),
    "nothing of B's moved while A attacked: blockers, jobs, standing authorizations, decisions, the ledger, requests, proposals, suggestions, lessons, skills, grants, the dial, appearance, health, duties, triggers, undo",
  )
  const stray = (
    await exec(
      `select count(*)::int as n from public.standing_authorizations where tool = 'drive.ingest' and office_id <> ${q(G)}`,
    )
  ).rows[0] as { n: number }
  c.check(
    stray.n === 0,
    "no standing authorization was minted by A's attempt on B's question",
    `rows: ${String(stray.n)}`,
  )

  // ---- positive controls: the same calls as the right office work -----------------------------------------------------------------
  const ok = async (what: string, sql: string, test: (v: Record<string, unknown>) => boolean) => {
    const r = await c.try_(S, sql)
    c.check(
      r.ok && test((r.value ?? {}) as Record<string, unknown>),
      what,
      r.ok ? c.json(r.value).slice(0, 140) : r.error.slice(0, 140),
    )
  }
  await ok(
    "A answers A's plain question",
    `select public.hq_answer_blocker(${q(A)}, ${q(a.plain)}::uuid, 'Yes', 'person-a')`,
    (v) => v.ok === true,
  )
  await ok(
    "A's second press on the same question is the 'already answered' reply, not a second action",
    `select public.hq_answer_blocker(${q(A)}, ${q(a.plain)}::uuid, 'Yes', 'person-a')`,
    (v) => v.already === true,
  )
  await ok(
    "A's answer can name no one: an unknown principal is refused whoever's question it is",
    `select public.hq_answer_blocker(${q(A)}, ${q(a.standing)}::uuid, 'Yes, always', 'mallory')`,
    (v) => typeof v.error === 'string',
  )
  await ok(
    "A grants a standing authorization through A's own question",
    `select public.hq_answer_blocker(${q(A)}, ${q(a.standing)}::uuid, 'Yes, always', 'person-a')`,
    (v) => (v.standing as { ok?: boolean } | null)?.ok === true,
  )
  const granted = (
    await exec(
      `select office_id, tool, granted_by from public.standing_authorizations where tool = 'drive.ingest' and office_id in (${q(A)}, ${q(B)})`,
    )
  ).rows as { office_id: string; tool: string; granted_by: string }[]
  c.check(
    granted.length === 1 && granted[0]?.office_id === A && granted[0]?.granted_by === 'person-a',
    "the standing authorization is in A's office, granted by the person who pressed, and nowhere else",
    c.json(granted).slice(0, 120),
  )
  await ok(
    'a level-three tool can never be granted standing, whatever the answer: the question resolves and the grant is refused',
    `select public.hq_answer_blocker(${q(A)}, ${q(a.level3)}::uuid, 'Yes, always', 'person-a')`,
    (v) =>
      v.ok === true &&
      (v.standing as { ok?: boolean; error?: string } | null)?.ok === false &&
      String((v.standing as { error?: string }).error).includes('level-3'),
  )
  const l3 = (
    await exec(
      `select count(*)::int as n from public.standing_authorizations where tool = 'slack.channel' and office_id in (${q(A)}, ${q(B)})`,
    )
  ).rows[0] as { n: number }
  c.check(
    l3.n === 0,
    'no standing authorization exists for the level-three tool',
    `rows: ${String(l3.n)}`,
  )
  const floor = await c.refusal(
    'postgres',
    `update public.autonomy_policy set verdict = 'proceed' where action_level = 3`,
  )
  c.check(
    floor !== '' && /autonomy_policy|check/i.test(floor),
    'the autonomy policy floor (level 3 never resolves to proceed) still refuses an edit',
    floor.slice(0, 100),
  )

  await ok(
    'A takes back the No A gave',
    `select public.hq_withdraw_refusal(${q(A)}, ${q(a.declined)}::uuid, 'person-a')`,
    (v) => v.error !== undefined,
  )
  await c.exec(
    S,
    `select public.hq_answer_blocker(${q(A)}, ${q(a.declined)}::uuid, 'No', 'person-a')`,
  )
  await ok(
    "A takes back A's No",
    `select public.hq_withdraw_refusal(${q(A)}, ${q(a.declined)}::uuid, 'person-a')`,
    (v) => v.ok === true && v.withdrawn === a.declined,
  )
  await ok(
    "A revokes A's standing authorization",
    `select public.hq_revoke_standing(${q(A)}, ${q(a.standingRow)}::uuid, 'no longer wanted', 'person-a')`,
    (v) => v.ok === true,
  )
  await ok(
    "A grants a standing authorization from the dashboard, in A's office",
    `select public.hq_grant_standing(${q(A)}, 'notebook.write', 'because A said so', null, null, 'person-a')`,
    (v) => v.ok === true,
  )
  const dash = (
    await exec(
      `select office_id from public.standing_authorizations where tool = 'notebook.write' and reason = 'because A said so'`,
    )
  ).rows as { office_id: string }[]
  c.check(
    dash.length === 1 && dash[0]?.office_id === A,
    "and the row is A's",
    c.json(dash).slice(0, 100),
  )
  await ok(
    'a level-three tool is refused the dashboard press too',
    `select public.hq_grant_standing(${q(A)}, 'slack.channel', 'trying it', null, null, 'person-a')`,
    (v) => v.ok === false && String(v.error).includes('level-3'),
  )
  await ok(
    "A decides A's proposal",
    `select public.decide_proposal(${q(A)}, ${q(a.proposal)}::uuid, 'declined', 'not for now', 'person-a')`,
    (v) => v.ok === true && v.now === 'declined',
  )
  await ok(
    "A accepts A's suggestion (a lesson is written, in A's office)",
    `select public.decide_suggestion(${q(A)}, ${q(a.suggestion)}::uuid, true, 'person-a')`,
    (v) => v.accepted === true,
  )
  const les = (
    await exec(
      `select office_id from public.lessons where body = ${q(`Suggestion ${canary.A} take note`)}`,
    )
  ).rows as { office_id: string }[]
  c.check(
    les.length === 1 && les[0]?.office_id === A,
    "the lesson a suggestion became is A's",
    c.json(les).slice(0, 100),
  )
  await ok(
    "A approves A's tool request and A holds the tool",
    `select public.hq_approve_tool(${q(A)}, ${q(a.request)}::uuid, null, 'person-a')`,
    (v) => v.approved === true && v.granted === true,
  )
  const held = (
    await exec(
      `select office_id from public.staff_tools where staff_slug = 'chief-of-staff' and tool = 'drive.ingest' and office_id in (${q(A)}, ${q(B)})`,
    )
  ).rows as { office_id: string }[]
  c.check(
    held.length === 1 && held[0]?.office_id === A,
    "the grant is A's, though Grant's office also holds the same tool",
    c.json(held).slice(0, 100),
  )
  await ok(
    "A declines A's other request",
    `select public.hq_decline_tool(${q(A)}, ${q(a.request2)}::uuid, 'not at this time', 'person-a')`,
    (v) => v.declined === true,
  )
  await ok(
    "only the office's own person approves reach: B's person cannot approve A's request name",
    `select public.hq_approve_tool(${q(A)}, ${q(a.request2)}::uuid, null, 'person-b')`,
    (v) => typeof v.error === 'string',
  )
  await ok(
    "A turns a tool on and off for a colleague, in A's office",
    `select public.hq_staff_tool_set(${q(A)}, 'finance-director', 'drive.ingest', true, 'person-a')`,
    (v) => v.changed === true,
  )
  await ok(
    'and the revoke finds it',
    `select public.hq_revoke_tool(${q(A)}, 'finance-director', 'drive.ingest', 'person-a')`,
    (v) => v.revoked === 'drive.ingest',
  )
  await ok(
    "A retracts A's lesson",
    `select public.retract_lesson(${q(A)}, ${q(a.lesson)}::uuid, 'no longer true', 'person-a')`,
    (v) => v.ok === true,
  )
  await ok(
    "A retires A's skill",
    `select public.hq_retire_skill(${q(A)}, ${q(a.skill)}::uuid, 'no longer needed here')`,
    (v) => typeof v.retired === 'string',
  )
  await ok(
    "A stops A's job",
    `select public.request_stop(${q(A)}, ${q(a.job)}::uuid, 'person-a')`,
    (v) => v.ok === true,
  )
  await ok(
    "A reads A's job progress",
    `select public.job_progress(${q(A)}, ${q(a.job)}::uuid)`,
    (v) => v.job === a.job,
  )
  await ok(
    "A sets A's dial for the whole office and the row is A's",
    `select public.hq_autonomy_set(${q(A)}, 'act_with_review', null, 'testing', 'person-a')`,
    (v) => v.level === 'act_with_review',
  )
  const dial = (
    await exec(`select office_id, set_by from public.autonomy_settings where reason = 'testing'`)
  ).rows as { office_id: string; set_by: string }[]
  c.check(
    dial.length === 1 && dial[0]?.office_id === A && dial[0]?.set_by === 'person-a',
    "the dial row is A's and was set by the person, not by a default",
    c.json(dial).slice(0, 100),
  )
  await ok(
    "A sets the dial on A's own project",
    `select public.hq_autonomy_set(${q(A)}, 'observe', ${q(a.project)}::uuid, 'only here', 'person-a')`,
    (v) => v.scope === 'this project',
  )
  await ok(
    'an unknown principal cannot set the dial',
    `select public.hq_autonomy_set(${q(A)}, 'act', null, 'x', 'mallory')`,
    (v) => typeof v.error === 'string',
  )
  // A's answer to its own question wrote the decision log and the ledger in A's office, never B's or Grant's
  const logs = (
    await exec(
      `select (select count(*)::int from public.decisions where chose = 'Yes' and decided_by = 'person-a' and office_id = ${q(A)}) as d, (select count(*)::int from public.events where actor = 'person-a' and office_id <> ${q(A)}) as e`,
    )
  ).rows[0] as { d: number; e: number }
  c.check(
    logs.d >= 1 && logs.e === 0,
    "the decision A made is logged in A's office and the ledger wrote nothing outside it",
    c.json(logs),
  )

  // ======== readers: A reads A and never B ===========================================================================================
  const gov = c.json(await c.exec(S, `select public.hq_governance(${q(A)}, 200)`))
  c.check(
    !gov.includes(canary.B),
    "hq_governance(A) holds none of B's lessons, proposals, suggestions or requests",
    '',
  )
  c.check(
    gov.includes(canary.A),
    "hq_governance(A) does hold A's own (a reader that returns nothing proves nothing)",
    '',
  )
  const govB = c.json(await c.exec(S, `select public.hq_governance(${q(B)}, 200)`))
  c.check(
    govB.includes(canary.B) && !govB.includes(canary.A),
    'hq_governance(B) is the mirror image',
    '',
  )

  const stand = c.json(await c.exec(S, `select public.hq_standing(${q(B)})`))
  c.check(
    stand.includes(canary.B) && !stand.includes(canary.A),
    "hq_standing(B) lists B's standing authorizations and not A's",
    '',
  )
  const standA = c.json(
    await c.exec(S, `select public.hq_standing(${q(A)}, ${q(a.project)}::uuid)`),
  )
  c.check(!standA.includes(canary.B), "hq_standing(A, A's project) holds none of B's", '')
  const decs = c.json(await c.exec(S, `select public.hq_decisions(${q(A)}, 100)`))
  c.check(
    decs.includes(canary.A) && !decs.includes(canary.B),
    "hq_decisions(A) is A's log and not B's",
    '',
  )
  c.check(
    c.json(await c.exec(S, `select public.hq_decisions(${q(B)}, 100)`)).includes(canary.B),
    "and B's log holds B's (a reader that returns nothing proves nothing)",
    '',
  )

  const conns = c.json(await c.exec(S, `select public.hq_connections(${q(A)})`))
  c.check(
    conns.includes(canary.A) && !conns.includes(canary.B),
    "hq_connections(A) shows A's health and not B's",
    '',
  )
  c.check(
    !conns.includes('Shared infrastructure P3'),
    'a person who does not operate the deployment does not see its shared credentials',
    '',
  )
  const connsG = c.json(await c.exec(S, `select public.hq_connections(${q(G)})`))
  c.check(
    connsG.includes('Shared infrastructure P3'),
    "the operator does: Grant's connections include the deployment's",
    '',
  )
  c.check(
    !connsG.includes(canary.A) && !connsG.includes(canary.B),
    "and neither A's nor B's health",
    '',
  )

  const routing = c.json(await c.exec(S, `select public.hq_routing(${q(A)})`))
  c.check(
    routing.includes('p3-duty-a') && !routing.includes('p3-duty-b'),
    "hq_routing(A) lists A's duties only",
    '',
  )
  c.check(!routing.includes('nightly-backup'), 'and not the deployment duties an operator sees', '')
  c.check(
    c.json(await c.exec(S, `select public.hq_routing(${q(G)})`)).includes('nightly-backup'),
    'the operator sees them',
    '',
  )

  const trig = c.json(await c.exec(S, `select public.trigger_health(${q(A)})`))
  c.check(
    trig.includes(canary.A) && !trig.includes(canary.B),
    "trigger_health(A) lists A's triggers only",
    '',
  )

  const studio = c.json(await c.exec(S, `select public.hq_studio_settings(${q(A)})`))
  c.check(
    studio.includes(canary.A) && !studio.includes(canary.B),
    "hq_studio_settings(A) reads A's channel health and not B's",
    '',
  )
  for (const [what, sql] of [
    ['hq_team', `select public.hq_team(${q(A)})`],
    ['hq_staff', `select public.hq_staff(${q(A)})`],
    ['hq_settings', `select public.hq_settings(${q(A)})`],
    ['hq_setup', `select public.hq_setup(${q(A)})`],
  ] as const) {
    const out = c.json(await c.exec(S, sql))
    c.check(
      out.length > 20 && !out.includes(canary.B),
      `${what}(A) answers and holds nothing of B's`,
      `${String(out.length)} characters`,
    )
  }

  // ======== writes with no existence oracle ======================================================================================
  const routingBefore = await c.snapshot(B, ['responsibilities'])
  const bad = c.json(
    await c.exec(S, `select public.hq_routing_set(${q(G)}, 'duty:${b.duty}', 'off')`),
  )
  const none = c.json(
    await c.exec(S, `select public.hq_routing_set(${q(G)}, 'duty:no-such-duty-anywhere', 'off')`),
  )
  c.check(
    bad.replace(b.duty, 'X') === none.replace('no-such-duty-anywhere', 'X'),
    "even the operator cannot toggle another person's duty: it answers as a duty that does not exist",
    bad.slice(0, 90),
  )
  c.check(
    routingBefore === (await c.snapshot(B, ['responsibilities'])),
    "B's duties did not move",
    '',
  )
  c.check(
    (
      (await c.exec(S, `select public.hq_routing_set(${q(G)}, 'pager_floor', 'urgent')`)) as {
        ok?: boolean
      }
    ).ok === true,
    'the operator can change a routing setting',
    '',
  )
  await c.exec(S, `select public.hq_routing_set(${q(G)}, 'pager_floor', 'routine')`)

  const vault = async () =>
    String(
      ((await exec(`select count(*)::int as n from vault.secrets`)).rows[0] as { n: number }).n,
    )
  const vBefore = await vault()
  const cfgBefore = String(
    (
      (
        await exec(
          `select md5(string_agg(key || value::text, '|' order by key)) as h from public.system_config`,
        )
      ).rows[0] as { h: string }
    ).h,
  )
  const OP = 'only its operator'
  for (const [what, sql] of [
    ['hq_disconnect', `select public.hq_disconnect(${q(A)}, 'slack')`],
    ['hq_forget_google', `select public.hq_forget_google(${q(A)})`],
    ['hq_forget_vikunja', `select public.hq_forget_vikunja(${q(A)})`],
    [
      'hq_set_vikunja',
      `select public.hq_set_vikunja(${q(A)}, 'https://tasks.example.com', 1, 'tk_abcdefabcdef', 'person-a')`,
    ],
    ['hq_set_slack_credentials', `select public.hq_set_slack_credentials(${q(A)}, 'xoxb-1', 'a')`],
    ['hq_routing_set', `select public.hq_routing_set(${q(A)}, 'only_chief_speaks', 'true')`],
  ] as const) {
    const r = c.json(await c.exec(S, sql))
    c.check(
      r.includes(OP),
      `${what}: a person who does not operate the deployment is told so`,
      r.slice(0, 90),
    )
  }
  c.check(vBefore === (await vault()), 'and no vault secret was touched by any of them', '')
  c.check(
    cfgBefore ===
      String(
        (
          (
            await exec(
              `select md5(string_agg(key || value::text, '|' order by key)) as h from public.system_config`,
            )
          ).rows[0] as { h: string }
        ).h,
      ),
    'nor any deployment setting',
    '',
  )
  const opOk = c.json(await c.exec(S, `select public.hq_disconnect(${q(G)}, 'openrouter')`))
  c.check(
    opOk.includes('OpenRouter is how the team thinks'),
    'the operator reaches the disconnect function (and it refuses openrouter on its own terms)',
    opOk.slice(0, 80),
  )
  const opSlack = c.json(
    await c.exec(
      S,
      `select public.hq_set_slack_credentials(${q(G)}, 'not-a-token', 'not-a-secret')`,
    ),
  )
  c.check(
    !opSlack.includes(OP) && opSlack.includes('error'),
    "the operator passes the guard and meets the function's own validation",
    opSlack.slice(0, 90),
  )

  // appearance
  const ap = (await c.exec(
    S,
    `select public.hq_appearance_set(${q(A)}, jsonb_build_object('note', ${q(canary.A)}))`,
  )) as { saved?: boolean }
  c.check(ap.saved === true, "A saves A's appearance", '')
  const apRow = (
    await exec(
      `select office_id, owner from public.appearance_settings where settings::text like ${q(`%${canary.A}%`)}`,
    )
  ).rows as { office_id: string; owner: string }[]
  c.check(
    apRow.length === 1 && apRow[0]?.office_id === A && apRow[0]?.owner === 'person-a',
    "the row is A's and keyed to A's person, not 'grant'",
    c.json(apRow).slice(0, 100),
  )
  const apFor = c.json(
    await c.exec(
      S,
      `select public.hq_appearance_set(${q(A)}, jsonb_build_object('note', 'x'), 'person-b')`,
    ),
  )
  c.check(
    apFor.includes('not your appearance'),
    "A cannot set appearance on behalf of B's person",
    apFor.slice(0, 80),
  )
  c.check(
    (
      await exec(
        `select count(*)::int as n from public.appearance_settings where owner = 'person-b'`,
      )
    ).rows[0] !== undefined &&
      (
        (
          await exec(
            `select count(*)::int as n from public.appearance_settings where owner = 'person-b'`,
          )
        ).rows[0] as { n: number }
      ).n === 0,
    "and nothing was written under B's name",
    '',
  )

  // ======== no office, no work ========================================================================================================
  for (const [what, sql] of [
    ['a null office', `select public.hq_governance(null::uuid, 10)`],
    ['an office that does not exist', `select public.hq_governance(${q(c.nobody())}::uuid, 10)`],
    [
      'a null office on the approval door',
      `select public.hq_answer_blocker(null::uuid, ${q(a.plain)}::uuid, 'Yes', 'person-a')`,
    ],
    [
      'a missing office on the approval door',
      `select public.hq_answer_blocker(${q(c.nobody())}::uuid, ${q(a.plain)}::uuid, 'Yes', 'person-a')`,
    ],
    [
      'a null office on a proposal',
      `select public.decide_proposal(null::uuid, ${q(a.proposal)}::uuid, 'approved', null, 'person-a')`,
    ],
    [
      'a missing office on the dial',
      `select public.hq_autonomy_set(${q(c.nobody())}::uuid, 'act', null, 'x', 'person-a')`,
    ],
  ] as const) {
    const msg = await c.refusal(S, sql)
    c.check(
      msg.includes('no_office'),
      `${what} does the governance functions no good`,
      msg.slice(0, 80),
    )
  }

  // ======== the doors are shut to the browser's own roles ====================================================================================
  for (const role of callerRoles) {
    for (const sql of [
      `select public.hq_answer_blocker(${q(A)}, ${q(b.plain)}::uuid, 'Yes', 'person-a')`,
      `select public.hq_governance(${q(A)}, 10)`,
      `select public.hq_revoke_standing(${q(A)}, ${q(b.standingRow)}::uuid, 'x', 'person-a')`,
      `select public.hq_decisions(${q(A)}, 10)`,
      `select public.hq_autonomy_set(${q(A)}, 'act', null, 'x', 'person-a')`,
      `select public.hq_approve_tool(${q(A)}, ${q(b.request)}::uuid, null, 'person-a')`,
      `select public.decide_proposal(${q(A)}, ${q(b.proposal)}::uuid, 'approved', null, 'person-a')`,
    ]) {
      const msg = await c.refusal(role, sql)
      c.check(
        msg.includes('permission denied'),
        `${role} cannot call ${sql.slice(14, 44)}`,
        msg.slice(0, 80),
      )
    }
  }

  // ======== the legacy doors are gone, and nothing relied on the bridge =================================================================
  const legacy = (
    await exec(`
      select count(*)::int as n from pg_proc p
       where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
         and p.proname in ('hq_answer_blocker','hq_governance','decide_proposal','decide_suggestion','hq_autonomy_set','hq_staff_tool_set',
                           'hq_staff','hq_team','hq_retire_skill','retract_lesson','request_stop','job_progress','hq_routing','hq_routing_set',
                           'hq_set_vikunja','hq_forget_vikunja','hq_forget_google','hq_disconnect','hq_set_slack_credentials','hq_connections',
                           'hq_settings','hq_setup','hq_studio_settings','hq_appearance_set','trigger_health','hq_approve_tool','hq_decline_tool',
                           'hq_revoke_tool','approve_tool','decline_tool','revoke_tool','hq_grant_standing','hq_revoke_standing','revoke_standing',
                           'hq_standing','standing_now','hq_decisions','decisions_so_far','hq_withdraw_refusal','withdraw_refusal')
         and pg_get_function_arguments(p.oid) not like 'p_office uuid%'`)
  ).rows[0] as { n: number }
  c.check(
    legacy.n === 0,
    'every converted function exists only in its office-explicit form',
    `legacy overloads: ${String(legacy.n)}`,
  )
  const bridgeAfter = (
    await exec(
      `select coalesce(sum(n),0)::int as n from public.office_bridge_use where table_name = any(array[${TABLES.map(q).join(',')}])`,
    )
  ).rows[0] as { n: number }
  c.check(
    bridgeAfter.n === bridgeBefore.n,
    'the converted governance writers never relied on the compatibility bridge',
    `bridge uses on these tables: ${String(bridgeBefore.n)} -> ${String(bridgeAfter.n)}`,
  )

  // A and B are shared with every case file that runs after this one. A live standing yes is unique per office, tool and
  // scope, so the ones this file granted would make a later file's own grant collide (23505) for no reason of its own.
  await c.db.execute(
    `delete from public.standing_authorizations where office_id in (${q(A)}, ${q(B)})`,
  )
}
