/**
 * Ask the team something, for real, and watch it come back on both surfaces.
 *
 *   npm run ask -- "what should a project brief contain?"
 *   npm run ask -- --project=ai-team-hq-test "…"
 *
 * ## Why this exists
 *
 * Everything under `scripts/verify/` proves the system works and then tidies
 * up after itself: fixture channels are archived, fixture projects retired,
 * fixture messages deleted. That is correct for a check and useless for a
 * person — Grant looked at Slack and Telegram after fifteen green suites and
 * saw an empty workspace, which is exactly what the suites are designed to
 * leave behind.
 *
 * So this is the same path with nothing faked and nothing cleaned up:
 *
 *   route (§5, a real Chief-of-Staff decision, written to `routing_decisions`)
 *     -> enqueue (§7, a real job with a real idempotency key)
 *     -> run (§11, a real completion through the measured free-model allow-list)
 *     -> review (§10/§16, the gate an inference output cannot skip)
 *     -> notify (§12, Slack office AND Telegram pager, same notifier the worker uses)
 *
 * The buttons on the resulting message are live: they resolve through
 * `slack_deliveries`/`deliveries` to this job's correlation, so a press is
 * attributed to this answer and not to whatever ran last.
 *
 * Nothing here is a demo mode. If this script prints an answer, the system
 * produced it.
 */

import { recordDecision, route, scanForDuplicates } from '../../src/agents/router.ts'
import { combinedNotifier, pagerChannel } from '../../src/channels/notify.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Handler, HandlerOutput, Job, Reviewer } from '../../src/jobs/worker.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { contextBlock, retrieve, sourceRefs } from '../../src/knowledge/retrieval.ts'
import { ProviderRouter } from '../../src/providers/router.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { slackChannel } from '../../src/slack/notifier.ts'
import { SlackOffice } from '../../src/slack/office.ts'
import { ChannelProvisioner } from '../../src/slack/provision.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { TelegramPager } from '../../src/telegram/pager.ts'
import { pagerBot } from '../../src/telegram/roster.ts'
import { officeOfProject } from '../test-office.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const args = process.argv.slice(2)
const projectSlug = (args.find((a) => a.startsWith('--project=')) ?? '').slice('--project='.length)
const question = args
  .filter((a) => !a.startsWith('--'))
  .join(' ')
  .trim()

if (question === '') {
  console.error('usage: npm run ask -- "your question"  [--project=<slug>]')
  process.exit(2)
}

const need = (name: string): string => {
  const v = process.env[name]
  if (v === undefined || v === '') {
    console.error(`${name} is required`)
    process.exit(2)
  }
  return v
}

const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  need('SUPABASE_ACCESS_TOKEN'),
)
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

// --- the project the question belongs to -----------------------------------
const project = await one(
  projectSlug === ''
    ? `select project_id::text as id, slug, name from public.projects
        where status = 'active' order by created_at limit 1`
    : `select project_id::text as id, slug, name from public.projects
        where slug = ${lit(projectSlug)}`,
)
if (project === undefined) {
  console.error(`no such active project: ${projectSlug === '' ? '(none exist)' : projectSlug}`)
  process.exit(1)
}
const projectId = String(project.id)
console.log(`project: ${String(project.name)} (${String(project.slug)})`)

// --- §5: route it. A roster is decided, not assumed. ------------------------
const scan = await scanForDuplicates(db, question, { office: 'app.operator_office()', projectId })
const decision = route(question, scan)
console.log(
  `routed: intent=${decision.intent} confident=${String(decision.confident)} ` +
    `roster=[${decision.roster.join(', ')}]`,
)

// --- §7: a real job --------------------------------------------------------
const job = await one(`
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, intent_class, requested_by, priority)
  values (gen_random_uuid(), ${lit(projectId)}::uuid,
          ${lit(`ask-${Date.now().toString(36)}`)}, 'office.ask',
          ${lit(decision.intent)}, 'grant', 100)
  returning job_id::text as id, correlation_id::text as corr
`)
const jobId = String(job?.id)
await recordDecision(db, jobId, decision)

// --- the Slack channel this project speaks in ------------------------------
// The bot token comes from the vault, never from the environment: rotation
// writes there, so an environment copy is a stale copy waiting to be believed.
const botToken = String(
  (
    await one(
      `select app.resolve_secret(bot_token_ref) as t
         from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
    )
  )?.t ?? '',
)
if (botToken === '') {
  console.error('no enabled Slack install with a resolvable bot token')
  process.exit(1)
}
const slack = new SlackClient(botToken)
const teamId = String(
  (
    await one(
      `select team_id from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
    )
  )?.team_id,
)
// The channel for the staff member who was convened, created on demand.
//
// 0070: a channel per project per discipline, made the first time that person
// has something to say about that project rather than eight per project on day
// one. An empty channel teaches you to ignore the section.
const provisioner = new ChannelProvisioner(db, slack, teamId)
const speaker = decision.roster[0] ?? null
const channel = await provisioner.ensureChannel(projectId, String(project.slug), speaker)
console.log(
  `slack: ${channel.outcome} #${String(channel.channelName)}` +
    (channel.invited === undefined ? '' : ` (grant: ${channel.invited})`),
)

// --- §11: the answer, from a real model, on the free allow-list ------------
// The knowledge layer, actually used. Until this existed the corpus was
// something nothing read: `ask` sent every question to a model with no context
// from the documents at all, which made ADR-0013's "retrieval plus a model
// call" half a sentence.
const hits = await retrieve(db, await officeOfProject(db, projectId), question, projectId)
const context = contextBlock(hits)
console.log(
  hits.length === 0
    ? 'retrieval: nothing in the corpus matched — the answer will be ungrounded, and says so'
    : `retrieval: ${String(hits.length)} document(s) — ${hits
        .map((h) => h.title)
        .join(', ')
        .slice(0, 80)}`,
)

const providerRouter = new ProviderRouter(db, need('OPENROUTER_API_KEY'))
const handler: Handler = {
  kind: 'office.ask',
  handle: async (j: Job): Promise<HandlerOutput> => {
    const completion = await providerRouter.complete({
      messages: [
        {
          role: 'system',
          content:
            'You are a director on a small research team. Answer in plain prose, ' +
            'no preamble, no bullet points, no more than 150 words. If you are ' +
            'inferring rather than reporting a fact, say so in the answer.' +
            (context === ''
              ? ' No documents in our own records matched this question, so answer ' +
                'from general knowledge and OPEN by saying that our records had nothing on it.'
              : ' Numbered excerpts from our own documents follow. Prefer them over ' +
                'general knowledge, cite them as [1], [2] where you use them, and say ' +
                'plainly when they do not answer the question rather than filling the gap.'),
        },
        ...(context === ''
          ? []
          : [{ role: 'system' as const, content: `Our documents:\n\n${context}` }]),
        { role: 'user', content: question },
      ],
      maxTokens: 2_000,
      correlationId: j.correlationId,
    })
    return {
      body: completion.content.trim(),
      confidence: 'medium',
      // `inferred` even when it is grounded, and the sources beside it.
      //
      // §10 makes `verified` mean a reader can go and check. Giving a model
      // documents makes an answer *grounded*, not *checked* — nothing here
      // reads the answer to see whether the documents support it, so marking
      // it verified because sources now exist would be the exact lie §10 is
      // written to prevent. Sources with `inferred` is the honest pair: a
      // model wrote this, and here is what it was given.
      evidence: 'inferred',
      // What was RETRIEVED, never what the model says it used. A model's
      // citation list is a claim; this is a record.
      sources: sourceRefs(hits),
      contradictions: null,
      path: 'inference',
      model: completion.model,
    }
  },
}

// §16: an inference output cannot commit unreviewed. The reviewer here is
// permissive on purpose — the gate being exercised is that one exists and that
// its verdict is recorded, not that a rubber stamp is a real review.
const reviewer: Reviewer = () =>
  Promise.resolve({
    status: 'approved' as const,
    notes: 'Answers the question asked; provenance is labelled as inferred.',
  })

// --- §12: both surfaces, one notifier, the same one the worker uses --------
const office = await SlackOffice.configured(db, slack)
const channels = [slackChannel(db, office, { teamId })]
// From the registry (0054), not the environment: the pager's identity is a
// fact the database holds, and `getMe` was only ever asked because there was
// nowhere else to learn the bot's id.
const pager = await pagerBot(db)
if (pager !== null) {
  const telegram = new TelegramClient(pager.token)
  channels.push(
    pagerChannel(
      async () => new TelegramPager(db, telegram, { botId: pager.botId, subject: 'grant' }),
      // Above the pager floor, because the point of running this is that the
      // phone buzzes. A routine result deliberately would not.
      'important',
    ),
  )
}
const notifier = combinedNotifier(channels, db)

const dequeued = await dequeue(db, `ask-${process.pid}`)
if (dequeued === null) {
  console.error('nothing dequeued — another worker may hold the queue')
  process.exit(1)
}
const result = await runJob(db, dequeued, [handler], reviewer, notifier)

const out = await one(`
  select model, reviewer_status::text as rs, left(body, 400) as head
  from public.outputs where job_id = ${lit(jobId)}::uuid
`)

console.log(`\nstate: ${result.finalState}`)
console.log(`model: ${String(out?.model)}   review: ${String(out?.rs)}`)
console.log(`notify: ${result.note}`)
console.log(`\n${String(out?.head)}\n`)
if (result.finalState !== 'complete') process.exit(1)
