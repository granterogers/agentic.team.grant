/**
 * #394 (Run 4, 0622) - a typed "yes" answers a question he was shown.
 *
 *   npx tsx scripts/isolated/typed-yes.ts <replica-db>
 *
 * The real `app.open_questions_for_reply`, the function the handler asks. A turn is a real Telegram message
 * through the production shape (real-telegram.ts); the question is a blocker on the previous turn's job; what
 * he was SHOWN is a `sent` delivery of that job to his chat. Each case is asked the way the next message asks.
 */
import { isolated } from './guard.ts'
import { BOT, CHAT, realTelegramKey, registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'yes622')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const DOOR = "set local application_name = 'PostgREST 14.5';"
await registerBot(db)

/** A turn from his chat, enqueued as the webhook does. Returns the command and its job. */
const turn = async (text: string, context?: Record<string, unknown>) => {
  const key = realTelegramKey()
  const msg = key.split(':').pop() ?? '1'
  const cmd = await one(`${DOOR}
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values ('telegram', ${lit(`${CHAT}:${msg}`)}, ${lit(CHAT)}, ${lit(text)}, ${lit(key)}, 'grant', ${lit(JSON.stringify(context ?? {}))}::jsonb)
    returning command_id::text as id`)
  const enq = await one(`${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  const v = typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v
  return { command: String(cmd.id), job: String((v as { job_id: string }).job_id) }
}
const ask = async (job: string, sentTo: string | null) => {
  const proj = String((await one(`select app.unnamed_project(app.test_office())::text as p`)).p)
  const b = String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
        values (${lit(proj)}::uuid, ${lit(job)}::uuid, ${lit(`Typed yes proof ${run} ${crypto.randomUUID().slice(0, 6)}`)}, 'isolated', 'nothing happens until answered', array['Yes','No'], 'chief-of-staff', false)
        returning blocker_id::text as id`)
    ).id,
  )
  if (sentTo !== null) {
    await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, job_id, blocker_id, state, lease_expires_at, sent_at, message_ref)
      values ('telegram', ${lit(`typed-yes-${crypto.randomUUID()}`)}, ${lit(BOT)}, ${lit(sentTo)}, 'blocker', ${lit(job)}::uuid, ${lit(b)}::uuid, 'sent', app.now_utc() + interval '1 hour', app.now_utc(), '4242')`)
  }
  return b
}
const forNext = async (command: string) =>
  // only what the reply may BIND to: a question named but not bindable is one the office asks about (0623)
  (
    await db.execute(
      `select id from app.open_questions_for_reply(
         (select office.office_id from public.inbound_commands office where office.command_id = ${lit(command)}::uuid),
         ${lit(command)}::uuid) where bindable`,
    )
  ).rows.map((r) => String((r as { id: string }).id))

const settleAll = () =>
  db.execute(`do $x$ declare r record; begin
    for r in select blocker_id from public.blockers where state = 'open' loop
      perform app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = r.blocker_id), app.test_office()), r.blocker_id, 'No', 'grant');
    end loop; end $x$`)
// ---- shown: delivered to his chat -------------------------------------------------------------------------------
{
  const prev = await turn('do the thing that needs a go-ahead')
  const q = await ask(prev.job, CHAT)
  const next = await turn('yes')
  const got = await forNext(next.command)
  check(
    'a question that was DELIVERED to his chat is what a typed yes answers',
    got.length === 1 && got[0] === q,
    `${String(got.length)} question(s)`,
  )
}
// ---- not shown: never delivered ---------------------------------------------------------------------------------------
{
  const prev = await turn('do another thing that needs a go-ahead')
  await ask(prev.job, null)
  const next = await turn('yes')
  const got = await forNext(next.command)
  check(
    'a question that was raised but NEVER delivered is not answered by a typed yes',
    got.length === 0,
    `${String(got.length)} question(s)`,
  )
}
// ---- delivered somewhere else ---------------------------------------------------------------------------------------------
{
  const prev = await turn('a third thing that needs a go-ahead')
  await ask(prev.job, '999000111')
  const next = await turn('yes')
  const got = await forNext(next.command)
  check(
    'a question delivered to a DIFFERENT chat was not shown in this one',
    got.length === 0,
    `${String(got.length)} question(s)`,
  )
}
// ---- delivery attempted and failed ---------------------------------------------------------------------------------------
{
  const prev = await turn('a fourth thing that needs a go-ahead')
  const q = await ask(prev.job, CHAT)
  await db
    .execute(
      `update public.deliveries set state = 'claimed', sent_at = null, message_ref = null where job_id = ${lit(prev.job)}::uuid and state = 'sent'`,
    )
    .catch(async () => {
      await db.execute(
        `update public.deliveries set state = 'claimed', sent_at = null where job_id = ${lit(prev.job)}::uuid`,
      )
    })
  const next = await turn('yes')
  const got = await forNext(next.command)
  check(
    'a delivery that did not go out (failed or still claimed) is not "shown"',
    got.length === 0 && q.length > 0,
    `${String(got.length)} question(s)`,
  )
}
// ---- two open, one shown: the yes does not guess, and does not pick the unseen one ------------------------------------------
{
  await settleAll()
  const prev = await turn('a fifth thing that needs two go-aheads')
  const shown = await ask(prev.job, CHAT)
  await ask(prev.job, null)
  const next = await turn('yes')
  const got = await forNext(next.command)
  check(
    'with one question shown and one not, only the shown one is a candidate',
    got.length === 1 && got[0] === shown,
    `${String(got.length)} question(s)`,
  )
}
// ---- review B, F1: what he was shown is the office's LAST word, and a result or blocker message -------------------------------
{
  const prev = await turn('an eighth thing that needs a go-ahead')
  const q = await ask(prev.job, null)
  // the question's own message failed; a later PROGRESS note of the same job was sent
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, lease_expires_at, sent_at, message_ref)
    values ('telegram', ${lit(`typed-yes-${crypto.randomUUID()}`)}, ${lit(BOT)}, ${lit(CHAT)}, 'progress', ${lit(prev.job)}::uuid, 'sent', app.now_utc() + interval '1 hour', app.now_utc(), '4243')`)
  const next = await turn('yes')
  const got = await forNext(next.command)
  check(
    'a later PROGRESS note of the job is not the question: a typed yes answers nothing',
    got.length === 0 && q.length > 0,
    `${String(got.length)} question(s)`,
  )
  // a question that WAS shown, then the office said something else to the chat: the yes no longer answers it
  const prev2 = await turn('a ninth thing that needs a go-ahead')
  await ask(prev2.job, CHAT)
  const other = await turn('an unrelated question from him')
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, lease_expires_at, sent_at, message_ref)
    values ('telegram', ${lit(`typed-yes-${crypto.randomUUID()}`)}, ${lit(BOT)}, ${lit(CHAT)}, 'result', ${lit(other.job)}::uuid, 'sent', app.now_utc() + interval '1 hour', clock_timestamp(), '4244')`)
  const next2 = await turn('yes')
  const got2 = await forNext(next2.command)
  check(
    'once the office has said something else to the chat, an older question is not what "yes" answers',
    got2.length === 0,
    `${String(got2.length)} question(s)`,
  )
}
// ---- #392: a FORWARDED yes is somebody else's words ------------------------------------------------------------------------------
{
  await settleAll() // earlier cases left questions shown in this chat: two shown is not what this control is about
  const prev = await turn('a sixth thing that needs a go-ahead')
  const q = await ask(prev.job, CHAT)
  const typed = await turn('yes')
  const a = await forNext(typed.command)
  await settleAll() // otherwise TWO are shown and the forwarded yes answers nothing for the wrong reason
  const prev2 = await turn('a seventh thing that needs a go-ahead')
  const q2 = await ask(prev2.job, CHAT)
  const controlTyped = await turn('yes')
  const c2 = await forNext(controlTyped.command)
  // the forwarded yes must sit directly behind ITS question's turn, or it answers nothing for the wrong reason
  await settleAll()
  const prev3 = await turn('an eighth-and-a-half thing that needs a go-ahead')
  await ask(prev3.job, CHAT)
  const forwarded = await turn('yes', { forwarded: true })
  const b = await forNext(forwarded.command)
  check(
    '#392: the same "yes", forwarded from somebody else, answers nothing - and typed by him it still does (the control)',
    a.length === 1 && a[0] === q && c2.length === 1 && c2[0] === q2 && b.length === 0,
    `typed ${String(a.length)}, forwarded ${String(b.length)}`,
  )
}
// ---- the control: a channel with no delivery record (the dashboard's own chat) is answered as it always was ---------------------
{
  const chat = `dash-${run}`
  const mk = async (text: string) => {
    const dk = `teamhq:chat:proof-${run}-${crypto.randomUUID().slice(0, 8)}`
    const cmd = await one(`${DOOR}
      insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
      values ('teamhq', ${lit(`${chat}:${crypto.randomUUID().slice(0, 8)}`)}, 'grant', ${lit(text)}, ${lit(dk)}, 'grant')
      returning command_id::text as id`)
    const enq = await one(
      `${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`,
    )
    const v = typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v
    return { command: String(cmd.id), job: String((v as { job_id?: string }).job_id ?? '') }
  }
  const prev = await mk('a dashboard thing that needs a go-ahead')
  const q = prev.job === '' ? '' : await ask(prev.job, null)
  const next = await mk('yes')
  const got = q === '' ? [] : await forNext(next.command)
  check(
    "control: on the dashboard chat (no delivery record) a typed yes still finds the previous turn's question",
    q !== '' && got.length === 1 && got[0] === q,
    `${String(got.length)} question(s)`,
  )
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
