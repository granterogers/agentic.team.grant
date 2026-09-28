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
  await sent({ said: `Working on A ${run}`, session: s, project: A })
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

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
