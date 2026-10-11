// biome-ignore-all lint/suspicious/noExplicitAny: the read model's answers are untyped JSON
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * One regression for each defect the independent review of the activity ledger demonstrated (docs/activity-ledger/RELEASE-READINESS.md).
 *
 *   npx tsx scripts/isolated/activity-ledger-review.ts <replica-db>
 *
 * The replica must have 1060 and 1061 applied. Each check names the finding it guards and was written against the defect, so it
 * fails on the code the reviewer read. The unchanged behaviours the review found sound (isolation, keyset paging) are held by
 * activity-ledger.ts; this file holds only what was wrong.
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
const refused = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}
type Ev = Record<string, any>
const read = async (office: string, args: Record<string, string | number | null> = {}): Promise<Ev> => {
  const named = Object.entries(args).map(([k, v]) => `${k} => ${v === null ? 'null' : typeof v === 'number' ? v : lit(String(v))}`).join(', ')
  return json((await one(`select app.activity_read(p_office => ${lit(office)}::uuid${named ? `, ${named}` : ''}) as v`)).v)
}

let exit = 1
try {
  const grant = String((await one(`select app.operator_office() as o`)).o)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_enabled', 'true'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const project = String(json((await one(`select app.hq_create_project(${lit(grant)}::uuid, ${lit(`Review ${run}`)}, 'upload', ${lit(`rev-${run}`)}, ${lit(`Review ${run}`)}, true) as v`)).v).project_id)
  const root = await realParent(db)
  await db.execute(`update public.jobs set project_id = ${lit(project)}::uuid, recipient_agent = 'chief-of-staff' where job_id = ${lit(root)}::uuid`)
  const corr = String((await one(`select correlation_id::text as c from public.jobs where job_id = ${lit(root)}::uuid`)).c)
  const child = (_label: string, parent: string) => one(`select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, 'office.instruction', '{"x":1}'::jsonb, interval '0', true, ${lit(project)}::uuid)::text as id`).then((r) => String(r.id))
  const kid = await child('c1', root)
  const grandkid = await child('c2', kid)
  await db.execute(`update public.jobs set recipient_agent = 'research-director' where job_id = ${lit(kid)}::uuid`)

  // ---------------------------------------------------------------------------------------------- H1: no yes or no is invented
  const ins = (action: string, opts: string, extra: string) => db.execute(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id${extra.split('|')[0]})
    values (${lit(project)}::uuid, ${lit(root)}::uuid, ${lit(action)}, 'why', 'later', ${opts}, 'chief-of-staff', true, ${lit(grant)}::uuid${extra.split('|')[1] ?? ''})`)
  await ins(`H1 yes ${run}`, `array['Yes','No']`, `, decline_option, on_answer|, 'No', '{"option":"Yes","kind":"x","payloads":[]}'::jsonb`)
  await ins(`H1 wait ${run}`, `array['Investigate now','Cancel the job']`, '|')
  await ins(`H1 no ${run}`, `array['Yes','No']`, `, decline_option, on_answer|, 'No', '{"option":"Yes","kind":"x","payloads":[]}'::jsonb`)
  await ins(`H1 closed ${run}`, `array['Yes','No']`, '|')
  const settle = (action: string, option: string | null, by: string | null) => db.execute(`update public.blockers set state = 'resolved', resolved_at = now(), answered_option = ${option === null ? 'null' : lit(option)}, answered_by = ${by === null ? 'null' : lit(by)} where requested_action = ${lit(action)}`)
  await settle(`H1 yes ${run}`, 'Yes', 'grant')
  await settle(`H1 wait ${run}`, 'Cancel the job', 'grant')
  await settle(`H1 no ${run}`, 'No', 'grant')
  await settle(`H1 closed ${run}`, null, null)
  const feed = await read(grant, { p_job: root, p_visibility: 'diagnostic', p_limit: 200 })
  const dec = (word: string) => (feed.events as Ev[]).find((e) => e.type.startsWith('approval.') && e.type !== 'approval.requested' && String(e.summary).includes(`H1 ${word} ${run}`))
  check('H1: an approval with a performing answer and a different option is a yes, by the person', dec('yes')?.type === 'approval.granted' && dec('yes')?.actor === 'you', `${dec('yes')?.type} by ${dec('yes')?.actor}`)
  check('H1: an answer that cancels, on a question that names no decline, is NOT recorded as a yes', dec('wait')?.type === 'approval.answered' && !String(dec('wait')?.summary).startsWith('You said'), `${dec('wait')?.type}: ${dec('wait')?.summary}`)
  check('H1: the option the writer named as the decline is a no', dec('no')?.type === 'approval.denied', `${dec('no')?.type}`)
  check('H1: a question closed with no answer and nobody answering is closed, not a yes and not the office withdrawing', dec('closed')?.type === 'approval.answered' && String(dec('closed')?.summary).startsWith('Closed') && dec('closed')?.actor === 'office', `${dec('closed')?.type} by ${dec('closed')?.actor}`)
  check('H1: the chosen option is carried as text where the data cannot classify it', dec('wait')?.metadata?.answer === 'Cancel the job', `${dec('wait')?.metadata?.answer}`)

  // ---------------------------------------------------------------------------------------------- H2: a person's word is not a provider's
  const sent = (key: string, ref: string) => db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, correlation_id, job_id, message_ref, send_started_at, sent_at, office_id)
    values ('telegram', ${lit(`${key}-${run}`)}, 'bot', '987654321', 'result', 'sent', 1, now(), ${lit(corr)}::uuid, ${lit(root)}::uuid, ${lit(ref)}, now() - interval '1 second', now(), ${lit(grant)}::uuid)`)
  await sent('h2-real', 'm-1001')
  await sent('h2-person', `confirmed-by-person:${run}`)
  const dfeed = await read(grant, { p_job: root, p_type: 'delivery.succeeded', p_limit: 50 })
  const byRef = (ev: Ev) => ev.metadata?.confirmed_by_person === true
  const person = (dfeed.events as Ev[]).find(byRef)
  const real = (dfeed.events as Ev[]).find((e) => !byRef(e))
  check('H2: a delivery a person marked as arrived is not provider-confirmed', person?.status === 'completed' && person?.metadata?.provider_confirmed === false && String(person?.summary).includes('you'), `${person?.status} / ${person?.metadata?.provider_confirmed} / ${person?.summary}`)
  check('H2: a delivery whose provider returned a reference still is', real?.status === 'confirmed' && real?.metadata?.provider_confirmed === true, `${real?.status}`)

  // ---------------------------------------------------------------------------------------------- M3, M4: reasons and actors
  await db.execute(`update public.jobs set stop_requested_by = 'grant', stop_requested_at = now(), state = 'cancelled', state_reason = 'Called off by Grant' where job_id = ${lit(grandkid)}::uuid`)
  const cfeed = await read(grant, { p_job: root, p_visibility: 'diagnostic', p_limit: 200 })
  const cancelled = (cfeed.events as Ev[]).find((e) => e.type === 'job.cancelled' && e.job_id === grandkid)
  check('M4: a job a person stopped is attributed to the person, not to the agent it belonged to', cancelled?.actor === 'you' && cancelled?.actor_kind === 'user', `${cancelled?.actor_kind}/${cancelled?.actor}`)
  const approvedKid = await child('c3', root)
  // origin_kind is written once by the product; the fixture sets it past the guard, as the approval path would have at creation
  await db.execute(`set session_replication_role = replica`)
  await db.execute(`update public.jobs set origin_kind = 'approved' where job_id = ${lit(approvedKid)}::uuid`)
  await db.execute(`set session_replication_role = origin`)
  const afeed = await read(grant, { p_job: approvedKid, p_visibility: 'diagnostic' })
  check('M4: a job an approval started is created, not "handed to a specialist"', (afeed.events as Ev[]).some((e) => e.type === 'job.created' && e.job_id === approvedKid) && !(afeed.events as Ev[]).some((e) => e.type === 'job.delegated' && e.job_id === approvedKid), `${(afeed.events as Ev[]).map((e) => e.type).join()}`)
  check('M4: a real hand-off still is one', (cfeed.events as Ev[]).some((e) => e.type === 'job.delegated' && e.job_id === kid), 'delegated present')
  check('M3: a reason the job carried from an earlier state is not shown against a state it does not explain', (cfeed.events as Ev[]).filter((e) => ['job.created', 'job.delegated', 'job.started', 'job.completed'].includes(e.type)).every((e) => e.metadata?.reason === undefined), 'no reason on created/started/completed')

  // ---------------------------------------------------------------------------------------------- L3: a job filter includes every descendant
  const subtree = await read(grant, { p_job: kid, p_visibility: 'diagnostic', p_limit: 200 })
  check('L3: filtering on a job in the middle of the tree includes its grandchildren, and excludes its parent', (subtree.events as Ev[]).some((e) => e.job_id === grandkid) && !(subtree.events as Ev[]).some((e) => e.job_id === root), `jobs ${[...new Set((subtree.events as Ev[]).map((e) => e.job_id))].length}`)

  // ---------------------------------------------------------------------------------------------- M5: a fixture project's job-less rows are not shown
  const fx = String(json((await one(`select app.hq_create_project(${lit(grant)}::uuid, ${lit(`Fixture review ${run}`)}, 'upload', ${lit(`fixture-rev-${run}`)}, ${lit(`Fixture review ${run}`)}, true) as v`)).v).project_id)
  const isFx = (await one(`select is_fixture as f from public.projects where project_id = ${lit(fx)}::uuid`)).f === true
  await db.execute(`insert into public.blockers (project_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id)
    values (${lit(fx)}::uuid, ${lit(`Fixture question ${run}`)}, 'why', 'later', array['Yes','No'], 'chief-of-staff', true, ${lit(grant)}::uuid)`)
  const all = await read(grant, { p_visibility: 'diagnostic', p_limit: 200 })
  check('M5: a question in a fixture project, with no job to say so, is not shown', isFx && !(all.events as Ev[]).some((e) => String(e.summary).includes(`Fixture question ${run}`)), `fixture project: ${isFx}`)

  // ---------------------------------------------------------------------------------------------- L6: a null visibility is refused, not widened
  const nullVis = await refused(`select app.activity_read(p_office => ${lit(grant)}::uuid, p_visibility => null)`)
  check('L6: a null visibility is refused rather than read as the widest', nullVis.includes('unknown visibility'), nullVis.slice(0, 60))

  // ---------------------------------------------------------------------------------------------- M7: no native type is also an action-ledger type
  const clash = Number((await one(`select count(*) as c from public.activity_event_types t where t.default_visibility = 'diagnostic' and exists (select 1 from public.events e where e.action_type = t.event_type)`)).c)
  const taxonomyHasOld = Number((await one(`select count(*) as c from public.activity_event_types where event_type = 'tool.requested'`)).c)
  check('M7: the native tool types do not share a name with the action ledger\'s tool.requested', clash === 0 && taxonomyHasOld === 0, `clashing ${clash}, old name present ${taxonomyHasOld}`)

  // ---------------------------------------------------------------------------------------------- H4: the page is given a slug, and a name beside it
  const page = json((await one(`select app.activity_for_the_page(${lit(grant)}::uuid, 100) as v`)).v)
  const agentRow = (page.office as Ev[]).find((e) => e.who === 'research-director')
  check('H4: the Team HQ rows carry the raw slug in who, as hq_studio_lately does, with the display name beside it', agentRow !== undefined && agentRow.who_name === 'Research Director', `who=${agentRow?.who} who_name=${agentRow?.who_name}`)
  check('H4: no row carries a display name where the page looks a face up by slug', (page.office as Ev[]).every((e) => !/ /.test(String(e.who)) || e.who === null), 'no spaced who')

  // ---------------------------------------------------------------------------------------------- H3: a selective filter on a busy office
  const other = await realParent(db)
  await db.execute(`insert into public.job_state_transitions (job_id, from_state, to_state, reason, attempt, occurred_at)
    select ${lit(other)}::uuid, 'queued', 'running', null, 1, now() + (g || ' milliseconds')::interval from generate_series(1, 17000) g`)
  const byJob = await read(grant, { p_job: root, p_visibility: 'diagnostic', p_limit: 200 })
  const byProject = await read(grant, { p_project: project, p_visibility: 'diagnostic', p_limit: 200 })
  const types = new Set((byJob.events as Ev[]).map((e) => e.type))
  check('H3: a job older than 17 000 newer transitions still has its whole lifecycle, and the answer is complete', types.has('job.created') && types.has('job.delegated') && byJob.partial === false, `partial=${byJob.partial}, ${types.size} types`)
  check('H3: a project older than 17 000 newer transitions is complete too', byProject.partial === false && (byProject.events as Ev[]).some((e) => e.type === 'job.created'), `partial=${byProject.partial}, ${(byProject.events as Ev[]).length} events`)
  const chain = json((await one(`select app.activity_chain(${lit(grant)}::uuid, p_correlation => ${lit(corr)}::uuid) as v`)).v)
  check('H3: the chain of that work is complete and starts from its creation', chain.complete === true && (chain.events as Ev[]).some((e) => e.type === 'job.created'), `complete=${chain.complete}, ${(chain.events as Ev[]).length} events`)

  // ---------------------------------------------------------------------------------------------- M1: the external door
  const fake = `${'xo'}xb-123456-abcdefghijkl`
  const ext = (key: string, extra: string) => `select app.record_external_activity(p_office => ${lit(grant)}::uuid, p_worker => 'hermes', p_event_type => 'external.output_produced', p_idempotency_key => ${lit(`${key}-${run}`)}, p_summary => 'x'${extra})`
  const evId = String((await one(`${ext('ev1', `, p_job_id => ${lit(root)}::uuid, p_evidence_ref => jsonb_build_object('kind', 'blocker', 'id', 'abc', 'note', ${lit(fake)}, 'secret_thing', 'x')`)} as id`)).id)
  const stored = json((await one(`select evidence_ref as e from public.activity_events where activity_id = ${lit(evId)}::uuid`)).e)
  check('M1: a worker\'s evidence cannot claim to be one of the office\'s own records', stored.kind === 'external', `kind ${stored.kind}`)
  check('M1: a worker\'s evidence is cleaned like metadata', !JSON.stringify(stored).includes(fake) && stored.secret_thing === '[redacted:key]', JSON.stringify(stored).slice(0, 80))
  const bigId = String((await one(`${ext('ev2', `, p_evidence_ref => jsonb_build_object('id', repeat('a b ', 50000))`)} as id`)).id)
  const bigSize = Number((await one(`select pg_column_size(evidence_ref) as n from public.activity_events where activity_id = ${lit(bigId)}::uuid`)).n)
  const manyKeys = await refused(`${ext('ev3', `, p_evidence_ref => (select jsonb_object_agg('k' || g, 'v') from generate_series(1, 60) g)`)}`)
  check('M1: a 200 KB evidence value is cut, and an evidence object with too many keys is refused: nothing large is stored', bigSize <= 1024 && manyKeys.includes('too many keys'), `stored ${bigSize} bytes; many keys: ${manyKeys.slice(0, 50)}`)
  const wrongCorr = await refused(`${ext('c1', `, p_job_id => ${lit(root)}::uuid, p_correlation_id => gen_random_uuid()`)}`)
  check('M1: a correlation that is not the job\'s is refused', wrongCorr.includes('does not belong to that job'), wrongCorr.slice(0, 70))
  const noWork = await refused(`${ext('c2', `, p_correlation_id => gen_random_uuid()`)}`)
  check('M1: a correlation no work of the office has is refused', noWork.includes('no work of this office'), noWork.slice(0, 70))
  const fromJob = String((await one(`${ext('c3', `, p_job_id => ${lit(root)}::uuid`)} as id`)).id)
  const derived = String((await one(`select correlation_id::text as c from public.activity_events where activity_id = ${lit(fromJob)}::uuid`)).c)
  check('M1: the correlation is taken from the job', derived === corr, derived)
  const review = await refused(`select app.record_external_activity(p_office => ${lit(grant)}::uuid, p_worker => 'hermes', p_event_type => 'external.review_decided', p_idempotency_key => 'rv-${run}', p_summary => 'x')`)
  check('M1: a worker cannot assert that a person reviewed something', review.includes('may not be reported by an external worker'), review.slice(0, 70))
  await db.execute(`do $$ begin for i in 1 .. 300 loop perform app.record_external_activity(p_office => ${lit(grant)}::uuid, p_worker => 'floods', p_event_type => 'external.usage_recorded', p_idempotency_key => 'f-' || i || '-${run}', p_summary => 'x'); end loop; end $$`)
  const over = await refused(`select app.record_external_activity(p_office => ${lit(grant)}::uuid, p_worker => 'floods', p_event_type => 'external.usage_recorded', p_idempotency_key => 'f-999-${run}', p_summary => 'x')`)
  const replay = await refused(`select app.record_external_activity(p_office => ${lit(grant)}::uuid, p_worker => 'floods', p_event_type => 'external.usage_recorded', p_idempotency_key => 'f-1-${run}', p_summary => 'x')`)
  const otherWorker = await refused(`select app.record_external_activity(p_office => ${lit(grant)}::uuid, p_worker => 'quiet', p_event_type => 'external.usage_recorded', p_idempotency_key => 'q-1-${run}', p_summary => 'x')`)
  check('M1: a worker is limited per hour, a retry of an accepted report is not refused, and another worker is unaffected', over.includes('hourly limit') && replay === '' && otherWorker === '', `over: ${over.slice(0, 50)} / replay: ${replay || 'accepted'} / other: ${otherWorker || 'accepted'}`)

  // ---------------------------------------------------------------------------------------------- M2: the redactor is bounded
  const t0 = performance.now()
  const long = String((await one(`select length(app.activity_redact(repeat('a-', 40000))) as n`)).n)
  const redactMs = performance.now() - t0
  check('M2: redacting an 80 000 character string takes well under a second and returns at most 4 000 characters', redactMs < 1000 && Number(long) <= 4000, `${redactMs.toFixed(0)} ms, ${long} chars`)

  // ---------------------------------------------------------------------------------------------- L7: native writer edges
  const future = await refused(`select app.record_activity(p_office => ${lit(grant)}::uuid, p_event_type => 'system.recovered', p_idempotency_key => 'fut-${run}', p_actor_kind => 'system', p_actor => 'worker', p_summary => 's', p_occurred_at => now() + interval '90 days')`)
  check('L7: an activity cannot be dated in the future', future.includes('future'), future.slice(0, 60))
  const budgetId = String((await one(`select app.record_activity(p_office => ${lit(grant)}::uuid, p_event_type => 'budget.threshold_reached', p_idempotency_key => 'bud-${run}', p_actor_kind => 'system', p_actor => 'worker', p_summary => 'Threshold', p_metadata => '{"prompt_tokens": 5000, "token_budget": 100000, "api_token": "x"}'::jsonb) as id`)).id)
  const bm = json((await one(`select metadata as m from public.activity_events where activity_id = ${lit(budgetId)}::uuid`)).m)
  check('L7: token COUNTS survive the cleaner and a token-named key is still blanked', bm.prompt_tokens === 5000 && bm.token_budget === 100000 && bm.api_token === '[redacted:key]', JSON.stringify(bm))
  const failEvent = (await read(grant, { p_job: root, p_visibility: 'user', p_limit: 200 })).events as Ev[]
  check('L8: an ordinary reader is not shown a failure reason, only a diagnostic reader is', failEvent.every((e) => e.metadata?.reason === undefined), 'no reason at user visibility')

  // ---------------------------------------------------------------------------------------------- Hermes: there is no write door over HTTP
  const door = await one(`select
      (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('record_activity', 'record_activity_safely', 'record_external_activity')) as wrappers,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname in ('record_activity', 'record_activity_safely', 'record_external_activity')
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))) as reachable,
      has_schema_privilege('service_role', 'app', 'usage') as svc_usage,
      has_schema_privilege('anon', 'app', 'usage') or has_schema_privilege('authenticated', 'app', 'usage') as public_usage`)
  check('Hermes: no public wrapper exists for any activity writer, so PostgREST (the only door a key reaches) cannot call one', Number(door.wrappers) === 0, `${door.wrappers} wrappers`)
  check('Hermes: no HTTP role can execute an activity writer, and none has usage on the schema they live in', Number(door.reachable) === 0 && door.svc_usage === false && door.public_usage === false, `executable by an http role: ${door.reachable}; usage service ${door.svc_usage} public ${door.public_usage}`)
  const hermesReaders = await one(`select count(*) as c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'activity\\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)
  check('Hermes: the activity readers are not executable by a public key either', Number(hermesReaders.c) === 0, `${hermesReaders.c} public-key-executable readers`)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
