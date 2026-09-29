/**
 * #373 — a Team HQ turn keeps the project it was sent from, end to end.
 *
 *   npx tsx scripts/isolated/project-provenance.ts <replica-db>
 *
 * The REAL `/voice/turn` door (`voice-door.ts`) on the isolated replica, then
 * the real canonical layer: `app.enqueue_inbound`, `app.conversation_before`,
 * `app.enqueue_child`, `public.conversation_history`. Every property is read
 * from the rows, never from a reply's wording. Invariants are numbered as in
 * `docs/design/373-project-provenance.md`.
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { raiseBlocker } from '../../src/inference/record.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { postTurn, startDoor } from './voice-door.ts'

const db = await isolated(process.argv[2] ?? 'prov373')
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

/* Through the sanctioned writer, which gives the project the attachment
   ADR-0014 requires of an active one. */
const project = async (name: string): Promise<string> =>
  String(
    (
      await one(
        `select app.hq_create_project(${lit(name)}, 'notion', ${lit(`prov-${name}`)}, ${lit(name)}, true) ->> 'project_id' as id`,
      )
    ).id,
  )
const A = await project(`Provenance A ${run}`)
const B = await project(`Provenance B ${run}`)
const UNNAMED = String((await one(`select app.unnamed_project()::text as id`)).id)

const door = await startDoor(db)
/* A page visit: one session, as chat.js mints it. */
let visit = 0
const session = () => {
  visit += 1
  return `s${run.slice(-6)}${String(visit)}`
}

/** What one posted turn became: its command, its job, and that job's project. */
const sent = async (body: Record<string, unknown>) => {
  const r = await postTurn(door, body)
  const jobId = String(r.body.job_id ?? '')
  const row = await one(`
    select c.command_id::text as command, c.project_id::text as stated,
           split_part(c.origin_ref, ':', 1) as talk, c.dedupe_key as dedupe,
           j.job_id::text as job, j.project_id::text as project
      from public.inbound_commands c
      left join public.jobs j on j.job_id = ${jobId === '' ? 'null' : `${lit(jobId)}::uuid`}
     where c.command_id = ${lit(String(r.body.command_id ?? '00000000-0000-0000-0000-000000000000'))}::uuid`)
  return { status: r.status, reply: r.body, ...row } as Record<string, unknown> & { status: number }
}
const name = (id: unknown) =>
  id === A ? 'A' : id === B ? 'B' : id === UNNAMED ? 'Unnamed' : String(id)

/* 1 + 2. The same words from A and from B. */
{
  const s = session()
  const a = await sent({ said: 'What still needs doing?', session: s, project: A })
  const b = await sent({ said: 'What still needs doing?', session: s, project: B })
  check(
    '1. a turn from A is stated and resolved as A',
    a.stated === A && a.project === A,
    `stated ${name(a.stated)}, job ${name(a.project)}`,
  )
  check(
    '1. the same words from B are stated and resolved as B',
    b.stated === B && b.project === B,
    `stated ${name(b.stated)}, job ${name(b.project)}`,
  )
  check(
    '2. they are two conversations, not one',
    a.talk !== b.talk,
    `${String(a.talk)} vs ${String(b.talk)}`,
  )
  check(
    '   and containment still sees the page-shaped session',
    /^voice:turn:s[a-z0-9]{1,10}\./.test(String(a.dedupe)),
    String(a.dedupe),
  )
}

/* 3. Interleaved A1 -> B1 -> A2 -> B2. */
{
  const s = session()
  const seq: Record<string, unknown>[] = []
  for (const [p, n] of [
    [A, 1],
    [B, 1],
    [A, 2],
    [B, 2],
  ] as const) {
    seq.push(
      await sent({ said: `Interleaved ${name(p)}${String(n)} ${run}`, session: s, project: p }),
    )
  }
  check(
    '3. A1 B1 A2 B2 resolve A B A B',
    seq.map((x) => name(x.project)).join(' ') === 'A B A B',
    seq.map((x) => name(x.project)).join(' '),
  )
  const before = (
    await one(`select app.conversation_before(${lit(String(seq[2]?.command))}::uuid)::text as t`)
  ).t
  const said = (JSON.parse(String(before)) as { said: string }[]).map((t) => t.said)
  check(
    "3. A2's previous turns are A's, never B's",
    said.includes(`Interleaved A1 ${run}`) && !said.some((x) => x.includes(' B')),
    JSON.stringify(said),
  )
}

/* 4. Unnamed stated after A in the same visit is Unnamed. */
{
  const s = session()
  /* Work, so it passes through enqueue_inbound and the conversation has
     something to remember: a turn voice_answer answers directly never
     reaches memory, and then this check would be vacuous. */
  const first = await sent({
    said: `Please draft the agenda for the A workshop ${run}`,
    session: s,
    project: A,
  })
  check(
    '4. (precondition) the turn on A became work on A',
    first.project === A,
    `job ${String(first.job)} on ${name(first.project)}`,
  )
  /* A sentence that needs work, so a job exists: voice_answer answers some questions from state with no job at all. */
  const u = await sent({
    said: `Please draft a short note to the team about next week ${run}`,
    session: s,
    project: UNNAMED,
  })
  check(
    '4. a turn stating Unnamed after A in one visit is filed under Unnamed',
    u.job !== null && u.project === UNNAMED,
    `job ${String(u.job)} on ${name(u.project)}`,
  )
}

/* 5. A turn that states nothing behaves as today. */
{
  const s = session()
  const n = await sent({ said: `No project stated ${run}`, session: s })
  check(
    '5. a turn stating nothing is recorded and resolved as before',
    n.status === 200 && n.project === UNNAMED,
    `status ${String(n.status)}, job ${name(n.project)}`,
  )
}

/* 6. Malformed and nonexistent projects: kept message, no guess. */
{
  const s = session()
  await sent({ said: `Primes A ${run}`, session: s, project: A })
  const bad = await sent({
    said: `Malformed ${run}`,
    session: s,
    project: "a'; drop table projects; --",
  })
  check(
    '6. a malformed project is never stated, and the message is kept',
    bad.status === 200 && bad.stated === UNNAMED && bad.project !== A,
    `status ${String(bad.status)}, stated ${name(bad.stated)}, job ${name(bad.project)}`,
  )
  const ghost = await sent({
    said: `Ghost ${run}`,
    session: s,
    project: '00000000-0000-4000-8000-000000000373',
  })
  const loose = await sent({ said: `Please draft a loose note ${run}`, session: s })
  const ghostTalk =
    await one(`select split_part(origin_ref, ':', 1) as t from public.inbound_commands
    where command_id = ${lit(String(ghost.command))}::uuid`)
  check(
    "6. and it stays in its own thread, never the visit's no-project conversation",
    ghostTalk.t === `${s}/00000000-0000-4000-8000-000000000373` && loose.talk === s,
    `${String(ghostTalk.t)} vs ${String(loose.talk)}`,
  )
  check(
    '6. a project that does not exist costs the project, not the message',
    ghost.status === 200 && ghost.command !== undefined && ghost.project !== A,
    `status ${String(ghost.status)}, job ${name(ghost.project)}`,
  )
}

/* 7 + 8. Durable provenance, and delegation inherits it. */
{
  const a = await sent({
    said: `Please draft the venue brief and have Emma check it ${run}`,
    session: session(),
    project: A,
  })
  check(
    '7. that turn became work (a job exists)',
    typeof a.job === 'string' && a.job !== '',
    String(a.job),
  )
  const pinned = await one(
    `select (pinned_config ->> 'command_id') = ${lit(String(a.command))} as same from public.jobs where job_id = ${lit(String(a.job))}::uuid`,
  )
  check(
    '7. the job points at the command that states A, in the database',
    pinned.same === true && a.stated === A,
    `pinned ${String(pinned.same)}`,
  )
  /* Two statements: a row a function inserts is invisible to the rest of its own statement. */
  const kid = await one(
    `select app.enqueue_child(${lit(String(a.job))}::uuid, 'office.instruction', '{}'::jsonb, interval '0', false)::text as id`,
  )
  const child = await one(
    `select project_id::text as p from public.jobs where job_id = ${lit(String(kid.id))}::uuid`,
  )
  check('8. work delegated from it inherits A', child.p === A, name(child.p))
}

/* 9. The answer is read back by its project only. */
{
  const a = await sent({
    said: `Please write up which answer is mine ${run}`,
    session: session(),
    project: A,
  })
  await db.execute(
    `update public.jobs set state = 'running' where job_id = ${lit(String(a.job))}::uuid`,
  )
  await db.execute(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic)
    values (${lit(String(a.job))}::uuid, ${lit(`The answer for A ${run}`)}, 'high', 'verified', '["db:test"]'::jsonb, true)`)
  const inA = String(
    (await one(`select public.conversation_history(${lit(A)}::uuid, 50, null)::text as t`)).t,
  )
  const inB = String(
    (await one(`select public.conversation_history(${lit(B)}::uuid, 50, null)::text as t`)).t,
  )
  check(
    "9. A's answer is in A's conversation",
    inA.includes(`The answer for A ${run}`),
    `${inA.length} chars`,
  )
  check("9. and never in B's", !inB.includes(`The answer for A ${run}`), `${inB.length} chars`)
}

/* 3b. Concurrent turns on A and B in one visit: each lands where it was stated. */
{
  const s = session()
  const burst = await Promise.all(
    [A, B, A, B, A, B].map((p, i) =>
      sent({ said: `Please draft concurrent note ${String(i)} ${run}`, session: s, project: p }),
    ),
  )
  const wrong = burst.filter(
    (r, i) => r.project !== (i % 2 === 0 ? A : B) || r.talk !== `${s}/${i % 2 === 0 ? A : B}`,
  )
  check(
    '3b. six concurrent turns alternating A and B each resolve and converse where stated',
    burst.length === 6 && wrong.length === 0,
    burst.map((r) => name(r.project)).join(' '),
  )
}

/* 10. #374 across projects: "yes please" in B's Chat never answers A's question. */
{
  const handler = instructionHandler({
    db,
    router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never,
  })
  const jobOf = async (id: string): Promise<Job> => {
    const j =
      await one(`select job_id::text as id, kind, correlation_id::text as c, project_id::text as p,
        idempotency_key as k from public.jobs where job_id = ${lit(id)}::uuid`)
    return {
      jobId: String(j.id),
      kind: String(j.kind),
      correlationId: String(j.c),
      projectId: j.p === null ? null : String(j.p),
      idempotencyKey: String(j.k),
      attempt: 1,
    } as Job
  }
  /* A question raised on A the way production raises one: by the pursuit its turn started. */
  const askOn = async (s: string) => {
    const t = await sent({
      said: `Draft the renewal note and send it to the venue ${run}`,
      session: s,
      project: A,
    })
    const child = String(
      (
        await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id, parent_job_id)
          select 'office.pursue', requested_by, project_id, 'prov374-' || gen_random_uuid(), correlation_id, job_id
            from public.jobs where job_id = ${lit(String(t.job))}::uuid returning job_id::text as id`)
      ).id,
    )
    await raiseBlocker(db, {
      jobId: child,
      requestedAction: 'Send the renewal note to the venue',
      whyNeeded: 'isolated proof #373 x #374',
      consequencesOfDelay: 'none',
      approvalOptions: ['Yes, do it', 'No, leave it'],
      originatingAgent: 'chief-of-staff',
      workCanContinue: false,
    } as never)
    return child
  }
  const reply = async (s: string, on: string) => {
    const r = await sent({ said: 'yes please', session: s, project: on })
    if (typeof r.job === 'string' && r.job !== '') await handler.handle(await jobOf(r.job), db)
    return r
  }
  const state = async (child: string) =>
    String(
      (
        await one(
          `select state::text as s from public.blockers where job_id = ${lit(child)}::uuid order by created_at desc limit 1`,
        )
      ).s,
    )
  const s1 = session()
  const onA = await askOn(s1)
  const fromB = await reply(s1, B)
  check(
    '10. "yes please" typed in B, same visit, leaves A\'s question open',
    typeof fromB.job === 'string' && (await state(onA)) === 'open',
    `B turn job ${String(fromB.job)}, A question ${await state(onA)}`,
  )
  const s2 = session()
  const onA2 = await askOn(s2)
  await reply(s2, A)
  check(
    '10. (control) "yes please" typed in A answers it',
    (await state(onA2)) === 'resolved',
    `A question ${await state(onA2)}`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
