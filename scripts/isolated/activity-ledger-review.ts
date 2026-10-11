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
import { PgExecutor } from '../../src/db/pg-executor.ts'
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
  const child = (kind: string, parent: string) => one(`select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, 'office.instruction', '{"x":1}'::jsonb, interval '0', true, ${lit(project)}::uuid)::text as id`).then((r) => String(r.id))
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

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
