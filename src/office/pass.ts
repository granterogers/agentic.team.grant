/**
 * One pass of the office: buttons, duties, work, narration.
 *
 * ## Why this lives in `src/office/` and not `src/jobs/`
 *
 * It was written into `src/jobs/` first and CI refused it, correctly. §7 says
 * operational state must never depend on Notebook, and `tests/notebook/
 * isolation.test.ts` enforces that by scanning `src/{jobs,providers,db,
 * channels,slack,migrations}` for any import of the notebook adapter. This
 * file registers the notebook handlers, so putting it there would have made
 * the job engine depend on Notebook by import — the exact thing §13 needs to
 * stay untrue, so that abandoning Gate 2 remains a possible decision.
 *
 * A composition root is not the engine. It is the place that decides which
 * handlers exist, and it is allowed to know about all of them precisely
 * because nothing in `src/jobs/` knows about it.
 *
 * ## Why this is a module and not just `scripts/work.ts`
 *
 * Grant sent a voice note to his Chief of Staff and nothing happened for ten
 * minutes. The message had arrived, the job was queued, the webhook had done
 * its job perfectly — and the only consumer of that queue was a GitHub Actions
 * cron that says every five minutes and, over the fourteen hours before he
 * complained, actually ran six times. Actions schedules are best-effort and
 * GitHub drops them freely; a five-minute cron is a wish, not a schedule.
 *
 * The fix is to run a pass the instant a message lands, from the webhook that
 * already received it. That means the same pass has to run in two places: a
 * Node process on a runner, and a Deno edge function next to the database.
 *
 * Two places means one definition. The alternative — a second copy of the
 * wiring in the edge function — is how the tested code and the running code
 * become different code, which this project has already learned twice (the
 * telegram adapter is uploaded from `src/`, not copied, for exactly this
 * reason).
 *
 * So everything `scripts/work.ts` used to do inline lives here, with no
 * `process`, no `console` and no filesystem: the two callers supply those.
 */
import { processCallbacks } from '../channels/callbacks.ts'
import { combinedNotifier, pagerChannel } from '../channels/notify.ts'
import { announceStart } from '../channels/progress.ts'
import { replyChannel } from '../channels/reply.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { backupHandler } from '../handlers/backup.ts'
import { calendarHandler } from '../handlers/calendar.ts'
import { capacityHandler, fireDueDuties } from '../handlers/capacity.ts'
import { instructionHandler } from '../handlers/instruction.ts'
import { mailHandler } from '../handlers/mail.ts'
import { notebookHandlers } from '../handlers/notebook.ts'
import { notionSyncHandler } from '../handlers/notion-sync.ts'
import { planHandler } from '../handlers/plan.ts'
import { slackRotationHandler } from '../handlers/slack-rotation.ts'
import { sourceHandler } from '../handlers/source.ts'
import { type SyncHandlerDeps, syncHandler } from '../handlers/sync.ts'
import { vaultExportHandler } from '../handlers/vault-export.ts'
import type { Reviewer } from '../jobs/worker.ts'
import { drain } from '../jobs/worker.ts'
import { HttpNotebookAdapter } from '../notebook/http-adapter.ts'
import { ProviderRouter } from '../providers/router.ts'
import { SlackClient } from '../slack/api.ts'
import { narrateHandoffs } from '../slack/narrate.ts'
import { slackChannel } from '../slack/notifier.ts'
import { SlackOffice } from '../slack/office.ts'
import { TelegramClient } from '../telegram/api.ts'
import { TelegramPager } from '../telegram/pager.ts'
import { pagerBot } from '../telegram/roster.ts'

export interface PassOptions {
  /** Where progress goes. The edge function has no stdout worth the name. */
  readonly log?: (line: string) => void
  /** Local convenience only; the vault is the real source (§15). */
  readonly openRouterKey?: string
  /** How many jobs one pass may take. */
  readonly max?: number
  /**
   * Give up starting NEW jobs after this many milliseconds.
   *
   * The edge runtime kills a function at a wall-clock limit, and a pass killed
   * mid-job leaves a lease to expire — recoverable, but it costs the caller
   * their reply. A deadline lets the pass stop cleanly instead. Omitted on a
   * runner, which has minutes.
   */
  readonly deadlineMs?: number
  /**
   * Whether this runtime can transcribe a voice note.
   *
   * The Edge Function cannot: transcription shells out to faster-whisper so
   * that Grant's voice never leaves our own compute, and that runtime has no
   * subprocesses and no Python. It reports the fact at
   * `GET /functions/v1/worker` rather than assuming it.
   */
  readonly canTranscribe?: boolean
  /**
   * Whether this runtime can spawn a local process.
   *
   * False in the Edge Function. Passed down to the dequeue so notebook work
   * and discovery stay queued for a worker that can do them (0137), rather
   * than being claimed and failed here.
   */
  readonly canSubprocess?: boolean
  /**
   * How to reach the notebook. Defaults to the HTTPS reader.
   *
   * An override, not a requirement. `HttpNotebookAdapter` is plain `fetch`, so
   * it works in Deno and in Node alike, and the default keeps both runtimes
   * running the same code — which is the whole reason this pass exists in one
   * file rather than two.
   *
   * Deliberately NOT the live subprocess adapter, even here: importing it
   * would put `node:child_process` in the Edge bundle, which does not have it,
   * and the bundle would fail to load rather than degrade.
   */
  readonly notebook?: SyncHandlerDeps['adapter']
  /** Which Supabase project this is. Only the backup needs to name it. */
  readonly projectRef?: string
}

export interface PassResult {
  readonly handled: number
  readonly buttons: number
  readonly duties: number
  /** Set when there is no inference key anywhere: every instruction would park. */
  readonly cannotThink: boolean
}

/**
 * Build a pass against a database.
 *
 * Async because the wiring itself asks the database what exists: whether Slack
 * is installed, which bot pages, whether there is a key to think with. A pass
 * that assumed any of those would be a pass that half-works silently.
 */
export const buildPass = async (
  db: SqlExecutor,
  workerId: string,
  options: PassOptions = {},
): Promise<() => Promise<PassResult>> => {
  const log = options.log ?? ((): void => {})
  const max = options.max ?? 10

  const channels = []
  /** Set when Slack is installed, so the narrator can run after the drain. */
  let floor: (() => Promise<void>) | null = null

  const botToken = String(
    (
      await db.execute(
        `select app.resolve_secret(bot_token_ref) as t
           from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
      )
    ).rows[0]?.t ?? '',
  )
  if (botToken !== '') {
    const slack = new SlackClient(botToken)
    const teamId = String(
      (
        await db.execute(
          `select team_id from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
        )
      ).rows[0]?.team_id,
    )
    const office = await SlackOffice.configured(db, slack)
    channels.push(slackChannel(db, office, { teamId }))

    // Grant: *"create an additional channel in Slack where I see the
    // communications between the Chief of Staff and the rest of the members."*
    // Runs AFTER the drain, so a decision taken this pass is narrated this pass.
    floor = async (): Promise<void> => {
      for (const s of await narrateHandoffs(db, slack, office, teamId)) {
        if (s.outcome === 'sent') log(`floor: narrated ${s.jobId.slice(0, 8)}`)
      }
    }
  }

  const pager = await pagerBot(db)
  if (pager !== null) {
    channels.push(
      pagerChannel(
        new TelegramPager(db, new TelegramClient(pager.token), {
          botId: pager.botId,
          subject: 'grant',
        }),
        'important',
      ),
    )
  }

  // The reply channel goes FIRST. An instruction that arrived in a Telegram
  // chat is answered in that chat, by the bot it was sent to — a reply from the
  // pager to a message sent to Ines would be a colleague answering through a
  // switchboard. Everything else still gets its usual delivery.
  const notify = combinedNotifier([replyChannel(db), ...channels], db)

  // Notebook operations are deterministic — the notebook accepted the source or
  // it did not — and §16 exempts those from review.
  const review: Reviewer = () =>
    Promise.resolve({ status: 'approved' as const, notes: 'Deterministic notebook operation.' })

  // Storage needs the service role key and the vault is where it lives. Read
  // here rather than in the handler: §15 keeps credential lookup in the
  // composition root, and a handler that reaches the vault itself is a handler
  // that cannot be tested without one.
  const projectRef = options.projectRef ?? 'baujwlzcziasnfhhkchg'
  const serviceKey = String(
    (
      await db.execute(`
        select coalesce(decrypted_secret, '') as k from vault.decrypted_secrets
         where name = 'supabase.service_role_key'
      `)
    ).rows[0]?.k ?? '',
  )

  const orKey = options.openRouterKey ?? ''
  const vaultKey = String(
    (
      await db.execute(`
        select coalesce(app.resolve_secret(secret_ref), '') as k
          from public.providers where provider = 'openrouter' and secret_ref is not null
      `)
    ).rows[0]?.k ?? '',
  )
  const cannotThink = orKey === '' && vaultKey === ''

  const handlers = [
    ...notebookHandlers(db),
    planHandler(db),
    capacityHandler(db),
    calendarHandler(db),
    mailHandler(db),
    // §16's nightly copy. Registered unconditionally: the handler reports
    // "no storage key" as an outcome rather than failing, because a backup
    // that silently does not happen is the failure this whole thing is about.
    backupHandler({ db, projectRef, serviceKey }),
    // Slack's configuration tokens die twelve hours after they are issued and
    // the refresh token is single-use. A GitHub Actions cron used to renew
    // them; since it went, they have survived on whichever verification run
    // happened to rotate one.
    slackRotationHandler({
      db,
      // Read from the install rather than pasted in: there is exactly one
      // enabled Slack app (§9's "V1 is ONE app") and it knows its own id.
      appId: String(
        (
          await db.execute(`
            select slack_app_id from public.slack_app_credentials
             where enabled and revoked_at is null limit 1
          `)
        ).rows[0]?.slack_app_id ?? '',
      ),
    }),
    // The other corpus. Twenty pages shared with the integration and never
    // once read by anything outside a verification run.
    notionSyncHandler(db),
    // Registered though its duty is off: the handler being absent is what made
    // 0133 seed the duty disabled in the first place, and a handler nobody can
    // reach is a handler nobody finds out is broken. Switching the duty on is
    // one UPDATE.
    vaultExportHandler(db),
    // §22 A's first clause — a source arriving is noticed — but only where the
    // notebook can actually be read. See `notebook` in the options above.
    syncHandler({
      db,
      adapter:
        options.notebook ??
        (async () => {
          const http = await HttpNotebookAdapter.fromVault(db)
          return http === null ? null : { adapter: http, listNotebooks: () => http.listNotebooks() }
        }),
      workerId,
    }),
    ...(cannotThink
      ? []
      : [
          instructionHandler({ db, router: new ProviderRouter(db, orKey) }),
          // §22 A's first clause: a source arriving is read by Research. 0107's
          // trigger makes the job; without this handler it would park.
          sourceHandler({ db, router: new ProviderRouter(db, orKey) }),
        ]),
  ]

  return async (): Promise<PassResult> => {
    // Button presses first. Approving a generation enqueues it, so pressing the
    // button and getting the artifact in the same pass is the difference
    // between "it works" and "it works eventually".
    const pressed = await processCallbacks(db, { subject: 'grant' })
    for (const p of pressed) log(`button ${p.action}: ${p.outcome} — ${p.note.slice(0, 100)}`)

    // Recurring duties before the drain, so one fired this pass is worked this
    // pass.
    const duties = await fireDueDuties(db)
    for (const fired of duties) log(`duty: ${fired}`)

    const started = Date.now()
    const deadline = options.deadlineMs
    const done = await drain(db, workerId, handlers, review, max, {
      notify,
      onStart: (job) => announceStart(db, job),
      canTranscribe: options.canTranscribe ?? true,
      canSubprocess: options.canSubprocess ?? true,
      ...(deadline === undefined
        ? {}
        : { stopStartingAfter: (): boolean => Date.now() - started > deadline }),
    })
    for (const r of done) log(`${r.jobId.slice(0, 8)} ${r.finalState}: ${r.note.slice(0, 120)}`)

    // Never fatal. A narration channel that fails takes nothing with it: the
    // work is done and delivered, and the running commentary is the least
    // important thing here.
    if (floor !== null) {
      try {
        await floor()
      } catch (error) {
        log(`floor: ${(error as Error).message.slice(0, 120)}`)
      }
    }

    return {
      handled: done.length,
      buttons: pressed.length,
      duties: duties.length,
      cannotThink,
    }
  }
}
