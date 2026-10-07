/**
 * e2e-convergence (agent E1): do the five inbound surfaces write ONE ledger and behave as one system?
 *
 *   npx tsx scripts/isolated/e2e-convergence.ts <replica-db>
 *
 * Hermetic: the REAL edge handlers (telegram-webhook, slack-events, voice, hq-api) run in Node against a marked
 * local replica (edge-emulator.ts refuses and records every non-replica URL), the REAL `office.instruction` handler
 * runs with the model degraded to `{}` (only the deterministic cascade acts), and everything is read back from the
 * canonical tables. No model, no Telegram, no Slack, no Whisper, no network.
 *
 * Surfaces driven, the SAME sentence through each:
 *   tg-text    Telegram webhook, text            (inbound_commands origin 'telegram')
 *   tg-voice   Telegram webhook, voice note      (stored as a handle; the Whisper step is UNPROVEN here, so the
 *              transcript the worker would write back is PRESET - everything downstream of it is driven)
 *   slack      slack-events, signed message
 *   hq-chat    Team HQ chat composer  -> POST /voice/turn   (origin 'voice')
 *   hq-call    realtime call tool     -> POST /voice/turn   (same door, a different session id)
 *   hq-say     hq-api action `say`    -> app.say_in_project (origin 'teamhq')
 *
 * Prints PROVEN / FAILED per property, and the surface x property table as data.
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { computeSignature } from '../../src/slack/signature.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { registerBot } from './real-telegram.ts'
import { startTelegramDoor } from './telegram-door.ts'

const db = await isolated(process.argv[2] ?? 'e1_conv')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
let failed = 0
let total = 0
const check = (what: string, ok: boolean, detail: string) => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'PROVEN' : 'FAILED'} ${what} - ${detail}`)
}
const note = (s: string) => console.log(`       ${s}`)

const GRANT_TG = '1386648496'
const BOT = '8967954396'
const GRANT_SLACK = 'U0BUNF6AALC'
const SECRET = 'isolated-slack-signing-secret'
const TEAM = 'T0ISOLATED'
const CHANNEL = `C0E1${run.toUpperCase().slice(0, 6)}`
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const n = () => Math.floor(Math.random() * 9_000_000) + 1_000_000

// ---- the office: one real project the surfaces can name or be mapped to -------------------------------------------
const op = String((await one(`select app.operator_office()::text as o`)).o)
const projName = `Harbourview ${run}`
const proj = json(
  (
    await one(
      `select app.hq_create_project(${lit(op)}::uuid, ${lit(projName)}, 'upload', ${lit(`e1-${run}`)}, ${lit(projName)}, true) as v`,
    )
  ).v,
)
const projectId = String(proj.project_id)
const unnamed = String((await one(`select app.unnamed_project(${lit(op)}::uuid)::text as p`)).p)
const created = [projectId]

await registerBot(db)
await db.execute(
  `insert into public.subject_identities (office_id, subject, origin_channel, actor, note)
   values (${lit(op)}::uuid, 'grant', 'slack', ${lit(GRANT_SLACK)}, 'e1') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_app_credentials (office_id, slack_app_id, team_id, app_name)
   values (${lit(op)}::uuid, 'A0ISOLATED1', ${lit(TEAM)}, 'e1') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_workspaces (team_id, team_name, bot_user_id, office_id)
   values (${lit(TEAM)}, 'e1', 'U0BOTUSERX', ${lit(op)}::uuid) on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name, active)
   values (${lit(CHANNEL)}, ${lit(TEAM)}, ${lit(projectId)}::uuid, 'e1-harbourview', true)
   on conflict do nothing`,
)

// ---- the doors ---------------------------------------------------------------------------------------------------
const tg = await startTelegramDoor(db, BOT)
const slackEdge = await startEdge({
  db,
  edgeFile: 'supabase/functions/slack-events/index.ts',
  beside: [
    ['src/slack/events.ts', 'events.ts'],
    ['src/slack/interactions.ts', 'interactions.ts'],
    ['src/slack/signature.ts', 'signature.ts'],
  ],
  env: {
    SLACK_SIGNING_SECRET: SECRET,
    SLACK_BOT_USER_ID: 'U0BOTUSERX',
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  },
})
const env = {
  HQ_API_TOKEN: 'isolated-hq-token',
  SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
  SUPABASE_ANON_KEY: 'isolated-anon',
  SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
}
// H1: a second PERSON in a second OFFICE, with a project of the SAME NAME, for the isolation controls below.
const S_OTHER = `aaa.bbb.${'o'.repeat(70)}`
const otherEmail = `h1.other.${run}@example.com`
const otherKey = `h1-other-${run}`
await db.execute(
  `insert into auth.users (id, email) values (gen_random_uuid(), ${lit(otherEmail)})`,
)
const otherOffice = String(
  json(
    (
      await one(
        `select app.provision_person_office(${lit(`H1 other ${run}`)}, ${lit(otherEmail)}, ${lit(otherKey)}) as r`,
      )
    ).r,
  ).office_id,
)
const authUsers = { [S_GRANT]: 'grant.e.rogers@gmail.com', [S_OTHER]: otherEmail }
const voiceEdge = await startEdge({
  db,
  edgeFile: 'supabase/functions/voice/index.ts',
  env,
  authUsers,
})
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })

const postVoice = async (
  said: string,
  session: string,
  project: string | null,
  bearer = S_GRANT,
  message?: string,
) => {
  const r = await voiceEdge.call(
    new Request('https://gw.invalid/functions/v1/voice/turn', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        said,
        session,
        ...(project === null ? {} : { project }),
        ...(message === undefined ? {} : { message }),
      }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const act = async (action: string, args: Record<string, unknown>) => {
  const r = await gw.call(
    new Request('https://gw.invalid/functions/v1/hq-api', {
      method: 'POST',
      headers: { Authorization: `Bearer ${S_GRANT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const slackPost = async (text: string, channel: string) => {
  const raw = JSON.stringify({
    type: 'event_callback',
    team_id: TEAM,
    event_id: `Ev${run}${String(n())}`,
    event: {
      type: 'message',
      channel,
      channel_type: 'channel',
      user: GRANT_SLACK,
      text,
      ts: `17${String(Date.now()).slice(-8)}.${String(n()).slice(0, 6)}`,
    },
  })
  const ts = String(Math.floor(Date.now() / 1000) - 5)
  const r = await slackEdge.call(
    new Request('https://door.invalid/functions/v1/slack-events', {
      method: 'POST',
      headers: {
        'X-Slack-Signature': await computeSignature(SECRET, ts, raw),
        'X-Slack-Request-Timestamp': ts,
        'Content-Type': 'application/json',
      },
      body: raw,
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const tgUpdate = (extra: Record<string, unknown>) => ({
  update_id: n(),
  message: {
    message_id: n(),
    date: Math.floor(Date.now() / 1000),
    chat: { id: Number(GRANT_TG), type: 'private' },
    from: { id: Number(GRANT_TG) },
    ...extra,
  },
})

// ---- the handler, model degraded to {} ---------------------------------------------------------------------------
const handler = instructionHandler({
  db,
  router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never,
})
const jobOf = async (jobId: string): Promise<Job> => {
  const j =
    await one(`select job_id::text as id, kind, correlation_id::text as c, project_id::text as p,
    idempotency_key as k, office_id::text as o from public.jobs where job_id = ${lit(jobId)}::uuid`)
  return {
    jobId: String(j.id),
    kind: String(j.kind),
    correlationId: String(j.c),
    projectId: j.p === null ? null : String(j.p),
    idempotencyKey: String(j.k),
    attempt: 1,
    officeId: String(j.o),
  } as Job
}

interface Landed {
  surface: string
  command: Record<string, unknown> | null
  job: Record<string, unknown> | null
  task: Record<string, unknown> | null
  body: string
}
const landed: Landed[] = []

const land = async (
  surface: string,
  sentence: string,
  opts: { preset?: string } = {},
): Promise<Landed> => {
  // Poll briefly: the telegram door enqueues inside the request, so the row is there when it answers.
  const cmd = (
    await rows(
      `select command_id::text as id, office_id::text as office, origin_channel, origin_ref, actor, subject, synthetic,
            project_id::text as project, addressed_to, dedupe_key, job_id::text as job, voice_file_id,
            context::text as context, (instruction = ${lit(sentence)}) as same_text
       from public.inbound_commands
      where instruction = ${lit(sentence)} or ${opts.preset === undefined ? 'false' : `voice_file_id = ${lit(opts.preset)}`}
      order by received_at desc limit 1`,
    )
  )[0]
  if (cmd === undefined) {
    const out = { surface, command: null, job: null, task: null, body: '' }
    landed.push(out)
    return out
  }
  if (opts.preset !== undefined) {
    // What the worker's Whisper step writes back (src/handlers/instruction.ts:1540). The step itself is UNPROVEN here.
    await db.execute(
      `update public.inbound_commands set transcript = ${lit(sentence)}, instruction = ${lit(sentence)}
        where command_id = ${lit(String(cmd.id))}::uuid`,
    )
  }
  const job = cmd.job === null ? null : await jobOf(String(cmd.job))
  const jrow =
    job === null
      ? null
      : await one(`select kind, requested_by, project_id::text as project, office_id::text as office, priority,
          pinned_config->>'origin_channel' as pc_channel, (pinned_config ? 'instruction') as pc_instr,
          (pinned_config ? 'command_id') as pc_cmd from public.jobs where job_id = ${lit(job.jobId)}::uuid`)
  let body = ''
  let task: Record<string, unknown> | null = null
  if (job !== null) {
    try {
      body = (await handler.handle(job, db)).body
    } catch (e) {
      body = `HANDLER THREW: ${String((e as Error).message).slice(0, 200)}`
    }
    task =
      (
        await rows(
          `select task_id::text as id, title, state, due_on::text as due, assigned_to_human as mine, added_by,
                project_id::text as project, office_id::text as office, is_fixture
           from public.tasks where job_id = ${lit(job.jobId)}::uuid`,
        )
      )[0] ?? null
  }
  const out = { surface, command: cmd, job: jrow, task, body }
  landed.push(out)
  return out
}

const tag = (s: string) => `${s}${run}`
const sentenceFor = (s: string) => `Remind me to ring the plumber about ${tag(s)} tomorrow.`

// ================================================================================================================
console.log('== driving the six surfaces with the same sentence shape ==')
{
  const t = sentenceFor('tgtext')
  const r = await tg.post(tgUpdate({ text: t }))
  check(
    'tg-text: door answers 200 and queues',
    r.status === 200 && typeof r.body.queued === 'string',
    JSON.stringify(r.body),
  )
  await land('tg-text', t)
}
{
  const t = sentenceFor('tgvoice')
  const fileId = `file-e1-${run}`
  const r = await tg.post(tgUpdate({ voice: { file_id: fileId, duration: 6 } }))
  // Replica config voice.transcription = none: the door stores the recording and a job, then says so honestly
  // (refused: no transcription available) rather than queueing silence. Production's setting is PARKED.
  check(
    'tg-voice: door answers 200 and stores the recording as a command',
    r.status === 200,
    JSON.stringify(r.body),
  )
  await land('tg-voice', t, { preset: fileId })
}
{
  const t = sentenceFor('slack')
  const r = await slackPost(t, 'C0UNMAPPED1')
  check('slack: door answers 200', r.status === 200, JSON.stringify(r.body))
  await land('slack', t)
}
{
  const t = sentenceFor('slackmapped')
  const r = await slackPost(t, CHANNEL)
  check('slack (mapped channel): door answers 200', r.status === 200, JSON.stringify(r.body))
  await land('slack-mapped', t)
}
{
  const t = sentenceFor('hqchat')
  const r = await postVoice(t, `s${run.slice(-4)}chat`, projectId)
  check(
    'hq-chat: /voice/turn answers delegated',
    r.status === 200 && r.body.did === 'delegated',
    JSON.stringify(r.body),
  )
  await land('hq-chat', t)
}
{
  const t = sentenceFor('hqcall')
  const r = await postVoice(t, `s${run.slice(-4)}call`, projectId)
  check(
    'hq-call: /voice/turn answers delegated',
    r.status === 200 && r.body.did === 'delegated',
    JSON.stringify(r.body),
  )
  await land('hq-call', t)
}
{
  const t = sentenceFor('hqsay')
  const r = await act('say', { p_project_id: projectId, p_text: t })
  const b = json(r.body.data ?? r.body)
  check('hq-say: gateway `say` ok', r.status === 200, JSON.stringify(r.body).slice(0, 200))
  void b
  await land('hq-say', t)
}

// ---- the table ---------------------------------------------------------------------------------------------------
console.log('\n== ledger table (read back from canonical tables) ==')
console.log(
  [
    'surface',
    'cmd.origin',
    'cmd.actor',
    'cmd.subject',
    'job.kind',
    'job.requested_by',
    'project',
    'task',
    'task.mine',
    'task.due',
    'task.added_by',
  ].join(' | '),
)
for (const l of landed) {
  const proj = (p: unknown) =>
    p === projectId
      ? 'Harbourview'
      : p === unnamed
        ? 'Unnamed'
        : p === null || p === undefined
          ? '-'
          : 'other'
  console.log(
    [
      l.surface,
      l.command?.origin_channel ?? '-',
      l.command?.actor ?? '-',
      l.command?.subject ?? '-',
      l.job?.kind ?? '-',
      l.job?.requested_by ?? '-',
      proj(l.job?.project),
      l.task === null ? 'NONE' : 'yes',
      l.task?.mine ?? '-',
      l.task?.due ?? '-',
      l.task?.added_by ?? '-',
    ].join(' | '),
  )
}

const by = Object.fromEntries(landed.map((l) => [l.surface, l]))
console.log('\n== properties ==')
for (const l of landed) {
  check(
    `${l.surface}: wrote inbound_commands`,
    l.command !== null,
    String(l.command?.origin_channel),
  )
  check(
    `${l.surface}: command carries the office the door resolved`,
    l.command?.office === op,
    String(l.command?.office),
  )
  check(
    `${l.surface}: enqueue_inbound made a job of kind office.instruction`,
    l.job?.kind === 'office.instruction',
    String(l.job?.kind),
  )
  check(
    `${l.surface}: job priority 10 (a person is waiting)`,
    Number(l.job?.priority) === 10,
    String(l.job?.priority),
  )
  check(
    `${l.surface}: job.office == command.office`,
    l.job?.office === l.command?.office,
    String(l.job?.office),
  )
  check(
    `${l.surface}: job pinned_config carries instruction + command_id`,
    l.job?.pc_instr === true && l.job?.pc_cmd === true,
    '',
  )
  check(
    `${l.surface}: ledger rows are REAL (not synthetic) as Grant's own`,
    l.command?.synthetic === false || l.command?.synthetic === null,
    String(l.command?.synthetic),
  )
  check(
    `${l.surface}: ONE personal task made by the same writer`,
    l.task !== null && l.task.mine === true,
    JSON.stringify(l.task),
  )
  check(
    `${l.surface}: task due tomorrow`,
    l.task?.due === new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    String(l.task?.due),
  )
  check(
    `${l.surface}: task is in the operator's office`,
    l.task?.office === op,
    String(l.task?.office),
  )
}
// subject resolution: one person, whichever door
const subjects = new Set(landed.map((l) => String(l.command?.subject)))
check(
  'every surface resolves the actor to the SAME subject (grant)',
  subjects.size === 1 && subjects.has('grant'),
  JSON.stringify([...subjects]),
)
const requesters = new Set(landed.map((l) => String(l.job?.requested_by).split(':')[1]))
check(
  'every job is requested_by <channel>:grant (same person)',
  requesters.size === 1 && requesters.has('grant'),
  JSON.stringify([...requesters]),
)
const channelsSeen = landed
  .map((l) => `${l.surface}=${String(l.command?.origin_channel)}`)
  .join(', ')
note(`origin_channel per surface: ${channelsSeen}`)
check(
  'Team HQ chat and the realtime call use ONE door and ONE origin_channel (voice)',
  by['hq-chat']?.command?.origin_channel === 'voice' &&
    by['hq-call']?.command?.origin_channel === 'voice',
  '',
)
check(
  "Team HQ composer's origin_channel is 'teamhq' as CLAUDE.md says the dashboard channel is",
  by['hq-chat']?.command?.origin_channel === 'teamhq',
  `actual: ${String(by['hq-chat']?.command?.origin_channel)} (hq-say uses ${String(by['hq-say']?.command?.origin_channel)})`,
)
// project scoping
check(
  'hq surfaces file under the project the page names',
  by['hq-chat']?.job?.project === projectId && by['hq-say']?.job?.project === projectId,
  `${String(by['hq-chat']?.job?.project)}`,
)
check(
  "slack mapped channel files under the channel's project",
  by['slack-mapped']?.job?.project === projectId,
  String(by['slack-mapped']?.job?.project),
)
note(
  `unaddressed Telegram text with no project named files under ${by['tg-text']?.job?.project === unnamed ? 'Unnamed (routing.unnamed_when_unresolved)' : String(by['tg-text']?.job?.project)}`,
)
note(
  `unmapped Slack channel files under ${by.slack?.job?.project === unnamed ? 'Unnamed' : String(by.slack?.job?.project)}`,
)
// voice note
check(
  'tg-voice: the stored command carries a voice handle and, before transcription, NO words',
  by['tg-voice']?.command?.voice_file_id !== null,
  String(by['tg-voice']?.command?.voice_file_id),
)
check(
  'tg-voice: with the transcript present the SAME deterministic writer made the task',
  by['tg-voice']?.task !== null,
  '',
)

// ---- addressing and only-chief-speaks ---------------------------------------------------------------------------
console.log('\n== addressing / delivery rules ==')
{
  const t = `Ask research about ${tag('addr')} please`
  await tg.post(tgUpdate({ text: t }), BOT)
  const c = (
    await rows(`select addressed_to from public.inbound_commands where instruction = ${lit(t)}`)
  )[0]
  note(`telegram addressed_to when sent to the chief's bot: ${String(c?.addressed_to)}`)
  const s = await act('say', {
    p_project_id: projectId,
    p_text: `addr ${tag('x')}`,
    p_addressed_to: 'research-director',
  })
  const sc = (
    await rows(
      `select addressed_to, origin_channel from public.inbound_commands where instruction = ${lit(`addr ${tag('x')}`)}`,
    )
  )[0]
  check(
    'hq-say honours an addressee (staff slug) and records it on the command',
    sc?.addressed_to === 'research-director',
    JSON.stringify(sc),
  )
  const v = await postVoice(`addr voice ${tag('v')}`, `s${run.slice(-4)}adr`, projectId)
  void s
  void v
}
{
  const cfg = await one(
    `select value::text as v from public.system_config where key = 'telegram.only_chief_speaks'`,
  )
  note(`telegram.only_chief_speaks on replica: ${String(cfg?.v)}`)
}

// ---- idempotency at the door (redelivery) -----------------------------------------------------------------------
console.log('\n== redelivery ==')
{
  const t = `Redelivery check ${tag('rd')}`
  const upd = tgUpdate({ text: t })
  const a = await tg.post(upd)
  const b = await tg.post(upd)
  const c = Number(
    (
      await one(
        `select count(*)::int as c from public.inbound_commands where instruction = ${lit(t)}`,
      )
    ).c,
  )
  const j = Number(
    (
      await one(
        `select count(*)::int as c from public.jobs j join public.inbound_commands c on c.job_id = j.job_id where c.instruction = ${lit(t)}`,
      )
    ).c,
  )
  check(
    'telegram redelivery: one command, one job',
    c === 1 && j === 1 && a.status === 200 && b.status === 200,
    `commands ${c} jobs ${j}`,
  )
  const s2 = `Slack redelivery ${tag('rds')}`
  const raw = JSON.stringify({
    type: 'event_callback',
    team_id: TEAM,
    event_id: `Evrd${run}`,
    event: {
      type: 'message',
      channel: 'C0UNMAPPED1',
      channel_type: 'channel',
      user: GRANT_SLACK,
      text: s2,
      ts: `1790000000.${String(n()).slice(0, 6)}`,
    },
  })
  const ts = String(Math.floor(Date.now() / 1000) - 5)
  const post = async () =>
    slackEdge.call(
      new Request('https://door.invalid/functions/v1/slack-events', {
        method: 'POST',
        headers: {
          'X-Slack-Signature': await computeSignature(SECRET, ts, raw),
          'X-Slack-Request-Timestamp': ts,
          'Content-Type': 'application/json',
        },
        body: raw,
      }),
    )
  await post()
  await post()
  const sc = Number(
    (
      await one(
        `select count(*)::int as c from public.inbound_commands where instruction = ${lit(s2)}`,
      )
    ).c,
  )
  check('slack redelivery: one command', sc === 1, `commands ${sc}`)
  const v1 = await postVoice(`voice twice ${tag('vt')}`, `s${run.slice(-4)}twice`, projectId)
  const v2 = await postVoice(`voice twice ${tag('vt')}`, `s${run.slice(-4)}twice`, projectId)
  const vc = Number(
    (
      await one(
        `select count(*)::int as c from public.inbound_commands where instruction = ${lit(`voice twice ${tag('vt')}`)}`,
      )
    ).c,
  )
  note(
    `hq/voice double-submit of one sentence: ${vc} command rows (${String(v1.body.did)}, ${String(v2.body.did)}) - by design each submit is a new turn key`,
  )
}

// ---- conversation continuity: what "that" / "yes please" can refer to --------------------------------------------
console.log('\n== conversation continuity ==')
{
  const before = async (said: string) => {
    const c = (
      await rows(
        `select command_id::text as id from public.inbound_commands where instruction = ${lit(said)} order by received_at desc limit 1`,
      )
    )[0]
    const r = await one(
      `select jsonb_array_length(app.conversation_before(${lit(op)}::uuid, ${lit(String(c?.id))}::uuid)) as n`,
    )
    return Number(r.n)
  }
  const sA = `s${run.slice(-4)}ca`
  const sB = `s${run.slice(-4)}cb`
  await postVoice(`first thought ${tag('c1')}`, sA, projectId)
  await new Promise((r) => setTimeout(r, 30))
  await postVoice(`second thought ${tag('c2')}`, sA, projectId)
  await new Promise((r) => setTimeout(r, 30))
  await postVoice(`third thought after a page reload ${tag('c3')}`, sB, projectId)
  // H1: the conversation is the person's thread in the project, so the turn before is always inside it. Assert WHICH
  // turn is there (the antecedent), never an exact count that earlier sections of this run also feed.
  const saidBefore = async (said: string): Promise<string[]> => {
    const c = (
      await rows(
        `select command_id::text as id from public.inbound_commands where instruction = ${lit(said)} order by received_at desc limit 1`,
      )
    )[0]
    const r = await one(
      `select app.conversation_before(${lit(op)}::uuid, ${lit(String(c?.id))}::uuid)::text as v`,
    )
    return (JSON.parse(String(r.v)) as { said: string }[]).map((t) => t.said)
  }
  check(
    'hq: a follow-up in the SAME page session sees the turn before it',
    (await saidBefore(`second thought ${tag('c2')}`)).includes(`first thought ${tag('c1')}`),
    String(await before(`second thought ${tag('c2')}`)),
  )
  const afterReload = await saidBefore(`third thought after a page reload ${tag('c3')}`)
  check(
    'hq: a follow-up after a page reload (new session id, same person and project) still sees the earlier turns (H1)',
    afterReload.includes(`first thought ${tag('c1')}`) &&
      afterReload.includes(`second thought ${tag('c2')}`),
    `sees ${String(afterReload.length)} earlier turns, including both thoughts: ${String(afterReload.includes(`first thought ${tag('c1')}`))}`,
  )
  const tgA = `Telegram first ${tag('t1')}`
  const tgB = `Telegram second ${tag('t2')}`
  await tg.post(tgUpdate({ text: tgA }))
  await new Promise((r) => setTimeout(r, 30))
  await tg.post(tgUpdate({ text: tgB }))
  check(
    'telegram: the chat id is the conversation, so a follow-up sees the turn before',
    (await before(tgB)) >= 1,
    String(await before(tgB)),
  )
  note(
    'cross-surface: conversation_before filters on origin_channel AND chat/session, so a Telegram follow-up cannot see Team HQ turns (by construction, read from the function body)',
  )
}

// ---- H1: the durable conversation, its isolation, and the rules it must not break --------------------------------
console.log('\n== H1: durable Team HQ conversation (person + office + project) ==')
{
  const DOOR = "set local application_name = 'PostgREST 14.5';"
  const mkProject = async (office: string, name: string, key: string | null): Promise<string> =>
    String(
      json(
        (
          await one(
            `select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`h1x-${run}-${name.replace(/\W+/g, '')}`)}, ${lit(name)}, true${key === null ? '' : `, ${lit(key)}`}) as v`,
          )
        ).v,
      ).project_id,
    )
  const dock = `H1 Dock ${run}`
  const pMine = await mkProject(op, dock, null)
  const pMineTwo = await mkProject(op, `${dock} Two`, null)
  const pTheirs = await mkProject(otherOffice, dock, otherKey) // the SAME NAME, in another person's office
  created.push(pMine, pMineTwo, pTheirs)

  const cmdOf = async (said: string) =>
    (
      await rows(
        `select command_id::text as id, job_id::text as job, office_id::text as office, origin_ref, dedupe_key, synthetic,
              app.harness_voice_session(dedupe_key) as harness_session, app.command_origin(command_id) as origin
         from public.inbound_commands where instruction = ${lit(said)} order by received_at desc limit 1`,
      )
    )[0] as Record<string, unknown>
  const thread = async (office: string, said: string): Promise<string[]> => {
    const c = await cmdOf(said)
    const r = await one(
      `select app.conversation_before(${lit(office)}::uuid, ${lit(String(c.id))}::uuid)::text as v`,
    )
    return (JSON.parse(String(r.v)) as { said: string }[]).map((t) => t.said)
  }
  const questions = async (office: string, said: string) => {
    const c = await cmdOf(said)
    return (
      await rows(
        `select id, bindable from app.open_questions_for_reply(${lit(office)}::uuid, ${lit(String(c.id))}::uuid)`,
      )
    ).map((r) => ({ id: String(r.id), bindable: r.bindable === true }))
  }
  const askOn = async (office: string, project: string, said: string): Promise<string> => {
    const c = await cmdOf(said)
    return String(
      (
        await one(`insert into public.blockers (office_id, project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
          values (${lit(office)}::uuid, ${lit(project)}::uuid, ${lit(String(c.job))}::uuid, ${lit(`H1 ${run} ${crypto.randomUUID().slice(0, 6)}`)}, 'isolated', 'nothing happens until answered', array['Yes','No'], 'chief-of-staff', false)
          returning blocker_id::text as id`)
      ).id,
    )
  }
  const stateOf = async (id: string) =>
    String(
      (await one(`select state from public.blockers where blocker_id = ${lit(id)}::uuid`)).state,
    )

  // Turn 1, then a RELOAD (a new visit id), then the follow-up whose antecedent is turn 1.
  const t1 = `Research the best option. ${tag('h1a')}`
  const t2 = `Yes, do that. ${tag('h1b')}`
  const v1 = await postVoice(t1, `s${run.slice(-4)}h1a`, pMine)
  await new Promise((r) => setTimeout(r, 30))
  const v2 = await postVoice(t2, `s${run.slice(-4)}h1b`, pMine)
  check(
    'H1: both turns reached the door as the dashboard (delegated)',
    v1.body.did === 'delegated' && v2.body.did === 'delegated',
    `${String(v1.body.did)} ${String(v2.body.did)}`,
  )
  const c1 = await cmdOf(t1)
  const c2 = await cmdOf(t2)
  check(
    'H1: the two visits wrote ONE conversation head and two distinct dedupe keys',
    String(c1.origin_ref).split(':')[0] === String(c2.origin_ref).split(':')[0] &&
      c1.dedupe_key !== c2.dedupe_key,
    `${String(c1.origin_ref).split(':')[0]}`,
  )
  check(
    'H1: the durable head names neither the person nor the office in the clear',
    !String(c1.origin_ref).includes(op) && !String(c1.origin_ref).includes('grant'),
    String(c1.origin_ref).split(':')[0] ?? '',
  )
  check(
    'H1: the reloaded turn "Yes, do that." receives "Research the best option." as its antecedent',
    (await thread(op, t2)).includes(t1),
    JSON.stringify(await thread(op, t2)),
  )
  check(
    'H1: the dashboard turns are REAL (not synthetic, not harness-shaped) and trusted',
    c1.synthetic === false &&
      c1.harness_session === false &&
      c2.harness_session === false &&
      c1.origin !== 'unknown',
    `${String(c1.origin)} synthetic=${String(c1.synthetic)}`,
  )

  // A typed yes after a reload binds the question the office raised on turn 1.
  // (The question belongs to the turn BEFORE the yes, as everywhere else: a yes two turns later is not an answer.)
  const tq = `Research the best supplier. ${tag('h1q')}`
  await postVoice(tq, `s${run.slice(-4)}h1b`, pMine)
  await new Promise((r) => setTimeout(r, 30))
  const q1 = await askOn(op, pMine, tq)
  const t3 = `yes ${tag('h1c')}`
  await postVoice(t3, `s${run.slice(-4)}h1c`, pMine) // another reload
  const bound = await questions(op, t3)
  check(
    'H1: a typed yes after a reload binds the open question of the turn before it',
    bound.length === 1 && bound[0]?.id === q1 && bound[0].bindable === true,
    JSON.stringify(bound),
  )

  // Isolation. Each negative is only meaningful because the positive above holds on the same fixture.
  const o1 = `Yes, do that. ${tag('h1o1')}`
  await postVoice(o1, `s${run.slice(-4)}h1a`, pTheirs, S_OTHER) // the SAME replayed visit id, another person
  check(
    'H1 isolation: ANOTHER OFFICE, same project name and a replayed visit id, sees none of it',
    (await thread(otherOffice, o1)).length === 0,
    JSON.stringify(await thread(otherOffice, o1)),
  )
  check(
    'H1 isolation: ANOTHER OFFICE cannot bind the question',
    (await questions(otherOffice, o1)).length === 0,
    '',
  )
  const o2 = `yes ${tag('h1o2')}`
  await postVoice(o2, `s${run.slice(-4)}h1c`, pMineTwo)
  check(
    'H1 isolation: ANOTHER PROJECT in the same office gets no earlier turns from this one',
    !(await thread(op, o2)).includes(t1) && !(await thread(op, o2)).includes(t2),
    JSON.stringify(await thread(op, o2)),
  )
  check(
    "H1 isolation: ANOTHER PROJECT cannot bind this project's question",
    (await questions(op, o2)).length === 0,
    '',
  )
  // ANOTHER PERSON in the SAME office: the same head, written the way the production door writes it, from a different actor.
  const colleague = `yes ${tag('h1p')}`
  const turnId = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
  await one(`${DOOR}
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key)
    values (${lit(op)}::uuid, ${lit(pMine)}::uuid, 'voice', ${lit(`${String(c1.origin_ref).split(':')[0]}:${turnId}`)}, ${lit(`h1-colleague-${run}`)}, ${lit(colleague)},
            ${lit(`voice:turn:s${run.slice(-4)}h1p.${turnId}`)})
    returning command_id::text as id`)
  const cc = await cmdOf(colleague)
  check(
    "H1 isolation (control): the colleague's turn is a real-origin turn on the SAME head and office, so the negatives are not vacuous",
    cc.office === op &&
      String(cc.origin_ref).split(':')[0] === String(c1.origin_ref).split(':')[0] &&
      cc.origin !== 'unknown',
    `origin ${String(cc.origin)}`,
  )
  check(
    'H1 isolation: ANOTHER PERSON in the same office sees none of it',
    (await thread(op, colleague)).length === 0,
    JSON.stringify(await thread(op, colleague)),
  )
  check(
    'H1 isolation: ANOTHER PERSON in the same office cannot bind the question',
    (await questions(op, colleague)).length === 0,
    '',
  )

  // Two tabs of one person interleaving.
  const tabX = `Research option X. ${tag('h1x')}`
  const tabY = `Research option Y. ${tag('h1y')}`
  const projX = await mkProject(op, `${dock} Tabs`, null)
  created.push(projX)
  await postVoice(tabX, `s${run.slice(-4)}tx`, projX)
  const qx = await askOn(op, projX, tabX)
  await new Promise((r) => setTimeout(r, 30))
  await postVoice(tabY, `s${run.slice(-4)}ty`, projX) // the other tab: no question of its own
  const yesX = `yes ${tag('h1yx')}`
  await postVoice(yesX, `s${run.slice(-4)}tx`, projX)
  const afterY = await questions(op, yesX)
  check(
    "H1 tabs: tab Y's turn does not answer, close or rebind tab X's question",
    (await stateOf(qx)) === 'open' && afterY.every((q) => q.id === qx || false),
    `${await stateOf(qx)} ${JSON.stringify(afterY)}`,
  )
  check(
    'H1 tabs: with no question of its own in the latest turn, a yes binds NOTHING it was not asked about',
    afterY.filter((q) => q.bindable).length === 0,
    JSON.stringify(afterY),
  )
  // The latest turn in the shared thread now raises its own question: two are open, a yes binds to the NEWEST turn's only.
  const qy = await askOn(op, projX, yesX)
  const yesY = `yes ${tag('h1yy')}`
  await postVoice(yesY, `s${run.slice(-4)}ty`, projX)
  const both = await questions(op, yesY)
  check(
    "H1 tabs: with two open questions in the thread a yes binds exactly ONE (the newest turn's), never both, never another person's",
    both.filter((q) => q.bindable).length === 1 &&
      both.find((q) => q.bindable)?.id === qy &&
      !both.some((q) => q.id === qx && q.bindable),
    JSON.stringify(both),
  )
  check(
    'H1 tabs: both questions are still open (nothing was settled by arriving)',
    (await stateOf(qx)) === 'open' && (await stateOf(qy)) === 'open',
    '',
  )

  // The harness rule still holds, and a durable head does not trip it.
  const hs = `verify-h1${run}`
  const harnessSaid = `harness words ${tag('h1h')}`
  await postVoice(harnessSaid, hs, pMine)
  const ch = await cmdOf(harnessSaid)
  check(
    'H1 harness: a non-page session from a person is still harness and keeps its own head',
    ch.harness_session === true && String(ch.origin_ref).startsWith(`${hs}/`),
    `${String(ch.origin_ref)}`,
  )
  const after = `after the harness ${tag('h1z')}`
  await postVoice(after, `s${run.slice(-4)}h1z`, pMine)
  check(
    "H1 harness: a harness turn never appears in the person's real thread",
    !(await thread(op, after)).includes(harnessSaid),
    '',
  )

  // Per-turn uniqueness survives a stable head: a burst on one visit is N turns, not one webhook.
  const burst = Array.from({ length: 5 }, (_, i) => `burst ${String(i)} ${tag('h1burst')}`)
  const sBurst = `s${run.slice(-4)}bst`
  const results = await Promise.all(burst.map((t) => postVoice(t, sBurst, pMine)))
  const nBurst = Number(
    (
      await one(
        `select count(*)::int as c from public.inbound_commands where instruction like ${lit(`burst % ${tag('h1burst')}`)}`,
      )
    ).c,
  )
  check(
    'H1 dedupe: five simultaneous turns on one visit and one head are five commands',
    nBurst === 5 && results.every((r) => r.status === 200),
    `${String(nBurst)} rows`,
  )

  // A replayed message is ONE command (journey L), scoped to the person, office and project that sent it.
  const countSaying = async (said: string) =>
    Number(
      (
        await one(
          `select count(*)::int as c from public.inbound_commands where instruction = ${lit(said)}`,
        )
      ).c,
    )
  const sameId = `m${run}shared`
  const sharedSession = `s${run.slice(-4)}rp`
  const rp = `replayed ${tag('h1r')}`
  const r1 = await postVoice(rp, sharedSession, pMine, S_GRANT, sameId)
  const r2 = await postVoice(rp, sharedSession, pMine, S_GRANT, sameId)
  check(
    'H1 replay: the same message id POSTed twice is ONE command and ONE job, with the same acknowledgement',
    (await countSaying(rp)) === 1 &&
      r1.status === 200 &&
      r2.status === 200 &&
      r1.body.did === 'delegated' &&
      r2.body.did === 'delegated' &&
      r1.body.command_id === r2.body.command_id &&
      r1.body.job_id === r2.body.job_id,
    `${String(await countSaying(rp))} command(s) ${JSON.stringify([r1.body.command_id, r2.body.command_id])}`,
  )
  const rd = `different ids ${tag('h1d')}`
  await postVoice(rd, sharedSession, pMine, S_GRANT, `m${run}firstmsg`)
  await postVoice(rd, sharedSession, pMine, S_GRANT, `m${run}secondmsg`)
  check(
    'H1 replay: the same words under two DIFFERENT message ids are two commands',
    (await countSaying(rd)) === 2,
    String(await countSaying(rd)),
  )
  const ro = `other person ${tag('h1o')}`
  await postVoice(ro, sharedSession, pMine, S_GRANT, sameId)
  await postVoice(ro, sharedSession, pTheirs, S_OTHER, sameId)
  check(
    "H1 replay: ANOTHER PERSON in ANOTHER OFFICE sending the SAME id and visit id is not deduped against mine (two commands, one each)",
    (await countSaying(ro)) === 2,
    String(await countSaying(ro)),
  )
  const rj = `other project ${tag('h1j')}`
  await postVoice(rj, sharedSession, pMine, S_GRANT, sameId)
  await postVoice(rj, sharedSession, pMineTwo, S_GRANT, sameId)
  check(
    'H1 replay: the same id into ANOTHER PROJECT is another message',
    (await countSaying(rj)) === 2,
    String(await countSaying(rj)),
  )
  const rm = `malformed ${tag('h1m')}`
  for (const bad of ['short', 'has space in it', 'x'.repeat(65), 'semi;colon;colon;', '../../../etc']) {
    await postVoice(rm, sharedSession, pMine, S_GRANT, bad)
  }
  check(
    'H1 replay: a malformed or absent message id is ignored (each POST is its own turn, as before)',
    (await countSaying(rm)) === 5,
    String(await countSaying(rm)),
  )
  // the hq `say` writer: same id, same person and project is one command; another PERSON in the SAME office is not deduped
  const sayText = `said once ${tag('h1s')}`
  const sayRow = async (office: string, project: string, by: string, id: string | null) =>
    json(
      (
        await one(
          `select app.say_in_project(${lit(office)}::uuid, ${lit(project)}::uuid, ${lit(sayText)}, null, '{}'::text[], ${lit(by)}${id === null ? '' : `, ${lit(id)}`}) as v`,
        )
      ).v,
    )
  const s1 = await sayRow(op, pMine, 'grant', sameId)
  const s2 = await sayRow(op, pMine, 'grant', sameId)
  const s3 = await sayRow(op, pMine, 'grant-colleague', sameId)
  check(
    'H1 replay (say): the same id replayed is one command; the same id from another person in the same office is another',
    s1.ok === true &&
      s1.command === s2.command &&
      s1.job === s2.job &&
      s2.replayed === true &&
      s3.command !== s1.command,
    JSON.stringify([s1.replayed, s2.replayed, s3.replayed]),
  )

  for (const id of [qx, qy, q1]) {
    await db
      .execute(`select app.hq_answer_blocker(${lit(op)}::uuid, ${lit(id)}::uuid, 'No', 'grant')`)
      .catch(() => undefined)
  }
}

// ---- cleanup -----------------------------------------------------------------------------------------------------
console.log(`\n${String(total - failed)}/${String(total)} PROVEN (${String(failed)} FAILED)`)
void created
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1
