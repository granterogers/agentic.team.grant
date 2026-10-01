/**
 * #381 — a test that drives a real door is harness from the moment it
 * arrives, and Grant using the same door at the same moment is not.
 *
 *   npx tsx scripts/isolated/test-origins.ts <replica-db>
 *
 * Every turn is made by the REAL adapter code (`src/channels/telegram.ts`,
 * `src/slack/events.ts`, `src/slack/interactions.ts`) and written the way its
 * edge function writes it: through PostgREST (application_name), then
 * `app.enqueue_inbound`. The test side declares its conversation first, with
 * the same `app.register_test_origin` a suite calls.
 *
 * Both boundaries are asked exactly as production asks them: app.claim_delivery
 * to Grant's real chat, and the worker's external-write gate.
 */
import { toCanonicalCommand as fromTelegram } from '../../src/channels/telegram.ts'
import { containmentRefusal } from '../../src/jobs/containment.ts'
import { toCanonicalCommand as fromSlack } from '../../src/slack/events.ts'
import { toCanonicalInteraction } from '../../src/slack/interactions.ts'
import { testOrigins } from '../verify/lib/test-origin.ts'
import { isolated } from './guard.ts'
import { BOT, CHAT, registerBot } from './real-telegram.ts'

const dbName = process.argv[2] ?? 'orig381'
const db = await isolated(dbName)
// A second connection, so "at the same moment" is two sessions in flight, not one queue.
const db2 = await isolated(dbName)
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
const raises = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Grant's chat is a chat the office knows, as it is in production.
await db.execute(`insert into public.telegram_chats (chat_id, chat_type, bot_id, subject)
  values (${lit(CHAT)}, 'private', ${lit(BOT)}, 'grant') on conflict do nothing`)
const REAL_SLACK = 'C0C2DAPDN02'
const realProject = String(
  jsonOf(
    (
      await one(`select app.hq_create_project(app.test_office(), ${lit(`Origin real ${run}`)}, 'upload', ${lit(`origin-real-${run}`)},
    ${lit(`Origin real ${run}`)}, true) as v`)
    ).v,
  ).project_id,
)
await db.execute(`insert into public.slack_workspaces (team_id, team_name, bot_user_id)
  values ('T0ISOLATED', 'Isolated', 'U0BOTUSER') on conflict do nothing`)
await db.execute(`insert into public.slack_channel_map (project_id, channel_id, team_id, channel_name)
  values (${lit(realProject)}::uuid, ${lit(REAL_SLACK)}, 'T0ISOLATED', ${lit(`origin-real-${run}`)}) on conflict do nothing`)

type Row = Record<string, unknown>
const pick = (c: Row) => ({
  origin_channel: c.origin_channel,
  origin_ref: c.origin_ref,
  actor: c.actor,
  instruction: c.instruction ?? '',
  dedupe_key: c.dedupe_key,
  callback_action: c.callback_action ?? null,
  received_at: c.received_at,
})
/** A command row as its door writes it, then enqueued as the door does. */
const store = async (row: Row, via = db): Promise<{ command: string; job: string | null }> => {
  const cols = Object.keys(row)
  const on = async (sql: string) => (await via.execute(sql)).rows[0] as Row
  const cmd = await on(`${DOOR}
    insert into public.inbound_commands (${cols.join(', ')})
    select ${cols.join(', ')} from jsonb_populate_record(null::public.inbound_commands, ${lit(JSON.stringify(row))}::jsonb)
    returning command_id::text as id`)
  const enq = jsonOf(
    (await on(`${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v,
  )
  return { command: String(cmd.id), job: typeof enq.job_id === 'string' ? enq.job_id : null }
}
const telegramTurn = (chat: string, text: string, from = chat) =>
  pick(
    fromTelegram(
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
    ) as unknown as Row,
  )
const slackTurn = (
  channel: string,
  user: string,
  text: string,
  ts = `${String(1790000000 + Number(n()))}.${n()}`,
) =>
  pick(
    fromSlack(
      {
        type: 'event_callback',
        team_id: 'T0ISOLATED',
        event: { type: 'message', channel, user, text, ts },
      } as never,
      'U0BOTUSER',
    ) as unknown as Row,
  )
const origin = async (job: string) =>
  String((await one(`select app.job_origin(${lit(job)}::uuid) as v`)).v)
const claim = async (job: string, key: string, target = CHAT, channel = 'telegram') =>
  one(`select outcome, coalesce((select suppressed_reason from public.deliveries
        where dedupe_key = ${lit(key)}), '') as why
      from app.claim_delivery(app.job_office(${lit(job)}::uuid),
        ${lit(channel)}, ${lit(key)}, ${lit(BOT)}, ${lit(target)}, 'result',
        null, null, null, ${lit(job)}::uuid)`)
const child = async (parent: string, kind = 'office.synthesise') =>
  String(
    (
      await one(`select app.enqueue_child(p_office => app.job_office(${lit(parent)}::uuid), p_parent => ${lit(parent)}::uuid, p_kind => ${lit(kind)},
        p_payload => '{}'::jsonb)::text as v`)
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0] ?? ''

/* ---------------------------------------------------------------- run A */
const A = await testOrigins(db, 'isolated:381')
const chatA = A.telegramChat()
const slackA = A.slackChannel()
await A.declare('telegram', chatA)
await A.declare('slack', slackA)

// The two doors at the same moment: the test in its declared chat, Grant in his.
const [tTest, tReal] = await Promise.all([
  store({ ...telegramTurn(chatA, `Declared test ${run}`, '4242'), subject: 'grant' }),
  store({ ...telegramTurn(CHAT, `Grant, meanwhile ${run}`), subject: 'grant' }, db2),
])
const keyOf = async (c: string) =>
  one(
    `select dedupe_key as k, synthetic from public.inbound_commands where command_id = ${lit(c)}::uuid`,
  )
const kt = await keyOf(tTest.command)
check(
  'a declared Telegram test turn carries the key the production adapter writes',
  /^telegram:message:\d+:-?\d+:\d+$/.test(String(kt.k)) &&
    (await one(`select app.adapter_key_ok('telegram', ${lit(String(kt.k))}) as v`)).v === true,
  String(kt.k),
)
check(
  'and it is written synthetic at the door',
  kt.synthetic === true,
  `synthetic=${String(kt.synthetic)}`,
)
check(
  'so its work is harness',
  (await origin(String(tTest.job))) === 'harness',
  await origin(String(tTest.job)),
)
const tc = await claim(String(tTest.job), `o381:t:${String(tTest.job)}`)
check(
  "and its answer cannot reach Grant's chat",
  tc.outcome !== 'claimed',
  `${String(tc.outcome)} ${String(tc.why)}`,
)
const kr = await keyOf(tReal.command)
check(
  'Grant, at the same moment, through the same door, is not synthetic',
  kr.synthetic === false,
  String(kr.k),
)
check(
  'his work is trusted',
  (await origin(String(tReal.job))) === 'trusted',
  await origin(String(tReal.job)),
)
const rc = await claim(String(tReal.job), `o381:r:${String(tReal.job)}`)
check('and his answer reaches him', rc.outcome === 'claimed', String(rc.outcome))

// Slack, both sides.
const [sTest, sReal] = await Promise.all([
  store({ ...slackTurn(slackA, 'U0ZTFIXTURE', `Declared Slack ${run}`), subject: 'grant' }),
  store(
    { ...slackTurn(REAL_SLACK, 'U0BUNF6AALC', `Grant in Slack ${run}`), subject: 'grant' },
    db2,
  ),
])
check(
  'a declared Slack test turn is harness',
  (await origin(String(sTest.job))) === 'harness',
  String((await keyOf(sTest.command)).k),
)
check(
  'and it cannot post to a real project channel',
  (await claim(String(sTest.job), `o381:s:${String(sTest.job)}`, REAL_SLACK, 'slack')).outcome !==
    'claimed',
  'refused',
)
check(
  'Grant in Slack at the same moment is trusted',
  (await origin(String(sReal.job))) === 'trusted',
  await origin(String(sReal.job)),
)
check(
  'and his Slack answer is delivered',
  (await claim(String(sReal.job), `o381:sr:${String(sReal.job)}`, REAL_SLACK, 'slack')).outcome ===
    'claimed',
  'claimed',
)

// A button press in the declared Slack channel (verify:slack presses one).
{
  const press = toCanonicalInteraction({
    type: 'block_actions',
    team: { id: 'T0ISOLATED' },
    user: { id: 'U0ZTFIXTURE' },
    channel: { id: slackA },
    container: { channel_id: slackA, message_ts: `${String(1790000000 + Number(n()))}.000200` },
    actions: [{ action_id: 'feedback.useful', value: JSON.stringify({ a: 'feedback.useful' }) }],
  } as never) as unknown as Row | null
  const row = await one(`${DOOR} insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, callback_action, subject)
    values ('slack', ${lit(String(press?.origin_ref))}, 'U0ZTFIXTURE', '', ${lit(String(press?.dedupe_key))},
            ${lit(String(press?.callback_action ?? 'useful'))}, 'grant')
    returning synthetic, dedupe_key as k`)
  check('a button press in a declared channel is synthetic', row.synthetic === true, String(row.k))
}

/* The webhook records the chat it heard from, as his. It must not become where he is reached. */
{
  await db.execute(
    `${DOOR} select public.record_telegram_chat(${lit(chatA)}, 'private', ${lit(BOT)}, 'grant')`,
  )
  const rec = await one(`select deliverable, undeliverable_reason as why from public.telegram_chats
    where chat_id = ${lit(chatA)} and bot_id = ${lit(BOT)}`)
  const pager = await one(`select app.telegram_chat_for('grant', ${lit(BOT)}) as c`)
  check(
    "a declared chat the webhook records is never where Grant's messages go",
    rec.deliverable === false && pager.c === CHAT,
    `deliverable=${String(rec.deliverable)} (${String(rec.why)}); pager -> ${String(pager.c)}`,
  )
  const quietReal = `-5${n()}${n()}`
  await db.execute(
    `${DOOR} select public.record_telegram_chat(${lit(quietReal)}, 'group', ${lit(BOT)})`,
  )
  check(
    'control: an undeclared chat is recorded deliverable, as before',
    (await one(`select deliverable from public.telegram_chats where chat_id = ${lit(quietReal)}`))
      .deliverable === true,
    'deliverable',
  )
}

/* Lineage, and everything that happens to work after it is classified. */
const c1 = await child(String(tTest.job))
const c2 = await child(c1, 'office.notion_import')
check('its child is harness', (await origin(c1)) === 'harness', await origin(c1))
check('and its grandchild', (await origin(c2)) === 'harness', await origin(c2))
const gate = await containmentRefusal(db, { jobId: c2, kind: 'office.notion_import' })
check('an external writer under it is refused by the worker gate', gate !== null, gate ?? 'ALLOWED')
const realWriter = await child(String(tReal.job), 'office.notion_import')
check(
  "control: the same writer under Grant's turn may run",
  (await containmentRefusal(db, { jobId: realWriter, kind: 'office.notion_import' })) === null,
  'allowed',
)
for (const [what, key] of [
  ['narration', `narration:${c1}`],
  ['progress', `progress:${c1}`],
  ['an approval question', `blocker:${c1}:question`],
] as const) {
  const r = await claim(c1, key)
  check(
    `${what} from it cannot reach Grant`,
    r.outcome !== 'claimed',
    `${String(r.outcome)} ${String(r.why)}`,
  )
}
check(
  'synthetic cannot be taken back',
  (await raises(
    `update public.jobs set synthetic = false where job_id = ${lit(String(tTest.job))}::uuid`,
  )) !== '',
  'refused',
)

// Released, then late work: a retry, a recovery, a child, a duplicate delivery.
const released = await A.release()
check(
  'releasing the run ends its window',
  released === 2,
  `${String(released)} declaration(s) released`,
)
await db.execute(`update public.jobs set state = 'running', leased_by = 'worker-that-died',
    leased_until = app.now_utc() - interval '1 hour', started_at = app.now_utc() - interval '1 hour'
  where job_id = ${lit(String(tTest.job))}::uuid`)
await db.execute('select * from app.recover_stalled_jobs()')
const after = await one(
  `select state::text as s from public.jobs where job_id = ${lit(String(tTest.job))}::uuid`,
)
check(
  'a worker dies holding it, recovery retries it - and it is still harness',
  (await origin(String(tTest.job))) === 'harness',
  `state ${String(after.s)}, origin ${await origin(String(tTest.job))}`,
)
const late = await child(String(tTest.job))
check(
  'a child made after release is harness',
  (await origin(late)) === 'harness',
  await origin(late),
)
const lateTurn = await store({
  ...telegramTurn(chatA, `A late update ${run}`, '4242'),
  subject: 'grant',
})
check(
  'a turn arriving in the chat after release is still synthetic (the declaration is sticky)',
  (await keyOf(lateTurn.command)).synthetic === true,
  await origin(String(lateTurn.job)),
)
const dupKey = String(kt.k)
check(
  'the same webhook delivered again is still one turn',
  (await raises(`${DOOR} insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
     values ('telegram', ${lit(`${chatA}:1`)}, '4242', 'dup', ${lit(dupKey)}, 'grant')`)) !== '' &&
    Number(
      (
        await one(
          `select count(*)::int as n from public.inbound_commands where dedupe_key = ${lit(dupKey)}`,
        )
      ).n,
    ) === 1,
  'one row',
)

/* Expiry: a declaration that has lapsed before the turn is written. */
{
  const E = await testOrigins(db, 'isolated:381')
  const chatE = E.telegramChat()
  await db.execute(
    `select app.register_test_origin('telegram', ${lit(chatE)}, ${lit(E.token)}, 'isolated:381', interval '1 second')`,
  )
  await db.execute('select pg_sleep(1.2)')
  const expired = await one(`select expires_at < app.now_utc() as lapsed from public.test_origins
    where conversation = ${lit(chatE)}`)
  const t = await store({ ...telegramTurn(chatE, `After expiry ${run}`, '4242'), subject: 'grant' })
  check(
    'a turn in a declared chat after the declaration expired is still harness',
    expired.lapsed === true && (await origin(String(t.job))) === 'harness',
    `lapsed=${String(expired.lapsed)} origin=${await origin(String(t.job))}`,
  )
}

/* Two runs at once. */
{
  const [X, Y] = await Promise.all([
    testOrigins(db, 'isolated:381:x'),
    testOrigins(db, 'isolated:381:y'),
  ])
  const cx = X.telegramChat()
  const cy = Y.telegramChat()
  await Promise.all([X.declare('telegram', cx), Y.declare('telegram', cy)])
  await X.release()
  const [tx, ty] = await Promise.all([
    store({ ...telegramTurn(cx, `Run X ${run}`, '4242'), subject: 'grant' }),
    store({ ...telegramTurn(cy, `Run Y ${run}`, '4242'), subject: 'grant' }, db2),
  ])
  check(
    'two runs at once: each is harness, and releasing one does not touch the other',
    (await origin(String(tx.job))) === 'harness' && (await origin(String(ty.job))) === 'harness',
    `${await origin(String(tx.job))} / ${await origin(String(ty.job))}`,
  )
  const yLive = await one(
    `select released_at is null as live from public.test_origins where conversation = ${lit(cy)}`,
  )
  check('and Y is still in its window', yLive.live === true, String(yLive.live))
}

/* What a declaration refuses: anything real. */
const refusal = async (what: string, channel: string, conv: string) => {
  const msg = await raises(
    `select app.register_test_origin(${lit(channel)}, ${lit(conv)}, 'refuse381${run.slice(-6)}', 'isolated:381')`,
  )
  check(`a declaration of ${what} is refused`, msg.includes('refused'), msg.split('\n')[0] ?? '')
}
await refusal("Grant's Telegram chat", 'telegram', CHAT)
await refusal('a Slack channel that has carried a real turn', 'slack', REAL_SLACK)
{
  // A real project's channel that nobody has spoken in yet: the map alone refuses it.
  const quietSlack = `C0QUIET${n()}`
  const quietProject = String(
    jsonOf(
      (
        await one(`select app.hq_create_project(app.test_office(), ${lit(`Origin quiet ${run}`)}, 'upload', ${lit(`origin-quiet-${run}`)},
      ${lit(`Origin quiet ${run}`)}, true) as v`)
      ).v,
    ).project_id,
  )
  await db.execute(`insert into public.slack_channel_map (project_id, channel_id, team_id, channel_name)
    values (${lit(quietProject)}::uuid, ${lit(quietSlack)}, 'T0ISOLATED', ${lit(`origin-quiet-${run}`)})`)
  await refusal("a real project's Slack channel nobody has spoken in", 'slack', quietSlack)
}
await refusal('a dashboard project with real work', 'teamhq', realProject)
{
  const quiet = `-7${n()}${n()}`
  await store({ ...telegramTurn(quiet, `A real stranger ${run}`), subject: 'grant' })
  await refusal('a chat that has carried a real turn', 'telegram', quiet)
}
check(
  'a malformed run token is refused',
  (
    await raises(
      `select app.register_test_origin('telegram', '-7000000000000001', 'BAD TOKEN', 'isolated:381')`,
    )
  ).includes('run token'),
  'refused',
)
check(
  'a guessed run token releases nothing',
  Number((await one(`select app.release_test_origins('guessed0000') as n`)).n) === 0,
  '0 released',
)
{
  // A real turn that merely CONTAINS a run token is not a declaration.
  const t = await store({
    ...telegramTurn(CHAT, `Here is a token ${A.token} ${run}`),
    subject: 'grant',
  })
  check(
    'a real turn quoting a run token stays trusted',
    (await origin(String(t.job))) === 'trusted',
    await origin(String(t.job)),
  )
}
check(
  'a declaration cannot be deleted',
  (await raises(`delete from public.test_origins where run_token = ${lit(A.token)}`)).includes(
    'append-only',
  ),
  'refused',
)
check(
  'nor moved to another conversation',
  (await raises(
    `update public.test_origins set conversation = ${lit(CHAT)} where run_token = ${lit(A.token)}`,
  )) !== '',
  'refused',
)

/* The dashboard door and the MCP door. */
{
  const D = await testOrigins(db, 'isolated:381:d')
  const p = String(
    jsonOf(
      (
        await one(`select app.hq_create_project(app.test_office(), ${lit(`Origin dash ${run}`)}, 'upload', ${lit(`origin-dash-${run}`)},
      ${lit(`Origin dash ${run}`)}, true) as v`)
      ).v,
    ).project_id,
  )
  await D.declare('teamhq', p)
  const said = jsonOf(
    (
      await one(
        `${DOOR} select app.say_in_project(app.test_office(), ${lit(p)}::uuid, ${lit(`Dashboard test ${run}`)}) as v`,
      )
    ).v,
  )
  check(
    'a dashboard turn in a declared project is harness',
    (await origin(String(said.job))) === 'harness',
    await origin(String(said.job)),
  )
  const other = jsonOf(
    (
      await one(
        `${DOOR} select app.say_in_project(app.test_office(), ${lit(realProject)}::uuid, ${lit(`Grant on the dashboard ${run}`)}) as v`,
      )
    ).v,
  )
  check(
    'and Grant in his own project is trusted',
    (await origin(String(other.job))) === 'trusted',
    await origin(String(other.job)),
  )

  const client = `isolated-381-${run}`
  await db.execute(`insert into public.mcp_clients (client_id, display_name, token_sha256, scopes)
    values (${lit(client)}, 'Isolated 381', encode(extensions.digest(${lit(client)}, 'sha256'), 'hex'), array['read','write'])`)
  await D.declare('mcp', client)
  const mj =
    await one(`${DOOR} insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
    values (gen_random_uuid(), ${lit(`mcp381:${run}`)}, 'notebook.generate', ${lit(`mcp:${client}`)})
    returning job_id::text as id, synthetic`)
  check(
    'an MCP job from a declared client is synthetic and harness',
    mj.synthetic === true && (await origin(String(mj.id))) === 'harness',
    await origin(String(mj.id)),
  )
  const doc = await one(`insert into public.documents (project_id, title, connector, added_by)
    values (${lit(realProject)}::uuid, ${lit(`Declared client doc ${run}`)}, 'mcp', ${lit(client)})
    returning document_id::text as id`)
  check(
    'and a document it added is not the office’s own',
    (await one(`select app.document_origin(${lit(String(doc.id))}::uuid) as v`)).v === 'harness',
    String((await one(`select app.document_origin(${lit(String(doc.id))}::uuid) as v`)).v),
  )
}

/* A registered test DESTINATION still receives test work. */
{
  const dest = `-7${n()}${n()}`
  await db.execute(
    `insert into public.test_destinations (channel, target_ref, why) values ('telegram', ${lit(dest)}, 'isolated 381')`,
  )
  const r = await claim(String(tTest.job), `o381:dest:${String(tTest.job)}`, dest)
  check(
    'a registered test destination still receives test work',
    r.outcome === 'claimed',
    String(r.outcome),
  )
}

/* Unknown stays fail-closed. */
{
  const u = await store({
    origin_channel: 'telegram',
    origin_ref: `${CHAT}:${n()}`,
    actor: CHAT,
    instruction: `Unknown ${run}`,
    dedupe_key: `telegram:artifact_demo:${run}`,
    subject: 'grant',
  })
  check(
    'a turn no adapter writes is still unknown',
    (await origin(String(u.job))) === 'unknown',
    await origin(String(u.job)),
  )
  check(
    'and refused',
    (await claim(String(u.job), `o381:u:${String(u.job)}`)).outcome !== 'claimed',
    'refused',
  )
}

const failed = results.filter((x) => !x.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
await db2.end()
process.exit(failed === 0 ? 0 : 1)
