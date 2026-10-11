// biome-ignore-all lint/suspicious/noExplicitAny: the read model's answers are untyped JSON
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * A filter on the activity read model returns EXACTLY what filtering the whole history afterwards would, never fewer and never more.
 *
 *   npx tsx scripts/isolated/activity-ledger-equivalence.ts <replica-db>
 *
 * The read model pushes severity, category, type, agent, job, correlation and project into each source's own query so a selective
 * filter does not have to read every row (migration 1061). That is an optimisation of a result, so the result is what is proved: the
 * whole history is read once with no filter and paged to the end, then each filter is run through the read model (small pages, so the
 * keyset is exercised) and compared with the same filter applied to that whole history, by id and in order. The data is varied on
 * purpose: every job state, every delivery state, every approval ending, model calls that did and did not finish, impediments of
 * every kind, reviewed outputs, action-ledger events and native events of every severity, across four agents and two projects.
 * Control: a filter nobody matches must return nothing and a filter everybody matches must return everything, or the comparison is vacuous.
 */
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const dbName = process.argv[2] ?? 'ledger'
const db = await isolated(dbName)
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
type Ev = Record<string, any>
const SEV: Record<string, number> = { debug: 0, info: 1, notice: 2, warning: 3, error: 4, critical: 5 }

let exit = 1
try {
  const grant = String((await one(`select app.operator_office() as o`)).o)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_enabled', 'true'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const mkProject = async (n: string) => String(json((await one(`select app.hq_create_project(${lit(grant)}::uuid, ${lit(`Equiv ${n} ${run}`)}, 'upload', ${lit(`eq-${n}-${run}`)}, ${lit(`Equiv ${n} ${run}`)}, true) as v`)).v).project_id)
  const projA = await mkProject('a')
  const projB = await mkProject('b')
  const agents = ['chief-of-staff', 'research-director', 'finance-director', 'operations-director']
  const jobs: string[] = []
  for (let i = 0; i < 24; i++) {
    const j = await realParent(db)
    await db.execute(`update public.jobs set project_id = ${lit(i % 2 === 0 ? projA : projB)}::uuid, recipient_agent = ${lit(agents[i % 4] as string)} where job_id = ${lit(j)}::uuid`)
    jobs.push(j)
  }
  const kids: string[] = []
  for (let i = 0; i < 8; i++) {
    const k = String((await one(`select app.enqueue_child(app.job_office(${lit(jobs[i] as string)}::uuid), ${lit(jobs[i] as string)}::uuid, 'office.instruction', '{"x":1}'::jsonb, interval '0', true, ${lit(i % 2 === 0 ? projA : projB)}::uuid)::text as id`)).id)
    await db.execute(`update public.jobs set recipient_agent = ${lit(agents[(i + 1) % 4] as string)} where job_id = ${lit(k)}::uuid`)
    kids.push(k)
  }
  const all = [...jobs, ...kids]
  const jl = `array[${all.map((j) => lit(j)).join(',')}]::uuid[]`

  // every job state a transition can name
  await db.execute(`insert into public.job_state_transitions (job_id, from_state, to_state, reason, attempt, occurred_at)
    select j, 'queued'::job_state, s::job_state, 'because ' || s, 1, now() - (n * interval '37 seconds')
      from unnest(${jl}) with ordinality a(j, n)
      cross join (values ('running'), ('complete'), ('failed'), ('cancelled'), ('retrying'), ('paused'), ('waiting_external'), ('waiting_user'), ('output_created')) v(s)
     where (n + length(s)) % 3 <> 0`)
  // every delivery state and ending
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, job_id, correlation_id, message_ref, send_started_at, sent_at, error_code, suppressed_reason, staff_id, office_id)
    select 'telegram', 'eq-' || n || '-' || st || '-${run}', 'bot', '123456', 'result', st::slack_delivery_state, 1, now(), j, (select correlation_id from public.jobs where job_id = j),
           case st when 'sent' then 'm-' || n when 'suppressed' then 'm-s' || n end,
           case when st in ('sent', 'claimed') then now() - interval '2 minutes' end,
           case when st = 'sent' then now() - (n * interval '41 seconds') end,
           case when st = 'failed' then 'transport_error' end,
           case when st = 'suppressed' then 'duplicate' end,
           (select staff_id from public.staff where slug = (array['chief-of-staff','research-director','finance-director','operations-director'])[1 + (n % 4)]),
           ${lit(grant)}::uuid
      from unnest(${jl}) with ordinality a(j, n)
      cross join (values ('sent'), ('failed'), ('suppressed'), ('claimed')) v(st)
     where (n + length(st)) % 2 = 0`)
  // model calls that finished and did not
  await db.execute(`insert into public.inference_usage (job_id, correlation_id, model_id, outcome, provenance, provider, office_id, occurred_at)
    select j, (select correlation_id from public.jobs where job_id = j), 'm/' || (n % 3), case when n % 3 = 0 then 'provider_error' else 'ok' end, 'estimated', 'openrouter', ${lit(grant)}::uuid, now() - (n * interval '53 seconds')
      from unnest(${jl}) with ordinality a(j, n)`)
  // approvals: asked, then every ending
  for (let i = 0; i < 10; i++) {
    const j = all[i] as string
    const proj = i % 2 === 0 ? projA : projB
    const ending = i % 5
    await db.execute(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, decline_option, on_answer)
      values (${lit(proj)}::uuid, ${lit(j)}::uuid, ${lit(`Eq question ${i} ${run}`)}, 'why', 'later', array['Yes','No'], ${lit(agents[i % 4] as string)}, true, ${lit(grant)}::uuid, ${i % 2 === 0 ? `'No'` : 'null'}, ${i % 2 === 0 ? `'{"option":"Yes","kind":"x","payloads":[]}'::jsonb` : 'null'})`)
    const set = ['state = \'resolved\', answered_option = \'Yes\', answered_by = \'grant\'', 'state = \'resolved\', answered_option = \'No\', answered_by = \'grant\'', 'state = \'expired\'', 'state = \'withdrawn\'', 'state = \'resolved\', answered_option = null']
    await db.execute(`update public.blockers set ${set[ending]}, resolved_at = now() - interval '${i} minutes' where requested_action = ${lit(`Eq question ${i} ${run}`)}`)
  }
  // impediments of every kind
  for (const [i, kind] of ['ambiguous', 'missing_data', 'missing_skill', 'missing_tool', 'needs_permission', 'not_capable'].entries()) {
    await db.execute(`insert into public.job_impediments (job_id, kind, needed_raw, noticed_by, staff_slug, project_id) values (${lit(all[i + 2] as string)}::uuid, ${lit(kind)}, ${lit(`need ${kind}`)}, 'the handler', ${lit(agents[i % 4] as string)}, ${lit(i % 2 === 0 ? projA : projB)}::uuid)`)
  }
  // throttles waited out (and a pause for another reason, which must not appear)
  for (const [i, reason] of ['rate_limited', 'rate_limited', 'rate_limited', 'scheduled_wait'].entries()) {
    await db.execute(`insert into public.job_pauses (job_id, reason, detail, resume_when, resumable) values (${lit(all[i + 1] as string)}::uuid, ${lit(reason)}, 'provider said slow down', 'the window ends', true)`)
  }
  // outputs, some reviewed
  for (let i = 0; i < 8; i++) {
    const oid = String((await one(`insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources, deterministic, reviewer_status, model)
      values (${lit(all[i + 4] as string)}::uuid, (select staff_id from public.staff where slug = ${lit(agents[i % 4] as string)}), 'PRIVATE', 'medium', 'inferred', '[]'::jsonb, false, 'pending', 'm/x') returning output_id::text as id`)).id)
    if (i % 4 !== 0) await db.execute(`update public.outputs set reviewer_status = ${lit(['pending', 'approved', 'rejected', 'approved'][i % 4] as string)}, reviewed_at = now() - interval '${i} minutes', review_notes = 'reviewed in the equivalence proof',
      reviewed_by = (select staff_id from public.staff where slug = ${lit(agents[(i + 1) % 4] as string)}) where output_id = ${lit(oid)}::uuid`)
  }
  // the action ledger, and native rows of every severity
  for (let i = 0; i < 8; i++) {
    await db.execute(`insert into public.events (correlation_id, actor_kind, actor, trigger, action_type, reversible, office_id, project_id, related_job_id, occurred_at)
      values (gen_random_uuid(), ${i % 2 === 0 ? `'agent'` : `'user'`}, ${lit(i % 2 === 0 ? (agents[i % 4] as string) : 'grant')}, 't', ${lit(['task.created', 'document.added', 'calendar.event_added', 'finding.write'][i % 4] as string)}, false, ${lit(grant)}::uuid, ${lit(i % 2 === 0 ? projA : projB)}::uuid, ${lit(all[i] as string)}::uuid, now() - interval '${i * 7} minutes')`)
  }
  const natives: [string, string | null][] = [['system.recovered', 'warning'], ['budget.threshold_reached', 'error'], ['system.recovered', 'notice'], ['tool.call_requested', null], ['tool.call_failed', 'error'], ['budget.threshold_reached', 'critical'], ['system.recovered', null]]
  for (const [i, [type, sev]] of natives.entries()) {
    await db.execute(`select app.record_activity(p_office => ${lit(grant)}::uuid, p_event_type => ${lit(type)}, p_idempotency_key => ${lit(`eqn-${i}-${run}`)}, p_actor_kind => 'system', p_actor => 'worker', p_summary => 's',
      p_severity => ${sev === null ? 'null' : lit(sev)}, p_agent_slug => ${lit(agents[i % 4] as string)}, p_project_id => ${lit(i % 2 === 0 ? projA : projB)}::uuid, p_job_id => ${lit(all[i] as string)}::uuid)`)
  }

  for (const [i, type] of ['external.output_produced', 'external.worker_error'].entries()) {
    await db.execute(`select app.record_external_activity(p_office => ${lit(grant)}::uuid, p_worker => 'hermes', p_event_type => ${lit(type)}, p_idempotency_key => ${lit(`eqx-${i}-${run}`)}, p_summary => 'x', p_project_id => ${lit(projA)}::uuid, p_job_id => ${lit(all[i] as string)}::uuid)`)
  }

  // ---------------------------------------------------------------------------------------------- the whole history, once
  const named = (args: Record<string, string | number | null>) => Object.entries(args).map(([k, v]) => `${k} => ${v === null ? 'null' : typeof v === 'number' ? v : lit(String(v))}`).join(', ')
  const read = async (args: Record<string, string | number | null>): Promise<Ev> => json((await one(`select app.activity_read(p_office => ${lit(grant)}::uuid${Object.keys(args).length ? `, ${named(args)}` : ''}) as v`)).v)
  const walk = async (args: Record<string, string | number | null>, size: number): Promise<{ events: Ev[]; partial: boolean }> => {
    const events: Ev[] = []
    let partial = false
    let at: string | null = null
    let id: string | null = null
    for (let i = 0; i < 500; i++) {
      const a: Record<string, string | number | null> = { ...args, p_limit: size }
      if (at !== null && id !== null) { a.p_before_at = at; a.p_before_id = id }
      const p = await read(a)
      events.push(...(p.events as Ev[]))
      partial = partial || p.partial === true
      if (p.next === null || p.next === undefined) return { events, partial }
      at = String(p.next.at); id = String(p.next.id)
    }
    throw new Error('did not terminate')
  }
  const whole = await walk({ p_visibility: 'operator' }, 40)
  const types = new Set(whole.events.map((e) => e.type))
  check('fixtures: the history is varied enough for the comparison to mean something', whole.events.length > 150 && types.size >= 22 && !whole.partial, `${whole.events.length} events, ${types.size} types, partial=${whole.partial}`)
  check('fixtures: only the throttle pauses are events (a pause for another reason is not)', whole.events.filter((e) => e.type === 'integration.rate_limited').length === 3, `${whole.events.filter((e) => e.type === 'integration.rate_limited').length} rate-limited events of 4 pauses`)
  const wanted = ['integration.rate_limited', 'job.failed', 'job.cancelled', 'job.completed', 'retry.scheduled', 'job.paused', 'job.waiting', 'delivery.failed', 'delivery.succeeded', 'delivery.suppressed', 'delivery.attempted', 'approval.granted', 'approval.denied', 'approval.answered', 'approval.expired', 'approval.withdrawn', 'inference.completed', 'output.reviewed', 'action.blocked', 'job.impeded', 'system.recovered', 'budget.threshold_reached', 'tool.call_failed']
  check('fixtures: it holds every job ending, delivery ending and approval ending', wanted.every((t) => types.has(t)), `missing: ${wanted.filter((t) => !types.has(t)).join() || 'none'}`)
  const ids = (l: Ev[]) => l.map((e) => String(e.id))

  const cases: { name: string; args: Record<string, string | number | null>; keep: (e: Ev) => boolean }[] = []
  for (const s of ['notice', 'warning', 'error', 'critical']) cases.push({ name: `severity >= ${s}`, args: { p_min_severity: s }, keep: (e) => (SEV[e.severity] ?? -1) >= (SEV[s] as number) })
  for (const c of ['request', 'job', 'approval', 'output', 'delivery', 'tool', 'reliability', 'usage', 'integration', 'external']) cases.push({ name: `category ${c}`, args: { p_category: c }, keep: (e) => e.category === c })
  for (const t of ['integration.rate_limited', 'job.failed', 'job.completed', 'job.cancelled', 'delivery.failed', 'delivery.succeeded', 'approval.answered', 'approval.denied', 'inference.completed', 'system.recovered', 'output.reviewed', 'task.created', 'budget.threshold_reached']) cases.push({ name: `type ${t}`, args: { p_type: t }, keep: (e) => e.type === t })
  for (const a of agents) cases.push({ name: `agent ${a}`, args: { p_agent: a }, keep: (e) => e.agent === a })
  for (const s of ['failed', 'confirmed', 'completed', 'declined', 'attempted', 'requested']) cases.push({ name: `status ${s}`, args: { p_status: s }, keep: (e) => e.status === s })
  cases.push({ name: 'project A', args: { p_project: projA }, keep: (e) => e.project_id === projA })
  cases.push({ name: 'project B', args: { p_project: projB }, keep: (e) => e.project_id === projB })
  cases.push({ name: 'severity >= error and category job', args: { p_min_severity: 'error', p_category: 'job' }, keep: (e) => (SEV[e.severity] ?? -1) >= 4 && e.category === 'job' })
  cases.push({ name: 'agent finance-director and category delivery', args: { p_agent: 'finance-director', p_category: 'delivery' }, keep: (e) => e.agent === 'finance-director' && e.category === 'delivery' })
  cases.push({ name: 'project A and severity >= warning', args: { p_project: projA, p_min_severity: 'warning' }, keep: (e) => e.project_id === projA && (SEV[e.severity] ?? -1) >= 3 })
  cases.push({ name: 'agent research-director and type job.completed', args: { p_agent: 'research-director', p_type: 'job.completed' }, keep: (e) => e.agent === 'research-director' && e.type === 'job.completed' })
  cases.push({ name: 'a filter nobody matches', args: { p_agent: 'nobody-here' }, keep: () => false })
  cases.push({ name: 'category with no events of that kind in user view', args: { p_category: 'integration', p_min_severity: 'critical' }, keep: (e) => e.category === 'integration' && e.severity === 'critical' })

  let bad = 0
  for (const c of cases) {
    const got = await walk({ ...c.args, p_visibility: 'operator' }, 7)
    const want = whole.events.filter(c.keep)
    const same = got.events.length === want.length && ids(got.events).join() === ids(want).join() && !got.partial
    if (!same) {
      bad++
      const gi = new Set(ids(got.events))
      const wi = new Set(ids(want))
      console.log(`FAIL filter ${c.name} - got ${got.events.length}, whole-history filtered ${want.length}, missing ${ids(want).filter((x) => !gi.has(x)).length}, extra ${ids(got.events).filter((x) => !wi.has(x)).length}, partial ${got.partial}`)
    }
  }
  check(`every filter returns exactly what filtering the whole history returns (${cases.length} filters, in order, by id, never partial)`, bad === 0, `${cases.length - bad} of ${cases.length} identical`)
  const nonEmpty = cases.filter((c) => whole.events.some(c.keep)).length
  const empty = cases.filter((c) => !whole.events.some(c.keep)).map((c) => c.name)
  check('control: nearly every filter selects something, and the empty ones are the intended ones', nonEmpty >= cases.length - 5 && empty.includes('a filter nobody matches'), `${nonEmpty} of ${cases.length} non-empty; empty: ${empty.join('; ')}`)

  // the ordinary view: the user's own visibility, same comparison
  const userWhole = await walk({}, 40)
  const uCase = await walk({ p_min_severity: 'error' }, 5)
  check('user visibility: a filter agrees with the user\'s whole history too', ids(uCase.events).join() === ids(userWhole.events.filter((e) => (SEV[e.severity] ?? -1) >= 4)).join(), `${uCase.events.length} events`)

  // job and correlation: the subtree and the correlation, against the jobs table
  const root = jobs[0] as string
  const subtree = new Set<string>((await db.execute(`with recursive t(id) as (select ${lit(root)}::uuid union select j.job_id from public.jobs j join t on j.parent_job_id = t.id) select id::text as id from t`)).rows.map((r) => String((r as any).id)))
  const byJob = await walk({ p_job: root, p_visibility: 'operator' }, 9)
  const wantJob = whole.events.filter((e) => e.job_id !== null && subtree.has(String(e.job_id)))
  check('job filter: the job and every job under it, nothing else', ids(byJob.events).join() === ids(wantJob).join() && wantJob.length > 0, `${byJob.events.length} of ${wantJob.length}`)
  const corr = String((await one(`select correlation_id::text as c from public.jobs where job_id = ${lit(root)}::uuid`)).c)
  const byCorr = await walk({ p_correlation: corr, p_visibility: 'operator' }, 9)
  const wantCorr = whole.events.filter((e) => e.correlation_id === corr)
  check('correlation filter: exactly the events of that correlation', ids(byCorr.events).join() === ids(wantCorr).join() && wantCorr.length > 0, `${byCorr.events.length} of ${wantCorr.length}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
