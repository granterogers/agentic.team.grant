/**
 * B6 (architecture audit, run 1): a question about a Slack channel whose name
 * is taken offers only what the office can perform.
 *
 *   npx tsx scripts/isolated/channel-options.ts <replica-db>
 *
 * The REAL channels handler runs against the replica with a stand-in for Slack
 * (the client calls the global `fetch`, which is replaced here and records every
 * call). A project's channel name is taken by a channel that is not the
 * office's; the handler asks. The property, read from what Slack was actually
 * asked to do:
 *
 *   an option that names a channel to use must be followed by a request to
 *   create that channel; nothing may be offered whose answer changes nothing.
 *   And the question must say plainly what the office cannot do.
 */
import { channelsHandler } from '../../src/handlers/channels.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'chan0609')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const slackCalls: { method: string; params: string }[] = []
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.startsWith('https://slack.com/api/')) throw new Error(`REFUSED: ${url}`)
  const method = url.slice('https://slack.com/api/'.length).split('?')[0] ?? ''
  slackCalls.push({ method, params: `${url.split('?')[1] ?? ''}${String(init?.body ?? '')}` })
  const reply = (v: unknown) =>
    new Response(JSON.stringify(v), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  if (method === 'conversations.create') return reply({ ok: false, error: 'name_taken' })
  if (method === 'conversations.list') return reply({ ok: true, channels: [] })
  return reply({ ok: true })
}) as typeof fetch

const name = `Taken ${run}`
const project = String(
  json(
    (
      await one(
        `select app.hq_create_project(app.test_office(), ${lit(name)}, 'upload', ${lit(`taken-${run}`)}, ${lit(name)}, true) as v`,
      )
    ).v,
  ).project_id,
)
// The project is a REAL one for this proof: a fixture never gets a channel (0266).
await db
  .execute(
    `update public.projects set is_fixture_override = false where project_id = ${lit(project)}::uuid`,
  )
  .catch(() => undefined)
const isFixture = (
  await one(`select is_fixture from public.projects where project_id = ${lit(project)}::uuid`)
).is_fixture
const jobId = String(
  (
    await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
      values ('office.channels', 'duty:isolated-b6c', ${lit(project)}::uuid, 'b6c-' || gen_random_uuid(), gen_random_uuid())
      returning job_id::text as id`)
  ).id,
)
const job = {
  jobId,
  kind: 'office.channels',
  correlationId: 'x',
  projectId: project,
  idempotencyKey: 'x',
  attempt: 1,
} as unknown as Job

const handler = channelsHandler(
  { db: db as never, botToken: 'xoxb-isolated', teamId: 'T0ISOLATED' },
  'office.channels',
)
const out = await handler.handle(job, db as never)
const q = await one(`select blocker_id::text as id, requested_action as ask, approval_options as o
  from public.blockers where job_id = ${lit(jobId)}::uuid and state = 'open'`)
check(
  'precondition: the name was taken and the office asked (project is not a fixture)',
  isFixture === false && typeof q.id === 'string',
  `fixture ${String(isFixture)}; ${String(out.body).slice(0, 80)}`,
)
const options = (q.o ?? []) as string[]
const creates = () => slackCalls.filter((c) => c.method === 'conversations.create')

for (const option of options) {
  const namesAChannel = /#\S+/.test(option)
  const before = creates().length
  const answer = json(
    (
      await one(
        `select app.hq_answer_blocker(${lit(String(q.id))}::uuid, ${lit(option)}, 'grant') as r`,
      )
    ).r,
  )
  if (answer.ok === true) {
    // The rest of the office carries on; give it the chance to act on the answer.
    await handler.handle(job, db as never).catch(() => undefined)
  }
  const after = creates().filter((c) => /_project/.test(c.params)).length
  check(
    namesAChannel
      ? `"${option}" names a channel to use: Slack is asked to create it`
      : `"${option}" does not promise a channel it cannot make`,
    namesAChannel ? after > 0 : true,
    `${String(creates().length - before)} create call(s) after answering; ${String(after)} for a _project name`,
  )
  break // one answer settles the question; the rest are read, not pressed
}
check(
  'the question says plainly what the office cannot do (it does not take over a channel it did not make)',
  /not one of ours|did not make|cannot|will not/i.test(String(q.ask)) ||
    /will not|cannot/i.test(JSON.stringify(q)),
  String(q.ask).slice(0, 140),
)
check(
  'and no option names a channel the office has no way to create',
  options.every((o) => !/#\S+/.test(o)),
  JSON.stringify(options),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await db.end()
process.exit(failed.length === 0 ? 0 : 1)
