/**
 * COS-096 / COS-098 / COS-099 — a plan task is stored with its owner, not on Grant's list by default.
 *
 *   npx tsx scripts/isolated/task-owner-writes.ts <replica-db>
 *
 * Drives the SAME writer the plan executor calls for a project task (`app.task_add`, with the owner it is given),
 * against a real job's project on the replica. The routing decision itself is `taskHome` (unit-tested); this proof
 * checks the database stores what the decision says.
 *
 * Asserts:
 *   1. A task given a specialist is stored as that specialist's, on the job's project.
 *   2. A task given the Chief of Staff is stored as the Chief of Staff's, not unowned and not Grant's.
 *   3. A refusal (an owner nobody here is called) comes back as an error, not as a stored task.
 */
import { CHIEF_OF_STAFF } from '../../src/agents/task-home.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const jobId = await realParent(db)
const { rows: pr } = await db.execute(
  `select project_id::text as p from public.jobs where job_id = '${jobId}'::uuid`,
)
const project = (pr[0] as { p: string }).p

const add = async (owner: string, title: string) => {
  const { rows } = await db.execute(`
    select app.task_add(p_office => app.job_office('${jobId}'::uuid),
                        p_project => '${project}'::uuid,
                        p_title => '${title}',
                        p_detail => 'proof',
                        p_assignee => '${owner}',
                        p_added_by => 'the office',
                        p_job => '${jobId}'::uuid) as t`)
  const raw = (rows[0] as { t?: unknown }).t
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as { id?: string; error?: string }
}

const ownerOf = async (taskId: string) =>
  (
    (
      await db.execute(`
        select s.slug as slug from public.tasks t
          left join public.staff s on s.staff_id = t.assignee_staff
         where t.task_id = '${taskId}'::uuid`)
    ).rows[0] as { slug: string | null } | undefined
  )?.slug ?? null

const specialist = await add(
  'research-director',
  `cos096 proof specialist ${Date.now().toString(36)}`,
)
if (typeof specialist.id === 'string') {
  const owner = await ownerOf(specialist.id)
  check(
    'a specialist-owned plan task is stored with that specialist',
    owner === 'research-director',
    `stored owner: ${owner ?? 'none'}`,
  )
} else {
  check(
    'a specialist-owned plan task is stored with that specialist',
    false,
    `refused: ${specialist.error}`,
  )
}

const cos = await add(CHIEF_OF_STAFF, `cos096 proof chief ${Date.now().toString(36)}`)
if (typeof cos.id === 'string') {
  const owner = await ownerOf(cos.id)
  check(
    "a task with no named specialist is the Chief of Staff's",
    owner === CHIEF_OF_STAFF,
    `stored owner: ${owner ?? 'none'}`,
  )
} else {
  check("a task with no named specialist is the Chief of Staff's", false, `refused: ${cos.error}`)
}

const nobody = await add('no-such-person-cos096', `cos096 proof nobody ${Date.now().toString(36)}`)
check(
  'an owner nobody here is called is refused, not stored',
  nobody.id === undefined &&
    typeof nobody.error === 'string' &&
    nobody.error.includes('nobody here'),
  nobody.id === undefined ? `refused: ${nobody.error ?? 'no reason given'}` : 'a task was stored',
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
