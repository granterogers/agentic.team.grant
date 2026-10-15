/**
 * TM-032 / COS-053 / COS-083 — a status answer is built from the conversation's recorded work, not from memory.
 *
 *   npx tsx scripts/isolated/status-answers-from-state.ts <replica-db>
 *
 * Drives the REAL `instructionHandler` on a real job (a real turn through the real enqueue path), with the
 * conversation's handed-on work recorded in `jobs`. The only stand-in is the model: a stub router that records every
 * prompt it is shown and answers with fixed text. Nothing here says what the office WOULD say; it asserts what the
 * office was SHOWN, which is the property the status claim rests on.
 *
 * Asserts:
 *   1. The reader lists handed-on work from an earlier turn as in flight while it is queued.
 *   2. A status question is told that piece is still underway, queued or running, not finished.
 *   3. The handler ran end to end and its answer is the body it returns.
 *   4. After that piece fails, the reader no longer lists it as in flight.
 *   5. After that piece fails, the status question no longer describes it as underway.
 *
 * KNOWN GAP, observed and not asserted as a pass: a failed piece that was NOT reassigned is not reported at all.
 *
 * Replica only; the guard refuses anything else.
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import type { Job } from '../../src/jobs/worker.ts'
import type { ProviderRouter } from '../../src/providers/router.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>

// The model stand-in: records each prompt, answers with fixed text. Only the answering call matters here.
const shown: string[] = []
const stub = {
  complete: async (req: { messages: { role: string; content: string }[] }) => {
    const system = req.messages[0]?.content ?? ''
    const user = req.messages
      .slice(1)
      .map((m) => m.content)
      .join('\n')
    shown.push(`${system}\n${user}`)
    if (system.startsWith('You route one request')) return { content: 'none', model: 'status/stub' }
    if (system.startsWith('You are the chief of staff of a small office'))
      return { content: '{}', model: 'status/stub' }
    return { content: 'STUB STATUS ANSWER', model: 'status/stub' }
  },
}
const handler = instructionHandler({ db, router: stub as unknown as ProviderRouter })

// The work is handed on by an EARLIER turn of the same conversation; the status question is a later turn. The reader
// lists the conversation's handed-on work, so a turn's own children are not "prior work" to it (work-carries-its-project).
const priorTurn = await realParent(db)
const statusJob = await realParent(db)
const office = String((await one(`select app.job_office('${statusJob}'::uuid)::text as o`)).o)
const project = String(
  (await one(`select project_id::text as p from public.jobs where job_id = '${statusJob}'::uuid`))
    .p,
)

// Hand a specialist one piece of work under the earlier turn, and leave it queued (in flight).
const handedOn = String(
  (
    await one(`select app.enqueue_child_once('${office}'::uuid, '${priorTurn}'::uuid, 'office.instruction',
      'research-director: draft the venue report',
      jsonb_build_object('instruction', 'Draft the venue report', 'addressed_to', 'research-director',
                         'origin_channel', 'telegram', 'command_id', '', 'handed_off_by', 'chief-of-staff'),
      false, null, null, null, null) ->> 'job_id' as j`)
  ).j,
)

// The authoritative reader, before the handler runs: the handed-on job must be listed as in flight.
const readerBefore = JSON.parse(
  String(
    (
      await one(`select app.conversation_work('${office}'::uuid,
        (select command_id from public.inbound_commands where job_id = '${statusJob}'::uuid limit 1),
        interval '24 hours', '${statusJob}'::uuid)::text as r`)
    ).r,
  ),
) as { in_flight: { job: string }[] }
const listedBefore = readerBefore.in_flight.some((w) => w.job === handedOn)
if (process.env.STATUS_DUMP)
  console.log(`  > reader in_flight: ${JSON.stringify(readerBefore.in_flight).slice(0, 200)}`)

// The status question itself.
await db.execute(
  `update public.jobs set pinned_config = jsonb_set(pinned_config, '{instruction}', '"Where has the venue report got to?"')
    where job_id = '${statusJob}'::uuid`,
)

const job: Job = {
  jobId: statusJob,
  kind: 'office.instruction',
  correlationId: String(
    (
      await one(
        `select correlation_id::text as c from public.jobs where job_id = '${statusJob}'::uuid`,
      )
    ).c,
  ),
  projectId: project,
  idempotencyKey: `status-proof-${statusJob}`,
  attempt: 1,
  officeId: office,
}
const queuedRun = await handler.handle(job)
const promptQueued = shown.join('\n')
if (process.env.STATUS_DUMP)
  for (const p of shown)
    for (const line of p.split('\n'))
      if (/venue report|Draft the venue|in flight|queued|running|failed/i.test(line))
        console.log(`  > ${line.slice(0, 220)}`)
check(
  'the reader lists the handed-on work as in flight while it is queued',
  listedBefore,
  `listed: ${String(listedBefore)}`,
)
check(
  'a status question is told that work is still underway, not finished, while it is queued',
  /Still open from that: 1 piece\(s\) are still underway, queued or running, not finished\./.test(
    promptQueued,
  ),
  'the prompt states the open piece by its state, not as finished',
)
check(
  'the handler ran end to end and its answer is the job output',
  queuedRun.body.includes('STUB STATUS ANSWER'),
  `body starts: ${queuedRun.body.slice(0, 60)}`,
)

// The handed-on job fails. The next status question must be built from that, not from the earlier prompt.
await db.execute(
  `update public.jobs set state = 'failed', state_reason = 'status proof: ran out of attempts' where job_id = '${handedOn}'::uuid`,
)
shown.length = 0
await handler.handle({ ...job, idempotencyKey: `status-proof-2-${statusJob}` })
const promptFailed = shown.join('\n')
const readerAfter = JSON.parse(
  String(
    (
      await one(`select app.conversation_work('${office}'::uuid,
        (select command_id from public.inbound_commands where job_id = '${statusJob}'::uuid limit 1),
        interval '24 hours', '${statusJob}'::uuid)::text as r`)
    ).r,
  ),
) as { in_flight: { job: string }[]; recently_done: { job: string; state: string }[] }
const failedListed = readerAfter.recently_done.some(
  (w) => w.job === handedOn && w.state === 'failed',
)
const stillInFlight = readerAfter.in_flight.some((w) => w.job === handedOn)
check(
  'after it fails, the reader no longer lists it as in flight',
  !stillInFlight,
  `in flight: ${String(stillInFlight)}`,
)
// KNOWN GAP, recorded and not asserted as a pass: the reader reports only `complete` as finished and omits failed
// pieces, so a failed hand-off that was NOT reassigned is silent to a status question. A failed hand-off that WAS
// reassigned to the Chief of Staff has a live replacement, which the reader does show. Linking the two needs a design
// choice (the replacement carries no id of the job it replaces), so it stays AMBER on COS-053 and COS-083.
console.log(
  `OBSERVED failed piece listed by the reader: ${String(failedListed)} (known gap: a failed piece not reassigned is silent)`,
)
check(
  'after it fails, the status question no longer says it is underway',
  !/Still open from that: 1 piece\(s\) are still underway/.test(promptFailed),
  'the prompt does not describe a failed piece as underway',
)

await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared'
    where job_id in ('${priorTurn}'::uuid, '${statusJob}'::uuid, '${handedOn}'::uuid) and state = 'queued'`,
)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
