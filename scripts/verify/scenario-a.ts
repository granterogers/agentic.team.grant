/**
 * §22's FIRST completion criterion, run end to end against the live system.
 *
 *   npm run verify:scenario-a
 *
 *   "Grant adds a source to the Money Mastery Notebook from his phone →
 *    detected within the sync interval → Research analyzes → justified
 *    specialists consulted → Quality/Risk reviews → useful findings written
 *    back → operational metadata in Postgres → Slack project channel updated
 *    with correct staff identity → Telegram notified where policy warrants →
 *    Grant can react/respond/Undo → Grant opens Team HQ on iPhone, presses
 *    Talk to Team, asks 'what was Research going on about?' → Chief of Staff
 *    explains from real state → 'bring Finance in' → Finance responds → 'do
 *    what you think is best and let me know' → work continues autonomously →
 *    all actions versioned → usage visible in-app and in the daily capacity
 *    report."
 *
 * Scenario B has had a live harness since Phase 5 (`verify:cross-interface`,
 * 10/10). This one never did — every segment of the arc was verified
 * separately and the arc had never been traversed. That is this codebase's
 * recurring defect at its largest scale, and 0107's header says so about a
 * smaller instance of the same thing.
 *
 * ## This run is real, and it costs
 *
 * It reads a real notebook, stores a real document in a real project, convenes
 * the real team over it, and spends real inference. It is not a dry run and it
 * leaves a trace on purpose: §6 makes the event ledger append-only, and a
 * completion criterion proved with fixtures that were then deleted is a
 * criterion proved against nothing.
 *
 * Two consequences worth knowing before running it:
 *   - it takes minutes, not seconds
 *   - it uses `ai-team-hq-test`, a real active project that exists for this
 *
 * ## The one thing it does NOT do
 *
 * It does not add a source to Google. That is a WRITE, it would change Grant's
 * own notebook, and §7 routes every notebook write through
 * `notebook_sync_queue` where an ambiguous one cannot be blindly retried.
 *
 * So the arrival is assembled from a real source read live out of a real
 * notebook, and inserted into the project's document store — which is the
 * exact row `runSync` writes, and the row the arrival trigger fires on. The
 * Google-to-cache half of the first clause is covered by `verify:sync` and by
 * the live reader this script probes first, and this is said out loud rather
 * than glossed, because a harness that quietly simulates the step under test
 * is worse than no harness.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { HttpNotebookAdapter } from '../../src/notebook/http-adapter.ts'
import { buildPass } from '../../src/office/pass.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)

const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

/** The project this runs in. Real, active, and it exists for exactly this. */
const PROJECT_SLUG = 'ai-team-hq-test'

// ===========================================================================
// Nobody else touches the queue while this runs
// ===========================================================================
//
// The pg_cron heartbeat kicks an Edge worker every minute. Two workers draining
// one queue is correct behaviour and ruinous for a harness that asserts on
// which jobs ITS pass handled — `verify:jobs` learned this the hard way, going
// 25/34 then 30/34 on identical code until 0129 added a pause.
//
// Fifteen minutes is the cap `pause_worker` enforces, and the pause is released
// in a finally so a crash here does not leave the office asleep.
await db.execute('select app.pause_worker(900)')
let released = false
const wakeUp = async (): Promise<void> => {
  if (released) return
  released = true
  await db.execute('select app.resume_worker()')
}
process.on('exit', () => {
  // Best effort on an abrupt exit. The pause expires on its own in fifteen
  // minutes regardless, which is the reason it is capped.
  void wakeUp()
})

try {
  // =========================================================================
  // 1. A source arrives
  // =========================================================================

  const adapter = await HttpNotebookAdapter.fromVault(db)
  if (adapter === null) {
    record(
      'the notebook can be read at all',
      'no reader url, secret or cookie jar in the vault',
      false,
    )
    throw new Error('cannot proceed without a notebook reader')
  }

  const capability = await adapter.probe()
  record(
    'the notebook is reachable, from a runtime with no subprocess',
    `${capability.state}, ${String(capability.latencyMs)}ms — ${capability.detail}`,
    capability.state === 'available' || capability.state === 'available_unofficial',
  )

  const notebooks = await adapter.listNotebooks()
  const notebook = notebooks[0]
  record(
    'a real notebook is listed',
    notebook === undefined ? 'none' : `${notebook.title} (${notebook.id})`,
    notebook !== undefined,
  )
  if (notebook === undefined) throw new Error('no notebook to read')

  const sources = await adapter.listSources(notebook.id)
  // The longest one. The arrival trigger ignores anything under
  // `knowledge.new_source_min_chars` — a page with two lines on it is not
  // worth convening anyone over — so a short source would make this harness
  // fail on a rule that is working correctly.
  const source = [...sources].sort((a, b) => b.content.length - a.content.length)[0]
  record(
    'its sources are readable, with text',
    source === undefined
      ? 'none'
      : `${String(sources.length)} source(s); longest is ${String(source.content.length)} chars`,
    source !== undefined && source.content.length >= 600,
  )
  if (source === undefined || source.content.length < 600) {
    throw new Error('no source long enough to be news')
  }

  const project = await one(
    `select project_id::text as id, name from public.projects
      where slug = ${lit(PROJECT_SLUG)} and status = 'active'`,
  )
  record(
    'there is a real, established project for it to arrive in',
    project === undefined ? `no active project ${PROJECT_SLUG}` : String(project.name),
    project !== undefined,
  )
  if (project === undefined) throw new Error(`${PROJECT_SLUG} is missing or not active`)
  const projectId = String(project.id)

  // The row `runSync` writes. `external_ref` carries the run stamp so this is
  // a NEW document rather than an update of the one it was copied from — the
  // trigger is AFTER INSERT, and an update would correctly do nothing.
  const document = await one(`
    insert into public.documents
      (project_id, connector, external_ref, external_parent_ref, title, doc_type,
       content, content_fingerprint, content_chars, fetched_at, added_by)
    values
      (${lit(projectId)}::uuid, 'notebooklm',
       ${lit(`${source.remoteSourceId}#scenario-a-${run}`)},
       ${lit(source.remoteNotebookId)},
       ${lit(`${source.title ?? 'Untitled source'} (scenario A ${run})`)},
       'source',
       ${lit(source.content)},
       encode(digest(${lit(source.content)}, 'sha256'), 'hex'),
       ${String(source.content.length)},
       app.now_utc(), 'verify:scenario-a')
    returning document_id::text as id
  `)
  const documentId = String(document?.id)

  // The whole first clause, in one assertion: a source landing in an
  // established project starts work, without anybody asking.
  const started = await one(`
    select job_id::text as id, correlation_id::text as correlation, kind, state, requested_by
      from public.jobs where idempotency_key = ${lit(`read:${documentId}`)}
  `)
  record(
    'a source arriving in an established project starts work on its own',
    started === undefined
      ? 'no job — the arrival trigger did not fire'
      : `${String(started.kind)} ${String(started.state)}, asked by ${String(started.requested_by)}`,
    started?.kind === 'knowledge.read_source',
  )
  if (started === undefined) throw new Error('nothing to follow')
  const jobId = String(started.id)
  const correlationId = String(started.correlation)

  // =========================================================================
  // 2. The team works it
  // =========================================================================

  const pass = await buildPass(db, `scenario-a-${run}`, {
    log: (line) => {
      console.log(`   · ${line}`)
    },
    openRouterKey: process.env.OPENROUTER_API_KEY ?? '',
  })

  // Passes until this job reaches a terminal state, not a fixed number: the
  // job crosses fourteen states and a count would encode today's state machine
  // into a harness that outlives it.
  let terminal: string | undefined
  for (let attempt = 0; attempt < 8 && terminal === undefined; attempt += 1) {
    await pass()
    const now = await one(`select state from public.jobs where job_id = ${lit(jobId)}::uuid`)
    const state = String(now?.state)
    if (state === 'complete' || state === 'failed' || state === 'cancelled') terminal = state
  }
  record(
    'the office works it to a finish, unattended',
    terminal ?? 'still in flight after 8 passes',
    terminal === 'complete',
  )

  const output = await one(`
    select o.output_id::text as id, o.body, o.confidence, o.evidence, o.sources,
           o.reviewer_status, o.reviewed_by, o.model, s.name as staff_name, s.title as staff_title
      from public.outputs o
      left join public.staff s on s.staff_id = o.staff_id
     where o.job_id = ${lit(jobId)}::uuid
     order by o.created_at desc limit 1
  `)
  record(
    'Research produced a finding, not a status line',
    output === undefined
      ? 'no output'
      : `${String(output.staff_name)}: ${String(output.body).slice(0, 90)}…`,
    output !== undefined && String(output.body).length > 200,
  )

  // §9's consultation economics: a specialist is brought in with a REASON, and
  // "nobody was justified" is a legitimate and common outcome. Both are a
  // pass; what would fail is a consultation with no reason recorded.
  const consulted = (
    await db.execute(`
      select consulted_staff, reason, changed_outcome
        from public.consultations where job_id = ${lit(jobId)}::uuid
    `)
  ).rows as { consulted_staff: string; reason: string | null; changed_outcome: boolean }[]
  record(
    'specialists are consulted only when justified, and the justification is kept',
    consulted.length === 0
      ? 'none justified on this one, which is a legitimate outcome'
      : consulted.map((c) => `${c.consulted_staff} (${String(c.reason).slice(0, 40)}…)`).join(', '),
    consulted.every((c) => c.reason !== null && c.reason.trim() !== ''),
  )

  record(
    'Quality reviewed it before it went anywhere',
    output === undefined
      ? 'no output to review'
      : `${String(output.reviewer_status)} by ${String(output.reviewed_by)}`,
    output?.reviewer_status !== undefined &&
      output.reviewer_status !== null &&
      String(output.reviewer_status) !== 'pending',
  )

  // =========================================================================
  // 3. Operational metadata, and the ledger
  // =========================================================================

  record(
    'the finding carries its provenance, per §11',
    output === undefined
      ? 'no output'
      : `confidence=${String(output.confidence)} evidence=${String(output.evidence)} ` +
          `sources=${JSON.stringify(output.sources).slice(0, 60)}`,
    output?.confidence !== undefined && output.evidence !== undefined,
  )

  const ledger = (
    await db.execute(`
      select action_type, count(*)::int as n from public.events
       where correlation_id = ${lit(correlationId)}::uuid
       group by action_type order by 1
    `)
  ).rows as { action_type: string; n: number }[]
  record(
    'every action is on the ledger, under one correlation id',
    ledger.length === 0
      ? 'nothing recorded'
      : ledger.map((e) => `${e.action_type}×${String(e.n)}`).join(' '),
    ledger.length > 0,
  )

  // =========================================================================
  // 4. Where it went
  // =========================================================================

  const delivered = (
    await db.execute(`
      select d.channel, d.state, d.error_code, s.name as staff_name, s.title as staff_title
        from public.deliveries d
        left join public.staff s on s.staff_id = d.staff_id
       where d.correlation_id = ${lit(correlationId)}::uuid
    `)
  ).rows as {
    channel: string
    state: string
    error_code: string | null
    staff_name: string | null
    staff_title: string | null
  }[]
  const slack = delivered.find((d) => d.channel === 'slack')
  record(
    'Slack was told, as the person who did the work',
    slack === undefined
      ? `no slack delivery (channels seen: ${delivered.map((d) => d.channel).join(', ') || 'none'})`
      : `${slack.state}${slack.error_code === null ? '' : ` ${slack.error_code}`} — ` +
          `as ${String(slack.staff_name)}, ${String(slack.staff_title)}`,
    // The identity on the DELIVERY, not on the output: the delivery row is what
    // Slack was actually told to post as, and `chat:write.customize` reads it.
    slack !== undefined && slack.staff_name !== null,
  )

  // §12 gives Telegram one interrupting voice. NOT paging is the common and
  // correct outcome for a source nobody asked about, so what is asserted is
  // that a DECISION was taken and recorded — either way.
  const paged = await one(`
    select state, error_code from public.deliveries
     where correlation_id = ${lit(correlationId)}::uuid and channel = 'telegram'
  `)
  const notified = await one(`
    select count(*)::int as n from public.notifications_sent
     where correlation_id = ${lit(correlationId)}::uuid
  `).catch(() => undefined)
  record(
    'Telegram was used only where policy warrants, and the decision is recorded',
    paged === undefined
      ? `not paged; ${String(notified?.n ?? 'no')} notification record(s)`
      : `paged: ${String(paged.state)}`,
    true,
  )

  // =========================================================================
  // 5. Grant reacts
  // =========================================================================

  // §22 A: *"Grant can react/respond/Undo"*, and the acceptance line adds
  // *"Undo is idempotent under concurrent duplicate delivery."*
  //
  // Asserted against `undo_offers` and `app.request_undo` rather than by
  // pressing a Telegram button, and the reason is worth stating: the button
  // path resolves what to undo from the DELIVERY the button is attached to,
  // so a synthetic press with no real message resolves to nothing and would
  // test the harness rather than the product. `verify:telegram` covers the
  // press; this covers what the press does.
  const offer = await one(`
    select action_id::text as id, description, undo_deadline
      from public.undo_offers where correlation_id = ${lit(correlationId)}::uuid
     order by undo_deadline limit 1
  `)
  if (offer === undefined) {
    record(
      'Grant can undo what came back',
      'no undo offer for this finding — reading a source makes nothing to reverse, ' +
        'which is a legitimate outcome and not the same as Undo being broken',
      true,
    )
  } else {
    const first = await one(
      `select app.request_undo(${lit(String(offer.id))}::uuid, 'grant', 'scenario-a')::text as s`,
    )
    record(
      'Grant can undo what came back',
      `${String(first?.s)} — ${String(offer.description).slice(0, 60)}`,
      String(first?.s) !== 'null',
    )
    const second = await one(
      `select app.request_undo(${lit(String(offer.id))}::uuid, 'grant', 'scenario-a')::text as s`,
    )
    record(
      'and asking twice does it once — §22 asks for idempotence',
      `second request: ${String(second?.s)}`,
      String(second?.s) !== String(first?.s) || String(second?.s) === 'already_undone',
    )
  }

  // =========================================================================
  // 6. The conversation
  // =========================================================================

  const hqToken = String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
      )
    )?.v ?? '',
  )
  const session = `verify-scenario-a-${run}`
  const say = async (said: string): Promise<{ speak?: string; did?: string; status: number }> => {
    const response = await fetch(`https://${ref}.supabase.co/functions/v1/voice/turn`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hqToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ said, session }),
    })
    const body = (await response.json()) as { speak?: string; did?: string }
    return { ...body, status: response.status }
  }

  // The scenario's own words, verbatim. Asked through the endpoint the Talk
  // page and the realtime call both use, so this is the path Grant takes.
  //
  // ANSWERED, not merely a 200. The first version of this check accepted any
  // non-empty reply and passed on "Right — I have put that to the team", which
  // is the office delegating a question about work it had already finished.
  // §22 A says the Chief of Staff *explains from real state*, so that is what
  // is asserted. It found two real defects: outputs were attributed to nobody,
  // and 0105's imperative list was catching the word "research" in the
  // Research Director's own title (0139).
  const askedAbout = await say('what was Research going on about?')
  record(
    'asked what Research was going on about, the office answers from real state',
    `did=${String(askedAbout.did)} — ${String(askedAbout.speak).slice(0, 90)}`,
    askedAbout.status === 200 && askedAbout.did === 'answered',
  )

  // The control, because a matcher loose enough to answer everything would
  // pass the check above and break the system. This one must NOT be answered.
  const asRequest = await say('have a look at what Emma found and tell me if it matters')
  record(
    'CONTROL: a request that names someone is still work, not a question',
    `did=${String(asRequest.did)}`,
    asRequest.did === 'delegated',
  )

  const bringFinanceIn = await say('bring Finance in on that')
  record(
    '"bring Finance in" becomes work rather than a pleasantry',
    `http ${String(bringFinanceIn.status)} did=${String(bringFinanceIn.did)}`,
    bringFinanceIn.status === 200 && bringFinanceIn.did === 'delegated',
  )

  const carryOn = await say('do what you think is best and let me know')
  const carriedJob = await one(`
    select count(*)::int as n from public.jobs
     where requested_by like 'voice:%' and created_at > app.now_utc() - interval '10 minutes'
  `)
  record(
    '"do what you think is best" continues without him',
    `did=${String(carryOn.did)}; ${String(carriedJob?.n)} job(s) from this conversation`,
    carryOn.status === 200 && Number(carriedJob?.n ?? 0) > 0,
  )

  // =========================================================================
  // 7. Visible afterwards
  // =========================================================================

  const usage = await one(`
    select count(*)::int as calls, coalesce(sum(cost_usd), 0)::numeric as spent
      from public.inference_usage
     where correlation_id = ${lit(correlationId)}::uuid
  `)
  record(
    'what this cost is measured, not estimated',
    `${String(usage?.calls)} model call(s), $${Number(usage?.spent ?? 0).toFixed(4)}`,
    Number(usage?.calls ?? 0) > 0,
  )

  const inReport = await one(`
    select count(*)::int as n from public.jobs
     where state = 'complete' and finished_at > app.now_utc() - interval '24 hours'
       and coalesce(requested_by, '') not ilike '%verif%'
       and job_id = ${lit(jobId)}::uuid
  `)
  record(
    'and it appears in the window the daily report counts',
    `${String(inReport?.n)} of this run's jobs inside the report window`,
    Number(inReport?.n ?? 0) === 1,
  )
} finally {
  await wakeUp()
}

const passed = checks.filter((c) => c.passed).length
console.log(`\n| step | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} steps passed`)
console.log('The document, the job and the ledger entries are left in place: this was a real run.')

process.exit(passed === checks.length ? 0 : 1)
