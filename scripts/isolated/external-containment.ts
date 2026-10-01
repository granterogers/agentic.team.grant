/**
 * #378 siblings — harness work may not write to somebody else's system.
 *
 *   npx tsx scripts/isolated/external-containment.ts <replica-db>
 *
 * The REAL `runJob` against the isolated replica, with harness lineage made
 * the way production makes it: a voice-door turn from a `verify-...` session
 * and the children it starts. The handlers of the external kinds are stand-ins
 * that only record that they were called, so "the writer ran" is observed
 * directly and nothing can leave this process. The gate is decided before the
 * handler, from the kind, so a stand-in exercises exactly the path a real
 * handler would take.
 *
 * Controls: a real Telegram turn's children, and a duty with no lineage, must
 * still run. Containment that blocks Grant's own work is not containment.
 */
import type { Handler, HandlerOutput, Job } from '../../src/jobs/worker.ts'
import { runJob } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { realTelegramKey, registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'ext378')
await registerBot(db)
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const EXTERNAL = [
  'office.notion_import',
  'office.notion_adopt',
  'notebook.add_source',
  'notebook.push_document',
  'office.execute_plan',
  'google.revoke',
  'ci.dispatch',
  'office.vault_export',
  'google.write_calendar_tasks',
]
const called: string[] = []
const output: HandlerOutput = {
  body: 'isolated stand-in',
  confidence: 'high',
  contradictions: null,
  evidence: 'verified',
  model: null,
  path: 'deterministic_retrieval',
  sources: ['isolated:378'],
} as HandlerOutput
const standIn = (kind: string): Handler =>
  ({
    kind,
    handle: async (job: Job) => {
      called.push(job.jobId)
      return output
    },
  }) as Handler
const HANDLERS = [...EXTERNAL, 'office.synthesise', 'office.notion_sync'].map(standIn)
const approve = (async () => ({ approved: true })) as unknown as Parameters<typeof runJob>[3]

const turn = async (channel: string, key: string, ref: string): Promise<string> => {
  const cmd = await one(`
    set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (${lit(channel)}, ${lit(ref)}, 'grant', ${lit(`External proof ${run}`)}, ${lit(key)}, 'grant')
    returning command_id::text as id`)
  const enq = await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  return String(
    ((typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }).job_id,
  )
}
const child = async (parent: string, kind: string): Promise<string> =>
  String(
    (
      await one(`select app.enqueue_child(p_office => app.job_office(${lit(parent)}::uuid), p_parent => ${lit(parent)}::uuid, p_kind => ${lit(kind)},
        p_payload => '{}'::jsonb)::text as v`)
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0] ?? ''

/** Run one job through the real runJob, as a worker would after dequeuing it. */
const runIt = async (jobId: string): Promise<{ state: string; ran: boolean; reason: string }> => {
  const r = await one(`update public.jobs set state = 'running', attempt = attempt + 1
      where job_id = ${lit(jobId)}::uuid and state = 'queued'
    returning kind, correlation_id::text as c, project_id::text as p, idempotency_key as k, attempt`)
  const before = called.length
  const job: Job = {
    jobId,
    kind: String(r.kind),
    correlationId: String(r.c),
    projectId: r.p === null ? null : String(r.p),
    idempotencyKey: String(r.k),
    attempt: Number(r.attempt),
  }
  await runJob(db, job, HANDLERS, approve).catch((e: Error) =>
    console.log(`  (runJob: ${e.message.slice(0, 120)})`),
  )
  const after = await one(
    `select state::text as s, coalesce(state_reason, '') as r from public.jobs where job_id = ${lit(jobId)}::uuid`,
  )
  return { state: String(after.s), ran: called.length > before, reason: String(after.r) }
}

const harness = await turn('voice', `voice:turn:verify-378x-${run}.1`, `verify-378x-${run}/x:1`)
const real = await turn('telegram', realTelegramKey(), `1386648496:${String(Date.now() % 100000)}`)
const cls =
  await one(`select app.harness_job(${lit(harness)}::uuid) as h, app.harness_job(${lit(real)}::uuid) as r,
  (select is_fixture from public.jobs where job_id = ${lit(harness)}::uuid) as f`)
check(
  'precondition: the parent is canonically harness, is_fixture says real',
  cls.h === true && cls.f === false,
  `harness_job ${String(cls.h)}, is_fixture ${String(cls.f)}`,
)
check('precondition: the control parent is real', cls.r === false, `harness_job ${String(cls.r)}`)

/* Harness parent -> external child, for every writer the audit found. */
for (const kind of EXTERNAL) {
  const c = await child(harness, kind)
  const got = await runIt(c)
  check(
    `harness ${kind} never reaches its writer`,
    !got.ran && got.state === 'cancelled' && got.reason.startsWith('contained:'),
    `${got.ran ? 'WRITER RAN' : 'writer not called'}, ${got.state}: ${got.reason.slice(0, 70)}`,
  )
}

/* Multi-level: harness -> internal child -> external grandchild. */
{
  const mid = await child(harness, 'office.synthesise')
  const leaf = await child(mid, 'office.notion_import')
  const got = await runIt(leaf)
  check(
    'a harness grandchild (through an internal child) is contained',
    !got.ran && got.state === 'cancelled',
    `${got.ran ? 'WRITER RAN' : 'writer not called'}, ${got.state}`,
  )
}

/* Parent finished while the child is still to run. */
{
  const c = await child(harness, 'notebook.add_source')
  await db.execute(
    `update public.jobs set state = 'running' where job_id = ${lit(harness)}::uuid and state = 'queued'`,
  )
  await db.execute(`update public.jobs set state = 'cancelled', finished_at = app.now_utc(), state_reason = 'isolated'
    where job_id = ${lit(harness)}::uuid and state = 'running'`)
  const got = await runIt(c)
  check(
    'a harness child still contained after its parent has ended',
    !got.ran && got.state === 'cancelled',
    `${got.ran ? 'WRITER RAN' : 'writer not called'}, ${got.state}`,
  )
}

/* Legacy provenance: a suite-named root job with no inbound turn at all. */
{
  const legacy = String(
    (
      await one(`insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
        values (gen_random_uuid(), ${lit(`legacy:${run}`)}, 'office.notion_import', ${lit(`verify:legacy-${run}`)})
        returning job_id::text as v`)
    ).v,
  )
  const got = await runIt(legacy)
  check(
    'a legacy suite-created job with no turn behind it is contained',
    !got.ran && got.state === 'cancelled',
    `${got.ran ? 'WRITER RAN' : 'writer not called'}, ${got.state}`,
  )
}

/* Missing provenance: the worker holds a job the database cannot find. */
{
  const before = called.length
  const ghost: Job = {
    jobId: '00000000-0000-4000-8000-000000000378',
    kind: 'google.revoke',
    correlationId: '00000000-0000-4000-8000-000000000378',
    projectId: null,
    idempotencyKey: `ghost:${run}`,
    attempt: 1,
  }
  const r = await runJob(db, ghost, HANDLERS, approve).catch((e: Error) => ({
    finalState: 'threw',
    note: e.message,
  }))
  check(
    'a job whose row cannot be found never reaches its writer (fails closed)',
    called.length === before && r.finalState === 'cancelled',
    `${called.length > before ? 'WRITER RAN' : 'writer not called'}, ${r.finalState}: ${r.note.slice(0, 80)}`,
  )
}

/* Controls: Grant's own work still runs. */
for (const kind of ['office.notion_import', 'notebook.add_source', 'ci.dispatch']) {
  const c = await child(real, kind)
  const got = await runIt(c)
  check(
    `control: a real ${kind} reaches its writer`,
    got.ran && got.state !== 'cancelled',
    `${got.ran ? 'writer called' : 'WRITER NOT CALLED'}, ${got.state}`,
  )
}
{
  const d = String(
    (
      await one(`insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
        values (gen_random_uuid(), ${lit(`duty:notion-sync:${run}`)}, 'office.notion_sync', 'duty:notion-sync')
        returning job_id::text as v`)
    ).v,
  )
  const got = await runIt(d)
  check(
    'control: a duty with no lineage reaches its writer',
    got.ran && got.state !== 'cancelled',
    `${got.ran ? 'writer called' : 'WRITER NOT CALLED'}, ${got.state}`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
