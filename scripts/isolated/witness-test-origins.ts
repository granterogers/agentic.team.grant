/**
 * #381 — the witness sees a declared test turn that reached Grant, even when
 * the production door did not honour the declaration.
 *
 *   npx tsx scripts/isolated/witness-test-origins.ts <replica-db>
 *
 * The door's recognition is broken on purpose (the ingress stamp restored to
 * one that ignores public.test_origins), so a declared test turn is written as
 * Grant's, its work is trusted, and its messages are written SENT to his real
 * chat - exactly what production would do if 0605 regressed. The witness must
 * name each one, must name a suite that drove a door WITHOUT declaring, and
 * must stay quiet about Grant.
 *
 * Then the witness itself is broken, twice, and this proof must notice: a
 * regression that cannot fail is not a regression.
 */
import { toCanonicalCommand as fromTelegram } from '../../src/channels/telegram.ts'
import { toCanonicalCommand as fromSlack } from '../../src/slack/events.ts'
import { ignoredOriginSql, provenanceSql } from '../leak-witness.ts'
import { testOrigins } from '../verify/lib/test-origin.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'witorig381')
await registerBot(db)
const run = Date.now().toString(36)
const n = () => String(Math.floor(Math.random() * 900000) + 100000)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const DOOR = "set local application_name = 'PostgREST 14.5';"
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const jsonOf = (v: unknown) =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

await db.execute(`insert into public.telegram_chats (office_id, chat_id, chat_type, bot_id, subject)
  values (app.operator_office(), ${lit(CHAT)}, 'private', ${lit(BOT)}, 'grant') on conflict do nothing`)
await db.execute(`insert into public.slack_workspaces (office_id, team_id, team_name, bot_user_id)
  values (app.operator_office(),'T0ISOLATED', 'Isolated', 'U0BOTUSER') on conflict do nothing`)
const REAL_SLACK = 'C0C2DAPDN02'
const project = String(
  jsonOf(
    (
      await one(`select app.hq_create_project(app.test_office(), ${lit(`Witness origin ${run}`)}, 'upload', ${lit(`witorig-${run}`)},
    ${lit(`Witness origin ${run}`)}, true) as v`)
    ).v,
  ).project_id,
)
await db.execute(`insert into public.slack_channel_map (project_id, channel_id, team_id, channel_name)
  values (${lit(project)}::uuid, ${lit(REAL_SLACK)}, 'T0ISOLATED', ${lit(`witorig-${run}`)}) on conflict do nothing`)
await db.execute(`insert into public.system_config (key, value, description) values ('slack.subject_user_id', '"U0BUNF6AALC"', 'isolated')
  on conflict (key) do update set value = excluded.value`)

const store = async (row: Record<string, unknown>): Promise<string> => {
  const cols = Object.keys(row)
  const cmd = await one(`${DOOR}
    insert into public.inbound_commands (${cols.join(', ')})
    select ${cols.join(', ')} from jsonb_populate_record(null::public.inbound_commands, ${lit(JSON.stringify(row))}::jsonb)
    returning command_id::text as id`)
  const enq = jsonOf(
    (await one(`${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v,
  )
  return String(enq.job_id)
}
const tg = (chat: string, text: string, from = chat) => {
  const c = fromTelegram(
    {
      update_id: Number(n()),
      message: {
        message_id: Number(n()),
        chat: { id: Number(chat), type: 'private' },
        from: { id: Number(from) },
        text,
      },
    } as never,
    new Date(),
    BOT,
  ) as unknown as Record<string, unknown>
  return {
    origin_channel: c.origin_channel,
    origin_ref: c.origin_ref,
    actor: c.actor,
    instruction: c.instruction,
    dedupe_key: c.dedupe_key,
    subject: 'grant',
  }
}
const sl = (channel: string, user: string, text: string) => {
  const c = fromSlack(
    {
      type: 'event_callback',
      team_id: 'T0ISOLATED',
      event: {
        type: 'message',
        channel,
        user,
        text,
        ts: `${String(1790000000 + Number(n()))}.${n()}`,
      },
    } as never,
    'U0BOTUSER',
  ) as unknown as Record<string, unknown>
  return {
    origin_channel: c.origin_channel,
    origin_ref: c.origin_ref,
    actor: c.actor,
    instruction: c.instruction,
    dedupe_key: c.dedupe_key,
    subject: 'grant',
  }
}

/* Production recognition, broken: the stamp as it was before 0605. */
await db.execute(`create or replace function app.stamp_synthetic_inbound() returns trigger
  language plpgsql security definer set search_path = '' as $f$
  begin
    if not app.from_production_ingress() then new.synthetic := true; end if;
    return new;
  end $f$`)

const origins = await testOrigins(db, 'isolated:381:witness')
const declaredChat = origins.telegramChat()
await origins.declare('telegram', declaredChat)
const testJob = await store(tg(declaredChat, `Declared, not honoured ${run}`, '4242'))
const syn = await one(
  `select synthetic, app.job_origin(job_id) as o from public.jobs where job_id = ${lit(testJob)}::uuid`,
)
check(
  'sabotage landed: the door did not honour the declaration, so the test is trusted',
  syn.synthetic === false && syn.o === 'trusted',
  `synthetic=${String(syn.synthetic)} origin=${String(syn.o)}`,
)
const testChild =
  String(
    (
      await one(
        `select app.enqueue_child(p_office => app.job_office(${lit(testJob)}::uuid), p_parent => ${lit(testJob)}::uuid, p_kind => 'office.synthesise', p_payload => '{}'::jsonb)::text as v`,
      )
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0] ?? ''
// A suite that drove the door and forgot to declare: a fixture chat and a fixture Slack channel.
const forgotChat = origins.telegramChat()
// The webhook records every chat it hears from before deciding anything, so the forgotten chat is known.
await db.execute(
  `${DOOR} select public.record_telegram_chat(${lit(forgotChat)}, 'private', ${lit(BOT)}, 'grant')`,
)
const forgotTg = await store(tg(forgotChat, `Forgot to declare ${run}`, '4242'))
const forgotSlack = await store(
  sl(origins.slackChannel(), 'U0ZTFORGOT', `Forgot to declare ${run}`),
)
// Grant, through both doors.
const grantTg = await store(tg(CHAT, `Grant ${run}`))
const grantSlack = await store(sl(REAL_SLACK, 'U0BUNF6AALC', `Grant in Slack ${run}`))

const since = String((await one('select app.now_utc()::text as t')).t)
const sent = (key: string, job: string, target = CHAT, channel = 'telegram') =>
  db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, purpose, state, message_ref, sent_at, lease_expires_at)
    values (${lit(channel)}, ${lit(key)}, 'acct', ${lit(target)}, ${lit(job)}::uuid, 'result', 'sent', ${lit(`m-${key}`)}, app.now_utc(), app.now_utc())`)
await sent(`result:${run}:t`, testJob)
await sent(`result:${run}:tc`, testChild, REAL_SLACK, 'slack')
await sent(`result:${run}:ft`, forgotTg)
await sent(`result:${run}:fs`, forgotSlack, REAL_SLACK, 'slack')
await sent(`result:${run}:gt`, grantTg)
await sent(`result:${run}:gs`, grantSlack, REAL_SLACK, 'slack')
// And the suite tidies up after itself, as suites do: its inbound row is gone.
await db.execute(`delete from public.inbound_commands where job_id = ${lit(testJob)}::uuid`)

type Traced = { key: string; breach: string | null }
const witness = async (sql: string) => (await db.execute(sql)).rows as Traced[]
const breachOf = (rows: Traced[], suffix: string) =>
  rows.find((r) => r.key === `result:${run}:${suffix}`)?.breach ?? null
const rows = await witness(provenanceSql(`${lit(since)}::timestamptz`))
check(
  "a declared test turn's answer that reached Grant is caught, although its inbound row was deleted",
  breachOf(rows, 't') === 'TEST_ORIGIN_SENT',
  String(breachOf(rows, 't')),
)
check("and its child's", breachOf(rows, 'tc') === 'TEST_ORIGIN_SENT', String(breachOf(rows, 'tc')))
check(
  'a Telegram suite that forgot to declare is caught',
  breachOf(rows, 'ft') === 'UNREGISTERED_ORIGIN_SENT',
  String(breachOf(rows, 'ft')),
)
check(
  'a Slack suite that forgot to declare is caught',
  breachOf(rows, 'fs') === 'UNREGISTERED_ORIGIN_SENT',
  String(breachOf(rows, 'fs')),
)
check(
  "control: Grant's Telegram is not a breach",
  breachOf(rows, 'gt') === null,
  String(breachOf(rows, 'gt')),
)
check(
  "control: Grant's Slack is not a breach",
  breachOf(rows, 'gs') === null,
  String(breachOf(rows, 'gs')),
)
{
  // The ignored-declaration check needs no send. Its row was deleted above, so declare and send again.
  const again = await store(tg(declaredChat, `Declared, not honoured, again ${run}`, '4242'))
  const ignored = (await db.execute(ignoredOriginSql)).rows as {
    key: string
    conversation: string
  }[]
  check(
    'a turn in a declared conversation that is not synthetic is named, with nothing sent',
    ignored.some((r) => r.conversation === declaredChat) && again.length > 0,
    `${String(ignored.length)} ignored`,
  )
}

/* Now break the witness, twice, and prove this proof would notice. */
{
  const blind = await witness(provenanceSql(`${lit(since)}::timestamptz`, { declarations: false }))
  check(
    'SABOTAGE the witness (declarations unread): the declared escape is no longer TEST_ORIGIN_SENT',
    breachOf(blind, 't') !== 'TEST_ORIGIN_SENT',
    `now ${String(breachOf(blind, 't'))} — the checks above would go red`,
  )
  const sql = provenanceSql(`${lit(since)}::timestamptz`)
  const marker = "and ((tc.chat_type = 'private' and tc.chat_id !~ '^-'"
  const sabotaged = sql
    .split(marker)
    .join("and (true or (tc.chat_type = 'private' and tc.chat_id !~ '^-'")
  const landed = sabotaged !== sql
  const noRule = await witness(sabotaged)
  check(
    'SABOTAGE the witness (undeclared-chat rule off): the forgotten declaration is no longer caught',
    landed && breachOf(noRule, 'ft') !== 'UNREGISTERED_ORIGIN_SENT',
    `sabotage landed=${String(landed)}, now ${String(breachOf(noRule, 'ft'))}`,
  )
}

const failed = results.filter((x) => !x.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
