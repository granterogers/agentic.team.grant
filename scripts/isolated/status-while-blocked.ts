/**
 * REG-036 / COS-053 — a status question while work is BLOCKED on Grant says it is waiting on him, and stops saying so
 * once he has answered.
 *
 *   npx tsx scripts/isolated/status-while-blocked.ts <replica-db>
 *
 * An earlier turn handed a specialist one piece of work. That piece is paused on an open question (a blocker) that
 * asks Grant for an answer. A later turn asks where it has got to. The only stand-in is the model: the prompt it is
 * shown is recorded and the answer is fixed.
 *
 * Asserts:
 *   1. While the question is open, the status prompt tells the model the piece is waiting on Grant's answer.
 *   2. CONTROL: once the question is resolved, the prompt no longer says it is waiting on him. Without this the first
 *      check could pass for a prompt that always says the same thing.
 *
 * Replica only; the guard refuses anything else.
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { raiseBlocker } from '../../src/inference/record.ts'
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

const tag = Date.now().toString(36)
const WAITING = /Still open from that: 1 piece\(s\) of it are waiting on your answer\./
const shown: string[] = []
const stub = {
  complete: async (req: { messages: { role: string; content: string }[] }) => {
    const system = req.messages[0]?.content ?? ''
    const user = req.messages
      .slice(1)
      .map((m) => m.content)
      .join('\n')
    shown.push(`${system}\n${user}`)
    if (system.startsWith('You route one request')) return { content: 'none', model: 'blk/stub' }
    if (system.startsWith('You are the chief of staff of a small office'))
      return { content: '{}', model: 'blk/stub' }
    return { content: 'STUB STATUS ANSWER', model: 'blk/stub' }
  },
}
const handler = instructionHandler({ db, router: stub as unknown as ProviderRouter })

const priorTurn = await realParent(db)
const statusJob = await realParent(db)
const office = String((await one(`select app.job_office('${statusJob}'::uuid)::text as o`)).o)
const project = String(
  (await one(`select project_id::text as p from public.jobs where job_id = '${statusJob}'::uuid`))
    .p,
)
const handedOn = String(
  (
    await one(`select app.enqueue_child_once('${office}'::uuid, '${priorTurn}'::uuid, 'office.instruction',
      'research-director: venue costs ${tag}',
      jsonb_build_object('instruction', 'Work out the venue costs ${tag}', 'addressed_to', 'research-director',
                         'origin_channel', 'telegram', 'command_id', '', 'handed_off_by', 'chief-of-staff'),
      false, null, null, null, null) ->> 'job_id' as j`)
  ).j,
)
await db.execute(`update public.jobs set state = 'paused', state_reason = 'proof: waiting on Grant'
  where job_id = '${handedOn}'::uuid`)
const blockerId = await raiseBlocker(db, {
  jobId: handedOn,
  requestedAction: `Use the supplier price ${tag}`,
  whyNeeded: 'The venue costs depend on which supplier price he wants used.',
  consequencesOfDelay: 'The costing waits until he answers.',
  approvalOptions: ['Use the first', 'Use the second'],
  originatingAgent: 'research-director',
  workCanContinue: false,
  actionFingerprint: `blocked-${tag}`,
  declineOption: 'Use the second',
})

await db.execute(
  `update public.jobs set pinned_config = jsonb_set(pinned_config, '{instruction}', '"Where has the venue costing got to?"')
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
  idempotencyKey: `blk-${statusJob}`,
  attempt: 1,
  officeId: office,
}
await handler.handle(job)
const promptOpen = shown.join('\n')
check(
  'while the question is open, the status prompt says the piece is waiting on Grant',
  WAITING.test(promptOpen),
  `waiting line present: ${String(WAITING.test(promptOpen))}`,
)

await db.execute(
  `update public.blockers set state = 'resolved', resolved_at = app.now_utc(), resolution = 'proof: answered'
    where blocker_id = '${blockerId}'::uuid`,
)
shown.length = 0
await handler.handle({ ...job, idempotencyKey: `blk2-${statusJob}` })
const promptAnswered = shown.join('\n')
check(
  'CONTROL: once he has answered, the status prompt no longer says it is waiting on him',
  !WAITING.test(promptAnswered),
  `waiting line present after answer: ${String(WAITING.test(promptAnswered))}`,
)

await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared'
    where job_id in ('${priorTurn}'::uuid, '${statusJob}'::uuid, '${handedOn}'::uuid) and state in ('queued', 'paused')`,
)
const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
