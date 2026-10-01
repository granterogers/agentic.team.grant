/**
 * #396 (Run 5, 0623) - a response binds to the question a message ASKED, by name.
 *
 *   npx tsx scripts/isolated/question-binding.ts <replica-db>
 *
 * The real `app.bind_delivery`, `app.approval_for_delivery`, `app.open_questions_for_reply` and the real
 * callback query (`PENDING`), against the replica. Nothing is inferred from time or from "latest": every case
 * that used to answer the wrong question is built the way the Run 5 reconnaissance reproduced it, and each is
 * asked the way the production code asks it.
 */
import { PENDING } from '../../src/channels/callbacks.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, realParent, realTelegramKey, registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'qb623')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
// The office a held row belongs to - what the worker would pass (app.job_office of its claimed job) for these rows.
const officeOfDelivery = (id: string) =>
  `(select d.office_id from public.deliveries d where d.delivery_id = ${lit(id)}::uuid)`
const officeOfCommand = (id: string) =>
  `(select c.office_id from public.inbound_commands c where c.command_id = ${lit(id)}::uuid)`
const DOOR = "set local application_name = 'PostgREST 14.5';"
await registerBot(db)
const BOT2 = '8123456789'

const child = async (parent: string) =>
  String(
    (
      await one(
        `select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, 'verify.ask', '{}'::jsonb)::text as c`,
      )
    ).c,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
const project = async () =>
  String((await one(`select app.unnamed_project(app.test_office())::text as p`)).p)
const ask = async (job: string, what: string, ageMinutes = 0) =>
  String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option, created_at)
        values (${lit(await project())}::uuid, ${lit(job)}::uuid, ${lit(`${what} ${run}`)}, 'isolated', 'nothing', array['Yes, do it','No, leave it'], 'chief-of-staff', false, 'No, leave it', app.now_utc() - ${lit(`${String(ageMinutes)} minutes`)}::interval)
        returning blocker_id::text as id`)
    ).id,
  )
let msg = 100000 + Math.floor(Math.random() * 800000)
const deliver = async (
  job: string,
  opts: {
    blocker?: string | null
    account?: string
    chat?: string
    ago?: number
    purpose?: string
    channel?: string
    threadRef?: string | null
  } = {},
) => {
  msg += 1
  const id = String(
    (
      await one(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, lease_expires_at, sent_at, message_ref, thread_ref, created_at)
        values (${lit(opts.channel ?? 'telegram')}, ${lit(`qb-${crypto.randomUUID()}`)}, ${lit(opts.account ?? BOT)}, ${lit(opts.chat ?? chatNow)}, ${lit(opts.purpose ?? 'result')}, ${lit(job)}::uuid, 'sent',
                app.now_utc() + interval '1 hour', app.now_utc() - ${lit(`${String(opts.ago ?? 0)} minutes`)}::interval, ${lit(String(msg))}, ${opts.threadRef === undefined || opts.threadRef === null ? 'null' : lit(opts.threadRef)}, app.now_utc() - ${lit(`${String(opts.ago ?? 0)} minutes`)}::interval)
        returning delivery_id::text as id`)
    ).id,
  )
  // A question exists before the message that asks it: the fixture's blocker is dated a second before its message.
  if (opts.blocker !== undefined && opts.blocker !== null)
    await db.execute(
      `update public.blockers set created_at = least(created_at, (select created_at from public.deliveries where delivery_id = ${lit(id)}::uuid) - interval '1 second') where blocker_id = ${lit(opts.blocker)}::uuid`,
    )
  const bound =
    opts.blocker === undefined || opts.blocker === null
      ? null
      : (
          await one(
            `select app.bind_delivery(${officeOfDelivery(id)}, ${lit(id)}::uuid, ${lit(opts.blocker)}::uuid) as b`,
          )
        ).b
  return { id, ref: String(msg), bound }
}
const forDelivery = async (d: string) =>
  ((
    await one(
      `select app.approval_for_delivery((select dl.office_id from public.deliveries dl where dl.delivery_id = ${lit(d)}::uuid), ${lit(d)}::uuid)::text as b`,
    )
  ).b ?? null) as string | null
const answer = async (b: string, by = 'grant') =>
  JSON.parse(
    String(
      (
        await one(
          `select app.hq_answer_blocker(${lit(b)}::uuid, 'Yes, do it', ${lit(by)})::text as r`,
        )
      ).r,
    ),
  ) as Record<string, unknown>
const stateOf = async (b: string) =>
  String(
    (await one(`select state::text as s from public.blockers where blocker_id = ${lit(b)}::uuid`))
      .s,
  )
let chatNow = CHAT
const turn = async (text: string, context?: Record<string, unknown>, account = BOT) => {
  const key = `telegram:message:${account}:${chatNow}:${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`
  const cmd = await one(`${DOOR}
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values ('telegram', ${lit(`${chatNow}:${key.split(':').pop()}`)}, ${lit(chatNow)}, ${lit(text)}, ${lit(key)}, 'grant', ${lit(JSON.stringify(context ?? {}))}::jsonb)
    returning command_id::text as id`)
  const enq = await one(`${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  const v = typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v
  return { command: String(cmd.id), job: String((v as { job_id: string }).job_id) }
}
const forNext = async (command: string) =>
  (
    await db.execute(
      `select id, bindable from app.open_questions_for_reply(${officeOfCommand(command)}, ${lit(command)}::uuid)`,
    )
  ).rows.map((r) => ({
    id: String((r as { id: string }).id),
    bindable: (r as { bindable: boolean }).bindable,
  }))

const root = await realParent(db)

// ---- old question, new question, one job ---------------------------------------------------------------------
{
  const j = await child(root)
  const q1 = await ask(j, 'Q1 first', 10)
  const q2 = await ask(j, 'Q2 second', 5)
  const d1 = await deliver(j, { blocker: q1, ago: 9 })
  const d2 = await deliver(j, { blocker: q2, ago: 4 })
  check(
    "each message is bound to the question it asked; pressing Q1's message answers Q1 and leaves Q2 open",
    (await forDelivery(d1.id)) === q1 && (await forDelivery(d2.id)) === q2,
    `${String((await forDelivery(d1.id)) === q1)}/${String((await forDelivery(d2.id)) === q2)}`,
  )
  const r = await answer((await forDelivery(d1.id)) as string)
  check(
    'and it does',
    r.ok !== false && (await stateOf(q1)) === 'resolved' && (await stateOf(q2)) === 'open',
    `${await stateOf(q1)}/${await stateOf(q2)}`,
  )
  const again = await answer(q1)
  check(
    'the same message answered twice is harmless (already answered, Q2 untouched)',
    again.already === true && (await stateOf(q2)) === 'open',
    JSON.stringify(again).slice(0, 70),
  )
}
// ---- reordered delivery: the message about Q1 was RECORDED after Q2's -------------------------------------------
{
  const j = await child(root)
  const q1 = await ask(j, 'R1', 10)
  const q2 = await ask(j, 'R2', 5)
  const d2 = await deliver(j, { blocker: q2, ago: 4 })
  const d1 = await deliver(j, { blocker: q1, ago: 1 }) // Q1's message reached the channel later
  check(
    "reordered delivery: the response follows the id, not the arrival order (Q1's late message still means Q1)",
    (await forDelivery(d1.id)) === q1 && (await forDelivery(d2.id)) === q2,
    `${String((await forDelivery(d1.id)) === q1)}`,
  )
}
// ---- delayed response --------------------------------------------------------------------------------------------
{
  const j = await child(root)
  const q1 = await ask(j, 'D1', 600)
  const d1 = await deliver(j, { blocker: q1, ago: 590 })
  await ask(j, 'D2 much later', 1)
  const b = await forDelivery(d1.id)
  const r = await answer(b as string)
  check(
    'a response 10 hours later still resolves the question that message asked, not the newest',
    b === q1 && r.ok !== false && (await stateOf(q1)) === 'resolved',
    `${await stateOf(q1)}`,
  )
}
// ---- foreign, fabricated, unnamed ------------------------------------------------------------------------------------
{
  const jA = await child(root)
  const jB = await child(root)
  const qB = await ask(jB, 'foreign B')
  const qA0 = await ask(jA, 'own A first', 5)
  const dA = await deliver(jA, { blocker: null })
  const foreign = (
    await one(
      `select app.bind_delivery(${officeOfDelivery(dA.id)}, ${lit(dA.id)}::uuid, ${lit(qB)}::uuid) as b`,
    )
  ).b
  const fabricated = (
    await one(
      `select app.bind_delivery(${officeOfDelivery(dA.id)}, ${lit(dA.id)}::uuid, gen_random_uuid()) as b`,
    )
  ).b
  check(
    "a delivery cannot name another job's question, nor one that does not exist: it binds nothing",
    foreign === false && fabricated === false && (await forDelivery(dA.id)) === null,
    `${String(foreign)}/${String(fabricated)}/${String(await forDelivery(dA.id))}`,
  )
  const qA = qA0
  const named = await one(
    `select app.bind_delivery(${officeOfDelivery(dA.id)}, ${lit(dA.id)}::uuid, ${lit(qA)}::uuid) as b`,
  )
  const rename = await db
    .execute(
      `update public.deliveries set blocker_id = ${lit(qB)}::uuid where delivery_id = ${lit(dA.id)}::uuid`,
    )
    .then(
      () => 'changed',
      (e: unknown) => String((e as Error).message),
    )
  check(
    'a message names its question once: it cannot be renamed afterwards',
    named.b === true && /written once|not its own|came after/.test(rename),
    rename.slice(0, 80),
  )
  const plain = await deliver(jA, { blocker: null })
  check(
    'a message that asked nothing answers nothing (an unbound press has no question)',
    (await forDelivery(plain.id)) === null,
    String(await forDelivery(plain.id)),
  )
}
// ---- cross-bot message id collision ------------------------------------------------------------------------------------
{
  const jA = await child(root)
  const jB = await child(root)
  const qA = await ask(jA, 'bot A question')
  const qB = await ask(jB, 'bot B question')
  msg += 1
  const same = String(msg)
  for (const [job, q, acct] of [
    [jA, qA, BOT],
    [jB, qB, BOT2],
  ] as const) {
    const d = String(
      (
        await one(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, lease_expires_at, sent_at, message_ref)
          values ('telegram', ${lit(`qb-${crypto.randomUUID()}`)}, ${lit(acct)}, ${lit(CHAT)}, 'result', ${lit(job)}::uuid, 'sent', app.now_utc() + interval '1 hour', app.now_utc(), ${lit(same)}) returning delivery_id::text as id`)
      ).id,
    )
    await one(
      `select app.bind_delivery(${officeOfDelivery(d)}, ${lit(d)}::uuid, ${lit(q)}::uuid) as b`,
    )
  }
  const press = async (account: string) => {
    const key = `telegram:callback:${account}:${crypto.randomUUID().slice(0, 8)}`
    const c =
      await one(`${DOOR} insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, callback_action, subject)
      values ('telegram', ${lit(`${CHAT}:${same}`)}, ${lit(CHAT)}, '', ${lit(key)}, 'approve', 'grant') returning command_id::text as id`)
    const rows = (await db.execute(PENDING(500))).rows as {
      command_id: string
      delivery_id: string | null
      job_id: string | null
    }[]
    return rows.filter((r) => r.command_id === String(c.id))
  }
  const viaA = await press(BOT)
  const viaB = await press(BOT2)
  check(
    "two bots numbering the same message id in one chat: a press through bot A finds exactly bot A's delivery, and bot B's finds B's",
    viaA.length === 1 && viaA[0]?.job_id === jA && viaB.length === 1 && viaB[0]?.job_id === jB,
    `${String(viaA.length)} via A (${String(viaA[0]?.job_id === jA)}), ${String(viaB.length)} via B (${String(viaB[0]?.job_id === jB)})`,
  )
}
// ---- typed responses --------------------------------------------------------------------------------------------------
{
  // 1. one question shown, last thing sent: a plain yes binds
  chatNow = String(2000000 + 1 * 7 + Math.floor(Math.random() * 100000) * 10)
  const j = await child(await turn('a thing that needs a go-ahead').then((t) => t.job))
  const q = await ask(j, 'typed one')
  await deliver(j, { blocker: q })
  const yes = await turn('yes')
  const got = await forNext(yes.command)
  check(
    'one question shown and last: a plain yes binds to exactly it',
    got.length === 1 && got[0]?.id === q && got[0]?.bindable === true,
    JSON.stringify(got).slice(0, 80),
  )
}
{
  // 2. TWO shown and open: never guessed
  chatNow = String(2000000 + 2 * 7 + Math.floor(Math.random() * 100000) * 10)
  const t = await turn('two things need go-aheads')
  const j1 = await child(t.job)
  const j2 = await child(t.job)
  const qa = await ask(j1, 'shown A')
  const qb = await ask(j2, 'shown B')
  await deliver(j1, { blocker: qa, ago: 2 })
  await deliver(j2, { blocker: qb, ago: 1 })
  const yes = await turn('yes')
  const got = await forNext(yes.command)
  check(
    'two questions shown and open: a bare yes is not bound to either - both come back, unbindable, so the office asks which',
    got.length >= 2 &&
      got.every((g) => g.bindable === false) &&
      got.some((g) => g.id === qa) &&
      got.some((g) => g.id === qb),
    `${String(got.length)} rows, bindable ${got.map((g) => String(g.bindable)).join('/')}`,
  )
}
{
  // 3. a REPLY to the older message answers that one, exactly
  chatNow = String(2000000 + 3 * 7 + Math.floor(Math.random() * 100000) * 10)
  const t = await turn('two more need go-aheads')
  const j1 = await child(t.job)
  const j2 = await child(t.job)
  const qa = await ask(j1, 'reply A')
  const qb = await ask(j2, 'reply B')
  const da = await deliver(j1, { blocker: qa, ago: 2 })
  await deliver(j2, { blocker: qb, ago: 1 })
  const yes = await turn('yes', { reply_to_message_id: da.ref })
  const got = await forNext(yes.command)
  check(
    'a yes that REPLIES to the older message answers exactly that question',
    got.length === 1 && got[0]?.id === qa && got[0]?.bindable === true,
    JSON.stringify(got).slice(0, 90),
  )
  const reply2 = await turn('yes', { reply_to_message_id: '999999999' })
  check(
    'a reply to a message that asked nothing answers nothing',
    (await forNext(reply2.command)).length === 0,
    'none',
  )
}
{
  // 4. the office spoke since: not bindable, not silent
  chatNow = String(2000000 + 4 * 7 + Math.floor(Math.random() * 100000) * 10)
  const t = await turn('a thing then something else')
  const j = await child(t.job)
  const q = await ask(j, 'spoke since')
  await deliver(j, { blocker: q, ago: 3 })
  await deliver(j, { blocker: null, ago: 1 })
  const yes = await turn('yes')
  const got = await forNext(yes.command)
  check(
    'the office said something else after the question: the question comes back NOT bindable (named, not answered)',
    got.length === 1 && got[0]?.bindable === false,
    JSON.stringify(got).slice(0, 80),
  )
}
{
  // 5. Slack thread: a reply under the ONE question's thread binds; a thread with two open questions does not
  chatNow = String(2000000 + 5 * 7 + Math.floor(Math.random() * 100000) * 10)
  const t = await turn('slack thread proof')
  const j = await child(t.job)
  const q1 = await ask(j, 'slack one')
  const d1 = await deliver(j, {
    blocker: q1,
    channel: 'slack',
    account: 'T0TEAM',
    chat: 'C0SLACK1',
    threadRef: '1790000000.000100',
  })
  void d1
  const slackTurn = async (threadTs: string | null) => {
    const cmd = await one(`${DOOR}
      insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
      values ('slack', ${lit(`C0SLACK1:1790000${String(Math.floor(Math.random() * 999999))}.000200`)}, 'U0GRANT', 'yes', ${lit(`slack:message:C0SLACK1:${crypto.randomUUID().slice(0, 10)}`)}, 'grant', ${lit(JSON.stringify(threadTs === null ? {} : { thread_ts: threadTs }))}::jsonb)
      returning command_id::text as id`)
    return String(cmd.id)
  }
  const inThread = await forNext(await slackTurn('1790000000.000100'))
  check(
    'a Slack reply under the thread of ONE open question binds to it',
    inThread.length === 1 && inThread[0]?.id === q1 && inThread[0]?.bindable === true,
    JSON.stringify(inThread).slice(0, 90),
  )
  const q2 = await ask(j, 'slack two')
  await deliver(j, {
    blocker: q2,
    channel: 'slack',
    account: 'T0TEAM',
    chat: 'C0SLACK1',
    threadRef: '1790000000.000100',
  })
  const flat = await forNext(await slackTurn('1790000000.000100'))
  check(
    'a flat Slack thread holding TWO open questions cannot say which: not bound to either',
    flat.length >= 2 && flat.every((g) => !g.bindable),
    flat.map((g) => String(g.bindable)).join('/'),
  )
  const elsewhere = await forNext(await slackTurn('1790000999.000900'))
  check(
    'a reply in some other thread answers nothing',
    elsewhere.length === 0,
    String(elsewhere.length),
  )
}
{
  // 6. cross-channel: a question shown only on Slack is not answered by a Telegram yes
  chatNow = String(2000000 + 6 * 7 + Math.floor(Math.random() * 100000) * 10)
  const t = await turn('cross channel proof')
  const j = await child(t.job)
  const q = await ask(j, 'slack only')
  await deliver(j, { blocker: q, channel: 'slack', account: 'T0TEAM', chat: 'C0SLACK2' })
  const yes = await turn('yes')
  const got = await forNext(yes.command)
  check(
    'a question shown only on Slack is not answered by a Telegram yes',
    !got.some((g) => g.id === q),
    String(got.length),
  )
}
{
  // 7. legacy: a delivery from before the migration with no name binds only when its job had exactly one question
  chatNow = String(2000000 + 7 * 7 + Math.floor(Math.random() * 100000) * 10)
  await db.execute(
    `update public.system_config set value = to_jsonb((app.now_utc() + interval '1 minute')::text) where key = 'delivery.bindings_from'`,
  )
  const one1 = await child(root)
  const only = await ask(one1, 'legacy only', 20)
  const legacyOne = await deliver(one1, { blocker: null, ago: 15 })
  const two = await child(root)
  await ask(two, 'legacy first', 20)
  await ask(two, 'legacy second', 18)
  const legacyTwo = await deliver(two, { blocker: null, ago: 15 })
  check(
    'a delivery from before the migration binds only when it is provable (its job had exactly one question); ambiguous ones bind nothing',
    (await forDelivery(legacyOne.id)) === only && (await forDelivery(legacyTwo.id)) === null,
    `${String((await forDelivery(legacyOne.id)) === only)}/${String(await forDelivery(legacyTwo.id))}`,
  )
  await db.execute(
    `update public.system_config set value = to_jsonb(app.now_utc()::text) where key = 'delivery.bindings_from'`,
  )
  const after = await deliver(one1, { blocker: null })
  check(
    'and one made after the cutoff with no name binds nothing at all',
    (await forDelivery(after.id)) === null,
    String(await forDelivery(after.id)),
  )
}

// ---- one conversation, several channels ------------------------------------------------------------------------------
{
  // (a) the SAME question shown on Telegram and on Slack, answered from both: performed once
  const j = await child(root)
  const q = await ask(j, 'shown twice')
  const tg = await deliver(j, { blocker: q, chat: '4110001', ago: 2 })
  const sl = await deliver(j, {
    blocker: q,
    channel: 'slack',
    account: 'T0TEAM',
    chat: 'C0BOTH01',
    ago: 1,
  })
  const first = await answer((await forDelivery(sl.id)) as string)
  const second = await answer((await forDelivery(tg.id)) as string)
  check(
    'a question shown on two channels and answered from both is performed once: the second press finds it already answered',
    first.ok !== false && second.already === true && (await stateOf(q)) === 'resolved',
    `${JSON.stringify(first).slice(0, 40)} then ${JSON.stringify(second).slice(0, 50)}`,
  )
}
{
  // (b) dashboard -> Telegram and Telegram -> dashboard: a channel answers only what IT showed
  const dash = async (channel: 'teamhq' | 'voice', session: string, text: string) => {
    const key =
      channel === 'voice'
        ? `voice:turn:s${session}.${String(Math.floor(Math.random() * 9000) + 1000)}`
        : `teamhq:message:${crypto.randomUUID().replace(/-/g, '')}`
    const cmd = await one(`${DOOR}
      insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
      values (${lit(channel)}, ${lit(`${session}:${crypto.randomUUID().slice(0, 8)}`)}, 'grant', ${lit(text)}, ${lit(key)}, 'grant')
      returning command_id::text as id`)
    const enq = await one(
      `${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`,
    )
    const v = typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v
    return { command: String(cmd.id), job: String((v as { job_id?: string }).job_id ?? '') }
  }
  const s1 = run.slice(0, 6)
  const first = await dash('teamhq', s1, 'a dashboard question needs a go-ahead')
  const qd = await ask(first.job, 'raised in the dashboard')
  chatNow = String(3300000 + Math.floor(Math.random() * 90000))
  const tgYes = await turn('yes')
  const got = await forNext(tgYes.command)
  check(
    'HQ -> Telegram: a Telegram yes does not answer a question only the dashboard raised',
    !got.some((g) => g.id === qd),
    `${String(got.length)} rows`,
  )
  const dashYes = await dash('teamhq', s1, 'yes')
  const dgot = await forNext(dashYes.command)
  check(
    'the dashboard yes, in the conversation that raised it, binds (exactly one open in the turn before)',
    dgot.length === 1 && dgot[0]?.id === qd && dgot[0]?.bindable === true,
    JSON.stringify(dgot).slice(0, 80),
  )
  // two open in the same dashboard turn: named, never guessed
  const s2 = `${run.slice(0, 5)}b`
  const m = await dash('teamhq', s2, 'two dashboard questions')
  const mj1 = await child(m.job)
  const mj2 = await child(m.job)
  await ask(mj1, 'dash A')
  await ask(mj2, 'dash B')
  const dyes = await dash('teamhq', s2, 'yes')
  const two = await forNext(dyes.command)
  check(
    'two open in the dashboard turn: a bare yes binds to neither',
    two.filter((g) => g.bindable).length === 0,
    String(two.length),
  )
  const rows2 = (
    await db.execute(
      `select bindable from app.open_questions_for_reply(${officeOfCommand(dyes.command)}, ${lit(dyes.command)}::uuid)`,
    )
  ).rows as { bindable: boolean }[]
  check(
    'but both are named, so the office can ask which',
    rows2.length >= 2 && rows2.every((r) => r.bindable === false),
    String(rows2.length),
  )
  // voice: the same rule under a voice session
  const vs = `${run.slice(0, 4)}v`
  const v1 = await dash('voice', vs, 'a spoken request that needs a go-ahead')
  const vq = await ask(v1.job, 'raised by voice')
  const vyes = await dash('voice', vs, 'yes')
  const vgot = await forNext(vyes.command)
  check(
    'voice is no weaker than text: a spoken yes binds to the ONE question the spoken turn raised',
    vgot.length === 1 && vgot[0]?.id === vq,
    JSON.stringify(vgot).slice(0, 70),
  )
}
{
  // dashboard and voice bind by the session's own turn chain: an intervening turn, or twelve hours, ends the binding
  const dash2 = async (
    channel: 'teamhq' | 'voice',
    session: string,
    text: string,
    ageHours = 0,
  ) => {
    const key =
      channel === 'voice'
        ? `voice:turn:s${session}.${String(Math.floor(Math.random() * 9000) + 1000)}`
        : `teamhq:message:${crypto.randomUUID().replace(/-/g, '')}`
    const cmd = await one(`${DOOR}
      insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, received_at)
      values (${lit(channel)}, ${lit(`${session}:${crypto.randomUUID().slice(0, 8)}`)}, 'grant', ${lit(text)}, ${lit(key)}, 'grant', app.now_utc() - ${lit(`${String(ageHours)} hours`)}::interval)
      returning command_id::text as id`)
    const enq = await one(
      `${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`,
    )
    const v = typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v
    return { command: String(cmd.id), job: String((v as { job_id?: string }).job_id ?? '') }
  }
  for (const channel of ['teamhq', 'voice'] as const) {
    const sess = `${run.slice(0, 4)}${channel === 'voice' ? 'w' : 'h'}`
    const t1 = await dash2(channel, sess, 'a thing that needs a go-ahead')
    const q = await ask(t1.job, `raised by ${channel}`)
    await dash2(channel, sess, 'an unrelated question in between')
    const yes = await dash2(channel, sess, 'yes')
    const got = await forNext(yes.command)
    check(
      `${channel}: a yes after an INTERVENING turn is not bound to the earlier turn's question`,
      !got.some((g) => g.id === q && g.bindable),
      JSON.stringify(got).slice(0, 80),
    )
    const sess2 = `${sess}x`
    const old1 = await dash2(channel, sess2, 'an old thing that needed a go-ahead', 13)
    const oq = await ask(old1.job, `stale ${channel}`)
    const late = await dash2(channel, sess2, 'yes')
    const lgot = await forNext(late.command)
    check(
      `${channel}: a yes thirteen hours later answers nothing`,
      !lgot.some((g) => g.id === oq),
      String(lgot.length),
    )
  }
}
{
  // (c) stale channel: shown more than twelve hours ago is not "what he was shown"
  const t = await turn('a stale channel proof')
  const j = await child(t.job)
  const q = await ask(j, 'stale channel')
  await deliver(j, { blocker: q, ago: 13 * 60 })
  const yes = await turn('yes')
  const got = await forNext(yes.command)
  check(
    'a question shown thirteen hours ago binds to nothing',
    !got.some((g) => g.bindable),
    String(got.length),
  )
}

// ---- findings of the first independent review ----------------------------------------------------------------------------
{
  // 1. an acknowledgement pinned Q2 as "what I am waiting on"; a reply that POINTS at Q1's old message must not answer Q2
  const t = await turn('review finding one')
  const j1 = await child(t.job)
  const j2 = await child(t.job)
  const q1 = await ask(j1, 'F1 first')
  const q2 = await ask(j2, 'F1 second')
  const d1 = await deliver(j1, { blocker: q1, ago: 0 })
  await deliver(j2, { blocker: q2, ago: 0 })
  await answer(q1)
  await db.execute(
    `update public.jobs set pinned_config = coalesce(pinned_config, '{}'::jsonb) || jsonb_build_object('awaiting_answer', ${lit(q2)}) where job_id = ${lit(t.job)}::uuid`,
  )
  const yes = await turn('yes', { reply_to_message_id: d1.ref })
  const got = await forNext(yes.command)
  check(
    'a reply that points at an old message never answers a DIFFERENT question the office was waiting on',
    !got.some((g) => g.id === q2 && g.bindable),
    JSON.stringify(got).slice(0, 100),
  )
  // the previous turn is now the reply above: the office's last reply (to that turn) is what pins the awaiting question
  await db.execute(
    `update public.jobs set pinned_config = coalesce(pinned_config, '{}'::jsonb) || jsonb_build_object('awaiting_answer', ${lit(q2)}) where job_id = ${lit(yes.job)}::uuid`,
  )
  const plain = await turn('yes')
  const pg = await forNext(plain.command)
  check(
    'the awaiting question still binds a plain yes (control)',
    pg.some((g) => g.id === q2 && g.bindable),
    JSON.stringify(pg).slice(0, 80),
  )
}
{
  // 5. a synthetic command may answer only harness work
  const t = await turn('review finding five')
  const j = await child(t.job)
  const q = await ask(j, 'F5 real question')
  await deliver(j, { blocker: q })
  const cmd =
    await one(`insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, synthetic)
    values ('telegram', ${lit(`${chatNow}:9999`)}, ${lit(chatNow)}, 'yes', ${lit(`telegram:message:${BOT}:${chatNow}:9999`)}, 'grant', true) returning command_id::text as id`)
  const rows = await forNext(String(cmd.id))
  const harnessJob = String((await one(`select app.harness_job(${lit(j)}::uuid)::text as h`)).h)
  check(
    "a synthetic typed yes is not offered a real job's question",
    harnessJob === 'true' || !rows.some((r) => r.id === q),
    `harness ${harnessJob}, ${String(rows.length)} rows`,
  )
}
{
  // 6 and 9. a message cannot be turned into the answer to a question raised after it; a job-less delivery names nothing
  const j = await child(root)
  const early = await deliver(j, { blocker: null, ago: 5 })
  const late = await ask(j, 'F6 raised after the message')
  const r = (
    await one(
      `select app.bind_delivery(${officeOfDelivery(early.id)}, ${lit(early.id)}::uuid, ${lit(late)}::uuid) as b`,
    )
  ).b
  check(
    'a message made before a question existed cannot name it',
    r === false && (await forDelivery(early.id)) === null,
    String(r),
  )
  const orphan = String(
    (
      await one(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, lease_expires_at, sent_at, message_ref)
    values ('telegram', ${lit(`qb-${crypto.randomUUID()}`)}, ${lit(BOT)}, ${lit(chatNow)}, 'notice', 'sent', app.now_utc() + interval '1 hour', app.now_utc(), '8') returning delivery_id::text as id`)
    ).id,
  )
  const nullJobBlocker = String(
    (
      await one(`insert into public.blockers (project_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option)
    values (app.unnamed_project(app.test_office()), ${lit(`F9 ${run}`)}, 'isolated', 'nothing', array['Yes','No'], 'chief-of-staff', false, 'No') returning blocker_id::text as id`).catch(
        () => ({ id: '' }),
      )
    ).id,
  )
  if (nullJobBlocker !== '') {
    const o = (
      await one(
        `select app.bind_delivery(${officeOfDelivery(orphan)}, ${lit(orphan)}::uuid, ${lit(nullJobBlocker)}::uuid) as b`,
      )
    ).b
    check('a delivery with no job names no question, even a job-less one', o === false, String(o))
  }
}
{
  // 3. the forwarded flag cannot be cleared by a second write of the same message
  const t = await turn('a forwarded thing', { forwarded: true })
  await db.execute(
    `update public.inbound_commands set context = '{"thread_ts":"1.1"}'::jsonb where command_id = ${lit(t.command)}::uuid`,
  )
  const c = await one(
    `select context ->> 'forwarded' as f from public.inbound_commands where command_id = ${lit(t.command)}::uuid`,
  )
  check(
    'an upsert of the same message cannot clear the forwarded flag',
    c.f === 'true',
    String(c.f),
  )
}
void realTelegramKey
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
