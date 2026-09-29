/**
 * #378 — Slack narration of harness work.
 *
 *   npx tsx scripts/isolated/narration-containment.ts <replica-db>
 *
 * The REAL narration code (`narrateHandoffs`, `narrateOutcomes`) through the
 * REAL Slack stack - SlackClient -> SlackTransport -> SlackOffice ->
 * DeliveryService -> app.claim_delivery - against the isolated replica. The
 * only stand-in is the network: `fetch` answers slack.com like Slack does and
 * refuses every other host, so nothing can leave this process.
 *
 * A harness job is made the way production makes one on 29 September: a
 * voice-door turn from a `verify-...` session, through a production door, so
 * app.harness_job says harness and `jobs.is_fixture` says real. A real
 * Telegram-door turn is the control: containment must not buy safety by
 * silencing Grant's own office.
 */
import { SlackClient } from '../../src/slack/api.ts'
import { narrateHandoffs, narrateOutcomes } from '../../src/slack/narrate.ts'
import { SlackOffice } from '../../src/slack/office.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'narr378')
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const TEAM = 'T0ISOLATED'
const FLOOR = 'C0FLOOR0001'
await db.execute(`insert into public.slack_workspaces (team_id, team_name, bot_user_id)
  values (${lit(TEAM)}, 'Isolated office', 'U0ISOLATED') on conflict do nothing`)
await db.execute(`insert into public.slack_channel_map (channel_id, team_id, channel_name, purpose)
  values (${lit(FLOOR)}, ${lit(TEAM)}, 'the_floor', 'general') on conflict do nothing`)

/* Slack, as far as the wire is concerned. */
const posted: { method: string; channel: string; text: string }[] = []
const slack = new SlackClient('isolated-fake-bot-token', {
  fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith('https://slack.com/api/')) throw new Error(`REFUSED: ${url}`)
    const method = url.slice('https://slack.com/api/'.length)
    const body = JSON.parse(String(init?.body ?? '{}')) as { channel?: string; text?: string }
    posted.push({ method, channel: String(body.channel ?? ''), text: String(body.text ?? '') })
    return new Response(
      JSON.stringify({ ok: true, ts: `${Date.now()}.000${posted.length}`, channel: body.channel }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }) as typeof fetch,
})
const office = new SlackOffice(db, slack)

/** A turn through a door; `door` sets the PostgREST application name production doors carry. */
const turn = async (channel: string, key: string, ref: string): Promise<string> => {
  const cmd = await one(`
    set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (${lit(channel)}, ${lit(ref)}, 'grant', ${lit(`Narration proof ${run}`)}, ${lit(key)}, 'grant')
    returning command_id::text as id`)
  const enq = await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  const v = (typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }
  await db.execute(`insert into public.routing_decisions
      (job_id, intent_class, confident, intent_reason, subject_terms, duplicate_resolution, roster, roster_reason)
    values (${lit(v.job_id)}::uuid, 'question', true, 'isolated proof', array['proof'], 'none_found',
            array['chief-of-staff'], 'isolated proof #378')`)
  return v.job_id
}
const harness = await turn('voice', `voice:turn:verify-378-${run}.1`, `verify-378-${run}/x:1`)
const real = await turn(
  'telegram',
  `telegram:message:1386648496:${String(Date.now() % 100000)}`,
  `1386648496:${String(Date.now() % 100000)}`,
)
const cls =
  await one(`select app.harness_job(${lit(harness)}::uuid) as h, (select is_fixture from public.jobs where job_id = ${lit(harness)}::uuid) as f,
  app.harness_job(${lit(real)}::uuid) as rh`)
check(
  'precondition: the harness job is canonically harness and is_fixture says real',
  cls.h === true && cls.f === false,
  `harness_job ${String(cls.h)}, is_fixture ${String(cls.f)}`,
)
check('precondition: the control job is real', cls.rh === false, `harness_job ${String(cls.rh)}`)

const posts = (job: string) =>
  posted.filter((p) => p.method === 'chat.postMessage' && p.text.includes(run)).length > 0 &&
  job !== ''
const rowFor = async (key: string): Promise<{ s?: string; j?: string }> =>
  ((
    await db.execute(
      `select state::text as s, job_id::text as j from public.deliveries where dedupe_key = ${lit(key)}`,
    )
  ).rows[0] as { s?: string; j?: string } | undefined) ?? {}

/* --- handoff narration -------------------------------------------------- */
posted.length = 0
await narrateHandoffs(db, slack, office, TEAM, 20)
const hRow = await rowFor(`narration:${harness}`)
const rRow = await rowFor(`narration:${real}`)
check(
  "the harness job's narration never reaches Slack",
  hRow.s !== 'sent',
  `delivery ${String(hRow.s ?? 'none')}`,
)
check(
  'and whatever was attempted is attributable to the job that caused it',
  hRow.s === undefined || hRow.j === harness,
  `job_id on the row: ${String(hRow.j ?? 'null')}`,
)
check(
  'control: the real job is narrated',
  rRow.s === 'sent',
  `delivery ${String(rRow.s ?? 'none')}`,
)
check(
  'control: and its row names its job',
  rRow.j === real,
  `job_id on the row: ${String(rRow.j ?? 'null')}`,
)
void posts

/* --- the witness ------------------------------------------------------- */
/*
  If the harness narration WAS sent, the witness must say so. On the baseline
  it was sent and the witness joined deliveries to jobs on a column narration
  never filled, so it counted nothing.
*/
const w = await one(`select app.harness_escapes() as e`)
const e = (typeof w.e === 'string' ? JSON.parse(w.e) : w.e) as { escaped: unknown[] }
const hSent = hRow.s === 'sent'
check(
  'the containment witness agrees with what reached Slack',
  hSent === e.escaped.length > 0,
  `harness narration sent: ${String(hSent)}; witness escapes: ${String(e.escaped.length)}`,
)

/* --- outcome narration -------------------------------------------------- */
/* A legal path to a finished state: queued -> running -> failed (outcome narration takes all three endings). */
for (const j of [harness, real]) {
  await db.execute(
    `update public.jobs set state = 'running' where job_id = ${lit(j)}::uuid and state = 'queued'`,
  )
  await db.execute(`update public.jobs set state = 'failed', finished_at = app.now_utc(), state_reason = 'isolated proof #378'
    where job_id = ${lit(j)}::uuid and state = 'running'`)
}
const ended = await one(`select count(*) filter (where state = 'failed')::int as n from public.jobs
  where job_id in (${lit(harness)}::uuid, ${lit(real)}::uuid)`)
check('precondition: both jobs have finished', ended.n === 2, `${String(ended.n)}/2 finished`)
await narrateOutcomes(db, slack, office, TEAM, 20).catch((err: Error) =>
  console.log(`  (outcomes: ${err.message.slice(0, 120)})`),
)
const hOut = await rowFor(`outcome:${harness}`)
const rOut = await rowFor(`outcome:${real}`)
check(
  "the harness job's outcome never reaches Slack",
  hOut.s !== 'sent',
  `delivery ${String(hOut.s ?? 'none')}`,
)
check(
  "control: the real job's outcome is posted, and names its job",
  rOut.s === 'sent' && rOut.j === real,
  `outcome ${String(rOut.s ?? 'none')}, job_id ${String(rOut.j ?? 'null')}`,
)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
