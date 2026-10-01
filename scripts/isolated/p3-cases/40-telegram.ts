/**
 * Telegram (migration 0683), through the REAL telegram-webhook handler running against the clone: a verified sender is
 * exactly one office; a stranger is nobody; a group is an operator's alone; outbound never falls to an unclaimed chat.
 */
import { type Ctx, lit } from '../p3-app-lib.ts'
import { startTelegramDoor } from '../telegram-door.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B, G } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const BOT = '8967954396'
  const n = () => Math.floor(Math.random() * 9_000_000) + 1_000_000
  const uid = () => String(7_000_000_000 + Math.floor(Math.random() * 900_000_000))

  if ((await q(`select 1 from public.telegram_bots where bot_id = '${BOT}'`)).length === 0) {
    const secret = await q(
      `insert into vault.secrets (name, secret) values (${lit(`p3.tg.${run}`)}, 'fake-telegram-token') returning id::text as id`,
    )
    await c.db.execute(
      `insert into public.telegram_bots (bot_id, username, staff_slug, is_pager, token_ref) values ('${BOT}', 'p3_chief_bot', 'chief-of-staff', true, ${lit(String(secret[0]?.id))})`,
    )
  }
  const ua = uid()
  const ub = uid()
  const ug = uid()
  const stranger = uid()
  for (const [office, actor, subject] of [
    [A, ua, `a-${run}`],
    [B, ub, `b-${run}`],
    [G, ug, `g-${run}`],
  ] as const) {
    await c.db.execute(
      `insert into public.subject_identities (origin_channel, actor, subject, office_id, note) values ('telegram', '${actor}', ${lit(subject)}, '${office}', 'p3 attack')`,
    )
  }
  const door = await startTelegramDoor(c.db, BOT)
  const message = (from: string, chat: string, type: string, text: string, id = n()) => ({
    update_id: n(),
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      text,
      chat: { id: Number(chat), type, ...(type === 'private' ? {} : { title: 'room' }) },
      from: { id: Number(from), is_bot: false },
    },
  })
  const commandFor = async (actor: string) =>
    await q(
      `select office_id, actor, instruction, command_id from public.inbound_commands where actor = '${actor}' order by received_at desc limit 5`,
    )
  const bridgeBefore = (
    await q(
      `select coalesce(sum(n),0)::int n from public.office_bridge_use where table_name in ('inbound_commands','telegram_chats')`,
    )
  )[0]?.n

  // ---- each verified sender is their own office ---------------------------------------------------------------------------
  const ra = await door.post(message(ua, ua, 'private', `hello from A ${run}`))
  const rb = await door.post(message(ub, ub, 'private', `hello from B ${run}`))
  c.check(
    ra.status === 200 && rb.status === 200,
    'both senders are accepted by the webhook',
    `${String(ra.status)} ${String(rb.status)}`,
  )
  const ca = await commandFor(ua)
  const cb = await commandFor(ub)
  c.check(
    ca[0]?.office_id === A && cb[0]?.office_id === B,
    "each message is stored in its sender's office",
    `${String(ca[0]?.office_id).slice(0, 8)} ${String(cb[0]?.office_id).slice(0, 8)}`,
  )
  const chats = await q(
    `select chat_id, office_id, subject from public.telegram_chats where chat_id in ('${ua}','${ub}') and bot_id = '${BOT}' order by chat_id`,
  )
  c.check(
    chats.length === 2 &&
      chats.every((r) =>
        r.chat_id === ua
          ? r.office_id === A && r.subject === `a-${run}`
          : r.office_id === B && r.subject === `b-${run}`,
      ),
    "each private chat is recorded in its sender's office, with its sender as the subject",
    JSON.stringify(chats.map((r) => String(r.office_id).slice(0, 8))),
  )

  // ---- a stranger is nobody ---------------------------------------------------------------------------------------------------
  const before = (
    await q(
      `select (select count(*) from public.inbound_commands)::int c, (select count(*) from public.telegram_chats)::int t`,
    )
  )[0]
  const rs = await door.post(message(stranger, stranger, 'private', 'let me in'))
  const after = (
    await q(
      `select (select count(*) from public.inbound_commands)::int c, (select count(*) from public.telegram_chats)::int t`,
    )
  )[0]
  c.check(
    rs.status === 200 &&
      String(rs.body.ignored ?? '').includes('unrecognised') &&
      before?.c === after?.c &&
      before?.t === after?.t,
    'an unrecognised sender is acknowledged and nothing is stored',
    JSON.stringify(rs.body),
  )

  // ---- a group is an operator's alone -------------------------------------------------------------------------------------------
  const group = String(-1_000_000_000_000 - Math.floor(Math.random() * 900_000_000))
  const gb = (
    await q(`select count(*)::int n from public.telegram_chats where chat_id = '${group}'`)
  )[0]?.n
  const rg = await door.post(message(ua, group, 'supergroup', `A in a group ${run}`))
  c.check(
    String(rg.body.ignored ?? '') !== '' &&
      (await q(`select count(*)::int n from public.telegram_chats where chat_id = '${group}'`))[0]
        ?.n === gb &&
      (await commandFor(ua)).every((r) => !String(r.instruction).includes('A in a group')),
    "an ordinary user's message in a group is not stored and the group is not recorded",
    JSON.stringify(rg.body).slice(0, 100),
  )
  const rgo = await door.post(message(ug, group, 'supergroup', `operator in the group ${run}`))
  const go = (
    await q(
      `select office_id from public.telegram_chats where chat_id = '${group}' and bot_id = '${BOT}'`,
    )
  )[0]
  c.check(
    rgo.status === 200 && go?.office_id === G,
    "the operator's office may have the office group, and it is recorded as theirs",
    JSON.stringify(rgo.body).slice(0, 100),
  )
  const rg2 = await door.post(
    message(ub, group, 'supergroup', `B tries the operator's group ${run}`),
  )
  c.check(
    (
      await q(
        `select office_id from public.telegram_chats where chat_id = '${group}' and bot_id = '${BOT}'`,
      )
    )[0]?.office_id === G &&
      (await commandFor(ub)).every((r) => !String(r.instruction).includes("operator's group")),
    'a chat bound to one office is never moved or used by another',
    JSON.stringify(rg2.body).slice(0, 80),
  )

  // ---- a duplicate delivery is one command and one job -----------------------------------------------------------------------------
  const dup = message(ua, ua, 'private', `delivered twice ${run}`, 4_242_001)
  await door.post(dup)
  await door.post(dup)
  const dupRows = await q(
    `select command_id, office_id from public.inbound_commands where instruction = ${lit(`delivered twice ${run}`)}`,
  )
  c.check(
    dupRows.length === 1 && dupRows[0]?.office_id === A,
    "the same update delivered twice is one command, in the sender's office",
    String(dupRows.length),
  )
  const enq = (await c.exec(
    'p2_worker',
    `select app.enqueue_inbound('${String(dupRows[0]?.command_id)}')`,
  )) as { job_id: string }
  c.check(
    (await q(`select office_id from public.jobs where job_id = '${enq.job_id}'`))[0]?.office_id ===
      A,
    "and the job it becomes is A's",
    '',
  )

  // ---- outbound: inside the office, to a claimed chat, never to an unclaimed one -------------------------------------------------------
  const chatFor = async (office: string, subject: string) =>
    (await c.exec(
      'p2_worker',
      `select app.telegram_chat_for('${office}', ${lit(subject)}, '${BOT}')`,
    )) as string | null
  const toA = await chatFor(A, `a-${run}`)
  const toB = await chatFor(B, `b-${run}`)
  c.check(
    toA === ua && toB === ub,
    "A's notices go to A's chat and B's to B's",
    `${String(toA)} ${String(toB)}`,
  )
  c.check(
    (await chatFor(A, `b-${run}`)) === null && (await chatFor(B, `a-${run}`)) === null,
    "one office asking for the other's subject is given no chat",
    '',
  )
  const orphan = uid()
  await c.db.execute(
    `insert into public.telegram_chats (office_id, chat_id, chat_type, bot_id, subject) values ('${A}', '${orphan}', 'private', '${BOT}', null)`,
  )
  await c.db.execute(
    `update public.telegram_chats set last_seen_at = now() + interval '1 hour' where chat_id = '${orphan}'`,
  )
  c.check(
    (await chatFor(A, `a-${run}`)) === ua,
    "a newer UNATTRIBUTED chat is not where A's messages go",
    '',
  )

  // ---- a disabled office's sender is a stranger ---------------------------------------------------------------------------------------
  const authX = `d6666666-6666-4666-8666-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`
  await c.db.execute(
    `insert into auth.users (id, email) values ('${authX}', ${lit(`tg-gone-${run}@example.invalid`)}) on conflict do nothing`,
  )
  await c.db.execute(
    `insert into public.offices (auth_user_id, kind, name) values ('${authX}', 'person', ${lit(`TG Gone ${run}`)})`,
  )
  const gone = String(
    (await q(`select office_id from public.offices where auth_user_id = '${authX}'`))[0]?.office_id,
  )
  const ugone = uid()
  await c.db.execute(
    `insert into public.subject_identities (origin_channel, actor, subject, office_id, note) values ('telegram', '${ugone}', ${lit(`gone-${run}`)}, '${gone}', 'p3 attack')`,
  )
  await c.db.execute(
    `update public.offices set state = 'disabled', disabled_at = now() where office_id = '${gone}'`,
  )
  const rd = await door.post(message(ugone, ugone, 'private', 'I am disabled'))
  c.check(
    String(rd.body.ignored ?? '').includes('unrecognised') &&
      (await commandFor(ugone)).length === 0,
    'a sender whose office is disabled is treated as a stranger',
    JSON.stringify(rd.body).slice(0, 80),
  )

  // ---- a message the database refuses is NOT acknowledged as stored (it used to be lost without a word) -------------------------------------
  // Put the old Grant-only default back for a moment, so A's insert hits the foreign key. The webhook must say 503 (Telegram
  // then retries) - never 200 with nothing stored.
  const lostText = `would be lost ${run}`
  try {
    await c.db.execute(`alter table public.inbound_commands disable trigger a0_project_default;
      alter table public.inbound_commands alter column project_id set default app.unnamed_project()`)
    const rl = await door.post(message(ua, ua, 'private', lostText))
    const stored = (
      await q(`select 1 from public.inbound_commands where instruction = ${lit(lostText)}`)
    ).length
    c.check(
      rl.status === 503 && stored === 0,
      'a message the database refuses (foreign key) is answered 503 so Telegram retries - not 200 with nothing stored',
      `status ${String(rl.status)}, stored ${String(stored)}`,
    )
  } finally {
    await c.db.execute(`alter table public.inbound_commands alter column project_id drop default;
      alter table public.inbound_commands enable trigger a0_project_default`)
  }
  const rl2 = await door.post(message(ua, ua, 'private', lostText))
  c.check(
    rl2.status === 200 &&
      (await q(`select 1 from public.inbound_commands where instruction = ${lit(lostText)}`))
        .length === 1,
    'and the retry, once the fault is gone, stores it exactly once',
    `status ${String(rl2.status)}`,
  )

  // ---- and the compatibility bridge was not asked to guess -------------------------------------------------------------------------------
  const bridgeAfter = (
    await q(
      `select coalesce(sum(n),0)::int n from public.office_bridge_use where table_name in ('inbound_commands','telegram_chats')`,
    )
  )[0]?.n
  c.check(
    bridgeAfter === bridgeBefore,
    'the Telegram path did not use the compatibility bridge',
    `${String(bridgeBefore)} -> ${String(bridgeAfter)}`,
  )
  c.check(
    door.refusedUrls.length === 0 ||
      door.refusedUrls.every((u) => !/api\.telegram\.org\/bot[^/]+\/sendMessage/.test(u)),
    'and nothing was sent to a person',
    '',
  )
}
