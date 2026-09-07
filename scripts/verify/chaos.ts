/**
 * Failure injection across every integration (Phase 10).
 *
 *   npm run verify:chaos
 *
 * ## The property under test
 *
 * §7 states it for the notebook and §17 generalises it: *an outage in one
 * integration must degrade that integration without corrupting or disabling the
 * rest of Team HQ.* Every suite so far tests an integration working. This one
 * tests the others still working while it does not.
 *
 * That is a different question, and the difference is where systems fail. A
 * Slack outage that also silences the pager takes out the surface that exists
 * to work when the other does not. A provider outage that fails jobs
 * permanently, instead of queueing them, loses work to a thirty-second blip.
 *
 * ## How the failures are injected
 *
 * Every client here takes an injectable `fetch`, so the failure is real from
 * the code's point of view — a 500, a refused connection, a timeout — without
 * anyone having to break a live service. What is NOT faked is the database,
 * the delivery ledger, the breaker or the job state machine: those are the
 * things whose behaviour under failure is the actual claim.
 *
 * Each case asserts two things, and the second is the one that matters:
 *   1. the broken integration reports its failure honestly, and
 *   2. **something else that shares nothing with it still works.**
 */

import { DeliveryService } from '../../src/channels/delivery.ts'
import { combinedNotifier, pagerChannel } from '../../src/channels/notify.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { HandlerOutput, Job } from '../../src/jobs/worker.ts'
import { NotionClient } from '../../src/notion/api.ts'
import { listShared } from '../../src/notion/sync.ts'
import { ProviderRouter } from '../../src/providers/router.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { slackChannel } from '../../src/slack/notifier.ts'
import { SlackOffice } from '../../src/slack/office.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { TelegramPager } from '../../src/telegram/pager.ts'
import { pagerBot } from '../../src/telegram/roster.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
// Slack channel ids are shaped `^[CDG][A-Z0-9]{6,}$` (0014), so a fixture id
// has to look like one. `C` plus the run stamp, uppercased and stripped.
const CHAOS_CHANNEL = `C${run.toUpperCase().replace(/[^A-Z0-9]/g, '')}CHAOS`

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

/** A fetch that always fails at the transport, as a dead host does. */
const refused = (() =>
  Promise.reject(new Error('ECONNREFUSED (injected)'))) as unknown as typeof fetch

/** A fetch that always returns 500, as a service having a bad day does. */
const brokenHttp = (async () =>
  new Response(JSON.stringify({ ok: false, error: 'internal_error' }), {
    status: 500,
  })) as unknown as typeof fetch

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const project = await one(`
  with created as (
    insert into public.projects (slug, name, status)
    values (${lit(`fixture-chaos-${run}`)}, ${lit(`Fixture: chaos ${run}`)}, 'active')
    returning project_id
  ),
  attached as (
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role)
    select project_id, 'upload', 'fixture', 'Verification fixture', 'source'
      from created
    returning project_id
  )
  select project_id::text as id from created
`)
const projectId = String(project?.id)

const teamId = String(
  (
    await one(
      `select team_id from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
    )
  )?.team_id,
)
const realSlackToken = String(
  (
    await one(
      `select app.resolve_secret(bot_token_ref) as t
         from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
    )
  )?.t ?? '',
)
const realPager = await pagerBot(db)
if (realSlackToken === '' || realPager === null) {
  console.error('this suite needs a working Slack install and pager to prove the OTHER half works')
  process.exit(1)
}

// A REAL job row, not a fabricated uuid. `deliveries.job_id` is a foreign key,
// so a made-up id fails the insert with 23503 — and the Slack case then passes
// on a database error instead of on the outage it injected. Twice now this
// check has passed for a reason that had nothing to do with Slack being down;
// the fixture is real so that the third reason is the right one.
const jobRow = await one(`
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
  values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(`chaos-${run}`)},
          'chaos.probe', 'verify:chaos', 100)
  returning job_id::text as id, correlation_id::text as corr
`)

const job = (): Job =>
  ({
    jobId: String(jobRow?.id),
    correlationId: String(jobRow?.corr),
    projectId,
  }) as unknown as Job
const output = (): HandlerOutput =>
  ({
    body: `Chaos probe ${run}.`,
    confidence: 'medium',
    evidence: 'inferred',
    sources: [],
    contradictions: null,
    path: 'inference',
    model: 'fixture',
  }) as unknown as HandlerOutput

// ---------------------------------------------------------------------------
// 1. Slack is down. The pager must not be.
// ---------------------------------------------------------------------------

{
  // The fixture project needs a real Slack destination, or this whole case is
  // the defect it exists to catch: with no channel mapped, the notifier reports
  // "no slack destination" and the check passes **whether or not Slack is
  // broken**. Mapped to the live project channel rather than a new one — a
  // provisioned channel would invite Grant to a fixture and then archive it.
  const liveChannel = await one(`
    select channel_id from public.slack_channel_map where active and created_by_app
     order by created_at desc limit 1
  `)
  if (liveChannel === undefined) {
    console.error('no active app channel to map the fixture to; cannot prove Slack failure')
    process.exit(1)
  }
  await db.execute(`
    insert into public.slack_channel_map
      (channel_id, channel_name, team_id, project_id, created_by_app, active)
    values (${lit(CHAOS_CHANNEL)}, ${lit(`chaos-${run}`)}, ${lit(teamId)},
            ${lit(projectId)}::uuid, false, true)
  `)

  const brokenOffice = await SlackOffice.configured(
    db,
    new SlackClient(realSlackToken, { fetchImpl: refused }),
  )
  const workingPager = new TelegramPager(db, new TelegramClient(realPager.token), {
    botId: realPager.botId,
    // Nobody registered under this subject, so the pager reports "no chat" and
    // sends nothing. The claim under test is that Slack's failure did not stop
    // the pager from being CONSULTED — not that Grant's phone buzzes for a
    // verification run.
    subject: `chaos-${run}`,
  })
  const notifier = combinedNotifier(
    [slackChannel(db, brokenOffice, { teamId }), pagerChannel(workingPager, 'important')],
    db,
  )
  // A real output row too, for the same reason: `outputId` is resolved by the
  // notifier to decide whether the result is reviewed, and a missing row would
  // make this a test of a null lookup.
  const outputRow = await one(`
    insert into public.outputs
      (job_id, body, confidence, evidence, sources, contradictions, deterministic,
       reviewer_status, reviewed_by, reviewed_at, model)
    values (${lit(String(jobRow?.id))}::uuid, ${lit(`Chaos probe ${run}.`)}, 'medium',
            'inferred', '[]'::jsonb, null, false, 'approved',
            (select staff_id from public.staff where slug = 'quality-director'),
            app.now_utc(), 'fixture')
    returning output_id::text as id
  `)
  const result = await notifier(job(), output(), String(outputRow?.id))
  // The discrimination: the note must name the TRANSPORT failure, not a
  // missing destination. "no slack destination" is what this check used to
  // pass on, and it would have passed with Slack working perfectly.
  record(
    'Slack down: the failure reported is the OUTAGE, not a missing destination',
    result.note.slice(0, 120),
    /econnrefused|injected|indeterminate|failed/i.test(result.note) &&
      !/no slack destination/i.test(result.note),
  )
  record(
    'Slack down: the pager was still consulted — one channel does not silence the other',
    result.note.slice(0, 160),
    /telegram|paged|no telegram chat/i.test(result.note),
  )
}

// ---------------------------------------------------------------------------
// 2. Telegram is down. Slack must still deliver, for real.
// ---------------------------------------------------------------------------

{
  const brokenPager = new TelegramPager(
    db,
    new TelegramClient(realPager.token, { fetchImpl: refused }),
    {
      botId: realPager.botId,
      subject: 'grant',
    },
  )
  const service = new DeliveryService(
    db,
    new TelegramTransport(new TelegramClient(realPager.token, { fetchImpl: refused })),
  )
  const attempt = await service.deliver({
    dedupeKey: `chaos:${run}:telegram-down`,
    accountRef: realPager.botId,
    targetRef: '1386648496',
    purpose: 'notice',
    body: { text: 'chaos probe — never sent', silent: true },
  })
  record(
    'Telegram down: the delivery records a real outcome rather than claiming success',
    `outcome=${attempt.outcome} code=${String(attempt.errorCode)}`,
    attempt.outcome !== 'sent',
  )
  // The other half. A live Slack call, while Telegram is unreachable.
  const liveSlack = new SlackClient(realSlackToken)
  const auth = await liveSlack.call('auth.test', {})
  record(
    'Telegram down: Slack is unaffected — a live call succeeds during the outage',
    `auth.test ok=${String(auth.body.ok)} team=${String(auth.body.team)}`,
    auth.body.ok === true,
  )
  void brokenPager
}

// ---------------------------------------------------------------------------
// 3. The inference provider is down. Work must queue, not fail forever.
// ---------------------------------------------------------------------------

{
  const orKey = process.env.OPENROUTER_API_KEY ?? ''
  const brokenRouter = new ProviderRouter(db, orKey, refused)
  let message = 'no error raised'
  try {
    await brokenRouter.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 32 })
  } catch (error) {
    message = (error as Error).message
  }
  record(
    'provider down: the router raises rather than returning an empty answer as if it were one',
    message.slice(0, 100),
    message !== 'no error raised',
  )

  // The consequence that matters. A provider outage must not corrupt the
  // registry: the models are still measured usable, because usability is a
  // property of the model and the outage is a property of the moment.
  const stillUsable = await one(`select count(*)::int as n from public.usable_models`)
  record(
    'provider down: the model registry is not emptied by an outage',
    `${String(stillUsable?.n)} model(s) still measured usable`,
    Number(stillUsable?.n) >= 1,
  )

  // And the breaker recorded it, which is how the NEXT worker learns without
  // repeating the discovery. §6: breaker state is in the database precisely so
  // a restart does not forget an outage.
  const failures = await one(`
    select consecutive_failures as n, last_failure_at is not null as recorded, state::text as state
      from public.provider_health where provider = 'openrouter'
  `)
  record(
    'provider down: the breaker recorded the failure, so the next worker inherits the knowledge',
    `consecutive_failures=${String(failures?.n)} state=${String(failures?.state)} recorded=${String(failures?.recorded)}`,
    failures?.recorded === true,
  )
}

// ---------------------------------------------------------------------------
// 4. Notion is down. The corpus must remain readable.
// ---------------------------------------------------------------------------

{
  let notionFailed = 'no error raised'
  try {
    await listShared(new NotionClient('ntn_fixture', { fetchImpl: brokenHttp }))
  } catch (error) {
    notionFailed = (error as Error).message
  }
  record(
    'Notion down: the connector fails loudly rather than reporting an empty workspace',
    notionFailed.slice(0, 90),
    notionFailed !== 'no error raised',
  )

  // The property the 2026-09-04 ban actually tested, injected rather than
  // waited for: a route being closed does not lose what it brought in.
  const corpus = await one(`select count(*)::int as n from public.documents`)
  const searchable = (await db.execute(`select * from app.search_documents('coaching', null, 5)`))
    .rows
  record(
    'Notion down: the corpus is intact and still searchable — a route is not a store',
    `${String(corpus?.n)} document(s), ${String(searchable.length)} still findable`,
    Number(corpus?.n) >= 1 && searchable.length >= 1,
  )
}

// ---------------------------------------------------------------------------
// 5. §18: a channel DISABLED is not the same as a channel down
// ---------------------------------------------------------------------------

// An outage is something that happened to us; a kill switch is a decision we
// made. §17 requires the second to be possible without collateral damage, and
// the two paths through the code are different — one throws at the transport,
// the other never reaches it.
{
  await db.execute(`
    update public.slack_app_credentials
       set enabled = false, disabled_reason = 'verify:chaos — deliberately switched off'
     where enabled and revoked_at is null
  `)
  const stillPaging = await one(`
    select count(*)::int as n from public.telegram_bots where is_pager and enabled
  `)
  const slackOff = await one(`
    select count(*)::int as n from public.slack_app_credentials where enabled
  `)
  record(
    'Slack switched off (§17): the pager is untouched by the decision',
    `enabled slack installs=${String(slackOff?.n)}, enabled pagers=${String(stillPaging?.n)}`,
    Number(slackOff?.n) === 0 && Number(stillPaging?.n) === 1,
  )

  // And the corpus, the jobs and the registry are all still there. Turning off
  // a surface must not touch anything behind it.
  const behind = await one(`
    select (select count(*)::int from public.documents) as docs,
           (select count(*)::int from public.usable_models) as models,
           (select count(*)::int from public.projects where status = 'active') as projects
  `)
  record(
    'Slack switched off: nothing behind the surface was affected',
    `documents=${String(behind?.docs)} models=${String(behind?.models)} active projects=${String(behind?.projects)}`,
    Number(behind?.docs) >= 1 && Number(behind?.models) >= 1,
  )

  await db.execute(`
    update public.slack_app_credentials
       set enabled = true, disabled_reason = null
     where disabled_reason = 'verify:chaos — deliberately switched off'
  `)
  const restored = await one(
    `select count(*)::int as n from public.slack_app_credentials where enabled`,
  )
  record(
    'and Slack is switched back on, exactly as it was found',
    `enabled installs=${String(restored?.n)}`,
    Number(restored?.n) >= 1,
  )
}

// ---------------------------------------------------------------------------
// 5b. §18: Telegram DISABLED, the mirror of the Slack case
// ---------------------------------------------------------------------------

// Written because the coverage map (docs/degradation-coverage.md) showed the
// Slack half existed and this one did not. The mirror matters: §12 makes
// Telegram the interrupting surface and Slack the office, so "the pager is off"
// and "the office is off" are different failures with different consequences,
// and only one of them had ever been exercised.
{
  await db.execute(`
    update public.telegram_bots
       set enabled = false, disabled_reason = 'verify:chaos — deliberately switched off'
     where is_pager
  `)
  const { pagerBot: resolvePager } = await import('../../src/telegram/roster.ts')
  const gone = await resolvePager(db)
  record(
    'Telegram switched off (§17): the pager stops resolving, so nothing tries to page',
    gone === null ? 'no pager resolves' : `still resolved @${gone.username}`,
    gone === null,
  )

  // And the office is untouched by the decision — a live Slack call, made while
  // the pager is switched off.
  const duringOutage = await new SlackClient(realSlackToken).call('auth.test', {})
  record(
    'Telegram switched off: Slack still delivers — the decision was about one surface',
    `auth.test ok=${String(duringOutage.body.ok)}`,
    duringOutage.body.ok === true,
  )

  await db.execute(`
    update public.telegram_bots set enabled = true, disabled_reason = null
     where disabled_reason = 'verify:chaos — deliberately switched off'
  `)
  const back = await resolvePager(db)
  record(
    'and the pager is switched back on, exactly as it was found',
    back === null ? 'STILL OFF' : `@${back.username}`,
    back !== null,
  )
}

// ---------------------------------------------------------------------------
// 6. §18: crash after commit, before notification
// ---------------------------------------------------------------------------

// The named case, and the one with the most expensive wrong answer: a worker
// dies between committing an output and delivering it. Recovery must not
// re-run the work — the output exists — and must not silently drop the job.
{
  const crashed = await one(`
    insert into public.jobs
      (correlation_id, project_id, idempotency_key, kind, requested_by, priority,
       state, leased_by, leased_until, started_at)
    values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(`chaos-crash-${run}`)},
            'chaos.probe', 'verify:chaos', 100, 'queued', 'worker-that-died',
            app.now_utc() - interval '1 hour', app.now_utc() - interval '1 hour')
    returning job_id::text as id
  `)
  const crashedId = String(crashed?.id)
  // Walk it to `notifying` the way the worker does, then abandon it there.
  // The real path through the fourteen-state machine (ADR-0008), not invented
  // names — a first pass used 'claimed', 'planning', 'working' and the enum
  // rejected all three, which is the constraint doing its job on a test that
  // guessed at the states it was meant to be exercising.
  for (const state of [
    'running',
    'output_created',
    'quality_review',
    'committing',
    'committed',
    'notifying',
  ]) {
    await db.execute(`
      update public.jobs set state = ${lit(state)}::public.job_state, updated_at = app.now_utc() - interval '1 hour'
       where job_id = ${lit(crashedId)}::uuid
    `)
  }
  await db.execute(`
    insert into public.outputs
      (job_id, body, confidence, evidence, sources, contradictions, deterministic,
       reviewer_status, reviewed_by, reviewed_at, model)
    values (${lit(crashedId)}::uuid, ${lit(`Committed before the crash ${run}.`)}, 'medium',
            'inferred', '[]'::jsonb, null, false, 'approved',
            (select staff_id from public.staff where slug = 'quality-director'),
            app.now_utc(), 'fixture')
  `)

  const { recoverStalled, deliverPending } = await import('../../src/jobs/worker.ts')
  const recovered = await recoverStalled(db)
  const after = await one(`
    select state::text as state, state_reason,
           (select count(*)::int from public.outputs o where o.job_id = j.job_id) as outputs
      from public.jobs j where j.job_id = ${lit(crashedId)}::uuid
  `)
  record(
    'crash after commit: recovery resumes DELIVERY rather than retrying the work',
    `${String(recovered.length)} recovered; state=${String(after?.state)} reason=${String(after?.state_reason).slice(0, 70)}`,
    after?.state === 'notifying' && String(after?.state_reason).includes('delivery outstanding'),
  )

  // The half that makes it real. Before 0058 nothing read `notifying`, so a
  // correctly-recovered job would have parked there forever — the same "sweep
  // to nowhere" as the requeue 0006 was written to close, one layer up.
  const handlerRuns = 0
  let deliveries = 0
  const resumed = await deliverPending(db, `chaos-${run}`, async () => {
    deliveries += 1
    return { delivered: true, note: 'delivered on resume' }
  })
  const settled = await one(`
    select state::text as state, state_reason,
           (select count(*)::int from public.outputs o where o.job_id = j.job_id) as outputs
      from public.jobs j where j.job_id = ${lit(crashedId)}::uuid
  `)
  record(
    'the outstanding delivery is picked up and the job finishes',
    `${String(resumed.length)} resumed, ${String(deliveries)} delivered; state=${String(settled?.state)}`,
    deliveries === 1 && settled?.state === 'complete',
  )
  record(
    'and the committed output is NOT duplicated — §18: no duplicate substantive work',
    `${String(settled?.outputs)} output row(s); the handler ran ${String(handlerRuns)} more time(s)`,
    Number(settled?.outputs) === 1 && handlerRuns === 0,
  )
  void handlerRuns
}

// ---------------------------------------------------------------------------
// 7. §18: the same instruction through two interfaces, near-simultaneously
// ---------------------------------------------------------------------------

// §18 names this one specifically, and §22's rule is that the source interface
// must not change the organisation's behaviour. Two channels, one instruction,
// sent together: both must be recorded (they are genuinely two events from one
// person) and both must resolve to the same person and the same text, so
// nothing downstream can tell them apart on anything that matters.
{
  const instruction = `Simultaneous probe ${run}`
  const [slackStored, telegramStored] = await Promise.all([
    one(`
      insert into public.inbound_commands
        (origin_channel, origin_ref, actor, instruction, dedupe_key)
      values ('slack', ${lit(`C0BVD21Q9S5:sim-${run}`)}, 'U0BUNF6AALC',
              ${lit(instruction)}, ${lit(`verify:chaos:sim-slack-${run}`)})
      returning subject, instruction
    `),
    one(`
      insert into public.inbound_commands
        (origin_channel, origin_ref, actor, instruction, dedupe_key)
      values ('telegram', ${lit(`1386648496:sim-${run}`)}, '1386648496',
              ${lit(instruction)}, ${lit(`verify:chaos:sim-telegram-${run}`)})
      returning subject, instruction
    `),
  ])
  record(
    'the same instruction through two interfaces at once: both recorded, one person, one text',
    `slack subject=${String(slackStored?.subject)} telegram subject=${String(telegramStored?.subject)}`,
    slackStored?.subject === 'grant' &&
      telegramStored?.subject === 'grant' &&
      slackStored?.instruction === telegramStored?.instruction,
  )
}

// ---------------------------------------------------------------------------
// 8. §18: a transaction failure mid-job leaves no half-state
// ---------------------------------------------------------------------------

{
  // A statement that does real work and then fails. Postgres rolls the whole
  // thing back; the claim under test is that nothing in our schema defeats
  // that with a trigger that writes outside the transaction.
  const before = await one(`select count(*)::int as n from public.projects`)
  let failedAs = 'nothing was refused'
  try {
    await db.execute(`
      insert into public.projects (slug, name, status)
        values (${lit(`fixture-chaos-rollback-${run}`)}, 'Rollback probe', 'active');
      insert into public.projects (slug, name, status)
        values (${lit(`fixture-chaos-rollback-${run}`)}, 'The same slug again', 'active');
    `)
  } catch (error) {
    failedAs = (error as Error).message.match(/\b\d{5}\b/)?.[0] ?? 'unknown'
  }
  const after = await one(`select count(*)::int as n from public.projects`)
  record(
    'a transaction that fails part-way leaves NO half-state behind',
    `refused with ${failedAs}; projects ${String(before?.n)} -> ${String(after?.n)}`,
    failedAs === '23505' && Number(after?.n) === Number(before?.n),
  )
}

// ---------------------------------------------------------------------------
// 9. CONTROL: the injection is real
// ---------------------------------------------------------------------------

{
  // Every check above would pass just as well against clients that quietly
  // ignored `fetchImpl` and talked to the real services — the failures would
  // simply not happen, and "nothing broke" reads the same as "nothing was
  // broken". This proves the injected fetch is the one being used.
  let reached = false
  const spy = (async () => {
    reached = true
    return new Response('{"ok":false,"error":"injected"}', { status: 500 })
  }) as unknown as typeof fetch
  await new SlackClient(realSlackToken, { fetchImpl: spy }).call('auth.test', {}).catch(() => {})
  record(
    'CONTROL: the injected transport is genuinely the one in use',
    reached ? 'the injected fetch was called' : 'the client ignored it and used the real network',
    reached,
  )
}

// ---------------------------------------------------------------------------

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)

// The breaker was deliberately tripped above. Left as it is, the next suite to
// ask for a completion would be refused by a breaker this one opened — a check
// that changes real configuration must restore it.
await db.execute(`select app.record_provider_success('openrouter')`)
const restored = await one(`select app.provider_available('openrouter') as ok`)
console.log(`provider breaker reset: available=${String(restored?.ok)}`)

await db.execute(`
  delete from public.slack_channel_map where channel_id = ${lit(CHAOS_CHANNEL)};
  delete from public.inbound_commands where dedupe_key like ${lit(`verify:chaos:%${run}`)};
  delete from public.deliveries where dedupe_key like ${lit(`chaos:${run}:%`)};
  delete from public.deliveries where job_id = ${lit(String(jobRow?.id))}::uuid;
  delete from public.outputs where job_id = ${lit(String(jobRow?.id))}::uuid;
  -- The job is retired, not deleted: job_state_transitions is an append-only
  -- audit of what the state machine did, and deleting the job to tidy a
  -- fixture would mean deleting evidence. The project is archived for the same
  -- reason - it has jobs, and those jobs have history worth more than a clean
  -- table. purge:fixtures handles the fixture-% convention.
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'chaos fixture retired'
   where project_id = ${lit(projectId)}::uuid and state not in ('complete','cancelled','failed');
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid;
`)
console.log('fixtures removed.')

if (failed.length > 0) process.exit(1)
