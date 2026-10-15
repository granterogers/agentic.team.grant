/**
 * REG-010 / COS-033 — a repeat of work whose first attempt has STALLED does not start a second copy.
 *
 *   npx tsx scripts/isolated/duplicate-while-stalled.ts <replica-db>
 *
 * An earlier turn's piece of work is `running` with its lease LAPSED (`leased_until` in the past): the worker that
 * held it has stopped renewing, so the job is stalled, not finished. A later turn repeats the request in different
 * words. Recovery (`app.recover_stalled_jobs`) is what reclaims a stalled job; this proof is about the repeat, which
 * must not start a second copy while the first is still unrecovered. The only stand-in is the model: the duplicate
 * matcher's answer is scripted.
 *
 * Asserts:
 *   1. A repeat the matcher calls the same work starts no new piece of work while the first is stalled.
 *   2. CONTROL: the same repeat, which the matcher calls different work, does start a new piece of work. Without
 *      this the first check could pass because nothing could ever start work.
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
  newWork: number
  body: string
}

async function scenario(label: string, repeat: string, matcherSays: string): Promise<Outcome> {
  const stub = {
    complete: async (req: { messages: { role: string; content: string }[] }) => {
      const system = req.messages[0]?.content ?? ''
      if (system.startsWith(MATCHER)) return { content: matcherSays, model: 'stall/stub' }
      if (system.startsWith('You route one request'))
        return { content: 'research-director', model: 'stall/stub' }
      if (system.startsWith('You are the chief of staff of a small office'))
        return {
          content: JSON.stringify({
            goal: repeat,
            steps: [
              {
                id: 's1',
                capability: 'task.create',
                why: `Draft the venue report step ${tag} ${label}`,
                needs: [],
                specialist: 'research-director',
                audience: 'office',
              },
            ],
            unreachable: [],
            refused: [],
          }),
          model: 'stall/stub',
        }
      return { content: 'STUB REPLY', model: 'stall/stub' }
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
  const original = String(
    (
      await one(`select app.enqueue_child_once('${office}'::uuid, '${priorTurn}'::uuid, 'office.instruction',
        'research-director: ${objective} (${label})',
        jsonb_build_object('instruction', '${objective}', 'addressed_to', 'research-director',
                           'origin_channel', 'telegram', 'command_id', '', 'handed_off_by', 'chief-of-staff'),
        false, null, null, null, null) ->> 'job_id' as j`)
    ).j,
  )
  // Running, with a lease that lapsed a long time ago: the worker holding it has stopped renewing.
  await db.execute(
    `update public.jobs set state = 'running', leased_by = 'stalled-proof', leased_until = now() - interval '2 hours'
      where job_id = '${original}'::uuid`,
  )

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
    idempotencyKey: `stall-${label}-${statusJob}`,
    attempt: 1,
    officeId: office,
  }
  const out = await handler.handle(job)
  const newWork = Number(
    (
      await one(`select count(*)::int as n from public.jobs
                  where parent_job_id in ('${priorTurn}'::uuid, '${statusJob}'::uuid)
                    and pinned_config::text like '%${tag}%'
                    and job_id <> '${original}'::uuid`)
    ).n,
  )
  // Clear up: the stalled original is cancelled (it is a fixture), and the two turns are cleared if still queued.
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared'
      where job_id in ('${original}'::uuid) and state in ('running', 'queued')`,
  )
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof: cleared'
      where job_id in ('${priorTurn}'::uuid, '${statusJob}'::uuid) and state = 'queued'`,
  )
  return { newWork, body: out.body }
}

// A paraphrase that clearly asks for work, so the request reaches the planner if the matcher lets it through.
const paraphrase = `Put together the venue report again ${tag}`
const same = await scenario('same', paraphrase, '1')
check(
  'a repeat of work whose first attempt has stalled starts no new piece of work',
  same.newWork === 0,
  `new pieces: ${String(same.newWork)}; reply: ${same.body.slice(0, 100)}`,
)

const control = await scenario('different', paraphrase, 'NONE')
check(
  'CONTROL: the same repeat, which the matcher calls different work, starts a new piece of work',
  control.newWork >= 1,
  `new pieces: ${String(control.newWork)}; reply: ${control.body.slice(0, 100)}`,
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
