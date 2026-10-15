/**
 * REG-009 / COS-033 — a repeat of work that is already running does not start a second copy.
 *
 *   npx tsx scripts/isolated/duplicate-while-running.ts <replica-db>
 *
 * Two guards can stop a repeat, and this proof keeps them apart:
 *   - STRUCTURAL: `enqueue_child_once` hands back the live child for an identical objective, so an identical repeat
 *     never creates a second one, whatever the model says.
 *   - MATCHER: a paraphrase has a different objective, so only the model's duplicate judgement can stop it. This is
 *     the path the proof is about, and it is decided by the model's answer (scripted here).
 *
 * Drives the REAL `instructionHandler`. An earlier turn of the conversation has handed a specialist one piece of work,
 * still queued. A later turn repeats it. The only stand-in is the model.
 *
 * Asserts:
 *   1. An identical repeat starts no second piece of work, and the reply says it was not started again.
 *   2. A PARAPHRASE the matcher calls the same work is consulted (its prompt is shown) and starts no second piece.
 *   3. CONTROL: the same paraphrase, which the matcher calls different work, DOES start a new piece. Without this
 *      the paraphrase proof could not tell a working matcher from one that never starts anything.
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

const tag = Date.now().toString(36)
const objective = `Draft the venue report ${tag}`
const MATCHER = 'You decide whether a new request is asking for work that is ALREADY underway.'

interface Outcome {
  matcherAsked: boolean
  newChildren: number
  body: string
}

async function scenario(label: string, repeat: string, matcherSays: string): Promise<Outcome> {
  const shown: string[] = []
  const stub = {
    complete: async (req: { messages: { role: string; content: string }[] }) => {
      const system = req.messages[0]?.content ?? ''
      const user = req.messages
        .slice(1)
        .map((m) => m.content)
        .join('\n')
      shown.push(`${system}\n${user}`)
      if (system.startsWith(MATCHER)) return { content: matcherSays, model: 'dup/stub' }
      // Name a specialist, so a request that is not a duplicate has somebody to start it. A routing answer of "none"
      // would convene nobody, and the control could then never start work whatever the matcher said.
      if (system.startsWith('You route one request'))
        return { content: 'research-director', model: 'dup/stub' }
      // A real plan with one step that starts work: a task for the research director. A plan that is empty starts
      // nothing, and the control could then never see a new piece of work, whatever the matcher said.
      if (system.startsWith('You are the chief of staff of a small office'))
        return {
          content: JSON.stringify({
            goal: `Put the venue report together ${tag}`,
            steps: [
              {
                id: 's1',
                capability: 'task.create',
                why: `Draft the venue report step ${tag}`,
                needs: [],
                specialist: 'research-director',
                audience: 'office',
              },
            ],
            unreachable: [],
            refused: [],
          }),
          model: 'dup/stub',
        }
      return { content: 'STUB REPLY', model: 'dup/stub' }
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
  // The earlier turn's piece of work for the objective, still queued.
  const original = String(
    (
      await one(`select app.enqueue_child_once('${office}'::uuid, '${priorTurn}'::uuid, 'office.instruction',
        'research-director: ${objective} (${label})',
        jsonb_build_object('instruction', '${objective}', 'addressed_to', 'research-director',
                           'origin_channel', 'telegram', 'command_id', '', 'handed_off_by', 'chief-of-staff'),
        false, null, null, null, null) ->> 'job_id' as j`)
    ).j,
  )
  // The repeat, a later turn of the same conversation.
  await db.execute(
    `update public.jobs set pinned_config = jsonb_set(pinned_config, '{instruction}', '${JSON.stringify(repeat).replace(/'/g, "''")}'::jsonb)
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
    idempotencyKey: `dup-${label}-${statusJob}`,
    attempt: 1,
    officeId: office,
  }
  const out = await handler.handle(job, db)
  // Every piece of work started for the repeat's wording, under either turn, other than the original.
  // Every job started under either turn that carries this run's token, other than the original piece of work. That
  // covers a specialist's child, a deliverable (artifact.report) and anything else the handler enqueues for the repeat.
  const jobsStarted = Number(
    (
      await one(`select count(*)::int as n from public.jobs
                  where parent_job_id in ('${priorTurn}'::uuid, '${statusJob}'::uuid)
                    and pinned_config::text like '%${tag}%'
                    and job_id <> '${original}'::uuid`)
    ).n,
  )
  // The work the plan starts: a task carrying this run's token (the stub plan's step names it).
  const tasks = Number(
    (await one(`select count(*)::int as n from public.tasks where title like '%${tag}%'`)).n,
  )
  const newChildren = jobsStarted + tasks
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared'
      where job_id in ('${priorTurn}'::uuid, '${statusJob}'::uuid, '${original}'::uuid)
        and state = 'queued'`,
  )
  return {
    matcherAsked: shown.some((p) => p.startsWith(MATCHER)),
    newChildren,
    body: out.body,
  }
}

const identical = await scenario('identical', objective, '1')
check(
  'an identical repeat starts no second piece of work, and the reply says it was not started again',
  identical.newChildren === 0 && /not started it a second time/.test(identical.body),
  `new pieces: ${String(identical.newChildren)}; reply: ${identical.body.slice(0, 90)}`,
)

// A paraphrase that clearly asks for work, so the request reaches the planner (a vaguer phrasing is classed as a
// remark and starts nothing whatever the matcher says).
const paraphrase = `Draft a fresh version of the venue report ${tag}`
const same = await scenario('paraphrase-same', paraphrase, '1')
check(
  'a paraphrase the matcher calls the same work is consulted and starts no second piece of work',
  same.matcherAsked && same.newChildren === 0,
  `matcher asked: ${String(same.matcherAsked)}; new pieces: ${String(same.newChildren)}`,
)

const control = await scenario('paraphrase-different', paraphrase, 'NONE')
check(
  'CONTROL: the same paraphrase, which the matcher calls different work, does start a new piece of work',
  control.newChildren >= 1,
  `new pieces: ${String(control.newChildren)}; reply: ${control.body.slice(0, 140)}`,
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
