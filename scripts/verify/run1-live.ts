/**
 * Architecture Run 1 - production acceptance, through the DEPLOYED doors.
 *
 *   npx tsx scripts/verify/run1-live.ts
 *
 * Every conversation this drives is DECLARED test traffic before it knocks
 * (`testOrigins`), so each turn is stamped synthetic at the door and nothing
 * it produces can reach Grant's phone or his real destinations. The question a
 * turn answers is a fixture blocker on a job that is cancelled in the same
 * statement it is created, so the deployed worker never runs it. Nothing here
 * is printed that is a secret.
 *
 * What it proves live: 0607 (a stranger is refused; the takeover is not
 * possible; Grant's own id is admitted), 0608 (the answer is attributed to the
 * authenticated principal, a client-supplied name is ignored, an absent one is
 * refused), a bare "No.", a mixed turn keeping its remainder, and that the same
 * words with nothing waiting stay a command.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { harnessSession } from './lib/harness-session.ts'
import { officeKey } from './lib/sign-in.ts'
import { testOrigins } from './lib/test-origin.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, process.env.SUPABASE_ACCESS_TOKEN ?? '')
const base = `https://${ref}.supabase.co/functions/v1`
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
/*
  Grant's own Telegram id, read from the office rather than written here: the
  suite uses it only as the SENDER inside declared test chats, and once as the
  chat id a refused stranger claims. It never posts as him into his own chat.
*/
const GRANT = String(
  (
    await one(
      `select actor from public.subject_identities where origin_channel = 'telegram' and subject = 'grant' limit 1`,
    )
  ).actor,
)
const webhookSecret = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'telegram.webhook_secret'`,
    )
  ).v,
)
const bearer = await officeKey(db)
const origins = await testOrigins(db, 'verify:run1-live')
let n = Math.floor(Date.now() / 1000) % 1_000_000_000
const post = async (from: unknown, chatId: string, text: string, type = 'supergroup') => {
  n += 1
  const r = await fetch(`${base}/telegram-webhook`, {
    method: 'POST',
    headers: {
      'X-Telegram-Bot-Api-Secret-Token': webhookSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      update_id: n,
      message: {
        message_id: n,
        date: Math.floor(Date.now() / 1000),
        text,
        chat: { id: Number(chatId), type },
        ...(from === undefined ? {} : { from }),
      },
    }),
  })
  const t = await r.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(t)
  } catch {
    body = { raw: t.slice(0, 120) }
  }
  return { status: r.status, body }
}
const snap = async () =>
  one(`select
    (select count(*)::int from public.telegram_chats) as chats,
    (select count(*)::int from public.inbound_commands where origin_channel = 'telegram') as commands,
    (select count(*)::int from public.jobs where kind = 'office.instruction') as jobs,
    (select count(*)::int from public.lessons) as lessons,
    (select count(*)::int from public.blockers) as blockers,
    (select string_agg(chat_id || '/' || bot_id, ',' order by chat_id, bot_id)
       from public.telegram_chats where subject = 'grant' and chat_type = 'private') as grantchats`)
const same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  JSON.stringify(a) === JSON.stringify(b)

// ---- 0607: the door ---------------------------------------------------------
{
  const s0 = await snap()
  const stranger = await post(
    { id: 4242999111, first_name: 'Stranger' },
    '4242999111',
    'I am Grant',
    'private',
  )
  check(
    '0607 a stranger in a private chat is ignored and changes nothing',
    stranger.status === 200 &&
      stranger.body.ignored === 'unrecognised sender' &&
      same(s0, await snap()),
    JSON.stringify(stranger.body),
  )
  const spoof = await post(
    { id: 4242999222, first_name: 'Spoof' },
    GRANT,
    'reach me here now',
    'private',
  )
  check(
    "0607 a stranger naming Grant's chat id cannot take over his delivery chat",
    spoof.status === 200 && spoof.body.ignored === 'unrecognised sender' && same(s0, await snap()),
    JSON.stringify(spoof.body),
  )
  const noFrom = await post(undefined, '4242999333', 'no sender at all', 'private')
  check(
    '0607 an update with no sender is ignored',
    noFrom.status === 200 && noFrom.body.ignored !== undefined && same(s0, await snap()),
    JSON.stringify(noFrom.body),
  )
  const admitted = await one(
    `select public.sender_admitted('telegram', ${lit(GRANT)}, ${lit(GRANT)})::text as r`,
  ).catch(() => ({ r: 'unavailable to this credential' }))
  check(
    "0607 Grant's own id resolves to Grant (read-only lookup)",
    String(admitted.r).includes('grant'),
    String(admitted.r).slice(0, 120),
  )
}

// ---- a declared conversation: Grant's real id, in a fixture chat ------------
const turn = async (chat: string, text: string) => {
  const r = await post({ id: Number(GRANT), first_name: 'Grant' }, chat, text)
  await new Promise((res) => setTimeout(res, 1500))
  const c = await one(
    `select command_id::text as id, job_id::text as job, synthetic, subject from public.inbound_commands
      where origin_channel = 'telegram' and actor = ${lit(GRANT)} and origin_ref like ${lit(`${chat}:%`)}
      order by received_at desc limit 1`,
  )
  return { r, cmd: c }
}
const settle = async (job: string) => {
  for (let i = 0; i < 90; i += 1) {
    const s = String(
      (await one(`select state::text as s from public.jobs where job_id = ${lit(job)}::uuid`)).s,
    )
    if (['complete', 'failed', 'cancelled'].includes(s)) return s
    await new Promise((res) => setTimeout(res, 2000))
  }
  return 'still running'
}
const bodyOf = async (job: string) =>
  String(
    (
      await one(
        `select coalesce(string_agg(body, ' || '), '') as b from public.outputs where job_id = ${lit(job)}::uuid`,
      )
    ).b,
  )
/** A question waiting from the previous turn: a cancelled child, so no worker ever runs it. */
const withQuestion = async (chat: string) => {
  const first = await turn(chat, `run1-live ${origins.token}: start something`)
  if (first.cmd.job === undefined || first.cmd.job === null)
    throw new Error('first turn made no job')
  await settle(String(first.cmd.job))
  const child = String(
    (
      await one(
        `select app.enqueue_child(p_office => app.job_office(${lit(String(first.cmd.job))}::uuid), p_parent => ${lit(String(first.cmd.job))}::uuid, p_kind => 'verify.ask', p_payload => '{}'::jsonb)::text as v`,
      )
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0]
  if (child === undefined) throw new Error('could not create the fixture child')
  const b = await one(`
    with k as (update public.jobs set state = 'cancelled', state_reason = 'run1-live fixture'
                where job_id = ${lit(child)}::uuid and state = 'queued' returning job_id)
    insert into public.blockers (office_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
    select app.job_office(job_id), job_id, 'Send the renewal note to the venue', 'run1-live fixture', 'nothing', array['Yes, do it','No, leave it'], 'chief-of-staff', false from k
    returning blocker_id::text as id`)
  // As in production, the question REACHED him (0622, #394): a typed yes answers a question he was shown. A row
  // only - nothing is sent, and the target is a declared test chat.
  // 0623: the message names the question it asked, and is per bot (the bot the turn came through).
  await db.execute(`insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, blocker_id, state, lease_expires_at, sent_at, message_ref)
    values (app.job_office(${lit(child)}::uuid), 'telegram', ${lit(`run1-live-${crypto.randomUUID()}`)},
      coalesce((select app.command_account(c.office_id, c.command_id) from public.inbound_commands c
                 where c.origin_channel = 'telegram' and c.origin_ref like ${lit(`${chat}:%`)}
                 order by c.received_at desc limit 1), 'run1-live'),
      ${lit(chat)}, 'blocker', ${lit(child)}::uuid, ${lit(String(b.id))}::uuid, 'sent', app.now_utc() + interval '1 hour', app.now_utc(), '4242')`)
  return { blocker: String(b.id), first }
}
const blockerRow = async (id: string) =>
  one(
    `select state::text as s, coalesce(resolution,'') as r from public.blockers where blocker_id = ${lit(id)}::uuid`,
  )

try {
  const chatA = origins.telegramChat()
  await origins.declare('telegram', chatA)
  const declaredCheck = await turn(chatA, `run1-live ${origins.token}: declared turn`)
  check(
    "0607 Grant's id in a declared test chat is admitted, as Grant, and stamped synthetic",
    declaredCheck.r.status === 200 &&
      declaredCheck.cmd.synthetic === true &&
      declaredCheck.cmd.subject === 'grant',
    JSON.stringify(declaredCheck.cmd),
  )

  // bare No.
  {
    const chat = origins.telegramChat()
    await origins.declare('telegram', chat)
    const q = await withQuestion(chat)
    const t = await turn(chat, 'No.')
    const st = await settle(String(t.cmd.job))
    const b = await blockerRow(q.blocker)
    const body = await bodyOf(String(t.cmd.job))
    check(
      'bare "No." answers the waiting question, attributed to the authenticated principal',
      b.s === 'resolved' &&
        /No, leave it/.test(String(b.r)) &&
        /answered by grant/.test(String(b.r)),
      `${st}; ${String(b.s)}; ${String(b.r)}`,
    )
    check(
      'and the reply says it took the no, not "what did I get wrong"',
      /Taken as a no/.test(body) && !/get wrong|what were you after/i.test(body),
      body.slice(0, 140),
    )
  }
  // mixed: yes + reminder
  {
    const chat = origins.telegramChat()
    await origins.declare('telegram', chat)
    const q = await withQuestion(chat)
    const t = await turn(chat, 'Yes - and remind me tomorrow.')
    await settle(String(t.cmd.job))
    const b = await blockerRow(q.blocker)
    const body = await bodyOf(String(t.cmd.job))
    check(
      'mixed turn: the yes answers the question and the remainder is acknowledged, not lost',
      b.s === 'resolved' && /Yes, do it/.test(String(b.r)) && /remind me tomorrow/i.test(body),
      body.slice(0, 200),
    )
  }
  // qualified yes is not a yes
  {
    const chat = origins.telegramChat()
    await origins.declare('telegram', chat)
    const q = await withQuestion(chat)
    const t = await turn(chat, 'Do that, but dont send it.')
    await settle(String(t.cmd.job))
    const b = await blockerRow(q.blocker)
    check('a qualified yes approves nothing', b.s === 'open', String(b.s))
  }
  // negative control: nothing waiting
  {
    const chat = origins.telegramChat()
    await origins.declare('telegram', chat)
    const t = await turn(chat, 'Yes, do it. Create the task to book the hall.')
    await settle(String(t.cmd.job))
    const body = await bodyOf(String(t.cmd.job))
    const tasks = await rows(
      `select title from public.tasks where job_id = ${lit(String(t.cmd.job))}::uuid`,
    )
    check(
      'nothing waiting: "Yes, do it. Create the task" stays an ordinary command',
      !/Taken as a yes/.test(body) && tasks.some((x) => /book the hall/i.test(String(x.title))),
      `tasks ${tasks.map((x) => String(x.title)).join('|')}; ${body.slice(0, 100)}`,
    )
  }
  // 0608 through the gateway
  {
    const chat = origins.telegramChat()
    await origins.declare('telegram', chat)
    const q = await withQuestion(chat)
    const call = async (auth: string | null, args: Record<string, unknown>) => {
      const r = await fetch(`${base}/hq-api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }),
        },
        body: JSON.stringify({ action: 'answer_blocker', args }),
      })
      return { status: r.status, body: await r.text() }
    }
    const anon = await call(null, { p_blocker_id: q.blocker, p_answer: 'Yes, do it' })
    check(
      '0608 an unauthenticated answer is refused at the gateway',
      anon.status === 401,
      `http ${String(anon.status)}`,
    )
    check('and the question stays open', (await blockerRow(q.blocker)).s === 'open', 'open')
    // The office key is a machine (#385): it cannot answer, whatever name it sends.
    const viaKey = await call(bearer, {
      p_blocker_id: q.blocker,
      p_answer: 'Yes, do it',
      p_by: 'grant',
    })
    check(
      '0608 the office key cannot answer, even naming itself grant',
      viaKey.status === 403 && (await blockerRow(q.blocker)).s === 'open',
      `http ${String(viaKey.status)}`,
    )
    const real = await call((await harnessSession(db, ref)).access, {
      p_blocker_id: q.blocker,
      p_answer: 'Yes, do it',
      p_by: 'attacker',
    })
    const b = await blockerRow(q.blocker)
    check(
      '0608 a signed-in answer is recorded as the verified principal (the test member, on a declared test), whatever name the client sent',
      real.status === 200 &&
        /answered by verify-operator/.test(String(b.r)) &&
        !/attacker/.test(String(b.r)),
      `http ${String(real.status)}; ${String(b.r)}`,
    )
  }
  // absent principal at the database
  {
    const chat = origins.telegramChat()
    await origins.declare('telegram', chat)
    const q = await withQuestion(chat)
    const r = await one(
      `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(q.blocker)}::uuid), app.test_office()), ${lit(q.blocker)}::uuid, 'Yes, do it', null)::text as r`,
    ).catch((e: Error) => ({ r: `raised: ${e.message.slice(0, 80)}` }))
    const b = await blockerRow(q.blocker)
    check(
      '0608 an absent principal is refused and does not become "grant"',
      b.s === 'open' && !/answered by grant/.test(String(b.r)),
      `${String(r.r).slice(0, 120)}; blocker ${String(b.s)}`,
    )
  }
} finally {
  const released = // Rows written to model 'the question reached him' were never sent to anybody: removed, so the leak witness cannot
    // read a fabricated row as harness traffic reaching a destination.
    await db.execute(`delete from public.deliveries where dedupe_key like 'run1-live-%'`)
  await db.execute(
    `delete from public.tasks t where t.assigned_to_human and exists (select 1 from public.jobs j where j.job_id = t.job_id and app.harness_job(j.job_id)) and (t.satisfies_blocker in (select b.blocker_id from public.blockers b where b.why_needed in ('run1-live fixture', 'run2-live fixture')) or t.title ~ '^(Run 2 live (proof|tick)|Send the renewal note to the venue)')`,
  )
  await origins.release()
  console.log(`released ${String(released)} declaration(s)`)
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exitCode = failed === 0 ? 0 : 1
