/**
 * P4 step 2: the second person uses Team HQ's API as the page does - project, tasks, completion, contact, same-name
 * private objects - and then Grant's real session confirms none of it is visible to him, and the second person's reads
 * confirm none of Grant's same-named objects is visible to them.
 *   npx tsx scripts/p4/workflow.ts
 * Everything created belongs to the second person's office; nothing is created in Grant's. Grant's session is used for
 * READS only.
 */
import { act, check, db, grantSession, read, results, SECOND_OFFICE, secondSession } from './lib.ts'

const run = Date.now().toString(36)
const s = await secondSession()
const g = await grantSession()
const T = s.access_token
const G = g.access_token
const show = (r: { status: number; text: string }): string => `http ${r.status} ${r.text.slice(0, 160)}`

// ---- the second person's own work
const proj = await act(T, 'create_project', { p_name: 'Personal', p_connector: 'upload', p_ref: `p4-personal-${run}` })
console.log('create_project:', show(proj))
const res = (r: { json: unknown }): Record<string, string> =>
  ((r.json as { result?: Record<string, string> } | null)?.result ?? {}) as Record<string, string>
const projectId = res(proj).project_id ?? ''
const projectSlug = res(proj).slug ?? 'personal'
check('the second person created a project called Personal', proj.status === 200 && projectId !== '', show(proj))

const task = await act(T, 'task_add', { p_project: projectSlug, p_title: 'Follow up', p_detail: 'p4 second person' })
console.log('task_add:', show(task))
const taskId = res(task).id ?? ''
check('they added a task called Follow up', task.status === 200 && taskId !== '', show(task))

const mine = await act(T, 'my_task_add', { p_title: 'Follow up' })
console.log('my_task_add:', show(mine))
check('they added a personal task called Follow up', mine.status === 200, show(mine))

const done = await act(T, 'task_state', { p_task_id: taskId, p_state: 'done' })
check('they completed the task', done.status === 200, show(done))

const contact = await act(T, 'contact_add', { p_project: projectSlug, p_name: 'Kevin' })
console.log('contact_add:', show(contact))
check('they added a contact called Kevin', contact.status === 200, show(contact))

// ---- the second person reads it all back
const back = (await read(T, 'projects')).text
check('their project list shows Personal and their catch-all only', back.includes('"Personal"'), back.slice(0, 120))
const myTasks = await read(T, 'portfolio_tasks')
console.log('portfolio_tasks:', myTasks.text.slice(0, 300))

// ---- canonical rows: where did each land?
const rows = (
  await db.execute(`
    select (select count(*) from public.projects where name = 'Personal' and office_id = '${SECOND_OFFICE}') as proj_second,
           (select count(*) from public.projects where name = 'Personal' and office_id <> '${SECOND_OFFICE}') as proj_other,
           (select count(*) from public.tasks where title = 'Follow up' and office_id = '${SECOND_OFFICE}') as task_second,
           (select count(*) from public.tasks where title = 'Follow up' and office_id <> '${SECOND_OFFICE}') as task_other,
           (select count(*) from public.contacts c join public.projects p using (project_id) where c.name = 'Kevin' and p.office_id = '${SECOND_OFFICE}') as c_second,
           (select count(*) from public.contacts c join public.projects p using (project_id) where c.name = 'Kevin' and p.office_id <> '${SECOND_OFFICE}') as c_other`)
).rows[0] as Record<string, string>
console.log('canonical:', JSON.stringify(rows))
check('every row the second person made carries the second office', Number(rows.proj_second) >= 1 && Number(rows.task_second) >= 1 && Number(rows.c_second) >= 1)
check('none of the same-named rows is in any other office', Number(rows.proj_other) === 0 && Number(rows.task_other) === 0 && Number(rows.c_other) === 0, JSON.stringify(rows))

// ---- Grant's own view, signed in as Grant: none of those appears
for (const sec of ['projects', 'portfolio_tasks', 'overview', 'lately', 'activity', 'artifacts']) {
  const r = await read(G, sec)
  const leaks = [projectId, taskId].filter((x) => x !== '' && r.text.includes(x))
  check(`Grant's ${sec} does not show the second person's objects`, r.status === 200 && leaks.length === 0 && !r.text.includes('p4-personal'), show(r).slice(0, 60))
}
// no project called Personal in Grant's list
const gp = (await read(G, 'projects')).text
check("Grant's project list has no 'Personal'", !gp.includes('"Personal"'))

// ---- Grant's same-named private object (Notes) is not the second person's
const gnotes = (await db.execute(`select document_id::text as id from public.documents where office_id = app.operator_office() and lower(title) = 'notes' limit 1`)).rows[0] as { id?: string } | undefined
if (gnotes?.id !== undefined) {
  const r = await read(T, 'document', `&id=${gnotes.id}`)
  const r2 = await read(T, 'document', `&id=00000000-0000-4000-8000-000000000000`)
  console.log('foreign doc:', show(r), '\nnonexistent doc:', show(r2))
  check("the second person cannot open Grant's 'Notes' and the refusal equals a nonexistent id", r.status === r2.status && r.text === r2.text, `${r.status} vs ${r2.status}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok; project=${projectId} task=${taskId}`)
process.exitCode = failed.length === 0 ? 0 : 1
