/**
 * P4 step 11: Grant's own account still works, and the second person's existence changed nothing for him.
 *   npx tsx scripts/p4/grant-regression.ts
 * Signed in as Grant (a real session, minted without any mail). Reads every section he uses and compares what the page
 * would show with the canonical rows; makes one reversible write (a personal task, then deleted); and proves the
 * second person's objects appear nowhere in his payloads. No question is put to Claire in his office: that would be a
 * real job, a real model call and a permanent row in his history, for no extra evidence.
 */
import { act, check, db, grantSession, read, results, SECOND_OFFICE, secondSession } from './lib.ts'

const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const G = (await grantSession()).access_token

const sections = [
  'overview',
  'projects',
  'staff',
  'team',
  'activity',
  'lately',
  'pulse',
  'artifacts',
  'portfolio_tasks',
  'my_task_counts',
  'archived',
  'connections',
  'studio_settings',
  'governance',
  'decisions',
  'standing',
  'usage',
  'unseen',
  'team_work',
  'thinking',
  'workspace',
  'mcp',
  'conversation_channels',
  'triggers',
  'connectors',
  'task_sync',
  'cost',
  'routing',
  'setup',
]
const secondIds = (
  await rows(
    `select project_id::text v from public.projects where office_id = '${SECOND_OFFICE}' union select task_id::text from public.tasks where office_id = '${SECOND_OFFICE}' union select document_id::text from public.documents where office_id = '${SECOND_OFFICE}' union select job_id::text from public.jobs where office_id = '${SECOND_OFFICE}'`,
  )
).map((r) => String(r.v))
check('there are second-person ids to look for', secondIds.length >= 10, `${secondIds.length}`)
let bad = 0
for (const s of sections) {
  const r = await read(G, s)
  const leaked = secondIds.filter((i) => r.text.includes(i))
  const ok =
    r.status === 200 && leaked.length === 0 && !/P4 canary|p4-second-person|"Personal"/.test(r.text)
  if (!ok) bad++
  check(
    `Grant's ${s}: works, and shows nothing of the second person`,
    ok,
    `http ${r.status}, ${r.text.length} chars${leaked.length ? `, ${leaked.length} foreign ids` : ''}`,
  )
}

// the page's numbers agree with the canonical rows
const ov = JSON.parse((await read(G, 'overview')).text) as {
  data?: { counts?: { active_projects?: number } }
}
const canon = await rows(
  `select count(*)::int n from public.projects where office_id = app.operator_office() and status = 'active' and not is_fixture and slug <> 'unnamed'`,
)
const shown = ov.data?.counts?.active_projects
console.log(
  `   overview says ${String(shown)} active projects; canonical rows (excluding the catch-all) say ${canon[0]?.n}`,
)
check(
  "Grant's overview count is within one of the canonical count (the catch-all may be counted)",
  typeof shown === 'number' && Math.abs(shown - Number(canon[0]?.n)) <= 1,
)
const proj = JSON.parse((await read(G, 'projects')).text) as { data?: { project_id: string }[] }
const ids = (proj.data ?? []).map((p) => p.project_id)
const foreignProjects = await rows(
  `select count(*)::int n from public.projects where project_id in (${ids.map((i) => `'${i}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"}) and office_id <> app.operator_office()`,
)
check(
  "every project in Grant's list belongs to Grant's office",
  Number(foreignProjects[0]?.n) === 0 && ids.length >= 3,
  `${ids.length} projects`,
)

// one reversible write
const marker = `P4 regression ${Date.now().toString(36)}`
const added = await act(G, 'my_task_add', { p_title: marker })
const taskId = ((added.json as { result?: { id?: string } } | null)?.result?.id ?? '') as string
check(
  'Grant can add a personal task',
  added.status === 200 && taskId !== '',
  added.text.slice(0, 100),
)
const where = await rows(`select office_id::text off from public.tasks where task_id = '${taskId}'`)
check(
  "it landed in Grant's office",
  where[0]?.off === String((await rows(`select app.operator_office()::text v`))[0]?.v),
)
const seen = (await read(G, 'my_tasks', '&id=all')).text
const secondSees = (await read((await secondSession()).access_token, 'my_tasks', '&id=all')).text
check(
  'he sees it, the second person does not',
  seen.includes(marker) && !secondSees.includes(marker),
  `${seen.includes(marker)}/${secondSees.includes(marker)}`,
)
const gone = await act(G, 'my_task_delete', { p_task_id: taskId })
check('Grant can delete it again', gone.status === 200, gone.text.slice(0, 100))
const left = await rows(`select count(*)::int n from public.tasks where title = '${marker}'`)
check('and nothing of the regression is left behind', Number(left[0]?.n) === 0)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok (${bad} section problem(s))`)
process.exitCode = failed.length === 0 ? 0 : 1
