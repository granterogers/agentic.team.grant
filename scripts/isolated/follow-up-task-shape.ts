/**
 * REG-029 / Artifact C — a follow-up task carries an owner, its source, and no invented due date.
 *
 *   npx tsx scripts/isolated/follow-up-task-shape.ts <replica-db>
 *
 * Drives the REAL `app.task_add` (the writer the plan executor uses for a project task) with the fields a follow-up
 * needs: the contact and the action in the detail, an owner, the job it came from, and no due date. Rolled back.
 *
 * Asserts:
 *   1. The follow-up is stored with the owner it was given, on the project, linked to the job it came from.
 *   2. With no due date given, none is stored (the spec says do not invent due dates).
 *   3. CONTROL: a due date that IS given is stored, so the no-date check cannot pass because dates are always dropped.
 *
 * What this does NOT prove: that anything CREATES a follow-up from an unanswered thread. No such automation exists;
 * REG-029 stays AMBER with that stated.
 *
 * Replica only; the guard refuses anything else.
 */
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
await db.execute('begin')
try {
  const jobId = await realParent(db)
  const office = String((await one(`select app.job_office('${jobId}'::uuid)::text as o`)).o)
  const project = String(
    (await one(`select project_id::text as p from public.jobs where job_id = '${jobId}'::uuid`)).p,
  )
  const detail = `Contact: Priya Proof (priya-${tag}@acme.test). Action: confirm the venue price. Draft: "Hi Priya, could you confirm the price?"`

  const add = async (title: string, due: string) => {
    const raw = (
      await one(`select app.task_add(p_office => ${lit(office)}::uuid, p_project => ${lit(project)}::uuid,
        p_title => ${lit(title)}, p_detail => ${lit(detail)}, p_due_on => ${due},
        p_assignee => 'research-director', p_milestone => false, p_added_by => 'the office',
        p_job => ${lit(jobId)}::uuid) as t`)
    ).t
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as { id?: string; error?: string }
  }
  const row = async (id: string) =>
    (await one(`select t.detail, t.due_on::text as due, t.job_id::text as job, t.project_id::text as project,
        s.slug as owner from public.tasks t left join public.staff s on s.staff_id = t.assignee_staff
        where t.task_id = ${lit(id)}::uuid`)) as {
      detail: string
      due: string | null
      job: string
      project: string
      owner: string
    }

  const noDate = await add(`Follow up venue price ${tag}`, 'null')
  if (typeof noDate.id !== 'string') {
    check('a follow-up is stored', false, `refused: ${String(noDate.error)}`)
  } else {
    const r = await row(noDate.id)
    check(
      'a follow-up is stored with its owner, its source job and its project',
      r.owner === 'research-director' && r.job === jobId && r.project === project,
      `owner=${String(r.owner)} job-linked=${String(r.job === jobId)} project-linked=${String(r.project === project)}`,
    )
    check(
      'the detail carries the contact and the action',
      /Priya Proof/.test(r.detail) && /confirm the venue price/.test(r.detail),
      r.detail.slice(0, 80),
    )
    check('with no due date given, none is stored', r.due === null, `due_on=${String(r.due)}`)
  }

  const dated = await add(
    `Confirm venue price ${tag}`,
    `'${new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)}'::date`,
  )
  const dueStored = typeof dated.id === 'string' ? (await row(dated.id)).due : null
  check(
    'CONTROL: a due date that is given is stored',
    dueStored !== null && dueStored !== undefined,
    `due_on=${String(dueStored)}`,
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1
