// biome-ignore-all lint/suspicious/noExplicitAny: untyped rows
// biome-ignore-all format: dense seeding kept readable as written
/**
 * A realistic, multi-day, mixed-actor ledger for the Activity UX harness (phase 6). Written through the ledger's own writers
 * (app.record_activity, app.record_external_activity) into a DISPOSABLE replica; nothing is a JavaScript array standing in for the read
 * model. The disposable database's append-only trigger is switched off only to spread `occurred_at` over several days, which no product
 * writer can do (it stamps now); that is stated here because it is the one thing the product would refuse.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

export interface History {
  rows: number
  days: number
  marker: string
}

const CHIEF_SLUG = 'chief-of-staff'
const AGENTS = ['research-director', 'finance-director', 'growth-director', 'communications-director', 'operations-director', 'strategy-director', 'quality-director']

// Only types the native writer accepts (the rest are PROJECTED from the owning tables; see seedCycles).
// (type, actor_kind, actor, status, severity|null, summary(i), who-is-agent|null)
const SHAPES: [string, string, string, string, string | null, (i: number) => string, string | null][] = [
  ['budget.threshold_reached', 'system', 'office', 'recorded', 'warning', (i) => `The day budget reached 80% (${i})`, null],
  ['tool.call_completed', 'agent', '@', 'completed', null, (i) => `Read the pricing notes ${i}`, '@'],
  ['tool.call_requested', 'agent', '@', 'requested', null, (i) => `Asked to read the supplier sheet ${i}`, '@'],
  ['tool.call_failed', 'agent', '@', 'failed', 'warning', (i) => `Could not read the supplier sheet ${i}`, '@'],
]

export async function seedHistory(db: PgExecutor, office: string, run: string, projects: string[], n: number, days: number): Promise<History> {
  const marker = `hist-${run}`
  const staff = (await db.execute(`select slug from public.staff where slug = any (${`array[${AGENTS.map(lit).join(',')}]`}) order by slug`)).rows.map((r: any) => String(r.slug))
  const agents = staff.length > 0 ? staff : ['research-director']
  for (let i = 0; i < n; i++) {
    const [type, kind, actor, status, sev, text, agent] = SHAPES[i % SHAPES.length] as (typeof SHAPES)[number]
    const slug = actor === '@' || agent === '@' ? (agents[i % agents.length] as string) : null
    const who = actor === '@' ? (slug as string) : actor
    const project = projects.length === 0 ? 'null' : `${lit(projects[i % projects.length] as string)}::uuid`
    await db.execute(`select app.record_activity(p_office => ${lit(office)}::uuid, p_event_type => ${lit(type)}, p_idempotency_key => ${lit(`${marker}-${i}`)},
      p_actor_kind => ${lit(kind)}, p_actor => ${lit(who)}, p_summary => ${lit(text(i))}, p_status => ${lit(status)},
      p_severity => ${sev === null ? 'null' : lit(sev)}, p_agent_slug => ${slug === null ? 'null' : lit(slug)}, p_project_id => ${project})`)
  }
  // spread over `days` days, newest first by index (a disposable replica only; the product writer stamps now)
  await db.execute(`alter table public.activity_events disable trigger user`)
  await db.execute(`update public.activity_events set occurred_at = now() - ((substring(idempotency_key from '-(\\d+)$')::int * ${days}::numeric / ${n}::numeric) * interval '1 day') - interval '7 minutes' * (substring(idempotency_key from '-(\\d+)$')::int % 11)
    where idempotency_key like ${lit(`${marker}-%`)} and office_id = ${lit(office)}::uuid`)
  await db.execute(`alter table public.activity_events enable trigger user`)
  return { rows: n, days, marker }
}

/**
 * Genuine rows in the tables that own each fact, many of them, over several days: jobs that complete or fail (through the legal
 * transitions), approvals that are asked and some answered, deliveries that are confirmed or fail, outputs. Backdated in a DISPOSABLE
 * replica with triggers bypassed (`session_replication_role = replica`), which no product writer can do.
 */
export async function seedCycles(db: PgExecutor, s: { office: string; root: string; corr: string; projects: { id: string }[] }, run: string, cycles: number, days: number): Promise<{ jobs: number; approvals: number; deliveries: number; openApprovals: number; failedDeliveries: number }> {
  const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
  const staff = (await db.execute(`select slug, staff_id::text as id from public.staff where slug = any (array[${AGENTS.map(lit).join(',')}]) order by slug`)).rows as { slug: string; id: string }[]
  const set = (job: string, st: string) => db.execute(`update public.jobs set state = ${lit(st)} where job_id = ${lit(job)}::uuid`)
  let approvals = 0, deliveries = 0, openApprovals = 0, failedDeliveries = 0
  const touched: string[] = []
  for (let i = 0; i < cycles; i++) {
    const who = staff[i % staff.length] as { slug: string; id: string }
    const project = (s.projects[i % s.projects.length] as { id: string }).id
    const id = String((await one(`select app.enqueue_child(app.job_office(${lit(s.root)}::uuid), ${lit(s.root)}::uuid, 'office.instruction', '{"x":1}'::jsonb, interval '0', true, ${lit(project)}::uuid)::text as id`)).id)
    await db.execute(`update public.jobs set recipient_agent = ${lit(who.slug)} where job_id = ${lit(id)}::uuid`)
    touched.push(id)
    await set(id, 'running')
    if (i % 5 === 4) await set(id, 'failed')
    else {
      await db.execute(`insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources, deterministic, reviewer_status, model) values (${lit(id)}::uuid, ${lit(who.id)}::uuid, ${lit(`PRIVATE BODY ${i}`)}, 'medium', 'inferred', '[]'::jsonb, false, 'pending', 'openai/gpt-oss-120b')`)
      for (const st of ['output_created', 'quality_review']) await set(id, st)
      await db.execute(`update public.outputs set reviewer_status = 'approved', reviewed_at = now() where job_id = ${lit(id)}::uuid`)
      for (const st of ['committing', 'committed', 'notifying', 'complete']) await set(id, st)
    }
    if (i % 4 === 0) {
      await db.execute(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, decline_option, on_answer)
        values (${lit(project)}::uuid, ${lit(s.root)}::uuid, ${lit(`Approve the supplier payment ${i}`)}, 'It needs a decision', 'No payment until you answer', array['Yes','No'], 'chief-of-staff', true, ${lit(s.office)}::uuid, 'No', '{"option":"Yes","kind":"channel.create","payloads":[]}'::jsonb)`)
      approvals += 1
      if (i % 8 === 0) await db.execute(`update public.blockers set state = 'resolved', resolved_at = now(), answered_option = ${lit(i % 16 === 0 ? 'Yes' : 'No')}, answered_by = 'grant' where requested_action = ${lit(`Approve the supplier payment ${i}`)}`)
      else openApprovals += 1
    }
    const ok = i % 6 !== 5
    await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, correlation_id, job_id, send_started_at, office_id${ok ? ', message_ref, sent_at' : ', error_code'})
      values (${lit(i % 2 === 0 ? 'telegram' : 'slack')}, ${lit(`cyc-${i}-${run}`)}, 'bot', ${lit(i % 2 === 0 ? '987654321' : 'CCHANNEL1X')}, 'result', ${lit(ok ? 'sent' : 'failed')}, 1, now(), ${lit(s.corr)}::uuid, ${lit(id)}::uuid, now() - interval '1 second', ${lit(s.office)}::uuid${ok ? `, ${lit(`m-${i}`)}, now()` : `, 'channel_not_found'`})`)
    deliveries += 1
    if (!ok) failedDeliveries += 1
  }
  // two requests genuinely in flight now (running, not finished): Claire's and a specialist's
  for (const [slug, p] of [[CHIEF_SLUG, s.projects[0]], [AGENTS[0], s.projects[1] ?? s.projects[0]]] as [string, { id: string }][]) {
    const id = String((await one(`select app.enqueue_child(app.job_office(${lit(s.root)}::uuid), ${lit(s.root)}::uuid, 'office.instruction', '{"x":1}'::jsonb, interval '0', true, ${lit(p.id)}::uuid)::text as id`)).id)
    await db.execute(`update public.jobs set recipient_agent = ${lit(slug)} where job_id = ${lit(id)}::uuid`)
    await set(id, 'running')
  }
  // spread over `days` days: jobs by their transitions, the rest by their own timestamps
  await db.execute(`set session_replication_role = replica`)
  await db.execute(`update public.job_state_transitions t set occurred_at = now() - ((abs(hashtext(t.job_id::text)) % ${days * 24})::numeric * interval '1 hour') + (case t.to_state when 'running' then interval '0' else interval '3 minutes' end) where t.job_id = any (array[${touched.map((j) => `${lit(j)}::uuid`).join(',')}])`)
  await db.execute(`update public.outputs o set created_at = (select min(t.occurred_at) from public.job_state_transitions t where t.job_id = o.job_id), reviewed_at = (select max(t.occurred_at) from public.job_state_transitions t where t.job_id = o.job_id) where o.job_id = any (array[${touched.map((j) => `${lit(j)}::uuid`).join(',')}])`)
  await db.execute(`update public.deliveries d set created_at = (select max(t.occurred_at) from public.job_state_transitions t where t.job_id = d.job_id), updated_at = (select max(t.occurred_at) from public.job_state_transitions t where t.job_id = d.job_id), sent_at = case when d.state = 'sent' then (select max(t.occurred_at) from public.job_state_transitions t where t.job_id = d.job_id) else d.sent_at end where d.job_id = any (array[${touched.map((j) => `${lit(j)}::uuid`).join(',')}])`)
  await db.execute(`update public.blockers b set created_at = now() - ((abs(hashtext(b.requested_action)) % ${days * 24})::numeric * interval '1 hour'), asked_at = now() - ((abs(hashtext(b.requested_action)) % ${days * 24})::numeric * interval '1 hour'), updated_at = now() - ((abs(hashtext(b.requested_action)) % ${days * 24})::numeric * interval '1 hour'), resolved_at = case when b.state = 'resolved' then now() - ((abs(hashtext(b.requested_action)) % ${days * 24})::numeric * interval '1 hour') + interval '20 minutes' else null end where b.requested_action like 'Approve the supplier payment %'`)
  await db.execute(`set session_replication_role = origin`)
  return { jobs: cycles, approvals, deliveries, openApprovals, failedDeliveries }
}

export async function seedExternal(db: PgExecutor, office: string, run: string, project: string): Promise<void> {
  const ext = (worker: string, type: string, key: string, summary: string, status: string) =>
    db.execute(`select app.record_external_activity(${lit(office)}::uuid, ${lit(worker)}, ${lit(type)}, ${lit(`${key}-${run}`)}, ${lit(summary)}, ${lit(status)}, null, ${lit(project)}::uuid)`)
  await ext('hermes', 'external.research_completed', 'ux-x-done', 'Finished the competitor price review; the result is held for review', 'completed')
  await ext('hermes', 'external.output_produced', 'ux-x-out', 'Produced a draft comparison table', 'completed')
}
