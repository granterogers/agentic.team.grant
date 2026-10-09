/**
 * tk-state-changes (R2 / T1): one sentence, one effect, driven through the REAL instruction handler on a replica.
 *
 *   npx tsx scripts/isolated/tk-state-changes.ts <replica-db>
 *
 * "Mark the roofer task done" completed the task AND filed a junk team task called "the roofer task done" (the team-task
 * reader fires on a task noun plus an imperative), then answered "Added it". Here every sentence is run as a turn in a
 * fresh chat after the task it refers to was made by an earlier turn in the same chat, and the WHOLE task table of the
 * office is snapshotted before and after: a state change must change exactly one row and add none, a creation must add
 * exactly one and change none, and a sentence that matches nothing must change nothing and invent nothing.
 *
 * Hermetic: the model is degraded to `{}` (the deterministic readers and the real handler are what is proved; what a
 * real model does with these sentences is MODEL-DEPENDENT and not claimed). No network, no provider.
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'tk_x')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
let failed = 0
let total = 0
const check = (what: string, ok: boolean, detail: string) => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'PROVEN  ' : 'FAILED  '} ${what} - ${detail}`)
}
const section = (s: string) => console.log(`\n== ${s} ==`)

const op = String((await one(`select app.operator_office()::text as o`)).o)
const O = `${lit(op)}::uuid`
const project = json(
  (
    await one(
      `select app.hq_create_project(${O}, ${lit(`Tk State ${run}`)}, 'upload', ${lit(`tk-state-${run}`)}, ${lit(`Tk State ${run}`)}, true) as v`,
    )
  ).v,
)
const p1 = String(project.project_id)
// A clone that has been used before holds open tasks about roofers and venues, and a task named by its words is looked
// for across the whole list: start from a list with nothing open, so this proof is about this run only.
await db.execute(
  `update public.tasks set state = 'cancelled' where office_id = ${O} and assigned_to_human and state not in ('done', 'cancelled')`,
)

const handler = instructionHandler({
  db,
  router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never,
})

let n = 0
/** A turn in chat `chat`. Same chat prefix = same conversation, which is what "it" and "the roofer task" resolve in. */
const say = async (chat: string, said: string): Promise<{ body: string; jobId: string }> => {
  n += 1
  const c = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values (${O}, ${lit(p1)}::uuid, 'teamhq', ${lit(`tk${run}${chat}:${n}`)}, 'grant', ${lit(said)}, ${lit(`teamhq:message:tk${run}${chat}${n}`)}, 'grant', '{}'::jsonb)
    returning command_id::text as id`)
  const v = json((await one(`select app.enqueue_inbound(${lit(String(c.id))}::uuid) as v`)).v)
  const jobId = String(v.job_id)
  const j = await one(
    `select job_id::text as id, kind, correlation_id::text as c, project_id::text as p, idempotency_key as k, office_id::text as o from public.jobs where job_id = ${lit(jobId)}::uuid`,
  )
  const job = {
    jobId: String(j.id),
    kind: String(j.kind),
    correlationId: String(j.c),
    projectId: j.p === null ? null : String(j.p),
    idempotencyKey: String(j.k),
    attempt: 1,
    officeId: String(j.o),
  } as Job
  const out = await handler.handle(job, db)
  return { body: String((out as { body?: string }).body ?? ''), jobId }
}

type Snap = Map<string, string>
const snapshot = async (): Promise<Snap> => {
  const r = await rows(
    `select task_id::text as id, title, state, due_on::text as due, remind_at::text as rem, assigned_to_human as mine, repeat_every::text as rep
       from public.tasks where office_id = ${O}`,
  )
  return new Map(
    r.map((x) => [String(x.id), JSON.stringify([x.title, x.state, x.due, x.rem, x.mine, x.rep])]),
  )
}
const diff = (a: Snap, b: Snap) => {
  const added = [...b.keys()].filter((k) => !a.has(k))
  const removed = [...a.keys()].filter((k) => !b.has(k))
  const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k))
  return { added, removed, changed }
}
const rowOf = async (id: string) =>
  (
    await rows(
      `select title, state, assigned_to_human as mine, added_by from public.tasks where task_id = ${lit(id)}::uuid`,
    )
  )[0] as Record<string, unknown>

/** Make the task in its own chat by saying so, the way he would; returns its id. */
const seed = async (chat: string, sentence: string): Promise<string> => {
  const { jobId } = await say(chat, sentence)
  const r = await rows(
    `select task_id::text as id from public.tasks where job_id = ${lit(jobId)}::uuid`,
  )
  if (r.length !== 1) throw new Error(`seed "${sentence}" made ${String(r.length)} tasks, wanted 1`)
  return String(r[0]?.id)
}

section('R2: a state change that matches a task changes exactly that task and files nothing')
{
  const cases: { said: string; seed: string; state: 'done' | 'cancelled'; say: RegExp }[] = [
    {
      said: 'Mark the roofer task done.',
      seed: 'Add a task to call the roofer about the gutters',
      state: 'done',
      say: /ticked off/,
    },
    {
      said: 'Complete the roofer task.',
      seed: 'Add a task to call the roofer about the gutters',
      state: 'done',
      say: /ticked off/,
    },
    {
      said: 'Tick off roofer.',
      seed: 'Add a task to call the roofer about the gutters',
      state: 'done',
      say: /ticked off/,
    },
    {
      said: 'Cancel the venue task.',
      seed: 'Add a task to book the venue for the away day',
      state: 'cancelled',
      say: /cancelled/,
    },
    {
      said: 'Delete the venue task.',
      seed: 'Add a task to book the venue for the away day',
      state: 'cancelled',
      say: /cancelled/,
    },
  ]
  let i = 0
  for (const c of cases) {
    i += 1
    const chat = `s${String(i)}`
    const id = await seed(chat, c.seed)
    const before = await snapshot()
    const { body } = await say(chat, c.said)
    const after = await snapshot()
    const d = diff(before, after)
    const target = await rowOf(id)
    check(
      `"${c.said}" changes exactly one row, the one it named, and files none`,
      d.added.length === 0 &&
        d.removed.length === 0 &&
        d.changed.length === 1 &&
        d.changed[0] === id &&
        target.state === c.state,
      `added ${String(d.added.length)} removed ${String(d.removed.length)} changed ${String(d.changed.length)}; roofer/venue row now ${String(target.state)}`,
    )
    check(
      `...and the reply says what happened (${c.state}), not that something was added`,
      c.say.test(body) && !/added it/i.test(body),
      body.slice(0, 120),
    )
  }
}

section('R2: rename by name renames that task and files nothing')
{
  const id = await seed('r1', 'Add a task to call the roofer about the gutters')
  const before = await snapshot()
  const { body } = await say('r1', 'Rename the roofer task to Call John.')
  const d = diff(before, await snapshot())
  const t = await rowOf(id)
  check(
    '"Rename the roofer task to Call John." changes exactly one row (the title) and files none',
    d.added.length === 0 &&
      d.changed.length === 1 &&
      d.changed[0] === id &&
      String(t.title) === 'Call John',
    `title now "${String(t.title)}"; added ${String(d.added.length)}`,
  )
  check(
    '...and the reply says it changed it',
    /Changed/.test(body) && /Call John/.test(body),
    body.slice(0, 120),
  )
}

section('R2: the sentences that genuinely create work still create exactly one task')
{
  for (const [said, chat] of [
    ['Add a task to call the roofer.', 'c1'],
    ['Remind me to call the roofer.', 'c2'],
    ['Add a task to cancel the venue task.', 'c3'],
    ['Remind me to cancel the venue task.', 'c4'],
    ['Remind me to tick off the roofer.', 'c5'],
  ] as const) {
    const before = await snapshot()
    const { body } = await say(chat, said)
    const d = diff(before, await snapshot())
    check(
      `"${said}" adds exactly one task and changes none`,
      d.added.length === 1 && d.changed.length === 0 && d.removed.length === 0,
      `added ${String(d.added.length)} changed ${String(d.changed.length)}`,
    )
    const made = d.added[0] === undefined ? null : await rowOf(d.added[0])
    check(
      '...it is on HIS list and the reply says so',
      made?.mine === true && /on your list/.test(body),
      `${JSON.stringify(made)} / ${body.slice(0, 80)}`,
    )
  }
  // Team path: a task for a named specialist is still the office's work, still created once.
  const before = await snapshot()
  const { body } = await say('c6', 'Please create a task for Emma to review the roofer quote.')
  const d = diff(before, await snapshot())
  const made = d.added[0] === undefined ? null : await rowOf(d.added[0])
  check(
    "a task for a named specialist (the team-task reader) is still created once, as the team's",
    d.added.length === 1 && d.changed.length === 0 && made?.mine === false,
    `${JSON.stringify(made)} / ${body.slice(0, 100)}`,
  )
}

section('R2: a state change that matches NO task changes nothing and invents nothing')
{
  const chat = 'n1'
  await seed(chat, 'Add a task to call the roofer about the gutters')
  const cases: [string, RegExp][] = [
    ['Mark the florist task done.', /not changed|no |which one|could not/i],
    ['Cancel the accountant task.', /not changed|no |which one|could not/i],
    ['Tick off florist.', /not changed|no |which one|could not/i],
  ]
  for (const [said, reply] of cases) {
    const before = await snapshot()
    const { body } = await say(chat, said)
    const d = diff(before, await snapshot())
    check(
      `"${said}": no row added, changed or removed`,
      d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0,
      `added ${String(d.added.length)} changed ${String(d.changed.length)}`,
    )
    check(
      '...and the reply says it changed nothing rather than claiming a completion',
      reply.test(body) && !/is ticked off|is cancelled|added it/i.test(body),
      body.slice(0, 140),
    )
  }
  // A rename that names a task there is none of renames nothing and files nothing.
  {
    const b = await snapshot()
    const { body } = await say(chat, 'Rename the florist task to Call Jane.')
    const dd = diff(b, await snapshot())
    check(
      '"Rename the florist task to Call Jane.": nothing added, nothing changed, and it says it found none',
      dd.added.length === 0 &&
        dd.changed.length === 0 &&
        /have not changed anything|could not find/i.test(body),
      body.slice(0, 140),
    )
  }
  // A prohibition is not a request, and is not a creation either.
  const before = await snapshot()
  await say(chat, "Don't mark the roofer task done yet.")
  const d = diff(before, await snapshot())
  check(
    '"Don\'t mark the roofer task done yet." changes nothing and files nothing',
    d.added.length === 0 && d.changed.length === 0 && d.removed.length === 0,
    `added ${String(d.added.length)} changed ${String(d.changed.length)}`,
  )
}

section('R2: a bare referent still completes the one task of the conversation')
{
  const id = await seed('b1', 'Add a task to call the roofer about the gutters')
  const before = await snapshot()
  await say('b1', 'Mark it done.')
  const d = diff(before, await snapshot())
  check(
    '"Mark it done." completes the one task and files none',
    d.added.length === 0 &&
      d.changed.length === 1 &&
      d.changed[0] === id &&
      (await rowOf(id)).state === 'done',
    `changed ${String(d.changed.length)}`,
  )
}

section("T1: the personal editor does not edit the team's own task")
{
  const team = json(
    (
      await one(
        `select app.hq_task_add(${O}, ${lit(String(project.slug))}, ${lit(`Team T1 ${run}`)}) as v`,
      )
    ).v,
  )
  const mine = json((await one(`select app.my_task_add(${O}, ${lit(`Mine T1 ${run}`)}) as v`)).v)
  const set = async (id: string) =>
    json(
      (
        await one(
          `select app.my_task_set(${O}, ${lit(id)}, p_title => ${lit(`Edited ${run}`)}) as v`,
        )
      ).v,
    )
  const refused = await set(String(team.id))
  check(
    "my_task_set refuses the team's task, by name",
    refused.ok === false && /team's own work/.test(String(refused.error)),
    JSON.stringify(refused),
  )
  check(
    '...and the team task is untouched',
    String((await rowOf(String(team.id))).title) === `Team T1 ${run}`,
    '',
  )
  const allowed = await set(String(mine.id))
  check(
    'control: the same call edits a PERSONAL task',
    allowed.ok === true && String((await rowOf(String(mine.id))).title) === `Edited ${run}`,
    JSON.stringify(allowed).slice(0, 100),
  )
  const missing = json(
    (
      await one(
        `select app.my_task_set(${O}, '00000000-0000-0000-0000-000000000000', p_title => 'x') as v`,
      )
    ).v,
  )
  check(
    'control: a missing task still says it is missing (not "team")',
    missing.ok === false && /no task by that id/.test(String(missing.error)),
    JSON.stringify(missing),
  )
}

console.log(`\n${String(total - failed)}/${String(total)} PROVEN (${String(failed)} FAILED)`)
await db.end?.()
process.exit(failed === 0 ? 0 : 1)
