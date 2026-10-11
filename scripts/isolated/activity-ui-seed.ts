// biome-ignore-all lint/suspicious/noExplicitAny: untyped rows
// biome-ignore-all format: dense seeding kept readable as written
/**
 * Genuine ledger records for the Activity screen (phase 4 P0). Used by activity-ui-browser.ts; nothing here is mocked in JavaScript.
 *
 * Every row below is written to the tables that OWN the fact (jobs and their transitions, routing, blockers, outputs, deliveries, model
 * usage, the action ledger) with the product's own functions where there is one (a real Telegram turn, enqueue_child, the transition
 * trigger, record_activity, record_external_activity), in the operator office of a disposable replica. The ledger is then read through
 * app.activity_read exactly as production would. Synthetic text only; no credential-shaped string; no real address.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import { realParent } from './real-telegram.ts'

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

export interface Seeded {
  office: string
  projects: { slug: string; name: string; id: string }[]
  root: string
  child: string
  failedChild: string
  corr: string
}

export async function seedLedger(db: PgExecutor, run: string): Promise<Seeded> {
  const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
  const office = String((await one(`select app.operator_office() as o`)).o)
  const names = [`Riverside launch ${run}`, `The Extremely Long Legacy Coaching Course Programme For Senior Leadership Teams Across Every Region ${run}`]
  const projects: Seeded['projects'] = []
  for (const name of names) {
    const r = await one(`select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`ui-${run}-${projects.length}`)}, ${lit(name)}, true) as v`)
    const v = typeof r.v === 'string' ? JSON.parse(r.v) : r.v
    const id = String(v.project_id)
    projects.push({ id, name, slug: String((await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug) })
  }
  const project = String(projects[0]?.id)
  const project2 = String(projects[1]?.id)

  // a real turn from a person's chat, then work under it
  const root = await realParent(db)
  await db.execute(`update public.jobs set project_id = ${lit(project)}::uuid, recipient_agent = 'chief-of-staff' where job_id = ${lit(root)}::uuid`)
  const corr = String((await one(`select correlation_id::text as c from public.jobs where job_id = ${lit(root)}::uuid`)).c)
  await db.execute(`insert into public.routing_decisions (job_id, intent_class, intent_reason, confident, subject_terms, duplicate_resolution, roster, roster_reason, delegation_depth)
    values (${lit(root)}::uuid, 'assignment', 'asks for work to be done', true, array['pricing'], 'none_found', array['chief-of-staff','research-director','finance-director'], 'The request names pricing research and a budget view', 0)`)
  const mk = async (staff: string, parent = root, proj = project) => {
    const id = String((await one(`select app.enqueue_child(app.job_office(${lit(root)}::uuid), ${lit(parent)}::uuid, 'office.instruction', '{"x":1}'::jsonb, interval '0', true, ${lit(proj)}::uuid)::text as id`)).id)
    await db.execute(`update public.jobs set recipient_agent = ${lit(staff)} where job_id = ${lit(id)}::uuid`)
    return id
  }
  const child = await mk('research-director')
  const failedChild = await mk('finance-director')
  const staff = String((await one(`select staff_id::text as s from public.staff where slug = 'research-director'`)).s)
  const set = (job: string, st: string) => db.execute(`update public.jobs set state = ${lit(st)} where job_id = ${lit(job)}::uuid`)
  await set(child, 'running')
  await db.execute(`insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources, deterministic, reviewer_status, model)
    values (${lit(child)}::uuid, ${lit(staff)}::uuid, 'PRIVATE BODY TEXT THAT MUST NEVER BE COPIED', 'medium', 'inferred', '[]'::jsonb, false, 'pending', 'openai/gpt-oss-120b')`)
  for (const s of ['output_created', 'quality_review']) await set(child, s)
  await db.execute(`update public.outputs set reviewer_status = 'approved', reviewed_at = now() where job_id = ${lit(child)}::uuid`)
  for (const s of ['committing', 'committed', 'notifying', 'complete']) await set(child, s)
  await set(failedChild, 'running')
  await set(failedChild, 'failed')

  // approvals: requested (open), granted, denied, answered with an option the data cannot classify
  const blk = async (action: string, extra: string) => db.execute(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, decline_option, on_answer)
    values (${lit(project)}::uuid, ${lit(root)}::uuid, ${lit(action)}, 'It needs a room', 'No room until you answer', ${extra})`)
  const row = (_action: string, opts: string, decline: string, onAnswer: string) => `array[${opts}], 'chief-of-staff', true, ${lit(office)}::uuid, ${decline}, ${onAnswer}`
  await blk('Create the Slack channel for the launch project', row('', "'Yes','No'", "'No'", `'{"option":"Yes","kind":"channel.create","payloads":[]}'::jsonb`))
  await blk('Add the venue notes to the project', row('', "'Yes','No'", "'No'", `'{"option":"Yes","kind":"channel.create","payloads":[]}'::jsonb`))
  await blk('Send the budget view to the accountant', row('', "'Yes','No'", "'No'", `'{"option":"Yes","kind":"channel.create","payloads":[]}'::jsonb`))
  await blk('Which printer should we use for the flyers', row('', "'Printer A','Printer B','Later'", 'null', 'null'))
  const ids = (await db.execute(`select blocker_id::text as b, requested_action as a from public.blockers where job_id = ${lit(root)}::uuid order by created_at`)).rows as { b: string; a: string }[]
  const settle = (i: number, opt: string) => db.execute(`update public.blockers set state = 'resolved', resolved_at = now(), answered_option = ${lit(opt)}, answered_by = 'grant' where blocker_id = ${lit(String(ids[i]?.b))}::uuid`)
  await settle(1, 'Yes')
  await settle(2, 'No')
  await settle(3, 'Later')

  // deliveries: provider-confirmed, marked as arrived by a person, failed
  const dl = (key: string, channel: string, state: string, cols: string, vals: string) => db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, correlation_id, job_id, send_started_at, office_id${cols})
    values (${lit(channel)}, ${lit(`${key}-${run}`)}, 'bot', ${lit(channel === 'slack' ? 'CCHANNEL1X' : '987654321')}, 'result', ${lit(state)}, 1, now(), ${lit(corr)}::uuid, ${lit(root)}::uuid, now() - interval '1 second', ${lit(office)}::uuid${vals})`)
  await dl('d-ok', 'telegram', 'sent', ', message_ref, sent_at', `, 'm-77', now()`)
  await dl('d-person', 'slack', 'sent', ', message_ref, sent_at', `, 'confirmed-by-person:1', now()`)
  await dl('d-fail', 'slack', 'failed', ', error_code', `, 'channel_not_found'`)

  // model calls and an impediment
  await db.execute(`insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, provenance, office_id, latency_ms, cost_usd)
    values ('openrouter', 'openai/gpt-oss-120b', ${lit(child)}::uuid, ${lit(corr)}::uuid, 'ok', 900, 120, 'estimated', ${lit(office)}::uuid, 840, 0.0012)`)
  await db.execute(`insert into public.job_impediments (job_id, project_id, staff_slug, kind, needed_raw, detail, understood_as, noticed_by)
    values (${lit(child)}::uuid, ${lit(project)}::uuid, 'research-director', 'needs_permission', 'gmail.send', 'would send mail', 'send', 'the handler')`)
  for (const s of ['running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying', 'complete']) await set(root, s)

  // a second project's work, so the project filter has something to exclude
  const other = await mk('growth-director', root, project2)
  for (const s of ['running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying', 'complete']) await set(other, s)

  // OLD_SCHEMA=1: a database without the ledger (the mixed-version cells); the owning tables above are all the office has
  if (process.env.OLD_SCHEMA === '1') return { office, projects, root, child, failedChild, corr }
  // native events, written by the ledger's own writers
  const nat = (type: string, key: string, kind: string, actor: string, summary: string, extra = '') =>
    db.execute(`select app.record_activity(p_office => ${lit(office)}::uuid, p_event_type => ${lit(type)}, p_idempotency_key => ${lit(`${key}-${run}`)}, p_actor_kind => ${lit(kind)}, p_actor => ${lit(actor)}, p_summary => ${lit(summary)}${extra})`)
  const jc = `, p_job_id => ${lit(child)}::uuid, p_project_id => ${lit(project)}::uuid`
  await nat('tool.call_requested', 'tool-req', 'agent', 'research-director', 'Asked to read the pricing notes', `${jc}, p_tool => 'notebook.read'`)
  await nat('tool.call_completed', 'tool-ok', 'agent', 'research-director', 'Read the pricing notes', `${jc}, p_tool => 'notebook.read'`)
  await nat('tool.call_failed', 'tool-fail', 'agent', 'research-director', 'Could not read the supplier sheet', `${jc}, p_tool => 'drive.read', p_severity => 'warning'`)
  await nat('budget.threshold_reached', 'budget', 'system', 'office', 'The finance director was held back: the day budget is used', `, p_agent_slug => 'finance-director'`)
  await nat('system.recovered', 'recover', 'system', 'worker', 'Recovered 2 jobs a stopped worker had left running')
  const ext = (worker: string, type: string, key: string, summary: string, status = 'recorded', extra = '') =>
    db.execute(`select app.record_external_activity(${lit(office)}::uuid, ${lit(worker)}, ${lit(type)}, ${lit(`${key}-${run}`)}, ${lit(summary)}, ${lit(status)}${extra})`)
  await ext('hermes', 'external.research_completed', 'x-done', 'Finished the supplier comparison; the result is held for review', 'completed', `, null, ${lit(project)}::uuid, ${lit(child)}::uuid`)
  await ext('hermes', 'external.skill_proposed', 'x-skill', 'Proposed a skill for reading price lists; nothing is installed', 'recorded', `, null, ${lit(project)}::uuid`)
  await ext('hermes', 'external.worker_error', 'x-err', 'The sandbox ran out of time', 'failed', `, 'error', ${lit(project)}::uuid`)
  await ext('hermes', 'external.usage_recorded', 'x-use', 'Used 1234 tokens in 842 ms', 'recorded', `, null, ${lit(project)}::uuid, null, null, '{"total_tokens": 1234, "duration_ms": 842}'::jsonb`)
  return { office, projects, root, child, failedChild, corr }
}
