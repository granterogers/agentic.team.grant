// biome-ignore-all lint/suspicious/noExplicitAny: the read model's answers are untyped JSON
// biome-ignore-all lint/style/noNonNullAssertion: a measurement script over rows it has just created
// biome-ignore-all format: a dense measurement script kept readable as written
/**
 * Does a quiet office's Activity read get slower because OTHER offices are busy? (phase 8, F3; migrations 1060 and 1061)
 *
 *   npx tsx scripts/isolated/activity-scaling.ts <replica-db> [template-jobs=500] [noise-copies=0,2,8] [--report-only]
 *   (the figures in the release documents come from: ... 1200 0,1,4,16 --report-only, with SMALL_JOBS=3 or 60)
 *
 * A template office is seeded through the product's writers; a SMALL office gets a modest copy of it; then unrelated offices are filled by
 * copying the template into them (set-based, disposable replica only) and the small office's reads are measured after each step.
 * Reports p50 and p95 for six reads and the scaling trend. It ASSERTS shape only (never a wall-clock figure):
 *   - the small office's rows are identical at every noise level (the same events in the same order), and none belongs to another office;
 *   - with --expect-flat, the p50 at the highest noise level is within a stated multiple of the p50 at none.
 */
import { ensureActivityIndexes } from '../../src/activity/indexes.ts'
import { cloneVolume } from './activity-scale-seed.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const dbName = process.argv[2] ?? 'ledger'
const TEMPLATE_JOBS = Number(process.argv[3] ?? 500)
const LEVELS = (process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : '0,2,8').split(',').map(Number)
// The gate runs this with no arguments, so flatness is asserted unless it is asked to only report (a larger run for a document).
const EXPECT_FLAT = !process.argv.includes('--report-only')
const MAX_RATIO = Number(process.env.SCALING_MAX_RATIO ?? 2.5)
const db = await isolated(dbName)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, any>
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

let exit = 1
try {
  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.ledger_offices', '{"version":1,"mode":"all"}'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  await ensureActivityIndexes(db)
  const run = Date.now().toString(36)
  const grant = String((await one(`select app.operator_office() as o`)).o)
  const root = await realParent(db)
  const gproject = String((await one(`select project_id::text as p from public.jobs where job_id = ${lit(root)}::uuid`)).p)

  // ---- the template office (Grant's), seeded through the product's own enqueue and transition path
  await db.execute(`select app.enqueue_child(app.job_office(${lit(root)}::uuid), ${lit(root)}::uuid, 'office.instruction', '{}'::jsonb, interval '0', true, ${lit(gproject)}::uuid) from generate_series(1, ${TEMPLATE_JOBS})`)
  const chain = ['running', 'output_created', 'quality_review', 'committing', 'committed', 'notifying', 'complete']
  for (let i = 0; i < chain.length; i++) {
    const from = i === 0 ? 'queued' : chain[i - 1]
    const extra = i === 0 ? `, recipient_agent = (array['research-director','finance-director','chief-of-staff'])[1 + (abs(hashtext(job_id::text)) % 3)]` : ''
    await db.execute(`update public.jobs set state = '${chain[i]}'${extra} where parent_job_id = ${lit(root)}::uuid and state = '${from}'`)
  }
  await db.execute(`update public.jobs set state = 'failed' where parent_job_id = ${lit(root)}::uuid and abs(hashtext(job_id::text)) % 12 = 0 and state = 'complete'`).catch(() => undefined)
  await db.execute(`insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, provenance, office_id, latency_ms, cost_usd, occurred_at)
    select 'openrouter', 'openai/gpt-oss-120b', j.job_id, j.correlation_id, 'ok', 800, 100, 'estimated', j.office_id, 700, 0.001, j.updated_at from public.jobs j, generate_series(1, 4) g where j.parent_job_id = ${lit(root)}::uuid`)
  // the other job-keyed sources: an output and a routing decision for every job, an impediment for one in ten, a throttle for one in ten
  const firstLabel = async (typ: string) => String((await one(`select enumlabel as l from pg_enum where enumtypid = ${lit(`public.${typ}`)}::regtype order by enumsortorder limit 1`)).l)
  const [conf, evid, rstat, dres] = [await firstLabel('confidence_level'), await firstLabel('evidence_type'), await firstLabel('reviewer_status'), await firstLabel('duplicate_resolution')]
  await db.execute(`insert into public.outputs (job_id, body, confidence, evidence, reviewer_status, created_at)
    select j.job_id, 'An answer', ${lit(conf)}::public.confidence_level, ${lit(evid)}::public.evidence_type, ${lit(rstat)}::public.reviewer_status, j.updated_at from public.jobs j where j.parent_job_id = ${lit(root)}::uuid`)
  await db.execute(`insert into public.routing_decisions (job_id, intent_class, confident, intent_reason, subject_terms, duplicate_resolution, roster, roster_reason, delegation_depth, decided_at)
    select j.job_id, 'question', true, 'r', array['x'], ${lit(dres)}::public.duplicate_resolution, array['research-director'], 'a reason long enough', 1, j.created_at from public.jobs j where j.parent_job_id = ${lit(root)}::uuid`)
  await db.execute(`insert into public.job_impediments (job_id, kind, needed_raw, noticed_by, created_at)
    select j.job_id, 'needs_permission', 'a permission', 'the handler', j.updated_at from public.jobs j where j.parent_job_id = ${lit(root)}::uuid and abs(hashtext(j.job_id::text)) % 10 = 0`)
  await db.execute(`insert into public.job_pauses (job_id, at, reason, detail, resume_when, resumable)
    select j.job_id, j.updated_at, 'rate_limited', 'a throttle', 'later', true from public.jobs j where j.parent_job_id = ${lit(root)}::uuid and abs(hashtext(j.job_id::text)) % 10 = 1`)
  await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, correlation_id, job_id, message_ref, send_started_at, sent_at, office_id)
    select 'telegram', 'tpl-' || j.job_id::text, 'bot', '1386648496', 'result', 'sent', 1, now(), j.correlation_id, j.job_id, 'm-' || substr(j.job_id::text, 1, 8), j.updated_at, j.updated_at, j.office_id from public.jobs j where j.parent_job_id = ${lit(root)}::uuid`)

  // ---- the small office and three unrelated ones
  const mk = async (name: string, tag: string) => {
    const email = `scale-${tag}-${run}@example.invalid`
    await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
    const office = String(json((await one(`select app.provision_person_office(${lit(name)}, ${lit(email)}, ${lit(`sc${tag}-${run}`)}) as r`)).r).office_id)
    const project = String((await one(`select app.unnamed_project(${lit(office)}::uuid) as p`)).p)
    return { office, project }
  }
  const small = await mk('Small office', 's')
  const noise = [await mk('Busy one', 'n1'), await mk('Busy two', 'n2'), await mk('Busy three', 'n3')]
  const smallRows = await cloneVolume(db, grant, small.office, small.project, 1, Number(process.env.SMALL_JOBS ?? 3))
  console.log(`     small office: ${JSON.stringify(smallRows)}`)
  // a few native events for the small office, so the mix holds both kinds
  for (let i = 0; i < 30; i++) {
    await db.execute(`select app.record_activity(p_office => ${lit(small.office)}::uuid, p_event_type => 'tool.call_completed', p_idempotency_key => ${lit(`sm-${run}-${i}`)}, p_actor_kind => 'agent', p_actor => 'research-director', p_summary => ${lit(`Native ${i}`)}, p_agent_slug => 'research-director')`)
  }

  const reads: [string, string][] = [
    ['newest 50, ordinary', `p_visibility => 'user'`],
    ['newest 50, diagnostic', `p_visibility => 'diagnostic'`],
    ['severity >= error', `p_visibility => 'user', p_min_severity => 'error'`],
    ['one agent', `p_visibility => 'diagnostic', p_agent => 'research-director'`],
    ['status completed', `p_visibility => 'user', p_status => 'completed'`],
    ['source filter (deliveries)', `p_visibility => 'diagnostic', p_source => 'deliveries'`],
  ]
  const measure = async (office: string) => {
    const out: Record<string, { p50: number; p95: number }> = {}
    for (const [label, args] of reads) {
      const xs: number[] = []
      for (let i = 0; i < 9; i++) {
        const t = performance.now()
        await db.execute(`select app.activity_read(p_office => ${lit(office)}::uuid, ${args}, p_limit => 50)`)
        xs.push(performance.now() - t)
      }
      xs.shift() // the first read pays the page-in
      out[label] = { p50: pct(xs, 50), p95: pct(xs, 95) }
    }
    return out
  }
  const fingerprint = async (office: string) => {
    const r = json((await one(`select app.activity_read(p_office => ${lit(office)}::uuid, p_visibility => 'diagnostic', p_limit => 200) as v`)).v)
    return { ids: (r.events as any[]).map((e) => String(e.id)), partial: r.partial === true, offices: 1 }
  }

  let copies = 0
  const table: { level: number; noiseTransitions: number; m: Record<string, { p50: number; p95: number }> }[] = []
  let baseline: string[] | null = null
  for (const level of LEVELS) {
    while (copies < level) {
      const n = noise[copies % noise.length]!
      await cloneVolume(db, grant, n.office, n.project, 1)
      copies++
    }
    // Production's autovacuum analyses after about a tenth of a table has changed, so the planner's statistics lag a burst of writes: NO_ANALYZE=1
    // measures that window (the statistics are those of the first level while the data keeps growing).
    if (process.env.NO_ANALYZE !== '1' || level === LEVELS[0]) await db.execute(`analyze public.jobs, public.job_state_transitions, public.outputs, public.deliveries, public.inference_usage`)
    const nt = Number((await one(`select count(*) as c from public.job_state_transitions t join public.jobs j on j.job_id = t.job_id where j.office_id <> ${lit(small.office)}::uuid`)).c)
    const m = await measure(small.office)
    table.push({ level, noiseTransitions: nt, m })
    const fp = await fingerprint(small.office)
    if (baseline === null) baseline = fp.ids
    check(`level ${level}: the small office's newest 200 events are the same events in the same order as at the first level`, JSON.stringify(fp.ids) === JSON.stringify(baseline), `${fp.ids.length} events, partial ${fp.partial}`)
    const foreign = Number((await one(`select count(*) as c from public.jobs j where j.office_id <> ${lit(small.office)}::uuid and j.job_id::text = any (select jsonb_array_elements_text(coalesce(jsonb_path_query_array(app.activity_read(p_office => ${lit(small.office)}::uuid, p_visibility => 'diagnostic', p_limit => 200), '$.events[*].job_id'), '[]'::jsonb)))`)).c)
    check(`level ${level}: no event of the small office names a job of another office`, foreign === 0, `${foreign} foreign jobs`)
  }

  console.log(`\n     small office reads (ms, p50 / p95) against unrelated offices' job transitions`)
  console.log(`     ${'noise transitions'.padEnd(18)}${reads.map(([l]) => l.slice(0, 22).padEnd(24)).join('')}`)
  for (const row of table) console.log(`     ${String(row.noiseTransitions).padEnd(18)}${reads.map(([l]) => `${row.m[l]!.p50.toFixed(0)} / ${row.m[l]!.p95.toFixed(0)}`.padEnd(24)).join('')}`)
  const first = table[0]!
  const last = table[table.length - 1]!
  const ratios = reads.map(([l]) => ({ l, r: last.m[l]!.p50 / Math.max(first.m[l]!.p50, 1) }))
  console.log(`     p50 ratio, highest noise over none: ${ratios.map((x) => `${x.l.slice(0, 14)} x${x.r.toFixed(2)}`).join('; ')}`)
  const worst = Math.max(...ratios.map((x) => x.r))
  if (EXPECT_FLAT) check(`scaling: a small office's read does not grow with unrelated offices' volume (worst p50 ratio ${worst.toFixed(2)} for ${(last.noiseTransitions / Math.max(first.noiseTransitions, 1)).toFixed(0)}x the unrelated transitions)`, worst <= MAX_RATIO, `limit ${MAX_RATIO}`)
  else console.log(`     (no --expect-flat: reporting only; worst p50 ratio ${worst.toFixed(2)})`)

  // ---- THE READ TIME BOUND (phase 8, F2), on the busiest of the unrelated offices (its own history is large)
  const busy = noise[0]!
  const refusedWith = async (sql: string, c = db): Promise<{ ms: number; said: string }> => {
    const t = performance.now()
    try {
      await c.execute(sql)
      return { ms: performance.now() - t, said: '' }
    } catch (e) {
      return { ms: performance.now() - t, said: (e as Error).message }
    }
  }
  // the interface filter is pushed into every source (phase 8): it must return exactly what filtering the whole history afterwards returns
  {
    const readIds = async (args: string) => (json((await one(`select app.activity_read(p_office => ${lit(busy.office)}::uuid, p_visibility => 'diagnostic', p_limit => 200${args}) as v`)).v).events as any[])
    const all = await readIds('')
    const tg = await readIds(`, p_source => 'telegram'`)
    const nonsense = await readIds(`, p_source => 'no-such-interface'`)
    const expected = all.filter((e) => e.source_interface === 'telegram').map((e) => e.id)
    check(`source filter: the pushed-down interface filter returns exactly the telegram events of the whole history, in order (${expected.length} of the newest ${all.length} are telegram)`, expected.length > 0 && JSON.stringify(tg.slice(0, expected.length).map((e) => e.id)) === JSON.stringify(expected) && tg.every((e) => e.source_interface === 'telegram'), `${tg.length} returned`)
    check('source filter: an interface nothing carries answers an empty page at once (not partial), instead of reading every source to its cap', nonsense.length === 0, `${nonsense.length} events`)
  }

  console.log(`\n     the time bound`)
  const viaFunctionSet = await refusedWith(`create or replace function public.zz_slow_set() returns int language plpgsql set statement_timeout = '100ms' as $$ begin perform pg_sleep(1); return 1; end $$; select public.zz_slow_set()`)
  await db.execute(`drop function if exists public.zz_slow_set()`)
  check('root cause: a function-level statement_timeout does NOT interrupt the running call (a one second sleep under a 100 ms setting finished)', viaFunctionSet.said === '' && viaFunctionSet.ms >= 900, `${viaFunctionSet.ms.toFixed(0)} ms, ${viaFunctionSet.said || 'no error'}`)
  const slowRead = `select app.activity_read(p_office => ${lit(busy.office)}::uuid, p_status => 'scheduled', p_visibility => 'diagnostic', p_limit => 50)`
  const untimed = await refusedWith(slowRead)
  console.log(`     the slow read with the default 8 s budget: ${untimed.ms.toFixed(0)} ms, ${untimed.said === '' ? 'answered' : untimed.said.slice(0, 80)}`)
  await db.execute(`insert into public.system_config (key, value, description) values ('activity.read_budget_ms', '60'::jsonb, 'proof') on conflict (key) do update set value = excluded.value`)
  const budgeted = await refusedWith(slowRead)
  check('budget: with a 60 ms budget a read that would need wider passes is REFUSED between passes, with PT504, not answered', /ran out of time/.test(budgeted.said), `${budgeted.ms.toFixed(0)} ms: ${budgeted.said.slice(0, 90)}`)
  check('budget: the refusal comes in the time of one pass, not of the whole widening', budgeted.ms < Math.max(untimed.ms, 1) * 0.8 || untimed.ms < 300, `${budgeted.ms.toFixed(0)} ms against ${untimed.ms.toFixed(0)} ms unbounded`)
  check('budget: the refusal names no office, project or row of anybody (numbers and a hint only)', !new RegExp(`${busy.office}|${small.office}|${grant}`).test(budgeted.said), budgeted.said.slice(0, 120))
  const easy = await refusedWith(`select app.activity_read(p_office => ${lit(small.office)}::uuid, p_limit => 50)`)
  check('budget: a read that is valid on its first pass is never refused, however small the budget (positive control)', easy.said === '', easy.said.slice(0, 80) || `${easy.ms.toFixed(0)} ms`)
  const wrote = await refusedWith(`select app.record_activity(p_office => ${lit(small.office)}::uuid, p_event_type => 'tool.call_completed', p_idempotency_key => ${lit(`after-timeout-${run}`)}, p_actor_kind => 'agent', p_actor => 'research-director', p_summary => 'written after a timed-out read', p_agent_slug => 'research-director')`)
  check('budget: a timed-out read leaves writes working', wrote.said === '', wrote.said.slice(0, 80) || 'written')
  await db.execute(`delete from public.system_config where key = 'activity.read_budget_ms'`)
  const again = await refusedWith(slowRead)
  check('budget: removing the setting restores the default (the slow read answers again)', !/ran out of time/.test(again.said), `${again.ms.toFixed(0)} ms ${again.said.slice(0, 60)}`)
  // the hard bound, armed the only way PostgreSQL arms one: by the caller, in a statement BEFORE the call
  const sock = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
  const port = process.env.ISOLATED_PG_PORT ?? '55432'
  const { PgExecutor } = await import('../../src/db/pg-executor.ts')
  const c2 = new PgExecutor(`postgresql://postgres@/${dbName}?host=${sock}&port=${port}`)
  await c2.connect()
  try {
    const hard = await refusedWith(`begin; set local statement_timeout = '150ms'; ${slowRead}; rollback`, c2)
    check('hard bound: a statement_timeout armed by the CALLER before the call cancels the running read (57014), which is what a pre-request setting would do', /statement timeout|canceling/i.test(hard.said) && hard.ms < 1500, `${hard.ms.toFixed(0)} ms: ${hard.said.slice(0, 80)}`)
    await refusedWith(`rollback`, c2)
    const after = await refusedWith(`select 1`, c2)
    const other = await refusedWith(`select app.activity_read(p_office => ${lit(small.office)}::uuid, p_limit => 50)`)
    check('hard bound: after a cancelled read the connection and every other session carry on', after.said === '' && other.said === '', `${after.said || 'same connection ok'}; ${other.said || 'other session ok'}`)
  } finally {
    await c2.end().catch(() => undefined)
  }

  const failed = results.filter((r) => !r).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)
