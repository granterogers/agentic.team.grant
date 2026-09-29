/**
 * #379 — Grant's own traffic still reaches the outside world.
 *
 *   npx tsx scripts/isolated/legit-origins.ts <replica-db>
 *
 * Written BEFORE the classifier was tightened, and required to pass both
 * before and after: containment that buys safety by silencing the office is
 * not containment.
 *
 * Every command here is made by the REAL adapter code — the functions the
 * edge functions import (`src/channels/telegram.ts`, `src/slack/events.ts`,
 * `src/slack/interactions.ts`), the real voice door through its emulator, and
 * the real SQL doors the dashboard calls (`app.say_in_project`,
 * `app.send_to_agent`). Each is written the way its door writes it: through
 * PostgREST (application_name), then `app.enqueue_inbound`.
 *
 * For every origin two boundaries are asked, exactly as production asks them:
 *   - app.claim_delivery to a REAL destination (Grant's chat id) — must CLAIM;
 *   - the worker's job gate, for an external-writing CHILD — must allow.
 */
import { toCanonicalCommand as fromTelegram } from '../../src/channels/telegram.ts'
import { containmentRefusal } from '../../src/jobs/containment.ts'
import { toCanonicalCommand as fromSlack } from '../../src/slack/events.ts'
import { toCanonicalInteraction } from '../../src/slack/interactions.ts'
import { isolated } from './guard.ts'
import { postTurn, startDoor } from './voice-door.ts'

const db = await isolated(process.argv[2] ?? 'legit379')
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
const jobOf = (v: Record<string, unknown>) => {
  const j = v.job ?? v.job_id
  return typeof j === 'string' ? j : null
}
const jsonOf = (v: unknown) =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const CHAT = '1386648496'
const BOT = '8967954396'
const tokenRef = String(
  (
    await one(
      `insert into vault.secrets (name, secret) values (${lit(`isolated.bot.${run}`)}, 'isolated-fake-telegram-token') returning id::text as id`,
    )
  ).id,
)
await db.execute(`insert into public.telegram_bots (bot_id, username, staff_slug, is_pager, token_ref)
  values (${lit(BOT)}, 'isolated_chief_bot', 'chief-of-staff', true, ${lit(tokenRef)}) on conflict do nothing`)
const project = String(
  jsonOf(
    (
      await one(`select app.hq_create_project(${lit(`Legit ${run}`)}, 'upload', ${lit(`legit-${run}`)},
    ${lit(`Legit ${run}`)}, true) as v`)
    ).v,
  ).project_id as string,
)

/** A command row as its door writes it, then enqueued as the door does. */
const store = async (
  row: Record<string, unknown>,
): Promise<{ command: string; job: string | null }> => {
  const cols = Object.keys(row)
  const cmd = await one(`${DOOR}
    insert into public.inbound_commands (${cols.join(', ')})
    select ${cols.join(', ')} from jsonb_populate_record(null::public.inbound_commands, ${lit(JSON.stringify(row))}::jsonb)
    returning command_id::text as id`)
  const enq = jsonOf(
    (await one(`${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v,
  )
  return { command: String(cmd.id), job: typeof enq.job_id === 'string' ? enq.job_id : null }
}
const pick = (c: Record<string, unknown>) => ({
  origin_channel: c.origin_channel,
  origin_ref: c.origin_ref,
  actor: c.actor,
  instruction: c.instruction,
  dedupe_key: c.dedupe_key,
  callback_action: c.callback_action ?? null,
  voice_file_id: c.voice_file_id ?? null,
  voice_seconds: c.voice_seconds ?? null,
  received_at: c.received_at,
})

/** Both boundaries, for one job. */
const reaches = async (what: string, job: string | null) => {
  if (job === null) {
    check(`${what}: made work`, false, 'no job was enqueued')
    return
  }
  const claim = await one(`select outcome, coalesce((select suppressed_reason from public.deliveries
      where dedupe_key = ${lit(`legit:${job}`)}), '') as why
    from app.claim_delivery('telegram', ${lit(`legit:${job}`)}, ${lit(BOT)}, ${lit(CHAT)}, 'result',
      null, null, null, ${lit(job)}::uuid)`)
  check(
    `${what}: its answer may reach Grant`,
    claim.outcome === 'claimed',
    `${String(claim.outcome)} ${String(claim.why)}`,
  )
  const child =
    String(
      (
        await one(`select app.enqueue_child(p_parent => ${lit(job)}::uuid, p_kind => 'office.notion_import',
      p_payload => '{}'::jsonb)::text as v`)
      ).v,
    ).match(/[0-9a-f-]{36}/)?.[0] ?? ''
  const gate = await containmentRefusal(db, { jobId: child, kind: 'office.notion_import' })
  check(`${what}: its delegated writer may run`, gate === null, gate ?? 'allowed')
}

/* Telegram text, voice note, button press */
{
  const t = fromTelegram(
    {
      update_id: 1,
      message: {
        message_id: Number(n()),
        chat: { id: Number(CHAT), type: 'private' },
        from: { id: Number(CHAT) },
        text: `Legit text ${run}`,
      },
    } as never,
    new Date(),
    BOT,
  ) as unknown as Record<string, unknown>
  const s = await store({ ...pick(t), subject: 'grant', addressed_to: 'chief-of-staff' })
  await reaches('Telegram text', s.job)
  const v = fromTelegram(
    {
      update_id: 2,
      message: {
        message_id: Number(n()),
        chat: { id: Number(CHAT), type: 'private' },
        from: { id: Number(CHAT) },
        voice: { file_id: `AwACAgQ${run}`, duration: 17 },
      },
    } as never,
    new Date(),
    BOT,
  ) as unknown as Record<string, unknown>
  const sv = await store({ ...pick(v), subject: 'grant', addressed_to: 'chief-of-staff' })
  await reaches('Telegram voice note', sv.job)
  const cb = fromTelegram(
    {
      update_id: 3,
      callback_query: {
        id: `43829${n()}`,
        from: { id: Number(CHAT) },
        message: { message_id: 512, chat: { id: Number(CHAT), type: 'private' } },
        data: 'useful',
      },
    } as never,
    new Date(),
    BOT,
  ) as unknown as Record<string, unknown>
  const cbRow =
    await one(`${DOOR} insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, callback_action, subject)
    values ('telegram', ${lit(String(cb.origin_ref))}, ${lit(String(cb.actor))}, '', ${lit(String(cb.dedupe_key))}, ${lit(String(cb.callback_action))}, 'grant')
    returning command_id::text as id, dedupe_key as k`)
  check(
    'Telegram button press: the adapter key is what production writes',
    /^telegram:callback:\d+:\d+$/.test(String(cbRow.k)),
    String(cbRow.k),
  )
  if ((await one(`select to_regproc('app.command_origin') is not null as v`)).v === true) {
    const o = await one(`select app.command_origin(${lit(String(cbRow.id))}::uuid) as v`)
    check('Telegram button press: its origin is trusted', o.v === 'trusted', String(o.v))
  }
}

/* Slack text, and a Slack button */
{
  const ts = `${String(1790000000 + Number(n()))}.${n()}`
  const m = fromSlack(
    {
      type: 'event_callback',
      team_id: 'T0ISOLATED',
      event: {
        type: 'message',
        channel: 'C0C2DAPDN02',
        user: 'U0BUNF6AALC',
        text: `Legit Slack ${run}`,
        ts,
      },
    } as never,
    'U0BOTUSER',
  ) as unknown as Record<string, unknown>
  const s = await store({ ...pick(m), subject: 'grant' })
  await reaches('Slack message', s.job)
  const press = toCanonicalInteraction({
    type: 'block_actions',
    team: { id: 'T0ISOLATED' },
    user: { id: 'U0BUNF6AALC' },
    channel: { id: 'C0C2DAPDN02' },
    container: { message_ts: ts, channel_id: 'C0C2DAPDN02' },
    actions: [{ action_id: 'feedback.useful', value: 'x' }],
  } as never) as unknown as Record<string, unknown>
  const pr =
    await one(`${DOOR} insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, callback_action, subject)
    values ('slack', ${lit(String(press.origin_ref))}, ${lit(String(press.actor))}, '', ${lit(String(press.dedupe_key))}, ${lit(String(press.callback_action))}, 'grant')
    returning command_id::text as id, dedupe_key as k`)
  check(
    'Slack button: the adapter key is what production writes',
    String(pr.k).startsWith('slack:action:C0C2DAPDN02:'),
    String(pr.k),
  )
  if ((await one(`select to_regproc('app.command_origin') is not null as v`)).v === true) {
    const o = await one(`select app.command_origin(${lit(String(pr.id))}::uuid) as v`)
    check('Slack button: its origin is trusted', o.v === 'trusted', String(o.v))
  }
}

/* Team HQ: project Chat (typed), Chat voice and the realtime call (the voice door) */
{
  const said = jsonOf(
    (
      await one(
        `${DOOR} select app.say_in_project(${lit(project)}::uuid, ${lit(`Legit chat ${run}`)}) as v`,
      )
    ).v,
  )
  await reaches('Team HQ project Chat', jobOf(said))
  const door = await startDoor(db)
  for (const [what, session] of [
    ['Team HQ Chat voice (chat.js session)', `s${Math.random().toString(36).slice(2, 12)}`],
    ['Team HQ realtime call (call.js session)', `s${Math.random().toString(36).slice(2, 12)}`],
  ] as const) {
    const r = await postTurn(door, { said: `Legit voice ${run}`, session, project })
    await reaches(what, typeof r.body.job_id === 'string' ? r.body.job_id : null)
  }
}

/* Team HQ: an action on a document (app.send_to_agent), and the read its upload starts */
{
  // Two documents: the office reads a NEW one only in a project that already had one, and only past 600 characters.
  const words = `An isolated proof document ${run}. `.repeat(30)
  const addDoc = (ref: string) =>
    one(`insert into public.documents (project_id, title, connector, external_ref, content, content_chars, content_fingerprint, fetched_at, added_by)
      values (${lit(project)}::uuid, ${lit(`Legit doc ${ref}`)}, 'upload', ${lit(ref)}, ${lit(words)}, ${String(words.length)},
              encode(extensions.digest(${lit(words)}, 'sha256'), 'hex'), app.now_utc(), 'grant')
      returning document_id::text as id`)
  await addDoc(`legit-a-${run}`)
  const doc = await addDoc(`legit-b-${run}`)
  const sent = jsonOf(
    (
      await one(
        `${DOOR} select app.send_to_agent('document', ${lit(String(doc.id))}::uuid, 'review') as v`,
      )
    ).v,
  )
  await reaches('Team HQ document action', jobOf(sent))
  const read =
    await one(`select job_id::text as j from public.jobs where kind = 'knowledge.read_source'
    and pinned_config ->> 'document_id' = ${lit(String(doc.id))} limit 1`)
  await reaches('the read a new document starts', read?.j === undefined ? null : String(read.j))
}

/* A scheduled duty */
{
  await db.execute(`insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes)
    values (${lit(`legit-duty-${run}`)}, (select staff_id from public.staff where slug = 'chief-of-staff'),
            'A scheduled duty made for the isolated containment proof of issue 379.', 'office.notion_sync', 60)`)
  await db.execute('select * from app.dispatch_due_responsibilities()')
  const d = await one(
    `select job_id::text as j from public.jobs where requested_by = ${lit(`duty:legit-duty-${run}`)} limit 1`,
  )
  await reaches('a scheduled duty', d?.j === undefined ? null : String(d.j))
}

/* The office's own notices and a registered test destination (no job at all) */
{
  const op = await one(
    `select outcome from app.claim_delivery('telegram', ${lit(`build:legit:${run}`)}, ${lit(BOT)}, ${lit(CHAT)}, 'notice')`,
  )
  check('an operator notice may reach Grant', op.outcome === 'claimed', String(op.outcome))
  await db.execute(`insert into public.test_destinations (channel, target_ref, why)
    values ('telegram', ${lit(`-100${run.length}${n()}`)}, 'isolated proof test destination') on conflict do nothing`)
  const td = String(
    (
      await one(
        `select target_ref from public.test_destinations where why = 'isolated proof test destination' limit 1`,
      )
    ).target_ref,
  )
  const t = await one(
    `select outcome from app.claim_delivery('telegram', ${lit(`anything:${run}`)}, ${lit(BOT)}, ${lit(td)}, 'notice')`,
  )
  check(
    'a registered test destination may receive anything',
    t.outcome === 'claimed',
    String(t.outcome),
  )
}

const failed = results.filter((x) => !x.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
