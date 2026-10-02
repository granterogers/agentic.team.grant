/**
 * #404 live acceptance: what the model is actually SHOWN when the team works for the second person.
 *   npx tsx scripts/p5/person-prompt.ts
 * One request with a delegation and a task in it is enqueued in the SECOND person's office (a harness actor, so the job is
 * a fixture) and run IN-PROCESS by the real handlers from `buildPass`, scoped to this suite's requested_by so the deployed
 * worker is not involved (pause the heartbeat first: scripts/p3/worker-heartbeat.ts pause). `fetch` is wrapped so every
 * request to the model provider is recorded exactly as sent; the recorded prompts and the stored outputs are then checked:
 *   - the job and every child belong to the second office; none touches Grant's
 *   - the prompts name the second person (their office name) and NONE contains the word Grant
 *   - no output contains the word Grant
 *   - CONTROL: the same detector goes red on a prompt that does say Grant
 * Nothing is sent to a person: the origin is a harness actor, deliveries are suppressed by containment.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { buildPass } from '../../src/office/pass.ts'
import { check, results, SECOND_OFFICE } from '../p4/lib.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const projectRef = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(projectRef, token)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const pause = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

const run = Math.random().toString(36).slice(2, 8)
const ACTOR = `verify-p404-${run}`
const MINE = `telegram:${ACTOR}`
const WORKER = `p404-${run}`
// ASK=... runs a different request; the default has a task AND a delegation in it, which can take the free model minutes
const ASK =
  process.env.ASK ??
  'Please add a task to call the supplier on Friday, and ask the research director what she knows about our pricing.'

// ---- record every request to the model provider, as sent
const sent: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('openrouter.ai') && typeof init?.body === 'string') sent.push(init.body)
  return realFetch(input, init)
}) as typeof fetch

const namesGrant = (s: string): boolean => /\bGrant(?:['’]s)?\b/.test(s)

const person = String(
  (await one(`select name v from public.offices where office_id = ${lit(SECOND_OFFICE)}::uuid`)).v,
)
const projectId = String(
  (
    await one(
      `select project_id::text v from public.projects where office_id = ${lit(SECOND_OFFICE)}::uuid and slug = 'personal'`,
    )
  ).v,
)

// containment first: assert the job will be a fixture BEFORE it exists to run
const command = await one(`
  insert into public.inbound_commands
    (office_id, origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
  values (${lit(SECOND_OFFICE)}::uuid, 'telegram', ${lit(`p404-${run}`)}, ${lit(ACTOR)}, ${lit(ASK)},
          ${lit(`telegram:message:p404-${run}`)}, ${lit(projectId)}::uuid)
  returning command_id::text as id`)
const enq = await one(`select app.enqueue_inbound(${lit(String(command.id))}::uuid) as j`)
const rootJob = String(
  (typeof enq.j === 'string' ? JSON.parse(enq.j) : (enq.j ?? {}))?.job_id ?? enq.j ?? '',
)
const attributed = await one(
  `select is_fixture f, office_id::text o from public.jobs where job_id = ${lit(rootJob)}::uuid`,
)
check(
  'the request is a fixture job in the SECOND person office (nothing reaches a person)',
  attributed.f === true && attributed.o === SECOND_OFFICE,
  JSON.stringify(attributed),
)

if (attributed.f === true && attributed.o === SECOND_OFFICE) {
  const pass = await buildPass(db, WORKER, {
    max: 1,
    canTranscribe: false,
    canSubprocess: false,
    projectRef,
  })
  const deadline = Date.now() + 8 * 60_000
  let ran = 0
  let idle = 0
  while (Date.now() < deadline && idle < 6) {
    const job: Job | null = await dequeue(db, WORKER, false, false, undefined, MINE)
    if (job === null) {
      idle += 1
      await db.execute(`select app.requeue_retrying()`)
      await pause(4_000)
      continue
    }
    idle = 0
    ran += 1
    await runJob(db, job, pass.handlers, pass.review)
  }
  console.log(`  ran ${ran} job(s) in-process, ${sent.length} model request(s) recorded`)

  const tree = (
    await db.execute(`
      with recursive t as (
        select job_id, kind, state, office_id from public.jobs where job_id = ${lit(rootJob)}::uuid
        union all
        select j.job_id, j.kind, j.state, j.office_id from public.jobs j join t on j.parent_job_id = t.job_id)
      select job_id::text, kind, state::text s, office_id::text o from t`)
  ).rows as { job_id: string; kind: string; s: string; o: string }[]
  check(
    `the job and its ${tree.length - 1} child job(s) all belong to the second office`,
    tree.length >= 1 && tree.every((j) => j.o === SECOND_OFFICE),
    tree.map((j) => `${j.kind}:${j.s}`).join(','),
  )
  check('the root job completed', tree.find((j) => j.job_id === rootJob)?.s === 'complete')

  const outputs = (
    await db.execute(`
      select o.body from public.outputs o where o.job_id in (${tree.map((j) => lit(j.job_id)).join(',')})`)
  ).rows as { body: string }[]
  check(
    'an answer exists',
    outputs.length > 0 && outputs.every((o) => String(o.body).trim() !== ''),
  )
  check(
    'no answer says Grant',
    outputs.every((o) => !namesGrant(String(o.body))),
    outputs
      .filter((o) => namesGrant(String(o.body)))
      .map((o) => String(o.body).slice(0, 80))
      .join(' | '),
  )

  check(
    'model requests were recorded (the inspection looked at something)',
    sent.length > 0,
    String(sent.length),
  )
  const naming = sent.filter((b) => b.includes(person))
  check(
    `the prompts name the second person ("${person}")`,
    naming.length > 0,
    `${naming.length} of ${sent.length}`,
  )
  const leaks = sent.filter((b) => namesGrant(b))
  for (const b of leaks)
    for (const m of b.matchAll(/.{0,90}\bGrant(?:['’]s)?\b.{0,60}/g))
      console.log(`  LEAK CONTEXT: ${m[0].replace(/\\n/g, ' ').slice(0, 220)}`)
  check(
    'NO prompt sent to the model contains the word Grant',
    leaks.length === 0,
    `${leaks.length} of ${sent.length}`,
  )
  // CONTROL: the detector goes red on a prompt that does say Grant, green once it does not
  check(
    'CONTROL: the detector fires on a prompt that names Grant',
    namesGrant('You are replying to Grant, who runs the place'),
  )
  check(
    'CONTROL: and not on one that does not',
    !namesGrant(`You are replying to ${person}, who runs the place`),
  )
  check('CONTROL: and not on the verb', !namesGrant('we grant permission'))
}

// teardown: nothing left running
await db.execute(
  `update public.jobs set state = 'cancelled', finished_at = app.now_utc(), state_reason = 'p404 suite teardown' where requested_by = ${lit(MINE)} and state in ('queued','retrying','paused')`,
)
globalThis.fetch = realFetch
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exitCode = failed.length === 0 ? 0 : 1
