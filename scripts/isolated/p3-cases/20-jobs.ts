/**
 * Jobs keep their office (migration 0680): a child is its parent's, a duty is its responsibility's, a trigger fires only on
 * its own office's signals, an inbound message is filed inside the office its door resolved.
 */
import { type Ctx, lit } from '../p3-app-lib.ts'

const norm = (s: string): string => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const proj = async (office: string, slug: string): Promise<string> => {
    await c.db.execute(`insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'paused', '${office}') on conflict do nothing`)
    return String((await q(`select project_id from public.projects where office_id = '${office}' and slug = ${lit(slug)}`))[0]?.project_id)
  }
  const pa = await proj(A, `jobs-${run}`)
  const pb = await proj(B, `jobs-${run}`)
  const job = async (office: string, project: string, key: string): Promise<string> => {
    await c.db.execute(
      `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id) values (gen_random_uuid(), gen_random_uuid(), ${lit(key)}, 'probe', 'verify:p3', '${project}', '${office}')`,
    )
    return String((await q(`select job_id from public.jobs where office_id = '${office}' and idempotency_key = ${lit(key)}`))[0]?.job_id)
  }
  const ja = await job(A, pa, `p3-${run}-a`)
  const jb = await job(B, pb, `p3-${run}-b`)

  // ---- a child is its parent's -----------------------------------------------------------------------------------------
  const child = String(await c.exec('p2_worker', `select app.enqueue_child('${ja}', 'probe', '{}'::jsonb, '0'::interval, false)`))
  const co = (await q(`select office_id, project_id from public.jobs where job_id = '${child}'`))[0] as { office_id: string; project_id: string }
  c.check(co.office_id === A && co.project_id === pa, 'a child job is its parent\'s office and inherits its project', `child office ${co.office_id === A ? 'A' : co.office_id}`)
  const once = (await c.exec('p2_worker', `select app.enqueue_child_once('${jb}', 'probe', 'ask once')`)) as { job_id: string }
  c.check((await q(`select office_id from public.jobs where job_id = '${once.job_id}'`))[0]?.office_id === B, 'enqueue_child_once puts the child in B when the parent is B\'s', '')

  // ---- a foreign project and a nonexistent project are refused alike -----------------------------------------------------------
  const foreign = await c.refusal('p2_worker', `select app.enqueue_child('${ja}', 'probe', '{}'::jsonb, '0'::interval, false, '${pb}')`)
  const missing = await c.refusal('p2_worker', `select app.enqueue_child('${ja}', 'probe', '{}'::jsonb, '0'::interval, false, '${c.nobody()}')`)
  c.check(foreign.includes('no project') && norm(foreign) === norm(missing), 'a child cannot be hung on another office\'s project - and the refusal is the one a missing project gets', norm(foreign).slice(0, 80))
  const foreignOnce = await c.refusal('p2_worker', `select app.enqueue_child_once('${ja}', 'probe', 'r2', '{}'::jsonb, false, '${pb}')`)
  c.check(foreignOnce.includes('no project'), 'the same for enqueue_child_once', norm(foreignOnce).slice(0, 80))
  const strayCaller = await c.refusal('p2_worker', `select app.enqueue_child('${ja}', 'probe', '{}'::jsonb, '0'::interval, false, null, '${jb}', 'w', 1)`)
  c.check(strayCaller.includes('stale caller'), 'a caller job from another office cannot speak for this parent', strayCaller.slice(0, 80))
  c.check((await q(`select count(*)::int n from public.jobs where office_id = '${B}' and parent_job_id = '${ja}'`))[0]?.n === 0, 'no job of B\'s hangs from A\'s parent', '')

  // ---- the same duty slug in two offices fires twice, once each ---------------------------------------------------------------------
  const staff = String((await q(`select staff_id from public.staff where active order by slug limit 1`))[0]?.staff_id)
  for (const office of [A, B]) {
    await c.db.execute(
      `insert into public.responsibilities (office_id, slug, staff_id, description, job_kind, period_minutes, enabled, project_id) values ('${office}', ${lit(`p3-duty-${run}`)}, '${staff}', 'a probe duty that exists only to prove two offices can share a slug without colliding', 'probe', 60, true, null)`,
    )
  }
  await c.db.execute(`update public.responsibilities set enabled = false where slug <> ${lit(`p3-duty-${run}`)}`)
  const fired = await q(`select duty_slug, outcome, fired_job_id from app.dispatch_due_responsibilities() where duty_slug = ${lit(`p3-duty-${run}`)}`)
  c.check(fired.length === 2 && fired.every((r) => r.outcome === 'fired'), 'two offices with the same duty slug both fire (neither reads as already fired)', JSON.stringify(fired.map((r) => r.outcome)))
  const dutyOffices = (await q(`select office_id from public.jobs where idempotency_key like ${lit(`duty:p3-duty-${run}:%`)} order by office_id`)).map((r) => r.office_id).sort()
  c.check(dutyOffices.length === 2 && dutyOffices[0] !== dutyOffices[1] && dutyOffices.includes(A) && dutyOffices.includes(B), 'each duty job belongs to its own responsibility\'s office', '')

  // ---- a signal in A fires A's trigger and not B's -------------------------------------------------------------------------------
  for (const office of [A, B]) {
    await c.db.execute(`insert into public.event_triggers (office_id, name, source, event_type, job_kind) values ('${office}', ${lit(`p3-trig-${run}`)}, 'p3', 'ping', 'probe')`)
  }
  await c.db.execute(`insert into public.signals (office_id, source, event_type, external_ref, happened_at) values ('${A}', 'p3', 'ping', ${lit(`ref-${run}`)}, now())`)
  const sig = String((await q(`select signal_id from public.signals where external_ref = ${lit(`ref-${run}`)}`))[0]?.signal_id)
  const fire = (await c.exec('p2_worker', `select app.fire_triggers_for('${sig}')`)) as { triggers?: { trigger: string; decision: string; job: string }[] }
  const fireJobs = (fire.triggers ?? []).map((t) => t.job)
  const fireOffices = fireJobs.length === 0 ? [] : (await q(`select distinct office_id from public.jobs where job_id in (${fireJobs.map(lit).join(',')})`)).map((r) => r.office_id)
  c.check(
    (fire.triggers ?? []).some((t) => t.trigger === `p3-trig-${run}` && t.decision === 'fired') && fireOffices.length === 1 && fireOffices[0] === A,
    'a signal in A fires A\'s trigger, and only triggers whose jobs are A\'s',
    JSON.stringify(fireOffices),
  )
  c.check((await q(`select count(*)::int n from public.jobs where office_id = '${B}' and idempotency_key like ${lit(`trigger-p3-trig-${run}%`)}`))[0]?.n === 0, 'B\'s trigger started nothing', '')

  // ---- an inbound message is filed inside its own office ---------------------------------------------------------------------------
  const ua = String(await c.exec('p2_worker', `select app.unnamed_project('${A}')`))
  const ub = String(await c.exec('p2_worker', `select app.unnamed_project('${B}')`))
  c.check(ua !== ub && (await q(`select office_id from public.projects where project_id = '${ub}'`))[0]?.office_id === B, 'each office has its own reserved Unnamed project', '')
  const command = async (office: string, project: string, tag: string, context = '{}'): Promise<string> => {
    await c.db.execute(
      `insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, context) values ('${office}', '${project}', 'teamhq', ${lit(`p3:${tag}`)}, 'p3', ${lit(`hello ${tag}`)}, ${lit(`verify:p_cases:${run}-${tag}`)}, ${lit(context)}::jsonb)`,
    )
    return String((await q(`select command_id from public.inbound_commands where dedupe_key = ${lit(`verify:p_cases:${run}-${tag}`)}`))[0]?.command_id)
  }
  // A names B's project in its context (a button press on a foreign document): it must not be honoured.
  const cmdA = await command(A, ua, 'a1', JSON.stringify({ project_id: pb }))
  const inA = (await c.exec('p2_worker', `select app.enqueue_inbound('${cmdA}')`)) as { job_id: string }
  const jobA = (await q(`select office_id, project_id from public.jobs where job_id = '${inA.job_id}'`))[0] as { office_id: string; project_id: string }
  c.check(jobA.office_id === A && jobA.project_id !== pb, 'a command that names another office\'s project in its context is filed in its own office', `project is ${jobA.project_id === ua ? "A's Unnamed" : jobA.project_id}`)
  const cmdB = await command(B, ub, 'b1')
  const inB = (await c.exec('p2_worker', `select app.enqueue_inbound('${cmdB}')`)) as { job_id: string }
  const jobB = (await q(`select office_id, project_id from public.jobs where job_id = '${inB.job_id}'`))[0] as { office_id: string; project_id: string }
  c.check(jobB.office_id === B && jobB.project_id === ub, 'B\'s message is B\'s job in B\'s Unnamed project', '')
  const again = (await c.exec('p2_worker', `select app.enqueue_inbound('${cmdB}')`)) as { already?: boolean; job_id: string }
  c.check(again.already === true && again.job_id === inB.job_id, 'the same command twice is one job (the dedupe survived the per-office key)', '')

  // ---- the key is unique within an office, not across them ---------------------------------------------------------------------------
  const dupA = await c.refusal('p2_worker', `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, project_id, office_id) values (gen_random_uuid(), ${lit(`p3-${run}-a`)}, 'probe', 'verify:p3', '${pa}', '${A}')`)
  c.check(dupA.includes('jobs_one_live_per_idempotency_key'), 'the same key twice in one office is still refused', dupA.slice(0, 80))
  const dupB = await c.refusal('p2_worker', `insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, project_id, office_id) values (gen_random_uuid(), ${lit(`p3-${run}-a`)}, 'probe', 'verify:p3', '${pb}', '${B}')`)
  c.check(dupB === '', 'the same key in another office is not a collision', dupB.slice(0, 80))

  // ---- a disabled office's queued work waits; nothing of it is claimed -----------------------------------------------------------
  // (A throwaway office is made for this: an office is never deleted, and disabling A or B would end the other cases.)
  const authX = `d5555555-5555-4555-8555-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`
  await c.db.execute(`insert into auth.users (id, email) values ('${authX}', ${lit(`gone-${run}@example.invalid`)}) on conflict do nothing`)
  await c.db.execute(`insert into public.offices (auth_user_id, kind, name) values ('${authX}', 'person', ${lit(`Gone ${run}`)})`)
  const gone = String((await q(`select office_id from public.offices where auth_user_id = '${authX}'`))[0]?.office_id)
  const pg = await proj(gone, `gone-${run}`)
  const jg = await job(gone, pg, `p3-${run}-gone`)
  await c.db.execute(`update public.jobs set priority = 1 where job_id = '${jg}'`)
  await c.db.execute(`update public.offices set state = 'disabled', disabled_at = now() where office_id = '${gone}'`)
  const taken = await q(`select job_id from app.dequeue_job('p3-worker-${run}', true, true, array['probe'], 'verify:p3')`)
  c.check(taken.every((r) => r.job_id !== jg) && (await q(`select state from public.jobs where job_id = '${jg}'`))[0]?.state === 'queued', 'a disabled office\'s queued job is not claimed and stays queued', JSON.stringify(taken.map((r) => String(r.job_id).slice(0, 8))))
  await c.db.execute(`update public.offices set state = 'active', disabled_at = null where office_id = '${gone}'`).catch(() => undefined)
}
