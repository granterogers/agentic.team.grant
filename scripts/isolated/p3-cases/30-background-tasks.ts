/**
 * The task writers nobody calls with an office (migration 0682): a question that stops a job, a repeating task, a dead
 * credential's chore. Each writes to the office it belongs to - read off the row that caused it - and not to the person the
 * bridge would have guessed.
 */
import { type Ctx, lit } from '../p3-app-lib.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const proj = async (office: string, slug: string): Promise<string> => {
    await c.db.execute(`insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'paused', '${office}') on conflict do nothing`)
    return String((await q(`select project_id from public.projects where office_id = '${office}' and slug = ${lit(slug)}`))[0]?.project_id)
  }
  const pa = await proj(A, `bg-${run}`)
  const pb = await proj(B, `bg-${run}`)
  const job = async (office: string, project: string, key: string): Promise<string> => {
    await c.db.execute(`insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, project_id, office_id) values (gen_random_uuid(), ${lit(key)}, 'probe', 'verify:p3', '${project}', '${office}')`)
    return String((await q(`select job_id from public.jobs where office_id = '${office}' and idempotency_key = ${lit(key)}`))[0]?.job_id)
  }
  const ja = await job(A, pa, `bg-${run}-a`)
  const jb = await job(B, pb, `bg-${run}-b`)
  const before = (await q(`select count(*)::int n from public.office_bridge_use where table_name = 'tasks'`))[0]?.n

  // ---- a blocker that stops a job becomes a to-do on ITS office's list ----------------------------------------------------------
  for (const [office, project, jobId, tag] of [[A, pa, ja, 'A'], [B, pb, jb, 'B']] as const) {
    await c.db.execute(
      `insert into public.blockers (office_id, project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
       values ('${office}', '${project}', '${jobId}', ${lit(`Authorise ${tag} ${run}`)}, 'it is needed', 'it waits', array['Go ahead'], 'x', false)`,
    )
  }
  const mk = await q(`select office_id, title from public.tasks where title like ${lit(`Authorise % ${run}`)} order by title`)
  c.check(mk.length === 2 && mk[0]?.office_id === A && mk[1]?.office_id === B, 'a stopping question becomes a to-do in the office that asked it', JSON.stringify(mk.map((r) => String(r.office_id).slice(0, 8))))

  // ---- the next occurrence of a repeating task is the same office's ---------------------------------------------------------------
  for (const office of [A, B]) {
    await c.db.execute(
      `insert into public.tasks (office_id, title, state, assigned_to_human, added_by, due_on, repeat_every, repeat_from) values ('${office}', ${lit(`Repeat ${run}`)}, 'todo', true, 'p3', current_date, '1 day', 'due')`,
    )
    await c.db.execute(`update public.tasks set state = 'done', done_at = now() where office_id = '${office}' and title = ${lit(`Repeat ${run}`)} and state = 'todo'`)
  }
  const next = await q(`select office_id, count(*)::int n from public.tasks where title = ${lit(`Repeat ${run}`)} group by 1 order by 1`)
  c.check(next.length === 2 && next.every((r) => r.n === 2), 'each office\'s repeating task made its next occurrence in its own office', JSON.stringify(next.map((r) => `${String(r.office_id).slice(0, 8)}:${String(r.n)}`)))

  // ---- a dead credential's chore lands on the list of the office whose credential it is ----------------------------------------
  await c.db.execute(`insert into public.connection_health (office_id, service, credential, state, detail, owner, action) values ('${A}', ${lit(`svc${run}`)}, 'token', 'dead', 'refused', 'a', 'reconnect it in Settings')`)
  await c.exec('p2_worker', `select app.chores_for_credentials()`)
  const chore = await q(`select office_id from public.tasks where chore_key = ${lit(`credential:svc${run}:token`)}`)
  c.check(chore.length === 1 && chore[0]?.office_id === A, 'a dead credential in A raises a chore for A and for nobody else', JSON.stringify(chore.map((r) => String(r.office_id).slice(0, 8))))
  await c.db.execute(`update public.connection_health set state = 'ok' where office_id = '${A}' and service = ${lit(`svc${run}`)}`)
  await c.exec('p2_worker', `select app.chores_for_credentials()`)
  c.check((await q(`select state from public.tasks where chore_key = ${lit(`credential:svc${run}:token`)}`))[0]?.state === 'done', 'and clears it when the credential is healthy again', '')

  // ---- a deployment-level chore is the operator's, never a person who is not one ---------------------------------------------------
  const ops = (await q(`select app.operator_offices() as o`)).map((r) => r.o)
  c.check(ops.length >= 1 && !ops.includes(A) && !ops.includes(B), 'deployment chores go to operator offices; neither A nor B is one', JSON.stringify(ops.map((o) => String(o).slice(0, 8))))

  const after = (await q(`select count(*)::int n from public.office_bridge_use where table_name = 'tasks'`))[0]?.n
  c.check(after === before, 'none of these writers used the compatibility bridge for tasks', `${String(before)} -> ${String(after)}`)
}
