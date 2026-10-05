/**
 * B2 (architecture audit, run 1): an approval is answered by somebody the
 * office can name, and nothing defaults to Grant.
 *
 *   npx tsx scripts/isolated/approver-identity.ts <replica-db>
 *
 * Every ingress that answers an approval is driven by its real code against
 * the replica, and the DATABASE is asked what was recorded:
 *   - app.hq_answer_blocker and the gateway wrappers (SQL, direct);
 *   - the REAL hq-api handler (token, member session, non-member, spoofed p_by);
 *   - the REAL button path (processCallbacks) for a press by Grant and by
 *     somebody the office does not know.
 *
 * Not covered, on purpose: the task-tick door (app.task_answers_blocker),
 * which is the unified approval workstream's to fold into hq_answer_blocker.
 */
import { processCallbacks } from '../../src/channels/callbacks.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'approver0608')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const count = async (sql: string) => Number((await one(sql)).c)
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const CHAT = '1386648496'
const BOT = '8967954396'
const STRANGER = '5550001111'

// A second member of the office, so 'who answered' has more than one right answer.
await db.execute(
  `insert into public.office_members (email, note, owner_key) values ('second.person@example.com', 'isolated proof', 'second') on conflict do nothing`,
)

/** A fresh generation-approval question on a fresh real job: answering it starts a child. */
const question = async () => {
  const job = await realParent(db)
  const id = String(
    (
      await one(
        `select app.request_generation_approval(app.job_office(${lit(job)}::uuid), ${lit(job)}::uuid, 'notebook.generate', ${lit(`a deck ${run}`)}, 'proof') as id`,
      )
    ).id,
  )
  return { job, id }
}
const stateOf = async (id: string) =>
  String(
    (await one(`select state::text as s from public.blockers where blocker_id = ${lit(id)}::uuid`))
      .s,
  )
const childrenOf = (job: string) =>
  count(`select count(*)::int as c from public.jobs where parent_job_id = ${lit(job)}::uuid`)
const approvedBy = async (job: string) =>
  String(
    (
      await one(
        `select pinned_config ->> 'approved_by' as by from public.jobs where parent_job_id = ${lit(job)}::uuid limit 1`,
      )
    )?.by ?? '(no approval child)',
  )

// ---- app.hq_answer_blocker: it refuses what it cannot attribute -----------------
for (const [label, by] of [
  ['no principal at all', 'null'],
  ['a blank principal', "'   '"],
  ['a name the office does not know', "'mallory'"],
  ["a stranger's Telegram id", `'${STRANGER}'`],
  ['the right name in the wrong case', "'GRANT'"],
] as const) {
  const q = await question()
  const r = json(
    (
      await one(
        `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(q.id)}::uuid), app.test_office()), ${lit(q.id)}::uuid, 'Go ahead', ${by}) as r`,
      )
    ).r,
  )
  check(
    `hq_answer_blocker: ${label} is refused, and it says so`,
    typeof r.error === 'string' && r.ok !== true,
    JSON.stringify(r),
  )
  check(
    `hq_answer_blocker: ${label} - the question is still open and nothing started`,
    (await stateOf(q.id)) === 'open' && (await childrenOf(q.job)) === 0,
    `state ${await stateOf(q.id)}`,
  )
}
// The 2-argument shape the audit found must be gone, not merely unused.
check(
  'the old two-argument answer functions no longer exist (no identity-free overload)',
  (await count(`select count(*)::int as c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'hq_answer_blocker' and n.nspname in ('app','public') and p.pronargs = 2`)) ===
    0,
  'dropped by signature',
)

// ---- and records who, when it can --------------------------------------------
{
  const q = await question()
  const r = json(
    (
      await one(
        `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(q.id)}::uuid), app.test_office()), ${lit(q.id)}::uuid, 'Go ahead', 'grant') as r`,
      )
    ).r,
  )
  check(
    'hq_answer_blocker: Grant is accepted',
    r.ok === true && (await stateOf(q.id)) === 'resolved',
    JSON.stringify(r),
  )
  check(
    'hq_answer_blocker: the approval child carries who approved it',
    (await childrenOf(q.job)) === 1 && (await approvedBy(q.job)) === 'grant',
    await approvedBy(q.job),
  )
  const again = json(
    (
      await one(
        `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(q.id)}::uuid), app.test_office()), ${lit(q.id)}::uuid, 'Go ahead', 'grant') as r`,
      )
    ).r,
  )
  check(
    'a second answer is harmless (already answered, one child)',
    again.already === true && (await childrenOf(q.job)) === 1,
    JSON.stringify(again),
  )
}

// ---- a standing authorization is never granted on an anonymous answer ------------
{
  const job = await realParent(db)
  await db.execute(`insert into public.blockers (office_id, job_id, project_id, requested_action, why_needed, consequences_of_delay,
      approval_options, originating_agent, work_can_continue, standing_tool, standing_option)
    select j.office_id, ${lit(job)}::uuid, j.project_id, ${lit(`Stand ${run}`)}, 'proof', 'proof',
           array['Yes, once', 'Yes, and do not ask again', 'No'], 'chief-of-staff', true, 'calendar.write', 'Yes, and do not ask again'
      from public.jobs j where j.job_id = ${lit(job)}::uuid`)
  const bid = String(
    (
      await one(
        `select blocker_id::text as id from public.blockers where requested_action = ${lit(`Stand ${run}`)}`,
      )
    ).id,
  )
  const before = await count(`select count(*)::int as c from public.standing_authorizations`)
  const refused = json(
    (
      await one(
        `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(bid)}::uuid), app.test_office()), ${lit(bid)}::uuid, 'Yes, and do not ask again', 'mallory') as r`,
      )
    ).r,
  )
  check(
    'standing option from an unknown answerer: refused, no authorization written',
    typeof refused.error === 'string' &&
      (await count(`select count(*)::int as c from public.standing_authorizations`)) === before &&
      (await stateOf(bid)) === 'open',
    JSON.stringify(refused),
  )
  const ok = json(
    (
      await one(
        `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(bid)}::uuid), app.test_office()), ${lit(bid)}::uuid, 'Yes, and do not ask again', 'grant') as r`,
      )
    ).r,
  )
  const granted = await one(
    `select granted_by from public.standing_authorizations order by granted_at desc limit 1`,
  )
  check(
    'standing option from Grant: written, and granted_by is who answered',
    ok.ok === true && granted.granted_by === 'grant',
    JSON.stringify(ok),
  )
  // A plain question, answered by a different known person: the row must say THEM.
  {
    const j2 = await realParent(db)
    await db.execute(`insert into public.blockers (office_id, job_id, project_id, requested_action, why_needed, consequences_of_delay,
        approval_options, originating_agent, work_can_continue)
      select j.office_id, ${lit(j2)}::uuid, j.project_id, ${lit(`Plain ${run}`)}, 'proof', 'proof', array['Yes','No'], 'chief-of-staff', true
        from public.jobs j where j.job_id = ${lit(j2)}::uuid`)
    const pb = String(
      (
        await one(
          `select blocker_id::text as id from public.blockers where requested_action = ${lit(`Plain ${run}`)}`,
        )
      ).id,
    )
    await one(
      `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(pb)}::uuid), app.test_office()), ${lit(pb)}::uuid, 'Yes', 'second') as r`,
    )
    const res = await one(
      `select resolution from public.blockers where blocker_id = ${lit(pb)}::uuid`,
    )
    check(
      'the resolution names who answered, not a literal',
      /answered by second$/.test(String(res.resolution)),
      String(res.resolution),
    )
  }
  const decided = await one(
    `select decided_by from public.decisions where question = ${lit(`Stand ${run}`)}`,
  )
  check(
    'the decision log names the person who answered, not a literal',
    decided?.decided_by === 'grant',
    String(decided?.decided_by),
  )
}

// ---- the gateway's other answers to questions of authority -------------------------
for (const [fn, args] of [
  // every one takes the office first (the office model); the question is only who is deciding
  ['hq_approve_tool', `app.operator_office(), '00000000-0000-0000-0000-000000000000'::uuid, null`],
  ['hq_decline_tool', `app.operator_office(), '00000000-0000-0000-0000-000000000000'::uuid, 'no'`],
  ['hq_grant_standing', `app.operator_office(), 'calendar.write', 'proof'`],
  [
    'hq_revoke_standing',
    `app.operator_office(), '00000000-0000-0000-0000-000000000000'::uuid, 'proof'`,
  ],
] as const) {
  const none = json((await one(`select public.${fn}(${args}) as r`)).r)
  const unknown = json((await one(`select public.${fn}(${args}, p_by => 'mallory') as r`)).r)
  check(
    `${fn}: no principal is refused`,
    typeof none.error === 'string' && /who is answering/.test(String(none.error)),
    JSON.stringify(none),
  )
  check(
    `${fn}: an unknown principal is refused`,
    typeof unknown.error === 'string' && /does not know/.test(String(unknown.error)),
    JSON.stringify(unknown),
  )
}

// ---- the REAL gateway: identity is the gateway's fact, not the page's claim --------
const SESSION_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const SESSION_SECOND = `aaa.bbb.${'s'.repeat(70)}`
const SESSION_STRANGER = `aaa.bbb.${'x'.repeat(70)}`
const TOKEN = 'isolated-hq-token'
const gw = await startEdge({
  db,
  edgeFile: 'supabase/functions/hq-api/index.ts',
  env: {
    HQ_API_TOKEN: TOKEN,
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
    SUPABASE_ANON_KEY: 'isolated-anon',
  },
  authUsers: {
    [SESSION_GRANT]: 'grant.e.rogers@gmail.com',
    [SESSION_SECOND]: 'second.person@example.com',
    [SESSION_STRANGER]: 'not.a.member@example.com',
  },
})
const act = async (bearer: string, action: string, args: Record<string, unknown>) => {
  const r = await gw.call(
    new Request('https://gw.invalid/functions/v1/hq-api', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
{
  const q1 = await question()
  const viaToken = await act(TOKEN, 'answer_blocker', {
    p_blocker_id: q1.id,
    p_answer: 'Go ahead',
    p_by: 'mallory',
  })
  check(
    'gateway, the office key: it is a machine and cannot answer, whatever p_by it sends (#385)',
    viaToken.status === 403 &&
      viaToken.body.error === 'person_required' &&
      (await stateOf(q1.id)) === 'open' &&
      (await childrenOf(q1.job)) === 0,
    `status ${viaToken.status}, state ${await stateOf(q1.id)}`,
  )
  const q2 = await question()
  const viaSecond = await act(SESSION_SECOND, 'answer_blocker', {
    p_blocker_id: q2.id,
    p_answer: 'Go ahead',
    p_by: 'grant',
  })
  // The office model: a second PERSON has their OWN office, so they are not a second approver in Grant's. Their session
  // cannot answer Grant's question, and nothing is recorded as them or as him, whatever p_by the page claimed.
  check(
    "gateway, a second person's session cannot answer a question in Grant's office, and nothing is recorded as anybody",
    (await stateOf(q2.id)) === 'open' &&
      (await childrenOf(q2.job)) === 0 &&
      (await approvedBy(q2.job)) !== 'second' &&
      (await approvedBy(q2.job)) !== 'grant',
    `status ${viaSecond.status}; state ${await stateOf(q2.id)}; approved_by ${await approvedBy(q2.job)}`,
  )
  const q3 = await question()
  const viaGrantSession = await act(SESSION_GRANT, 'answer_blocker', {
    p_blocker_id: q3.id,
    p_answer: 'Go ahead',
  })
  check(
    "gateway, Grant's own session: recorded as Grant",
    viaGrantSession.status === 200 && (await approvedBy(q3.job)) === 'grant',
    `approved_by ${await approvedBy(q3.job)}`,
  )
  const q4 = await question()
  const viaStranger = await act(SESSION_STRANGER, 'answer_blocker', {
    p_blocker_id: q4.id,
    p_answer: 'Go ahead',
    p_by: 'grant',
  })
  check(
    'gateway, a valid session that is not a member: refused before anything is answered',
    // 401 (no usable session) or 403 (a session for somebody the office does not work for): refused either way
    (viaStranger.status === 401 || viaStranger.status === 403) &&
      (await stateOf(q4.id)) === 'open' &&
      (await childrenOf(q4.job)) === 0,
    `status ${viaStranger.status}`,
  )
  const viaNothing = await act('', 'answer_blocker', { p_blocker_id: q4.id, p_answer: 'Go ahead' })
  check(
    'gateway, no credential at all: 401',
    viaNothing.status === 401 && (await stateOf(q4.id)) === 'open',
    `status ${viaNothing.status}`,
  )
  const q5 = await question()
  await act(SESSION_GRANT, 'answer_blocker', { p_blocker_id: q5.id, p_answer: 'Go ahead' })
  const race = await Promise.all([
    act(SESSION_GRANT, 'answer_blocker', { p_blocker_id: q5.id, p_answer: 'Go ahead' }),
    act(SESSION_GRANT, 'answer_blocker', { p_blocker_id: q5.id, p_answer: 'Go ahead' }),
  ])
  check(
    'gateway, duplicate answers after the first: harmless, still one child',
    race.every((r) => r.status === 200) && (await childrenOf(q5.job)) === 1,
    `${await childrenOf(q5.job)} child(ren)`,
  )
  const q6 = await question()
  const raceOpen = await Promise.all([
    act(SESSION_GRANT, 'answer_blocker', { p_blocker_id: q6.id, p_answer: 'Go ahead' }),
    act(SESSION_GRANT, 'answer_blocker', { p_blocker_id: q6.id, p_answer: 'Go ahead' }),
  ])
  check(
    'gateway, two answers to one open question at once: one child, one recorded approver',
    raceOpen.every((r) => r.status === 200) &&
      (await childrenOf(q6.job)) === 1 &&
      (await approvedBy(q6.job)) === 'grant',
    `approved_by ${await approvedBy(q6.job)}`,
  )
}

// ---- the REAL button path ---------------------------------------------------------------
const secret = await one(
  `insert into vault.secrets (name, secret) values (${lit(`isolated.b2.${run}`)}, 'isolated-fake-telegram-token') returning id::text as id`,
)
await db.execute(`insert into public.telegram_bots (bot_id, username, staff_slug, is_pager, token_ref)
  values (${lit(BOT)}, 'isolated_chief_bot', 'chief-of-staff', true, ${lit(String(secret.id))}) on conflict do nothing`)
let msg = 100000 + (Date.now() % 800000)
/** A plan step's question (two options, the No named) or a Drive-shaped one (three, the last is the No). */
const planQuestion = async (options: string[], declineOption: string | null) => {
  const job = await realParent(db)
  const id = String(
    (
      await one(`insert into public.blockers (office_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option)
        values ((select office_id from public.jobs where job_id = ${lit(job)}::uuid), ${lit(job)}::uuid, ${lit(`Plan step ${run}`)}, 'proof', 'Nothing happens until somebody answers this question.',
          array[${options.map(lit).join(',')}], 'chief-of-staff', false, ${declineOption === null ? 'null' : lit(declineOption)})
        returning blocker_id::text as id`)
    ).id,
  )
  return { job, id }
}
const buttonCase = async (
  label: string,
  actor: string,
  subject: string | null,
  action: 'approve' | 'decline' | 'mute_24h',
  make: () => Promise<{ job: string; id: string }> = question,
) => {
  const q = await make()
  msg += 1
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, blocker_id, purpose, state, message_ref, sent_at, lease_expires_at, office_id)
    values ('telegram', ${lit(`b2:${run}:${msg}`)}, ${lit(BOT)}, ${lit(CHAT)}, ${lit(q.job)}::uuid, ${lit(q.id)}::uuid, 'result', 'sent', ${lit(String(msg))}, app.now_utc(), app.now_utc(), app.operator_office())`)
  await db.execute(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, callback_action)
    values (app.operator_office(), app.unnamed_project(app.operator_office()), 'telegram', ${lit(`${CHAT}:${msg}`)}, ${lit(actor)}, '', ${lit(`telegram:callback:${run}${msg}:${actor}`)}, ${subject === null ? 'null' : lit(subject)}, ${lit(action)})`)
  const done = await processCallbacks(db)
  return { q, done: done.find((d) => d.action === action), label }
}
{
  const g = await buttonCase('Grant approves', CHAT, 'grant', 'approve')
  check(
    'button: Grant approves - acted, recorded as Grant',
    g.done?.outcome === 'acted' && (await approvedBy(g.q.job)) === 'grant',
    JSON.stringify(g.done),
  )
  const s = await buttonCase('stranger approves', STRANGER, null, 'approve')
  check(
    'button: an unknown presser is refused - the question stays open, nothing started',
    s.done?.outcome === 'unresolvable' &&
      (await stateOf(s.q.id)) === 'open' &&
      (await childrenOf(s.q.job)) === 0,
    JSON.stringify(s.done),
  )
  const d = await buttonCase('stranger declines', STRANGER, null, 'decline')
  check(
    'button: an unknown presser cannot decline for him either',
    d.done?.outcome === 'unresolvable' && (await stateOf(d.q.id)) === 'open',
    JSON.stringify(d.done),
  )
  const before = await count(`select count(*)::int as c from public.preference_instructions`)
  const m = await buttonCase('stranger mutes', STRANGER, null, 'mute_24h')
  check(
    'button: an unknown presser cannot mute his pager',
    m.done?.outcome === 'unresolvable' &&
      (await count(`select count(*)::int as c from public.preference_instructions`)) === before,
    JSON.stringify(m.done),
  )
  const gm = await buttonCase('Grant mutes', CHAT, 'grant', 'mute_24h')
  check(
    "button: Grant's mute still works and is attributed to him",
    gm.done?.outcome === 'acted' &&
      (await count(
        `select count(*)::int as c from public.preference_instructions where subject = 'grant'`,
      )) > 0,
    JSON.stringify(gm.done),
  )
}
// The buttons answer through the one door, so a question that is NOT a generation approval is
// answered as what it is: no notebook.generate child, the right option recorded, who pressed.
{
  const answered = async (id: string) =>
    await one(
      `select state::text as s, answered_option as o, answered_by as by from public.blockers where blocker_id = ${lit(id)}::uuid`,
    )
  const yes = await buttonCase('Grant approves a plan step', CHAT, 'grant', 'approve', () =>
    planQuestion(['Yes, do it', 'No, leave it'], 'No, leave it'),
  )
  const ya = await answered(yes.q.id)
  check(
    'button: approving a plan-step question records its first option as Grant and starts no generation',
    yes.done?.outcome === 'acted' &&
      ya.s === 'resolved' &&
      ya.o === 'Yes, do it' &&
      ya.by === 'grant' &&
      (await childrenOf(yes.q.job)) === 0,
    JSON.stringify({ done: yes.done, ya }),
  )
  const no = await buttonCase('Grant declines a plan step', CHAT, 'grant', 'decline', () =>
    planQuestion(['Yes, do it', 'No, leave it'], 'No, leave it'),
  )
  const na = await answered(no.q.id)
  check(
    'button: declining records the option its writer named as the No',
    no.done?.outcome === 'acted' && na.o === 'No, leave it' && na.by === 'grant',
    JSON.stringify(na),
  )
  const drive = await buttonCase(
    'Grant declines a three-option question',
    CHAT,
    'grant',
    'decline',
    () =>
      planQuestion(
        ['Add them as source documents', 'Add them from now on without asking me', 'Ignore these'],
        null,
      ),
  )
  const da = await answered(drive.q.id)
  check(
    'button: a three-option question is declined with its LAST option, not its second',
    drive.done?.outcome === 'acted' && da.o === 'Ignore these',
    JSON.stringify(da),
  )
}
// ---- a button answers the question its message SHOWED (0617), not the newest on the job ----------------
{
  const answeredRow = async (id: string) =>
    await one(
      `select state::text as s, answered_option as o from public.blockers where blocker_id = ${lit(id)}::uuid`,
    )
  const secondQuestion = (job: string) =>
    one(`insert into public.blockers (office_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option)
      values ((select office_id from public.jobs where job_id = ${lit(job)}::uuid), ${lit(job)}::uuid, ${lit(`Second question ${run}`)}, 'proof', 'Nothing happens until somebody answers this question.',
        array['Yes, do it','No, leave it'], 'chief-of-staff', false, 'No, leave it') returning blocker_id::text as id`)
  // 1. The first message's button is pressed AFTER a second question was raised on the same job.
  const q1 = await planQuestion(['Yes, do it', 'No, leave it'], 'No, leave it')
  msg += 1
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, blocker_id, purpose, state, message_ref, sent_at, lease_expires_at, office_id)
    values ('telegram', ${lit(`b2:${run}:${msg}`)}, ${lit(BOT)}, ${lit(CHAT)}, ${lit(q1.job)}::uuid, ${lit(q1.id)}::uuid, 'result', 'sent', ${lit(String(msg))}, app.now_utc(), app.now_utc(), app.operator_office())`)
  const q2 = String((await secondQuestion(q1.job)).id)
  await db.execute(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, callback_action)
    values (app.operator_office(), app.unnamed_project(app.operator_office()), 'telegram', ${lit(`${CHAT}:${msg}`)}, ${lit(CHAT)}, '', ${lit(`telegram:callback:${run}${msg}:s1`)}, 'grant', 'approve')`)
  const p1 = (await processCallbacks(db)).find((d) => d.action === 'approve')
  check(
    'button: an Approve on the FIRST message answers the first question and leaves a newer one untouched',
    p1?.outcome === 'acted' &&
      (await answeredRow(q1.id)).o === 'Yes, do it' &&
      (await stateOf(q2)) === 'open',
    JSON.stringify({ p1, q1: await answeredRow(q1.id), q2: await stateOf(q2) }),
  )
  // 2. The first question was answered some other way; the same stale button must not reach the second.
  const r1 = await planQuestion(['Yes, do it', 'No, leave it'], 'No, leave it')
  msg += 1
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, blocker_id, purpose, state, message_ref, sent_at, lease_expires_at, office_id)
    values ('telegram', ${lit(`b2:${run}:${msg}`)}, ${lit(BOT)}, ${lit(CHAT)}, ${lit(r1.job)}::uuid, ${lit(r1.id)}::uuid, 'result', 'sent', ${lit(String(msg))}, app.now_utc(), app.now_utc(), app.operator_office())`)
  await db.execute(
    `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(r1.id)}::uuid), app.test_office()), ${lit(r1.id)}::uuid, 'No, leave it', 'grant')`,
  )
  const r2 = String((await secondQuestion(r1.job)).id)
  await db.execute(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, callback_action)
    values (app.operator_office(), app.unnamed_project(app.operator_office()), 'telegram', ${lit(`${CHAT}:${msg}`)}, ${lit(CHAT)}, '', ${lit(`telegram:callback:${run}${msg}:s2`)}, 'grant', 'approve')`)
  const p2 = (await processCallbacks(db)).find((d) => d.action === 'approve')
  check(
    'button: a stale Approve after the question was answered says so, and does NOT approve the newer question',
    /already/.test(String(p2?.note)) &&
      (await stateOf(r2)) === 'open' &&
      (await answeredRow(r1.id)).o === 'No, leave it',
    JSON.stringify({ p2, r2: await stateOf(r2) }),
  )
}

check(
  'nothing tried to leave the replica',
  gw.refusedUrls.length === 0,
  JSON.stringify(gw.refusedUrls.slice(0, 3)),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await db.end()
process.exit(failed.length === 0 ? 0 : 1)
