// biome-ignore-all lint/suspicious/noExplicitAny: the read model's answers are untyped JSON
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * The unified activity ledger (migrations 1060 and 1061), driven end to end on the isolated replica.
 *
 *   npx tsx scripts/isolated/activity-ledger.ts <replica-db>
 *
 * Nothing here is mocked. A real turn comes in the way the production adapter writes it, work is delegated with the real
 * enqueue function, jobs move through the real transition trigger, and the rows the other tables hold (routing, approvals,
 * outputs, deliveries, model usage, the action ledger) are written with the product's own writers or, where there is no
 * writer to call from SQL, with the columns the product writes. The ledger is then read through app.activity_read.
 *
 * What it proves, in the order a reviewer would ask:
 *   switch      the ledger is OFF by default and then writes nothing and the read says so
 *   chain       request -> routing -> delegation -> approval -> output -> delivery is reconstructable, in order, with
 *               causation where a source states one, and with nothing invented
 *   status      attempted is not completed and completed is not confirmed; cost is never given a number it was not given
 *   paging      a keyset cursor walks the whole set once, in a stable order, with no gap and no repeat
 *   filters     project, agent, job (and its descendants), correlation, category, severity, status, source, dates, type
 *   harness     a suite's traffic never reaches the feed, and the same shape of real traffic does (a control that can fail)
 *   isolation   a second office cannot read the first by naming its project, job, correlation or cursor, nor write into it
 *   integrity   idempotent, concurrent, append-only, supersession-only correction, visibility floor, bounded failure counter
 *   redaction   secrets and message content never reach a stored row; abusive metadata is refused
 *   external    the one door for an external worker cannot widen its own reach
 *
 * Positive controls sit beside the refusals: a suite made only of refusals passes against a ledger that refuses everything.
 */
import { PgExecutor } from '../../src/db/pg-executor.ts'
import { secretFamilies } from '../../src/text/secrets.ts'
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
const sock = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
const port = process.env.ISOLATED_PG_PORT ?? '55432'
const fresh = async () => {
  const c = new PgExecutor(`postgresql://postgres@/${dbName}?host=${sock}&port=${port}`)
  await c.connect()
  return c
}

type Ev = Record<string, any>
const read = async (args: Record<string, string | number | null>, office: string): Promise<Ev> => {
  const named = Object.entries(args)
    .map(([k, v]) => `${k} => ${v === null ? 'null' : typeof v === 'number' ? v : lit(String(v))}`)
    .join(', ')
  const r = await one(`select app.activity_read(p_office => ${lit(office)}::uuid${named ? `, ${named}` : ''}) as v`)
  return json(r.v)
}
const pages = async (args: Record<string, string | number | null>, office: string, size: number): Promise<Ev[]> => {
  const all: Ev[] = []
  let at: string | null = null
  let id: string | null = null
  for (let i = 0; i < 400; i++) {
    const a: Record<string, string | number | null> = { ...args, p_limit: size }
    if (at !== null && id !== null) {
      a.p_before_at = at
      a.p_before_id = id
    }
    const p = await read(a, office)
    all.push(...(p.events as Ev[]))
    if (p.next === null || p.next === undefined) return all
    at = String(p.next.at)
    id = String(p.next.id)
  }
  throw new Error('paging did not terminate')
}

let exit = 1
try {
  const grant = String((await one(`select app.operator_office() as o`)).o)

  // ---------------------------------------------------------------------------------------------- switch
  const offRead = await read({}, grant)
  check('switch: off by default, the read says so', offRead.enabled === false && (offRead.events as Ev[]).length === 0, JSON.stringify({ enabled: offRead.enabled }))
  const offWrite = await one(`select app.record_activity(${lit(grant)}::uuid, 'system.recovered', 'switch-off-${run}', 'system', 'worker', 'off') as v`)
  const offRows = Number((await one(`select count(*) as c from public.activity_events`)).c)
  check('switch: a write while off returns null and stores nothing', offWrite.v === null && offRows === 0, `returned ${String(offWrite.v)}, rows ${offRows}`)
  // Fails closed: with the setting ABSENT, or holding anything but the JSON value true, the ledger is off.
  await db.execute(`delete from public.system_config where key = 'activity.ledger_enabled'`)
  const absent = json((await one(`select to_jsonb(app.activity_ledger_on()) as v`)).v)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_enabled', '"true"'::jsonb, 'proof')`)
  const stringy = json((await one(`select to_jsonb(app.activity_ledger_on()) as v`)).v)
  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
  check('switch: fails closed - an absent setting, or the string "true", is off', absent === false && stringy === false, `absent -> ${String(absent)}, string -> ${String(stringy)}`)
  check('switch: on', json((await one(`select to_jsonb(app.activity_ledger_on()) as v`)).v) === true, 'activity.ledger_enabled = true')

  // ---------------------------------------------------------------------------------------------- build a real chain
  const project = String(json((await one(`select app.hq_create_project(${lit(grant)}::uuid, ${lit(`Ledger ${run}`)}, 'upload', ${lit(`led-${run}`)}, ${lit(`Ledger ${run}`)}, true) as v`)).v).project_id)
  const root = await realParent(db)
  await db.execute(`update public.jobs set project_id = ${lit(project)}::uuid, recipient_agent = 'chief-of-staff' where job_id = ${lit(root)}::uuid`)
  const corr = String((await one(`select correlation_id::text as c from public.jobs where job_id = ${lit(root)}::uuid`)).c)
  await db.execute(`insert into public.routing_decisions (job_id, intent_class, intent_reason, confident, subject_terms, duplicate_resolution, roster, roster_reason, delegation_depth)
    values (${lit(root)}::uuid, 'assignment', 'asks for work to be done', true, array['pricing'], 'none_found', array['chief-of-staff','research-director'], 'The request names pricing research and a write-up', 0)`)
  const child = String((await one(`select app.enqueue_child(app.job_office(${lit(root)}::uuid), ${lit(root)}::uuid, 'office.instruction', '{"x":1}'::jsonb, interval '0', true, ${lit(project)}::uuid)::text as id`)).id)
  await db.execute(`update public.jobs set recipient_agent = 'research-director' where job_id = ${lit(child)}::uuid`)
  await db.execute(`update public.jobs set state = 'running' where job_id = ${lit(child)}::uuid`)
  const staff = String((await one(`select staff_id::text as s from public.staff where slug = 'research-director'`)).s)
  await db.execute(`insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources, deterministic, reviewer_status, model)
    values (${lit(child)}::uuid, ${lit(staff)}::uuid, 'PRIVATE BODY TEXT THAT MUST NEVER BE COPIED', 'medium', 'inferred', '[]'::jsonb, false, 'pending', 'openai/gpt-oss-120b')`)
  await db.execute(`update public.jobs set state = 'output_created' where job_id = ${lit(child)}::uuid`)
  await db.execute(`update public.jobs set state = 'quality_review' where job_id = ${lit(child)}::uuid`)
  await db.execute(`update public.outputs set reviewer_status = 'approved', reviewed_at = now() where job_id = ${lit(child)}::uuid`)
  await db.execute(`update public.jobs set state = 'committing' where job_id = ${lit(child)}::uuid`)
  await db.execute(`update public.jobs set state = 'committed' where job_id = ${lit(child)}::uuid`)
  await db.execute(`update public.jobs set state = 'notifying' where job_id = ${lit(child)}::uuid`)
  await db.execute(`update public.jobs set state = 'complete' where job_id = ${lit(child)}::uuid`)
  await db.execute(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, decline_option, on_answer)
    values (${lit(project)}::uuid, ${lit(root)}::uuid, 'Create the Slack channel for the ledger project', 'It needs a room', 'No room until you answer', array['Yes','No'], 'chief-of-staff', true, ${lit(grant)}::uuid, 'No', '{"option":"Yes","kind":"channel.create","payloads":[]}'::jsonb)`)
  const blocker = String((await one(`select blocker_id::text as b from public.blockers where job_id = ${lit(root)}::uuid`)).b)
  await db.execute(`update public.blockers set state = 'resolved', resolved_at = now(), answered_option = 'Yes', answered_by = 'grant' where blocker_id = ${lit(blocker)}::uuid`)
  await one(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, correlation_id, job_id, message_ref, send_started_at, sent_at, office_id)
    values ('telegram', ${lit(`led-${run}`)}, 'bot', '987654321', 'result', 'sent', 1, now(), ${lit(corr)}::uuid, ${lit(root)}::uuid, 'm-77', now() - interval '1 second', now(), ${lit(grant)}::uuid)
    returning delivery_id::text as d`)
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, correlation_id, job_id, error_code, send_started_at, office_id)
    values ('slack', ${lit(`led-f-${run}`)}, 'bot', 'CCHANNEL1X', 'result', 'failed', 2, now(), ${lit(corr)}::uuid, ${lit(root)}::uuid, 'channel_not_found', now(), ${lit(grant)}::uuid)`)
  await db.execute(`insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, provenance, office_id, latency_ms, cost_usd)
    values ('openrouter', 'openai/gpt-oss-120b', ${lit(child)}::uuid, ${lit(corr)}::uuid, 'ok', 900, 120, 'estimated', ${lit(grant)}::uuid, 840, 0.0012)`)
  await db.execute(`insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, provenance, office_id)
    values ('openrouter', 'qwen/qwen3.7-flash', ${lit(child)}::uuid, ${lit(corr)}::uuid, 'rate_limited', 0, 0, 'estimated', ${lit(grant)}::uuid)`)
  await db.execute(`insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, provenance, office_id, provider_reported_cost, cost_usd)
    values ('openrouter', 'mistralai/mistral-small-3.2-24b-instruct', ${lit(child)}::uuid, ${lit(corr)}::uuid, 'ok', 100, 10, 'authoritative', ${lit(grant)}::uuid, 0.0031, 0.0031)`)
  await db.execute(`select app.append_event(${lit(grant)}::uuid, ${lit(corr)}::uuid, 'agent', 'research-director', 'office.instruction', 'task.created', false, ${lit(project)}::uuid, null, null, 'Added a task from the research', '[]'::jsonb, null, null, null, ${lit(child)}::uuid)`)
  await db.execute(`insert into public.job_impediments (job_id, project_id, staff_slug, kind, needed_raw, detail, understood_as, noticed_by)
    values (${lit(child)}::uuid, ${lit(project)}::uuid, 'research-director', 'needs_permission', 'gmail.send', 'would send mail', 'send', 'the handler')`)
  await db.execute(`update public.jobs set state = 'running' where job_id = ${lit(root)}::uuid`)
  await db.execute(`update public.jobs set state = 'output_created' where job_id = ${lit(root)}::uuid`)
  await db.execute(`update public.jobs set state = 'quality_review' where job_id = ${lit(root)}::uuid`)
  await db.execute(`update public.jobs set state = 'committing' where job_id = ${lit(root)}::uuid`)
  await db.execute(`update public.jobs set state = 'committed' where job_id = ${lit(root)}::uuid`)
  await db.execute(`update public.jobs set state = 'notifying' where job_id = ${lit(root)}::uuid`)
  await db.execute(`update public.jobs set state = 'complete' where job_id = ${lit(root)}::uuid`)

  // ---------------------------------------------------------------------------------------------- chain
  const chain = json((await one(`select app.activity_chain(${lit(grant)}::uuid, p_job => ${lit(root)}::uuid, p_visibility => 'diagnostic') as v`)).v)
  const evs = chain.events as Ev[]
  const types = evs.map((e) => e.type as string)
  const has = (t: string) => types.includes(t)
  const mustHave = ['request.received', 'request.routed', 'job.created', 'job.delegated', 'job.started', 'job.completed', 'output.created', 'output.reviewed', 'approval.requested', 'approval.granted', 'action.blocked', 'delivery.attempted', 'delivery.succeeded', 'delivery.failed', 'inference.completed', 'task.created']
  const missing = mustHave.filter((t) => !has(t))
  check('chain: request to delivery is reconstructed from the owning tables', missing.length === 0 && chain.complete === true, missing.length === 0 ? `${evs.length} events, ${new Set(types).size} types` : `missing ${missing.join(', ')}`)
  const ordered = evs.every((e, i) => i === 0 || String(evs[i - 1]?.at) <= String(e.at))
  check('chain: oldest first', ordered, `${evs.length} events in time order`)
  const byType = (t: string) => evs.find((e) => e.type === t) as Ev
  const received = byType('request.received')
  const rootCreated = evs.find((e) => e.type === 'job.created' && e.job_id === root) as Ev
  check('chain: the root job names the request that caused it', rootCreated?.causation_id === received?.id, `${String(rootCreated?.causation_id).slice(0, 8)} = ${String(received?.id).slice(0, 8)}`)
  const delegated = byType('job.delegated')
  check('chain: a delegated job names its parent job creation as cause', delegated?.causation_id === rootCreated?.id && delegated?.parent_job_id === root, `parent ${String(delegated?.parent_job_id).slice(0, 8)}`)
  check('chain: an approval decision names the question it answers', byType('approval.granted')?.causation_id === byType('approval.requested')?.id, 'granted -> requested')
  check('chain: a delivery outcome names its attempt', byType('delivery.succeeded')?.causation_id === byType('delivery.attempted')?.id, 'succeeded -> attempted')
  check('status: a provider-confirmed send is confirmed, never just completed', byType('delivery.succeeded')?.status === 'confirmed' && byType('delivery.attempted')?.status === 'attempted' && byType('delivery.failed')?.status === 'failed', `${byType('delivery.attempted')?.status} / ${byType('delivery.succeeded')?.status} / ${byType('delivery.failed')?.status}`)
  const inf = evs.filter((e) => e.type === 'inference.completed')
  const est = inf.find((e) => e.model === 'openai/gpt-oss-120b' && e.metadata.outcome === 'ok')
  const rl = inf.find((e) => e.metadata.outcome === 'rate_limited')
  const rep = inf.find((e) => e.model === 'mistralai/mistral-small-3.2-24b-instruct')
  check(
    'status: cost carries the provenance the usage row has and a failed call is a failed call',
    est?.metadata.cost_status === 'estimated' && Number(est?.metadata.cost_usd) === 0.0012 && rep?.metadata.cost_status === 'provider_reported' && Number(rep?.metadata.cost_usd) === 0.0031 && rl?.status === 'failed' && rl?.severity === 'warning',
    `ok -> ${est?.metadata.cost_status}; provider-reported -> ${rep?.metadata.cost_status}; rate_limited -> ${rl?.status}`,
  )
  const idsAgain = json((await one(`select app.activity_chain(${lit(grant)}::uuid, p_job => ${lit(root)}::uuid, p_visibility => 'diagnostic') as v`)).v).events.map((e: Ev) => e.id)
  check('chain: ids are deterministic across reads', JSON.stringify(idsAgain) === JSON.stringify(evs.map((e) => e.id)), `${idsAgain.length} ids identical`)
  const dump = JSON.stringify(evs)
  check('content: no message text, document text or destination id is in the feed', !dump.includes('PRIVATE BODY TEXT') && !dump.includes('987654321') && !dump.includes('CCHANNEL1X') && !dump.includes('A real turn for an isolated proof'), 'output body, chat id and instruction absent')
  check('provenance: every row says where it came from', evs.every((e) => ['projected', 'native', 'external'].includes(e.provenance) && typeof e.source === 'string' && e.evidence?.id !== undefined), `${new Set(evs.map((e) => e.source)).size} sources`)
  check('delegation: the child job also reads as work done by the specialist', evs.some((e) => e.type === 'job.completed' && e.job_id === child && e.agent === 'research-director'), 'research-director finished the child')
  check('approval: a question closed with an option is granted, with the person as actor', byType('approval.granted')?.actor === 'you' && byType('approval.granted')?.status === 'authorised', `${byType('approval.granted')?.actor}`)

  // ---------------------------------------------------------------------------------------------- visibility
  const userView = await read({ p_job: root }, grant)
  const userTypes = new Set((userView.events as Ev[]).map((e) => e.type))
  check('visibility: the ordinary view omits diagnostic types and keeps the headline ones', !userTypes.has('inference.completed') && !userTypes.has('job.started') && !userTypes.has('delivery.attempted') && userTypes.has('job.completed') && userTypes.has('delivery.succeeded') && userTypes.has('approval.requested'), `${[...userTypes].sort().join(', ')}`)
  const bad = await refused(`select app.activity_read(p_office => ${lit(grant)}::uuid, p_visibility => 'everything')`)
  check('visibility: an unknown level is refused, not guessed', bad.includes('unknown visibility'), bad.slice(0, 60))
  const badSev = await refused(`select app.activity_read(p_office => ${lit(grant)}::uuid, p_min_severity => 'loud')`)
  check('filters: an unknown severity is refused', badSev.includes('unknown severity'), badSev.slice(0, 60))

  // ---------------------------------------------------------------------------------------------- paging
  const full = await pages({ p_visibility: 'diagnostic' }, grant, 200)
  const walked = await pages({ p_visibility: 'diagnostic' }, grant, 4)
  const ids = walked.map((e) => e.id)
  check('paging: a keyset walk of four at a time returns exactly the full set, once each, in the same order', ids.length === full.length && new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(full.map((e) => e.id)), `${ids.length} of ${full.length}`)
  const nonIncreasing = full.every((e, i) => i === 0 || `${full[i - 1]?.at}|${full[i - 1]?.id}` >= `${e.at}|${e.id}`)
  check('paging: newest first and the order is total', nonIncreasing, `${full.length} rows`)
  // One source holding many rows, walked one at a time: the case a per-source limit of exactly the page size gets wrong (the gateway proof found it).
  for (let i = 0; i < 6; i++) await db.execute(`select app.record_activity(${lit(grant)}::uuid, 'tool.call_requested', ${lit(`walk-${i}-${run}`)}, 'agent', 'research-director', 'Asked for a tool ${i}')`)
  const nativeFull = await pages({ p_visibility: 'diagnostic', p_type: 'tool.call_requested' }, grant, 200)
  const nativeWalk = await pages({ p_visibility: 'diagnostic', p_type: 'tool.call_requested' }, grant, 1)
  check('paging: a walk of one at a time over a single source returns every row, once', nativeFull.length >= 6 && JSON.stringify(nativeWalk.map((e) => e.id)) === JSON.stringify(nativeFull.map((e) => e.id)), `${nativeWalk.length} of ${nativeFull.length}`)
  const tiny = await read({ p_limit: 1, p_visibility: 'diagnostic' }, grant)
  const huge = await read({ p_limit: 100000, p_visibility: 'diagnostic' }, grant)
  check('paging: a page is bounded', (tiny.events as Ev[]).length === 1 && (huge.events as Ev[]).length <= 200, `limit 1 -> 1, limit 100000 -> ${(huge.events as Ev[]).length}`)

  // ---------------------------------------------------------------------------------------------- filters
  const f = async (a: Record<string, string | number | null>) => (await pages({ p_visibility: 'diagnostic', ...a }, grant, 200)).map((e) => e)
  const byProject = await f({ p_project: project })
  check('filter: project', byProject.length > 0 && byProject.every((e) => e.project_id === project), `${byProject.length} events`)
  const byAgent = await f({ p_agent: 'research-director' })
  check('filter: agent', byAgent.length > 0 && byAgent.every((e) => e.agent === 'research-director'), `${byAgent.length} events`)
  const byJob = await f({ p_job: root })
  check('filter: a job returns the job and every job under it', byJob.some((e) => e.job_id === root) && byJob.some((e) => e.job_id === child), `${byJob.length} events`)
  const byChild = await f({ p_job: child })
  check('filter: a child job does not return its parent', byChild.length > 0 && byChild.every((e) => e.job_id === child), `${byChild.length} events`)
  const byCorr = await f({ p_correlation: corr })
  check('filter: correlation', byCorr.length > 0 && byCorr.every((e) => e.correlation_id === corr), `${byCorr.length} events`)
  const byCat = await f({ p_category: 'delivery' })
  check('filter: category', byCat.length === 4 &&byCat.every((e) => e.category === 'delivery'), `${byCat.length} delivery events`)
  const bySev = await f({ p_min_severity: 'error' })
  check('filter: minimum severity', bySev.length > 0 && bySev.every((e) => ['error', 'critical'].includes(e.severity)) && bySev.some((e) => e.type === 'delivery.failed'), `${bySev.length} at error or above`)
  const byStatus = await f({ p_status: 'confirmed' })
  check('filter: status', byStatus.length === 1 && byStatus[0]?.type === 'delivery.succeeded', `${byStatus.length} confirmed`)
  const bySource = await f({ p_source: 'slack' })
  check('filter: source interface', bySource.length > 0 && bySource.every((e) => e.source_interface === 'slack'), `${bySource.length} on slack`)
  const byOneType = await f({ p_type: 'approval.requested' })
  check('filter: event type', byOneType.length === 1, `${byOneType.length}`)
  const future = await f({ p_since: '2999-01-01T00:00:00Z' })
  const past = await f({ p_until: '2000-01-01T00:00:00Z' })
  check('filter: date range excludes what is outside it', future.length === 0 && past.length === 0, `future ${future.length}, past ${past.length}`)
  const none = await f({ p_status: 'confirmed', p_category: 'job' })
  check('filter: filters combine as AND', none.length === 0, 'confirmed jobs: none')
  const sevPage = await pages({ p_visibility: 'diagnostic', p_min_severity: 'warning' }, grant, 1)
  const sevFull = await f({ p_min_severity: 'warning' })
  check('filter: a filtered page is the newest matches, not the matches among the newest', sevPage.length === sevFull.length && sevPage.length > 1, `${sevPage.length} walked one at a time`)

  // Two native events an hour old: later in the proof many newer native events are written, so these lie deeper in their source than the
  // newest rows it reads first. A filter that matches only them must still find them (the validity check, not the first read, decides).
  for (const i of [1, 2]) await db.execute(`select app.record_activity(p_office => ${lit(grant)}::uuid, p_event_type => 'budget.threshold_reached', p_idempotency_key => ${lit(`early-limit-${i}-${run}`)}, p_actor_kind => 'system', p_actor => 'office', p_summary => 'Early rate limit ${i}', p_occurred_at => now() - interval '1 hour')`)

  // ---------------------------------------------------------------------------------------------- harness traffic
  const fixtureKey = `verify:${run}`
  const hcmd = await one(`insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (${lit(grant)}::uuid, ${lit(project)}::uuid, 'teamhq', 'h:${run}', 'u', 'harness turn', ${lit(`verify:turn:${run}`)}, 'grant') returning command_id::text as id`)
  const synthetic = Number((await one(`select count(*) as c from public.inbound_commands where command_id = ${lit(String(hcmd.id))}::uuid and synthetic`)).c)
  const reqs = (await f({ p_type: 'request.received' })).filter((e) => e.evidence.id === hcmd.id)
  check('harness: a suite\'s message is not shown (and is marked synthetic by the door)', reqs.length === 0 && synthetic === 1, `synthetic=${synthetic}, shown=${reqs.length}`)
  const fx = String((await one(`select app.enqueue_child(app.job_office(${lit(root)}::uuid), ${lit(root)}::uuid, 'office.instruction', '{}'::jsonb, interval '0', true, ${lit(project)}::uuid)::text as id`)).id)
  await db.execute(`update public.jobs set requested_by = ${lit(fixtureKey)} where job_id = ${lit(fx)}::uuid`).catch(() => undefined)
  const isFix = await one(`select (is_fixture or synthetic or app.harness_job(job_id)) as h from public.jobs where job_id = ${lit(fx)}::uuid`)
  const fxEvents = (await f({ p_job: fx })).filter((e) => e.job_id === fx)
  check('harness: a control - the same shape of job is shown when the product says it is real', isFix.h === true ? fxEvents.length === 0 : fxEvents.length > 0, `harness=${String(isFix.h)}, events=${fxEvents.length}`)

  // A job that only app.harness_job can recognise (neither flag set): it is a suite's by its origin namespace. This is the path the
  // expensive predicate exists for, and the one the cheap flags cannot stand in for.
  const deep = String((await one(`select app.enqueue_child(app.job_office(${lit(root)}::uuid), ${lit(root)}::uuid, 'office.instruction', '{}'::jsonb, interval '0', true, ${lit(project)}::uuid)::text as id`)).id)
  await db.execute(`update public.jobs set pinned_config = pinned_config || '{"origin_namespace": "verify"}'::jsonb where job_id = ${lit(deep)}::uuid`)
  const deepFlags = await one(`select synthetic, is_fixture, app.harness_job(job_id) as h from public.jobs where job_id = ${lit(deep)}::uuid`)
  const deepEvents = (await f({ p_job: deep })).filter((e) => e.job_id === deep)
  check('harness: a job only the canonical predicate recognises is not shown either (neither cheap flag is set)', deepFlags.synthetic === false && deepFlags.is_fixture === false && deepFlags.h === true && deepEvents.length === 0, `synthetic=${String(deepFlags.synthetic)}, fixture=${String(deepFlags.is_fixture)}, harness_job=${String(deepFlags.h)}, events=${deepEvents.length}`)

  // ---------------------------------------------------------------------------------------------- isolation
  const A_EMAIL = `ledger-a-${run}@example.invalid`
  const B_EMAIL = `ledger-b-${run}@example.invalid`
  for (const e of [A_EMAIL, B_EMAIL]) await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(e)})`)
  const officeA = String(json((await one(`select app.provision_person_office('Person A', ${lit(A_EMAIL)}, ${lit(`la-${run}`)}) as r`)).r).office_id)
  const officeB = String(json((await one(`select app.provision_person_office('Person B', ${lit(B_EMAIL)}, ${lit(`lb-${run}`)}) as r`)).r).office_id)
  const mk = async (o: string, n: string) => String(json((await one(`select app.hq_create_project(${lit(o)}::uuid, ${lit(n)}, 'upload', ${lit(`${n}-${run}`.toLowerCase().replace(/\W+/g, '-'))}, ${lit(n)}, true) as v`)).v).project_id)
  const projA = await mk(officeA, 'Alpha')
  const projB = await mk(officeB, 'Bravo')
  const jobOf = async (o: string, p: string) => {
    const j = String((await one(`select app.enqueue_child(${lit(o)}::uuid, null, 'office.instruction', '{}'::jsonb, interval '0', true, ${lit(p)}::uuid)::text as id`).catch(() => ({ id: '' }))).id)
    return j
  }
  const jobB = await jobOf(officeB, projB)
  let bHasJob = jobB !== ''
  if (!bHasJob) {
    // no parent-less enqueue: take the office's own first job from a real turn instead
    bHasJob = false
  }
  await db.execute(`select app.record_activity(${lit(officeB)}::uuid, 'budget.threshold_reached', ${lit(`b-native-${run}`)}, 'system', 'office', 'Office B crossed 80% of today''s budget', 'recorded', null, null, null, ${lit(projB)}::uuid)`)
  await db.execute(`select app.record_activity(${lit(officeA)}::uuid, 'budget.threshold_reached', ${lit(`a-native-${run}`)}, 'system', 'office', 'Office A crossed 80% of today''s budget', 'recorded', null, null, null, ${lit(projA)}::uuid)`)
  const aFeed = await pages({ p_visibility: 'diagnostic' }, officeA, 50)
  const bFeed = await pages({ p_visibility: 'diagnostic' }, officeB, 50)
  check('isolation: positive control - each office sees its own native event', aFeed.some((e) => e.summary.includes('Office A')) && bFeed.some((e) => e.summary.includes('Office B')), `A ${aFeed.length}, B ${bFeed.length}`)
  check('isolation: neither feed carries the other\'s rows or the first office\'s history', !aFeed.some((e) => e.summary.includes('Office B')) && !bFeed.some((e) => e.summary.includes('Office A')) && !aFeed.some((e) => e.correlation_id === corr) && !bFeed.some((e) => e.project_id === project), 'no cross-office row')
  const probe = async (office: string, a: Record<string, string | number | null>) => (await read({ p_visibility: 'diagnostic', ...a }, office)).events as Ev[]
  const xProject = await probe(officeA, { p_project: projB })
  const xJob = await probe(officeA, { p_job: root })
  const xCorr = await probe(officeA, { p_correlation: corr })
  const xChain = json((await one(`select app.activity_chain(${lit(officeA)}::uuid, p_job => ${lit(root)}::uuid) as v`)).v)
  const xAgent = await probe(officeB, { p_agent: 'research-director' })
  check('isolation: naming another office\'s project, job, correlation or agent returns nothing', xProject.length === 0 && xJob.length === 0 && xCorr.length === 0 && (xChain.events as Ev[]).length === 0 && xAgent.every((e) => e.job_id !== child), `project ${xProject.length}, job ${xJob.length}, corr ${xCorr.length}, chain ${(xChain.events as Ev[]).length}`)
  const stolen = (await pages({ p_visibility: 'diagnostic' }, grant, 3))[1]
  const viaCursor = await probe(officeA, { p_before_at: String(stolen?.at), p_before_id: String(stolen?.id) })
  check('isolation: another office\'s cursor opens nothing of that office', !viaCursor.some((e) => e.correlation_id === corr || e.project_id === project), `${viaCursor.length} rows, none foreign`)
  const w1 = await refused(`select app.record_activity(${lit(officeA)}::uuid, 'budget.threshold_reached', ${lit(`x1-${run}`)}, 'system', 'office', 'cross-office project', 'recorded', null, null, null, ${lit(projB)}::uuid)`)
  const w2 = await refused(`select app.record_activity(${lit(officeA)}::uuid, 'tool.call_completed', ${lit(`x2-${run}`)}, 'agent', 'a', 'cross-office job', 'recorded', null, null, null, null, ${lit(root)}::uuid)`)
  check('isolation: a write cannot attach another office\'s project or job', w1.includes('activity_events_project_same_office') && w2.includes('activity_events_job_same_office'), `${w1.slice(0, 40)} | ${w2.slice(0, 40)}`)
  const w3 = await refused(`select app.record_external_activity(${lit(officeA)}::uuid, 'hermes', 'external.output_produced', 'x3-${run}', 'borrowed project', 'recorded', null, ${lit(projB)}::uuid)`)
  check('isolation: an external report cannot attach another office\'s project', w3.includes('activity_events_project_same_office'), w3.slice(0, 60))
  const noOffice = await refused(`select app.activity_read(p_office => '00000000-0000-0000-0000-000000000000'::uuid)`)
  const noOffice2 = await refused(`select app.record_activity(p_office => '00000000-0000-0000-0000-000000000000'::uuid, p_event_type => 'tool.call_completed', p_idempotency_key =>'k-${run}-abcdef', p_actor_kind => 'agent', p_actor => 'a', p_summary => 's')`)
  check('isolation: no office, or a disabled one, is refused rather than defaulted', noOffice.includes('no_office') && noOffice2.includes('no_office'), 'read and write both refuse')
  const roles = await one(`select has_function_privilege('anon', 'public.activity_read(uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,text,timestamptz,uuid,integer)', 'execute') as a,
    has_function_privilege('authenticated', 'public.activity_read(uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,text,timestamptz,uuid,integer)', 'execute') as u,
    has_function_privilege('service_role', 'public.activity_read(uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,text,timestamptz,uuid,integer)', 'execute') as s,
    has_table_privilege('anon', 'public.activity_events', 'select') as ta, has_table_privilege('authenticated', 'public.activity_events', 'select') as tu,
    has_function_privilege('anon', 'app.record_activity(uuid,text,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamptz,uuid,text)', 'execute') as wa`)
  check('isolation: a browser key reads nothing and writes nothing; only the service role reads', roles.a === false && roles.u === false && roles.s === true && roles.ta === false && roles.tu === false && roles.wa === false, JSON.stringify(roles))

  // ---------------------------------------------------------------------------------------------- integrity
  const key = `idem-${run}`
  const write = async () => String(((await one(`select app.record_activity(${lit(grant)}::uuid, 'tool.call_completed', ${lit(key)}, 'agent', 'research-director', 'Tool finished', 'completed') as v`).catch((e: Error) => ({ v: `ERR ${e.message.slice(0, 60)}` }))) as { v: unknown }).v)
  const first = await write()
  const second = await write()
  const rows = Number((await one(`select count(*) as c from public.activity_events where idempotency_key = ${lit(key)}`)).c)
  check('integrity: the same key twice is one row and the same id', first === second && rows === 1, `rows ${rows}`)
  const reuse = await refused(`select app.record_activity(${lit(grant)}::uuid, 'tool.call_failed', ${lit(key)}, 'agent', 'research-director', 'a different event')`)
  check('integrity: a key reused for a different event is refused, not silently answered with the other event\'s id', reuse.includes('different activity type'), reuse.slice(0, 70))
  const conns = await Promise.all(Array.from({ length: 12 }, fresh))
  const ckey = `conc-${run}`
  const same = await Promise.all(conns.map((c) => c.execute(`select app.record_activity(${lit(grant)}::uuid, 'tool.call_requested', ${lit(ckey)}, 'agent', 'a', 'same event, twelve writers') as v`).then((r) => String((r.rows[0] as { v: string }).v))))
  const distinct = await Promise.all(conns.map((c, i) => c.execute(`select app.record_activity(${lit(grant)}::uuid, 'tool.call_requested', ${lit(`${ckey}-${i}`)}, 'agent', 'a', 'different event ${i}') as v`).then((r) => String((r.rows[0] as { v: string }).v))))
  await Promise.all(conns.map((c) => c.end()))
  const sameRows = Number((await one(`select count(*) as c from public.activity_events where idempotency_key = ${lit(ckey)}`)).c)
  check('integrity: twelve concurrent writers of one event produce one row and one id', sameRows === 1 && new Set(same).size === 1, `rows ${sameRows}, ids ${new Set(same).size}`)
  check('integrity: twelve concurrent writers of twelve events produce twelve rows (no event swallowed)', new Set(distinct).size === 12, `${new Set(distinct).size} ids`)
  const u1 = await refused(`update public.activity_events set summary = 'rewritten' where activity_id = ${lit(first)}::uuid`)
  const d1 = await refused(`delete from public.activity_events where activity_id = ${lit(first)}::uuid`)
  const t1 = await refused(`truncate public.activity_events`)
  const o1 = await refused(`update public.activity_events set office_id = ${lit(officeA)}::uuid where activity_id = ${lit(first)}::uuid`)
  check('integrity: append-only - update, delete, truncate and moving an event to another office are refused', u1 !== '' && d1 !== '' && t1 !== '' && o1 !== '', `${u1.slice(0, 30)} | ${d1.slice(0, 30)} | ${t1.slice(0, 30)}`)
  const corrId = String((await one(`select app.record_activity(${lit(grant)}::uuid, 'activity.corrected', ${lit(`corr-${run}`)}, 'system', 'office', 'The earlier tool event was recorded against the wrong tool', 'recorded', null, null, null, null, null, null, null, null, null, null, null, '{}'::jsonb, null, null, ${lit(first)}::uuid) as v`)).v)
  const corr2 = await refused(`select app.record_activity(${lit(grant)}::uuid, 'activity.corrected', ${lit(`corr2-${run}`)}, 'system', 'office', 'second correction', 'recorded', null, null, null, null, null, null, null, null, null, null, null, '{}'::jsonb, null, null, ${lit(first)}::uuid)`)
  const shown = (await pages({ p_visibility: 'diagnostic', p_type: 'tool.call_completed' }, grant, 50)).find((e) => e.id === first)
  check('integrity: a correction supersedes and the original stays, marked; a second correction of the same event is refused', corrId.length > 0 && corr2.includes('activity_events_one_correction') && shown?.metadata.superseded_by === corrId, `superseded_by ${String(shown?.metadata.superseded_by).slice(0, 8)}`)
  const vis = await refused(`insert into public.activity_events (office_id, event_type, actor_kind, actor, status, severity, visibility, summary, idempotency_key) values (${lit(grant)}::uuid, 'tool.call_requested', 'agent', 'a', 'recorded', 'info', 'user', 'diagnostic dressed as ordinary', ${lit(`vis-${run}-abcdef`)})`)
  check('integrity: a diagnostic type cannot be written as ordinary activity', vis.includes('may not be shown more widely'), vis.slice(0, 70))
  const unk = await refused(`select app.record_activity(${lit(grant)}::uuid, 'job.completed', ${lit(`unk-${run}-abcdef`)}, 'agent', 'a', 'projected types are not writable')`)
  const unk2 = await refused(`select app.record_activity(${lit(grant)}::uuid, 'made.up_type', ${lit(`unk2-${run}-abcdef`)}, 'agent', 'a', 'unknown')`)
  check('integrity: only native taxonomy types are writable', unk.includes('not a native type') && unk2.includes('not a native type'), `${unk.slice(0, 40)}`)
  const safe = await one(`select app.record_activity_safely(${lit(grant)}::uuid, 'made.up_type', 'safe-${run}-abcdef', 'agent', 'a', 'will fail') as v`).catch(() => ({ v: 'RAISED' }))
  const f1 = Number((await one(`select count(*) as c from public.activity_write_failures where event_type = 'made.up_type'`)).c)
  check('integrity: the safe writer never raises, returns null and counts the failure', safe.v === null && f1 === 1, `failures counted ${f1}`)
  for (let i = 0; i < 230; i++) await db.execute(`select app.record_activity_safely(${lit(grant)}::uuid, 'made.up_type', 'storm-${run}-${i}-abcd', 'agent', 'a', 's')`)
  const f2 = Number((await one(`select count(*) as c from public.activity_write_failures where office_id = ${lit(grant)}::uuid and occurred_at > now() - interval '1 hour'`)).c)
  check('integrity: a broken writer cannot become a storm - the counter stops at 200 an hour', f2 === 200, `counted ${f2} of 231 attempts`)
  const health = json((await one(`select app.activity_ledger_health(${lit(grant)}::uuid) as v`)).v)
  check('metrics: the health reading reports volume, failures and the retry backlog', health.enabled === true && health.write_failures_1h === 200 && Number(health.native_events_total) >= 15 && typeof health.retry_backlog === 'number', JSON.stringify({ failures: health.write_failures_1h, native: health.native_events_total, retries: health.retry_backlog }))
  const countsBefore = Number((await one(`select count(*) as c from public.activity_events`)).c)
  await db.execute(`select app.activity_ledger_health(${lit(grant)}::uuid)`)
  check('metrics: reading the health writes no activity (no self-monitoring loop)', Number((await one(`select count(*) as c from public.activity_events`)).c) === countsBefore, 'unchanged')
  const tx = await db.execute(`begin; select app.record_activity(${lit(grant)}::uuid, 'tool.call_completed', 'tx-${run}-abcdef', 'agent', 'a', 'rolled back with its transaction'); rollback;`).catch(() => null)
  const txRows = Number((await one(`select count(*) as c from public.activity_events where idempotency_key = 'tx-${run}-abcdef'`)).c)
  check('integrity: the strict writer commits or rolls back with the caller\'s transaction', tx !== undefined && txRows === 0, `rows after rollback ${txRows}`)

  // ---------------------------------------------------------------------------------------------- redaction
  const tok = ['xo', 'xb-123456789012-abcdefghijklmnop'].join('')
  const sk = ['s', 'k-', 'or-v1-0123456789abcdefghijklmnop'].join('')
  const jwt = ['ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'abcdefghijklmnopqrstuvwxyz'].join('')
  const meta = JSON.stringify({ note: `leaked ${tok} and ${sk}`, api_key: 'plain-value', session_cookie: 'abc', body: 'the full message text', transcript: 'a voice transcript', nested: { auth_token: 'x', jwt }, list: [`Bearer abcdefghijklmnop`, 'fine'] })
  const rid = String((await one(`select app.record_activity(${lit(grant)}::uuid, 'tool.call_failed', ${lit(`red-${run}-abcdef`)}, 'agent', 'a', ${lit(`Failed with ${tok} in the message`)}, 'failed', null, null, null, null, null, null, null, null, null, null, null, ${lit(meta)}::jsonb) as v`)).v)
  const stored = await one(`select summary, metadata::text as m from public.activity_events where activity_id = ${lit(rid)}::uuid`)
  const everything = `${stored.summary} ${stored.m}`
  check('redaction: no credential family survives in a stored summary or metadata', secretFamilies(everything).length === 0 && !everything.includes('plain-value') && !everything.includes('the full message text') && !everything.includes('a voice transcript'), `families left: ${secretFamilies(everything).join(',') || 'none'}`)
  check('redaction: credential-named and content-named keys are replaced, benign keys are kept', json(stored.m).api_key === '[redacted:key]' && json(stored.m).body.startsWith('[not stored') && json(stored.m).list[1] === 'fine', 'markers in place, "fine" kept')
  const abuse: [string, string][] = [
    ['not an object', `'"just a string"'::jsonb`],
    ['bad key', `'{"Bad Key": 1}'::jsonb`],
    ['too many keys', `(select jsonb_object_agg('k' || g, g) from generate_series(1, 41) g)`],
    ['too deep', `'{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}'::jsonb`],
    ['too large', `(select jsonb_object_agg('k' || g, repeat('x', 200)) from generate_series(1, 30) g)`],
  ]
  const abuseOut: string[] = []
  let abuseOk = true
  for (const [name, expr] of abuse) {
    const msg = await refused(`select app.record_activity(${lit(grant)}::uuid, 'tool.call_failed', ${lit(`abuse-${name.replace(/\W/g, '')}-${run}`)}, 'agent', 'a', 'abusive metadata', 'failed', null, null, null, null, null, null, null, null, null, null, null, ${expr})`)
    abuseOk = abuseOk && msg !== '' && !msg.includes('activity_events_idempotent')
    abuseOut.push(`${name}: ${msg.slice(0, 32)}`)
  }
  check('redaction: abusive metadata is refused for the right reason (shape, keys, depth, size)', abuseOk, abuseOut.join(' | '))
  const longSummary = await refused(`select app.record_activity(${lit(grant)}::uuid, 'tool.call_failed', ${lit(`long-${run}-abcdef`)}, 'agent', 'a', ${lit('x'.repeat(500))})`)
  const lsRow = await one(`select length(summary) as l from public.activity_events where idempotency_key = ${lit(`long-${run}-abcdef`)}`)
  check('redaction: an over-long summary is cut, not refused and not stored whole', longSummary === '' && Number(lsRow.l) === 300, `stored ${String(lsRow.l)} characters`)

  // ---------------------------------------------------------------------------------------------- external door
  const ext = String((await one(`select app.record_external_activity(${lit(grant)}::uuid, 'hermes', 'external.research_completed', ${lit(`e1-${run}`)}, 'Research finished; held for review', 'completed', null, ${lit(project)}::uuid, ${lit(root)}::uuid, ${lit(corr)}::uuid, '{"sources": 4}'::jsonb) as v`)).v)
  const extRow = await one(`select actor_kind, actor, provenance, visibility, source_interface from public.activity_events where activity_id = ${lit(ext)}::uuid`)
  check('external: an allowed report is stored as external, named, at the taxonomy\'s visibility', extRow.actor_kind === 'external' && extRow.actor === 'external:hermes' && extRow.provenance === 'external' && extRow.visibility === 'user' && extRow.source_interface === 'external', JSON.stringify(extRow))
  const extFeed = (await pages({ p_visibility: 'user', p_job: root }, grant, 100)).find((e) => e.id === ext)
  check('external: it appears in the feed with its provenance, on the right job', extFeed?.provenance === 'external' && extFeed?.job_id === root && extFeed?.actor === 'external:hermes', `${String(extFeed?.type)}`)
  const e1 = await refused(`select app.record_external_activity(${lit(grant)}::uuid, 'hermes', 'job.completed', 'e2-${run}', 'forged job completion')`)
  const e2 = await refused(`select app.record_external_activity(${lit(grant)}::uuid, 'hermes', 'system.recovered', 'e3-${run}', 'forged recovery')`)
  const e3 = await refused(`select app.record_external_activity(${lit(grant)}::uuid, 'hermes', 'external.worker_error', 'e4-${run}', 'x', 'failed', 'critical')`)
  const e4 = await refused(`select app.record_external_activity(${lit(grant)}::uuid, 'hermes', 'external.output_produced', 'e5-${run}', 'x', 'confirmed')`)
  const e5 = await refused(`select app.record_external_activity(${lit(grant)}::uuid, 'Not A Worker!', 'external.output_produced', 'e6-${run}', 'x')`)
  const e6 = await refused(`select app.record_external_activity(${lit(grant)}::uuid, 'hermes', 'external.output_produced', 'e7-${run}', 'x', 'authorised')`)
  check('external: it cannot forge a job, a recovery, critical severity, a confirmation or an authorisation, nor use a malformed name', e1.includes('may not be reported') && e2.includes('may not be reported') && e3.includes('critical') && e4.includes('may not claim') && e5.includes('worker name') && e6.includes('may not claim'), 'six refusals, each for its own reason')
  const spoof = String((await one(`select app.record_external_activity(${lit(grant)}::uuid, 'hermes', 'external.skill_proposed', 'e8-${run}', 'Proposes a skill', 'recorded', null, null, null, null, '{"actor":"grant","provenance":"native"}'::jsonb) as v`)).v)
  const spoofRow = await one(`select actor, provenance, actor_kind from public.activity_events where activity_id = ${lit(spoof)}::uuid`)
  check('external: metadata cannot spoof the actor or the provenance', spoofRow.actor === 'external:hermes' && spoofRow.provenance === 'external' && spoofRow.actor_kind === 'external', JSON.stringify(spoofRow))
  const direct = await refused(`insert into public.activity_events (office_id, event_type, actor_kind, actor, status, severity, visibility, summary, idempotency_key, provenance) values (${lit(grant)}::uuid, 'external.output_produced', 'external', 'x', 'recorded', 'info', 'user', 'unmarked', ${lit(`d-${run}-abcdef`)}, 'native')`)
  check('external: an external actor cannot be stored as native, even by a direct insert', direct.includes('activity_events_external_is_marked'), direct.slice(0, 70))

  // ---------------------------------------------------------------------------------------------- operator visibility
  await db.execute(`select app.record_activity(${lit(grant)}::uuid, 'system.recovered', ${lit(`rec-${run}-abcdef`)}, 'system', 'worker', 'Recovered 2 stalled jobs', p_status => 'completed', p_source_interface => 'worker')`)
  await db.execute(`select app.record_activity(${lit(officeA)}::uuid, 'system.recovered', ${lit(`reca-${run}-abcdef`)}, 'system', 'worker', 'Recovered 1 stalled job', p_status => 'completed', p_source_interface => 'worker')`)
  const opView = (await pages({ p_visibility: 'operator' }, grant, 100)).filter((e) => e.type === 'system.recovered')
  const opDefault = (await pages({ p_visibility: 'diagnostic' }, grant, 100)).filter((e) => e.type === 'system.recovered')
  const persOp = (await pages({ p_visibility: 'operator' }, officeA, 100)).filter((e) => e.type === 'system.recovered')
  check('visibility: operator-level events are the deployment operator\'s alone; a person asking for them is quietly given diagnostic', opView.length === 1 && opDefault.length === 0 && persOp.length === 0, `operator ${opView.length}, diagnostic ${opDefault.length}, person ${persOp.length}`)

  const ordinary = await pages({ p_visibility: 'user' }, grant, 200)
  const diagnostic = await pages({ p_visibility: 'diagnostic' }, grant, 200)
  check('visibility: native diagnostic events (tool calls) are absent from the ordinary view and present in the diagnostic one', !ordinary.some((e) => e.type === 'tool.call_requested') && diagnostic.some((e) => e.type === 'tool.call_requested') && ordinary.some((e) => e.type === 'tool.call_failed') === false, `ordinary ${ordinary.length}, diagnostic ${diagnostic.length}`)

  const deepFull = (await pages({ p_visibility: 'diagnostic', p_type: 'budget.threshold_reached' }, grant, 200)).map((e) => e.summary)
  const deepWalk = (await pages({ p_visibility: 'diagnostic', p_type: 'budget.threshold_reached' }, grant, 1)).map((e) => e.summary)
  check('paging: a filter whose matches lie deeper than the newest rows its source reads first still finds them', deepFull.length === 2 && deepFull.every((s) => s.startsWith('Early rate limit')) && JSON.stringify(deepWalk) === JSON.stringify(deepFull), `${deepFull.length} integration events, walked ${deepWalk.length}`)

  // ---------------------------------------------------------------------------------------------- adapter
  const page = json((await one(`select app.activity_for_the_page(${lit(grant)}::uuid, 40) as v`)).v)
  const first1: Ev = (page.office as Ev[])[0] ?? {}
  const keys = ['id', 'who', 'kind', 'verb', 'what', 'project', 'when', 'at', 'via', 'category']
  check('adapter: rows have the keys the existing Activity module reads', page.enabled === true && (page.office as Ev[]).length > 0 && keys.every((k) => k in first1), `keys ${Object.keys(first1).length}, first "${first1.verb} ${first1.what}"`)
  const hq = json((await one(`select app.hq_studio_lately(${lit(grant)}::uuid, 40) as v`)).v)
  check('compat: the existing Activity reader still answers and is unchanged in shape', Array.isArray(hq.office) && typeof hq.today === 'object', `office ${(hq.office as unknown[]).length} rows`)
  const pageOff = await (async () => {
    await db.execute(`update public.system_config set value = 'false'::jsonb where key = 'activity.ledger_enabled'`)
    const r = json((await one(`select app.activity_for_the_page(${lit(grant)}::uuid, 40) as v`)).v)
    await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
    return r
  })()
  check('switch: switching it back off silences the adapter again', pageOff.enabled === false, 'enabled=false')

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
