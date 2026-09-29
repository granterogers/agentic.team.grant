/**
 * B5/B6 (architecture audit, run 1): an option the office offers on a question
 * about an outward action must have a consequence the office can perform.
 *
 *   npx tsx scripts/isolated/outward-options.ts <replica-db>
 *
 * The property, asked of the REAL `governOutward` against the replica and read
 * from what the NEXT decision does, never from the prose:
 *
 *   every affirmative option, once chosen, changes what the office is willing
 *   to do the next time it is about to act (go = true); every declining option
 *   is a decline; and NO option is a promise that answering leaves exactly as
 *   it was - the "Yes, do it" that resolved the question, said it was going
 *   ahead, and left the next run to ask the same thing again.
 */
import { governOutward } from '../../src/agents/approval.ts'
import { optionFor } from '../../src/agents/spoken-answer.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'outward0609')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

/** A duty-shaped job: unprompted, so nobody 'asked' for the tool (0423). */
const dutyJob = async (project: string): Promise<string> =>
  String(
    (
      await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
        values ('google.write_calendar_tasks', 'duty:isolated-b5', ${lit(project)}::uuid,
                'b5-' || gen_random_uuid(), gen_random_uuid()) returning job_id::text as id`)
    ).id,
  )
const freshProject = async (label: string): Promise<string> =>
  String(
    json(
      (
        await one(`select app.hq_create_project(${lit(`Outward ${label} ${run}`)}, 'upload', ${lit(`outward-${label}-${run}`)},
          ${lit(`Outward ${label} ${run}`)}, true) as v`)
      ).v,
    ).project_id,
  )
const TOOL = 'notion.write' // level 2; no seeded standing authorization
const ask = async (project: string, standingOption?: string) => {
  const job = await dutyJob(project)
  return governOutward(db as never, {
    jobId: job,
    projectId: project,
    tool: TOOL,
    summary: 'The Notion copy is behind the task list: 2 pages to update',
    detail: '1. Update "A"\n2. Update "B"',
    empty: false,
    agent: 'operations-director',
    ...(standingOption === undefined ? {} : { standingOption }),
  })
}

/* The options the office actually offers, both with the caller's own label and with the default. */
for (const [label, standing] of [
  ['default label', undefined],
  ["the calendar duty's label", 'Yes, keep the diary in step without asking me'],
] as const) {
  const p0 = await freshProject(`opts-${label.length}`)
  const first = await ask(p0, standing)
  const blocker = String(first.blocker)
  const options = ((
    await one(
      `select approval_options as o from public.blockers where blocker_id = ${lit(blocker)}::uuid`,
    )
  ).o ?? []) as string[]
  check(
    `${label}: a spoken "yes" chooses the standing option, and a spoken "no" the decline - never nothing`,
    optionFor('yes', options) === options[0] && optionFor('no', options) === 'No, leave it',
    JSON.stringify([optionFor('yes', options), optionFor('no', options)]),
  )
  check(
    `${label}: a question was raised, with options`,
    first.go === false && options.length >= 2,
    JSON.stringify(options),
  )

  for (const option of options) {
    const project = await freshProject(`o${String(options.indexOf(option))}-${label.length}`)
    const q = await ask(project, standing)
    const qOptions = ((
      await one(
        `select approval_options as o from public.blockers where blocker_id = ${lit(String(q.blocker))}::uuid`,
      )
    ).o ?? []) as string[]
    const answered = json(
      (
        await one(
          `select app.hq_answer_blocker(${lit(String(q.blocker))}::uuid, ${lit(option)}, 'grant') as r`,
        )
      ).r,
    )
    const next = await ask(project, standing)
    const isDecline = optionFor('no', [option]) !== null
    check(
      `${label} · "${option}": answering is taken (${answered.ok === true ? 'ok' : JSON.stringify(answered)})`,
      answered.ok === true && qOptions.includes(option),
      JSON.stringify(answered).slice(0, 100),
    )
    check(
      isDecline
        ? `${label} · "${option}" is a decline: the next run does not go ahead`
        : `${label} · "${option}" has a consequence: the next run goes ahead`,
      isDecline ? next.go === false : next.go === true,
      `next decision go=${String(next.go)}${next.blocker === null ? '' : ' and it ASKED AGAIN'}`,
    )
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await db.end()
process.exit(failed.length === 0 ? 0 : 1)
