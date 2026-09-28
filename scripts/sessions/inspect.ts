/**
 * Print what a session actually did, from canonical state.
 *
 *   npx tsx scripts/sessions/inspect.ts <session>
 *
 * The recorded turn (what was said, what came back) beside the tasks in the
 * session's fixture projects with every field a task-continuity property is
 * about: due date, assignee, parent, state, the job that wrote it. Written
 * for the behavioural remediation run, where "one task" is not enough and
 * the question is WHICH task holds WHAT.
 */
import { all, lit, recorded } from './run.ts'

const name = process.argv[2] ?? ''
const rows = (await recorded()).filter((r) => r.session === name)
for (const r of rows) {
  console.log(
    `\n#${String(r.index)} ${r.say}\n   job ${r.jobId} ${r.state} ${r.agent} intent=${r.intent} roster=${r.roster}`,
  )
  console.log(`   => ${r.answered.replace(/\s+/g, ' ').slice(0, 700)}`)
  if (r.fails.length > 0) console.log(`   FAILED: ${r.fails.join(' | ')}`)
}
const tasks = await all(`
  select t.task_id::text id, t.title, t.state, coalesce(t.due_on::text,'') due,
         coalesce(t.assignee_staff::text,'') staff, t.assigned_to_human human,
         coalesce(t.parent_task_id::text,'') parent, coalesce(t.job_id::text,'') job,
         coalesce(t.remind_at::text,'') remind, t.added_by
    from public.tasks t join public.projects p on p.project_id = t.project_id
   where p.slug like ${lit(`fixture-sess-%-${name}`)}
   order by t.created_at`)
console.log(`\ntasks (${String(tasks.length)})`)
for (const t of tasks) console.log(`  ${JSON.stringify(t)}`)
