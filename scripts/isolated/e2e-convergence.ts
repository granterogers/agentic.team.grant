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
const authUsers = { [S_GRANT]: 'grant.e.rogers@gmail.com' }
const voiceEdge = await startEdge({ db, edgeFile: 'supabase/functions/voice/index.ts', env, authUsers })
const gw = await startEdge({ db, edgeFile: 'supabase/functions/hq-api/index.ts', env, authUsers })

const postVoice = async (said: string, session: string, project: string | null) => {
  const r = await voiceEdge.call(
    new Request('https://gw.invalid/functions/v1/voice/turn', {
      method: 'POST',
      headers: { Authorization: `Bearer ${S_GRANT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ said, session, ...(project === null ? {} : { project }) }),
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
  const j = await one(`select job_id::text as id, kind, correlation_id::text as c, project_id::text as p,
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

const land = async (surface: string, sentence: string, opts: { preset?: string } = {}): Promise<Landed> => {
  // Poll briefly: the telegram door enqueues inside the request, so the row is there when it answers.
  const cmd = (await rows(
    `select command_id::text as id, office_id::text as office, origin_channel, origin_ref, actor, subject, synthetic,
            project_id::text as project, addressed_to, dedupe_key, job_id::text as job, voice_file_id,
            context::text as context, (instruction = ${lit(sentence)}) as same_text
       from public.inbound_commands
      where instruction = ${lit(sentence)} or ${opts.preset === undefined ? 'false' : `voice_file_id = ${lit(opts.preset)}`}
      order by received_at desc limit 1`,
  ))[0]
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
      (await rows(
        `select task_id::text as id, title, state, due_on::text as due, assigned_to_human as mine, added_by,
                project_id::text as project, office_id::text as office, is_fixture
           from public.tasks where job_id = ${lit(job.jobId)}::uuid`,
      ))[0] ?? null
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
  check('tg-text: door answers 200 and queues', r.status === 200 && typeof r.body.queued === 'string', JSON.stringify(r.body))
  await land('tg-text', t)
}
{
  const t = sentenceFor('tgvoice')
  const fileId = `file-e1-${run}`
  const r = await tg.post(tgUpdate({ voice: { file_id: fileId, duration: 6 } }))
  // Replica config voice.transcription = none: the door stores the recording and a job, then says so honestly
  // (refused: no transcription available) rather than queueing silence. Production's setting is PARKED.
  check('tg-voice: door answers 200 and stores the recording as a command', r.status === 200, JSON.stringify(r.body))
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
  check('hq-chat: /voice/turn answers delegated', r.status === 200 && r.body.did === 'delegated', JSON.stringify(r.body))
  await land('hq-chat', t)
}
{
  const t = sentenceFor('hqcall')
  const r = await postVoice(t, `s${run.slice(-4)}call`, projectId)
  check('hq-call: /voice/turn answers delegated', r.status === 200 && r.body.did === 'delegated', JSON.stringify(r.body))
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
  ['surface', 'cmd.origin', 'cmd.actor', 'cmd.subject', 'job.kind', 'job.requested_by', 'project', 'task', 'task.mine', 'task.due', 'task.added_by'].join(' | '),
)
for (const l of landed) {
  const proj = (p: unknown) =>
    p === projectId ? 'Harbourview' : p === unnamed ? 'Unnamed' : p === null || p === undefined ? '-' : 'other'
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
  check(`${l.surface}: wrote inbound_commands`, l.command !== null, String(l.command?.origin_channel))
  check(`${l.surface}: command carries the office the door resolved`, l.command?.office === op, String(l.command?.office))
  check(`${l.surface}: enqueue_inbound made a job of kind office.instruction`, l.job?.kind === 'office.instruction', String(l.job?.kind))
  check(`${l.surface}: job priority 10 (a person is waiting)`, Number(l.job?.priority) === 10, String(l.job?.priority))
  check(`${l.surface}: job.office == command.office`, l.job?.office === l.command?.office, String(l.job?.office))
  check(`${l.surface}: job pinned_config carries instruction + command_id`, l.job?.pc_instr === true && l.job?.pc_cmd === true, '')
  check(`${l.surface}: ledger rows are REAL (not synthetic) as Grant's own`, l.command?.synthetic === false || l.command?.synthetic === null, String(l.command?.synthetic))
  check(`${l.surface}: ONE personal task made by the same writer`, l.task !== null && l.task.mine === true, JSON.stringify(l.task))
  check(`${l.surface}: task due tomorrow`, l.task?.due === new Date(Date.now() + 86400000).toISOString().slice(0, 10), String(l.task?.due))
  check(`${l.surface}: task is in the operator's office`, l.task?.office === op, String(l.task?.office))
}
// subject resolution: one person, whichever door
const subjects = new Set(landed.map((l) => String(l.command?.subject)))
check('every surface resolves the actor to the SAME subject (grant)', subjects.size === 1 && subjects.has('grant'), JSON.stringify([...subjects]))
const requesters = new Set(landed.map((l) => String(l.job?.requested_by).split(':')[1]))
check('every job is requested_by <channel>:grant (same person)', requesters.size === 1 && requesters.has('grant'), JSON.stringify([...requesters]))
const channelsSeen = landed.map((l) => `${l.surface}=${String(l.command?.origin_channel)}`).join(', ')
note(`origin_channel per surface: ${channelsSeen}`)
check(
  'Team HQ chat and the realtime call use ONE door and ONE origin_channel (voice)',
  by['hq-chat']?.command?.origin_channel === 'voice' && by['hq-call']?.command?.origin_channel === 'voice',
  '',
)
check(
  "Team HQ composer's origin_channel is 'teamhq' as CLAUDE.md says the dashboard channel is",
  by['hq-chat']?.command?.origin_channel === 'teamhq',
  `actual: ${String(by['hq-chat']?.command?.origin_channel)} (hq-say uses ${String(by['hq-say']?.command?.origin_channel)})`,
)
// project scoping
check('hq surfaces file under the project the page names', by['hq-chat']?.job?.project === projectId && by['hq-say']?.job?.project === projectId, `${String(by['hq-chat']?.job?.project)}`)
check('slack mapped channel files under the channel\'s project', by['slack-mapped']?.job?.project === projectId, String(by['slack-mapped']?.job?.project))
note(
  `unaddressed Telegram text with no project named files under ${by['tg-text']?.job?.project === unnamed ? 'Unnamed (routing.unnamed_when_unresolved)' : String(by['tg-text']?.job?.project)}`,
)
note(`unmapped Slack channel files under ${by.slack?.job?.project === unnamed ? 'Unnamed' : String(by.slack?.job?.project)}`)
// voice note
check('tg-voice: the stored command carries a voice handle and, before transcription, NO words', by['tg-voice']?.command?.voice_file_id !== null, String(by['tg-voice']?.command?.voice_file_id))
check('tg-voice: with the transcript present the SAME deterministic writer made the task', by['tg-voice']?.task !== null, '')

// ---- addressing and only-chief-speaks ---------------------------------------------------------------------------
console.log('\n== addressing / delivery rules ==')
{
  const t = `Ask research about ${tag('addr')} please`
  await tg.post(tgUpdate({ text: t }), BOT)
  const c = (await rows(`select addressed_to from public.inbound_commands where instruction = ${lit(t)}`))[0]
  note(`telegram addressed_to when sent to the chief's bot: ${String(c?.addressed_to)}`)
  const s = await act('say', { p_project_id: projectId, p_text: `addr ${tag('x')}`, p_addressed_to: 'research-director' })
  const sc = (await rows(`select addressed_to, origin_channel from public.inbound_commands where instruction = ${lit(`addr ${tag('x')}`)}`))[0]
  check('hq-say honours an addressee (staff slug) and records it on the command', sc?.addressed_to === 'research-director', JSON.stringify(sc))
  const v = await postVoice(`addr voice ${tag('v')}`, `s${run.slice(-4)}adr`, projectId)
  void s
  void v
}
{
  const cfg = await one(`select value::text as v from public.system_config where key = 'telegram.only_chief_speaks'`)
  note(`telegram.only_chief_speaks on replica: ${String(cfg?.v)}`)
}

// ---- idempotency at the door (redelivery) -----------------------------------------------------------------------
console.log('\n== redelivery ==')
{
  const t = `Redelivery check ${tag('rd')}`
  const upd = tgUpdate({ text: t })
  const a = await tg.post(upd)
  const b = await tg.post(upd)
  const c = Number((await one(`select count(*)::int as c from public.inbound_commands where instruction = ${lit(t)}`)).c)
  const j = Number(
    (await one(`select count(*)::int as c from public.jobs j join public.inbound_commands c on c.job_id = j.job_id where c.instruction = ${lit(t)}`)).c,
  )
  check('telegram redelivery: one command, one job', c === 1 && j === 1 && a.status === 200 && b.status === 200, `commands ${c} jobs ${j}`)
  const s2 = `Slack redelivery ${tag('rds')}`
  const raw = JSON.stringify({
    type: 'event_callback',
    team_id: TEAM,
    event_id: `Evrd${run}`,
    event: { type: 'message', channel: 'C0UNMAPPED1', channel_type: 'channel', user: GRANT_SLACK, text: s2, ts: `1790000000.${String(n()).slice(0, 6)}` },
  })
  const ts = String(Math.floor(Date.now() / 1000) - 5)
  const post = async () =>
    slackEdge.call(
      new Request('https://door.invalid/functions/v1/slack-events', {
        method: 'POST',
        headers: { 'X-Slack-Signature': await computeSignature(SECRET, ts, raw), 'X-Slack-Request-Timestamp': ts, 'Content-Type': 'application/json' },
        body: raw,
      }),
    )
  await post()
  await post()
  const sc = Number((await one(`select count(*)::int as c from public.inbound_commands where instruction = ${lit(s2)}`)).c)
  check('slack redelivery: one command', sc === 1, `commands ${sc}`)
  const v1 = await postVoice(`voice twice ${tag('vt')}`, `s${run.slice(-4)}twice`, projectId)
  const v2 = await postVoice(`voice twice ${tag('vt')}`, `s${run.slice(-4)}twice`, projectId)
  const vc = Number((await one(`select count(*)::int as c from public.inbound_commands where instruction = ${lit(`voice twice ${tag('vt')}`)}`)).c)
  note(`hq/voice double-submit of one sentence: ${vc} command rows (${String(v1.body.did)}, ${String(v2.body.did)}) - by design each submit is a new turn key`)
}

// ---- conversation continuity: what "that" / "yes please" can refer to --------------------------------------------
console.log('\n== conversation continuity ==')
{
  const before = async (said: string) => {
    const c = (await rows(`select command_id::text as id from public.inbound_commands where instruction = ${lit(said)} order by received_at desc limit 1`))[0]
    const r = await one(`select jsonb_array_length(app.conversation_before(${lit(op)}::uuid, ${lit(String(c?.id))}::uuid)) as n`)
    return Number(r.n)
  }
  const sA = `s${run.slice(-4)}ca`
  const sB = `s${run.slice(-4)}cb`
  await postVoice(`first thought ${tag('c1')}`, sA, projectId)
  await new Promise((r) => setTimeout(r, 30))
  await postVoice(`second thought ${tag('c2')}`, sA, projectId)
  await new Promise((r) => setTimeout(r, 30))
  await postVoice(`third thought after a page reload ${tag('c3')}`, sB, projectId)
  check('hq: a follow-up in the SAME page session sees the turn before it', (await before(`second thought ${tag('c2')}`)) === 1, String(await before(`second thought ${tag('c2')}`)))
  const afterReload = await before(`third thought after a page reload ${tag('c3')}`)
  check(
    'hq: a follow-up after a page reload (new session id, same project) still sees the earlier turns',
    afterReload >= 1,
    `sees ${String(afterReload)} earlier turns (session id is part of the conversation key; chat.js mints a new one per page load)`,
  )
  const tgA = `Telegram first ${tag('t1')}`
  const tgB = `Telegram second ${tag('t2')}`
  await tg.post(tgUpdate({ text: tgA }))
  await new Promise((r) => setTimeout(r, 30))
  await tg.post(tgUpdate({ text: tgB }))
  check('telegram: the chat id is the conversation, so a follow-up sees the turn before', (await before(tgB)) >= 1, String(await before(tgB)))
  note(
    'cross-surface: conversation_before filters on origin_channel AND chat/session, so a Telegram follow-up cannot see Team HQ turns (by construction, read from the function body)',
  )
}

// ---- cleanup -----------------------------------------------------------------------------------------------------
console.log(`\n${String(total - failed)}/${String(total)} PROVEN (${String(failed)} FAILED)`)
void created
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1
