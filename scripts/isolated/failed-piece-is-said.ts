/**
 * COS-053 / COS-083 / REG-039 — a piece of work that FAILED and that nobody took on is counted for a status question,
 * and stops being counted once the Chief of Staff has taken it on.
 *
 *   npx tsx scripts/isolated/failed-piece-is-said.ts <replica-db>
 *
 * Drives the REAL `instructionHandler` (the prompt it builds is what the model is shown), the REAL
 * `app.reassign_failed_specialist` (migration 1075) and the REAL `app.conversation_before` (migration 1078), inside a
 * rolled-back transaction. The model is a stub that records its prompt.
 *
 * The count is read from the reader, not from the wording, and the check is a CHANGE in it. The chat is shared with
 * other proofs' committed turns, so an unrelated failed piece can be in the window; an absolute count would test the
 * debris, not this proof's piece.
 *
 * Asserts:
 *   1. Before anyone takes it on, the reader counts this failed piece as failed and untaken, and the status prompt says so.
 *   2. CONTROL: the real reassignment makes the count fall by exactly one, and the status prompt no longer says it failed
 *      untaken, while the replacement is counted as underway.
 *
 * Each status question is its own job, because the handler checkpoints each step by job id.
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
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

const tag = Date.now().toString(36)
const FAILED = /piece\(s\) of it failed and nobody has taken them on\./
const UNDERWAY = /still underway, queued or running/

// One status question: its own job, in the same chat as the prior turn. Returns the prompt and the command.
async function askStatus(): Promise<{ prompt: string; command: string; office: string }> {
  const shown: string[] = []
  const stub = {
    complete: async (req: { messages: { role: string; content: string }[] }) => {
      const system = req.messages[0]?.content ?? ''
      const user = req.messages
        .slice(1)
        .map((m) => m.content)
        .join('\n')
      shown.push(`${system}\n${user}`)
      if (system.startsWith('You route one request')) return { content: 'none', model: 'fail/stub' }
      if (system.startsWith('You are the chief of staff of a small office'))
        return { content: '{}', model: 'fail/stub' }
      return { content: 'STUB STATUS ANSWER', model: 'fail/stub' }
    },
  }
  const handler = instructionHandler({ db, router: stub as unknown as ProviderRouter })
  const statusJob = await realParent(db)
  const office = String((await one(`select app.job_office('${statusJob}'::uuid)::text as o`)).o)
  const project = String(
    (await one(`select project_id::text as p from public.jobs where job_id = '${statusJob}'::uuid`))
      .p,
  )
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
    idempotencyKey: `fail-${statusJob}`,
    attempt: 1,
    officeId: office,
  }
  await handler.handle(job, db)
  const command = String(
    (
      await one(
        `select command_id::text as c from public.inbound_commands where job_id = '${statusJob}'::uuid`,
      )
    ).c,
  )
  return { prompt: shown.join('\n'), command, office }
}

// How many earlier turns in the window carry an untaken failure, as the reader reports them. The handler states the
// sentence once per such turn, so the prompt should say it exactly this many times, whatever other proofs left behind.
async function turnsWithUntaken(command: string, office: string): Promise<number> {
  const row = (await one(`select count(*)::int as n
    from jsonb_array_elements(app.conversation_before('${office}'::uuid, '${command}'::uuid)) e
   where (e ->> 'failedUntaken')::int > 0`)) as { n: number }
  return Number(row.n)
}
const sentences = (prompt: string) => (prompt.match(new RegExp(FAILED.source, 'g')) ?? []).length

// The number of failed pieces nobody took on that belong to THIS turn, as the reader counts them for a status question.
// Read from the turn's own entry (migration 1079 gives each entry its job id), not the window total, because other
// proofs' committed turns in the same chat can carry their own untaken pieces.
async function untaken(turn: string, command: string, office: string): Promise<number> {
  const row = (await one(`select coalesce(sum((e ->> 'failedUntaken')::int), 0)::int as n
    from jsonb_array_elements(app.conversation_before('${office}'::uuid, '${command}'::uuid)) e
   where e ->> 'jobId' = '${turn}'`)) as {
    n: number
  }
  return Number(row.n)
}

await db.execute('begin')
try {
  const priorTurn = await realParent(db)
  // Every row here is written in ONE transaction, so `now()` is the same for the prior turn and the status turn, and
  // the conversation reader (which takes only EARLIER turns) would drop the prior turn. Backdate it.
  await db.execute(
    `update public.inbound_commands set received_at = received_at - interval '5 minutes'
      where job_id = '${priorTurn}'::uuid`,
  )
  const office = String((await one(`select app.job_office('${priorTurn}'::uuid)::text as o`)).o)
  const child = String(
    (
      await one(`select app.enqueue_child_once('${office}'::uuid, '${priorTurn}'::uuid, 'office.instruction',
        'research-director: draft the venue report ${tag}',
        jsonb_build_object('instruction', 'Draft the venue report ${tag}', 'addressed_to', 'research-director',
                           'origin_channel', 'telegram', 'command_id', '', 'handed_off_by', 'chief-of-staff'),
        false, null, null, null, null) ->> 'job_id' as j`)
    ).j,
  )
  // The specialist's attempts ran out: the piece failed (a legal transition from queued).
  await db.execute(`update public.jobs set state = 'failed', state_reason = 'fail proof: ran out of attempts'
    where job_id = '${child}'::uuid`)

  const before = await askStatus()
  const countBefore = await untaken(priorTurn, before.command, before.office)
  check(
    'a failed piece nobody took on is counted as failed and untaken, and the status prompt says so',
    countBefore >= 1 && FAILED.test(before.prompt),
    `count=${String(countBefore)}; sentence=${String(FAILED.test(before.prompt))}`,
  )

  // The Chief of Staff takes it on: the real reassignment writes a replacement under the same turn.
  const reassigned = String(
    (await one(`select app.reassign_failed_specialist(${lit(child)}::uuid)::text as r`)).r,
  )
  const took = /"reassigned":\s*true/.test(reassigned)
  const after = await askStatus()
  const countAfter = await untaken(priorTurn, after.command, after.office)
  // The prompt must say the failure once per turn the reader counts, before and after. Asserting the word is gone
  // would fail on other proofs' untaken turns in the same window, which are correctly still said.
  const windowAfter = await turnsWithUntaken(after.command, after.office)
  check(
    "CONTROL: once the Chief of Staff has taken it on, this turn's count falls by exactly one, and the prompt says the failure once per turn the reader counts, the replacement is underway",
    took &&
      countAfter === countBefore - 1 &&
      sentences(after.prompt) === windowAfter &&
      UNDERWAY.test(after.prompt),
    `reassigned=${String(took)}; this turn ${String(countBefore)} -> ${String(countAfter)}; prompt says it ${String(sentences(after.prompt))}x, reader counts ${String(windowAfter)} turn(s); underway=${String(UNDERWAY.test(after.prompt))}`,
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
