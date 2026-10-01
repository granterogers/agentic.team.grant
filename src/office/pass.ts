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
import { announceStart, sayStillWorking } from '../channels/progress.ts'
import { replyChannel } from '../channels/reply.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { artifactHandler } from '../handlers/artifact.ts'
import { backupHandler } from '../handlers/backup.ts'
import { briefingHandler } from '../handlers/briefing.ts'
import { browserGatherHandler } from '../handlers/browser-gather.ts'
import { buildShotsHandler } from '../handlers/build-shots.ts'
import { calendarHandler } from '../handlers/calendar.ts'
import { calendarTasksHandler } from '../handlers/calendar-tasks.ts'
import { capacityHandler, fireDueDuties } from '../handlers/capacity.ts'
import { channelsHandler } from '../handlers/channels.ts'
import { choresHandler } from '../handlers/chores.ts'
import { ciDispatchHandler } from '../handlers/ci-dispatch.ts'
import { collectHandler } from '../handlers/collect.ts'
import { driveWatchHandler } from '../handlers/drive.ts'
import { driveReadHandler } from '../handlers/drive-read.ts'
import { extractTasksHandler } from '../handlers/extract-tasks.ts'
import { googleRevokeHandler } from '../handlers/google-revoke.ts'
import { instructionHandler } from '../handlers/instruction.ts'
import { jobTracesHandler } from '../handlers/job-traces.ts'
import { mailHandler } from '../handlers/mail.ts'
import { mcpDiscoverHandler } from '../handlers/mcp-discover.ts'
import { notebookHandlers } from '../handlers/notebook.ts'
import { notionAdoptHandler } from '../handlers/notion-adopt.ts'
import { notionImportHandler } from '../handlers/notion-import.ts'
import { notionSyncHandler } from '../handlers/notion-sync.ts'
import { planHandler } from '../handlers/plan.ts'
import { proposeHandler } from '../handlers/propose.ts'
import { pursueHandler } from '../handlers/pursue.ts'
import { remindersHandler } from '../handlers/reminders.ts'
import { slackRotationHandler } from '../handlers/slack-rotation.ts'
import { sourceHandler } from '../handlers/source.ts'
import { type SyncHandlerDeps, syncHandler } from '../handlers/sync.ts'
import { synthesiseHandler } from '../handlers/synthesise.ts'
import { tasksSyncHandler } from '../handlers/tasks-sync.ts'
import { vaultExportHandler } from '../handlers/vault-export.ts'
import type { Handler, Reviewer } from '../jobs/worker.ts'
import { drain } from '../jobs/worker.ts'
import { HttpNotebookAdapter } from '../notebook/http-adapter.ts'
import { ProviderRouter } from '../providers/router.ts'
import { SlackClient } from '../slack/api.ts'
import { narrateHandoffs, narrateOutcomes } from '../slack/narrate.ts'
import { slackChannel } from '../slack/notifier.ts'
import { SlackOffice } from '../slack/office.ts'
import { TelegramClient } from '../telegram/api.ts'
import type { PagerSeverity } from '../telegram/pager.ts'
import { TelegramPager } from '../telegram/pager.ts'
import { botForStaff, pagerBot } from '../telegram/roster.ts'

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
  /**
   * What time the office thinks it is (#133).
   *
   * Only `npm run replay` ever passes it, and only so a job that said "by
   * Friday" resolves to the Friday it meant rather than the one a fortnight
   * later. The office leaves it unset and reads the real clock.
   */
  readonly now?: () => Date
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
/**
 * A pass, plus the kinds it can actually handle (#112).
 *
 * `kinds` is a property on the function rather than a second return value, so
 * every existing caller keeps working and nothing has to be threaded through
 * two runtimes to get at it.
 *
 * It exists because nine hourly jobs sat queued for eight hours: the duty
 * enqueued `google.write_calendar_tasks`, the handler was written and
 * registered, and the DEPLOYED worker had been built before either existed. It
 * dequeued a kind it had never heard of and left it. Nothing was red, because a
 * queued job is not a failed job.
 *
 * Reading the registry from outside is what lets a check hold it against the
 * kinds the database enqueues. Any other way of listing the kinds would be a
 * second copy of this array, which is the drift the check is written against.
 */
export type Pass = (() => Promise<PassResult>) & {
  readonly kinds: readonly string[]
  /**
   * The wired handlers, and the reviewer they run under (#133).
   *
   * `npm run replay` runs ONE named job against current code, out of band: no
   * dequeue, no notifier, nothing delivered. It needs the real handler set to
   * mean anything -- a replay against a second, script-local assembly would be
   * measuring a wiring nobody runs, and the header above already records what
   * two copies of one list cost.
   *
   * Exposed the same way `kinds` is, and for the same reason: a property on
   * the returned function changes no existing caller, and the alternative is a
   * copy of forty constructor calls in `scripts/`.
   */
  readonly handlers: readonly Handler[]
  readonly review: Reviewer
}

export const buildPass = async (
  db: SqlExecutor,
  workerId: string,
  options: PassOptions = {},
): Promise<Pass> => {
  const log = options.log ?? ((): void => {})
  const max = options.max ?? 10
  // Timings in the log, because Grant asked for a reply inside a minute and
  // "it feels slow" cannot be acted on. Every query here is an HTTPS round
  // trip to the Management API (ADR-0007), so a pass is mostly latency and
  // the only way to know which part is to say.
  const buildStartedAt = Date.now()

  const channels = []
  /** Set when Slack is installed, so the narrator can run after the drain. */
  let floor: (() => Promise<void>) | null = null

  const projectRef = options.projectRef ?? 'baujwlzcziasnfhhkchg'

  // Two secrets and the Slack app id, in ONE round trip.
  //
  // Every query here is an HTTPS call to the Management API (ADR-0007), so
  // three of them is three times the latency of one for no reason — and the
  // measurement that prompted this said setup was six seconds of a
  // twenty-second empty pass.
  // raw-sql[3]: deployment composition root; it reads the Slack app's installation id and deployment secrets to build
  // clients, before any job is claimed. Nothing read here reaches a prompt or moves between offices.
  const setup = (
    await db.execute(`
      select
        (select coalesce(decrypted_secret, '') from vault.decrypted_secrets
          where name = 'supabase.service_role_key') as service_key,
        (select coalesce(app.resolve_secret(secret_ref), '') from public.providers
          where provider = 'openrouter' and secret_ref is not null) as vault_key,
        (select slack_app_id from public.slack_app_credentials
          where enabled and revoked_at is null limit 1) as slack_app_id,
        (select value #>> '{}' from public.system_config
          where key = 'telegram.pager_floor') as pager_floor,
        (select value #>> '{}' from public.system_config
          where key = 'telegram.only_chief_speaks') as only_chief_speaks
    `)
  ).rows[0] as {
    service_key?: string
    vault_key?: string
    slack_app_id?: string
    pager_floor?: string
    only_chief_speaks?: string
  }

  const serviceKey = String(setup?.service_key ?? '')
  const orKey = options.openRouterKey ?? ''
  const vaultKey = String(setup?.vault_key ?? '')
  const cannotThink = orKey === '' && vaultKey === ''

  let slackTeamId = ''
  // raw-sql[3]: deployment composition root; it reads the Slack app's installation to build the client, before any job is claimed.
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
    // raw-sql[3]: deployment composition root; the workspace id of the installation read just above.
    const teamId = String(
      (
        await db.execute(
          `select team_id from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
        )
      ).rows[0]?.team_id,
    )
    slackTeamId = teamId
    const office = await SlackOffice.configured(db, slack)
    /*
      The project ref and the service key travel with it (#258).

      Slack delivers a file as a signed LINK, because it holds `chat:write` and
      not `files:write` and Grant chose a link over another scope. Read here
      rather than in the notifier: §15 keeps credential lookup in the
      composition root, and a channel that reached the vault itself would be a
      channel that cannot be tested without one.
    */
    channels.push(slackChannel(db, office, { teamId, projectRef, serviceKey }))

    // Grant: *"create an additional channel in Slack where I see the
    // communications between the Chief of Staff and the rest of the members."*
    // Runs AFTER the drain, so a decision taken this pass is narrated this pass.
    floor = async (): Promise<void> => {
      for (const s of await narrateHandoffs(db, slack, office, teamId)) {
        if (s.outcome === 'sent') log(`floor: narrated ${s.jobId.slice(0, 8)}`)
      }
      /*
        And how it turned out (#282).

        The decisions alone made the floor a log of intentions: "Emma has it"
        and then nothing, whether she answered, produced nothing, or the job
        died. AFTER the decisions in the same pass, so a job that was decided
        and settled between two ticks gets both halves in order, and the
        outcome threads under its own decision.
      */
      for (const s of await narrateOutcomes(db, slack, office, teamId)) {
        if (s.outcome === 'sent') log(`floor: outcome ${s.jobId.slice(0, 8)}`)
      }
    }
  }

  const pager = await pagerBot(db)
  if (pager !== null) {
    // One pager per bot, built once and reused. `app.telegram_chat_for`
    // answers per bot (0136), so which bot carries a result decides whether it
    // lands in Grant's private chat or in the office group — and that is the
    // whole of "only the chief of staff messages me directly".
    const pagers = new Map<string, TelegramPager>()

    /*
      Only the chief speaks (0165).

      `direct_to_grant` decides WHICH CHAT somebody lands in, and it was already
      set to the chief — which routed everyone else into the office group, which
      Grant is a member of. Redirecting a message he can still read is not
      silence, and the Finance Director's daily report arriving in the group is
      what made that obvious.

      So this is the other question: whether they send at all. Returning null
      means no Telegram delivery for that person. The work still runs and the
      output is still written — the dashboard shows everything — and the
      `duty:<slug>` switches on the same page are how he stops the work itself.
    */
    const onlyChief = String(setup?.only_chief_speaks ?? '') === 'true'

    const pagerFor = async (staffSlug: string | null): Promise<TelegramPager | null> => {
      if (onlyChief && staffSlug !== null && staffSlug !== 'chief-of-staff') return null
      const bot = staffSlug === null ? pager : ((await botForStaff(db, staffSlug)) ?? pager)
      const existing = pagers.get(bot.botId)
      if (existing !== undefined) return existing
      const made = new TelegramPager(db, new TelegramClient(bot.token), {
        botId: bot.botId,
        // No subject named: the pager asks for the CLAIMED job's own office's person, not for a literal 'grant'.
      })
      pagers.set(bot.botId, made)
      return made
    }
    // The floor Grant set, and 'routine' when he has not.
    //
    // It used to be 'important', fixed at this call site, which meant the
    // office and the pager carried the identical sentence seconds apart. A
    // handler that wants to interrupt him says so now; this is the bar for a
    // handler with no opinion, and 0151 put it on the Settings page where he
    // can move it.
    const floorSetting = String(setup?.pager_floor ?? 'routine')
    channels.push(pagerChannel(pagerFor, floorSetting as PagerSeverity))
  }

  // The reply channel goes FIRST. An instruction that arrived in a Telegram
  // chat is answered in that chat, by the bot it was sent to — a reply from the
  // pager to a message sent to Ines would be a colleague answering through a
  // switchboard. Everything else still gets its usual delivery.
  const notify = combinedNotifier([replyChannel(db), ...channels], db)
  log(`setup: channels ready at ${String(Date.now() - buildStartedAt)}ms`)

  // Notebook operations are deterministic — the notebook accepted the source or
  // it did not — and §16 exempts those from review.
  const review: Reviewer = () =>
    Promise.resolve({ status: 'approved' as const, notes: 'Deterministic notebook operation.' })

  // Storage needs the service role key and the vault is where it lives. Read
  // here rather than in the handler: §15 keeps credential lookup in the
  // composition root, and a handler that reaches the vault itself is a handler
  // that cannot be tested without one.

  const handlers = [
    ...notebookHandlers(db),
    planHandler(db),
    capacityHandler(db, cannotThink ? null : new ProviderRouter(db, orKey)),
    briefingHandler(db, cannotThink ? null : new ProviderRouter(db, orKey)),
    driveWatchHandler(db),
    // #96. The other half of what drive.watch asks about: "Add them to the
    // project as source documents" was an option nothing implemented.
    driveReadHandler({ db, projectRef, serviceKey }),
    collectHandler({ db, projectRef, serviceKey }),
    calendarHandler(db),
    /*
      #109. Registered unconditionally and deliberately so.

      It only ever runs when `hq_disconnect` enqueued it, which happens because
      Grant pressed Disconnect — and the one moment it must not be missing is
      the moment a credential is parked waiting for it. A handler gated on
      `google.enabled` would be absent exactly when signing out matters most,
      and the parked token would sit there with no job that can reach it.
    */
    googleRevokeHandler(db),
    // The other direction: dated tasks into the diary (#94, ADR-0020). Off
    // until `calendar.sync_tasks` is turned on.
    calendarTasksHandler(db),
    jobTracesHandler(db),
    /*
      #21. The build diary pruned its rows and kept its pictures — 38 orphans
      against a 1 GB allowance. Registered beside the trace prune because it is
      the same duty wearing a different table.
    */
    buildShotsHandler({ db, projectRef, serviceKey }),
    /*
      A page the office is signed in to, read and photographed (#135, #16).

      Gather only. The unavailable adapter is what runs until somebody sets the
      two Vault entries, which is deliberate: the degradation path is the
      default path and gets exercised every day rather than only during an
      outage.
    */
    browserGatherHandler({ db, projectRef, serviceKey }),
    /*
      Running a workflow on demand, under the month's minute ceiling (#17).

      The ceiling lives in the database and `app.ci_reserve` is the only door,
      so registering this handler cannot widen what the office may spend.
    */
    ciDispatchHandler({ db }),
    /*
      Every dashboard project gets a channel, without anybody remembering (#187).

      TWO KINDS, ONE HANDLER. `office.provision_channels` is enqueued when a
      project is created; `office.rename_channels` has been enqueued by
      `app.hq_rename_project` since 0073 with NOTHING implementing it — eleven
      such jobs exist and every one of them is cancelled, so renaming a project
      has never renamed its channel. `ensureChannel` is idempotent and a rename
      is the case where the mapping exists and the name has moved, so one
      handler answers both honestly.

      Registered unconditionally, the way googleRevokeHandler is: an office
      with no Slack answers "Slack is not connected" from inside the handler,
      which is an outcome, rather than dying as NoHandlerError, which is not.
    */
    ...['office.provision_channels', 'office.rename_channels'].map((kind) =>
      channelsHandler({ db, botToken, teamId: slackTeamId }, kind),
    ),
    mailHandler(db),
    // §16's nightly copy. Registered unconditionally: the handler reports
    // "no storage key" as an outcome rather than failing, because a backup
    // that silently does not happen is the failure this whole thing is about.
    backupHandler({ db, projectRef, serviceKey }),
    // Slack's configuration tokens die twelve hours after they are issued and
    // the refresh token is single-use. A GitHub Actions cron used to renew
    // them; since it went, they have survived on whichever verification run
    // happened to rotate one.
    // Read from the install rather than pasted in: there is exactly one
    // enabled Slack app (§9's "V1 is ONE app") and it knows its own id. Came
    // back with the secrets above, in the same round trip.
    slackRotationHandler({
      db,
      appId: String(setup?.slack_app_id ?? ''),
      router: cannotThink ? null : new ProviderRouter(db, orKey),
    }),
    // The other corpus. Twenty pages shared with the integration and never
    // once read by anything outside a verification run.
    notionSyncHandler(db, cannotThink ? null : new ProviderRouter(db, orKey)),
    /*
      What the office could not do, turned into something Grant can answer.

      `app.raise_proposals` had no caller at all, so #49's loop ended in a
      table nobody filled: every proposal on the Governance page was a suite's
      fixture. The duty is daily (0473).

      The router is passed since 0489, when the round gained the other half of
      #49's loop: Claire SAYS what the office cannot do, once, rather than
      leaving it on a page he has to go and look at. Without a router `sayAs`
      falls back to its template, which is a worse sentence and still the
      whole message — the fallback is never silence.
    */
    proposeHandler(db, cannotThink ? null : new ProviderRouter(db, orKey)),
    choresHandler(db),
    remindersHandler(db),
    tasksSyncHandler(db),
    // "Use the Notion you already have" — a configuration change the office can
    // now make, rather than one that needed a terminal (0164).
    notionAdoptHandler({ db }),
    // And the composition of everything else: source material actually landing
    // in Notion as pages. Every capability existed and nothing put them
    // together, which is why the teamspace stayed empty (0166).
    notionImportHandler({ db, router: cannotThink ? null : new ProviderRouter(db, orKey) }),
    /*
      Finding the tasks inside something we have read (#130).

      `tasks_extracted` has been a declared and validated shape since 0272 and
      had never held a row — a contract nothing produces, which is the same
      family as a column nothing writes.
    */
    extractTasksHandler({ db, router: cannotThink ? null : new ProviderRouter(db, orKey) }),
    /*
      Carrying out a plan the office composed (#283).

      Carrying out a plan is deterministic — an executor reads or writes
      canonical state and returns receipts — with ONE exception. `draft.create`
      composes prose from what the earlier steps found, which is not a query
      and cannot be assembled from columns, so the router is passed for that
      step alone. Without one it reports an honest impediment rather than
      writing something plausible, which is why it is optional rather than
      mocked.
    */
    pursueHandler({ db, ...(cannotThink ? {} : { router: new ProviderRouter(db, orKey) }) }),
    /*
      Turning a request into a finished file (#258).

      Registered here with the storage credentials because the pipeline ends in
      Storage and in a document row, and a handler that could write the report
      and not keep it would be the half-capability the Issue is about.
    */
    artifactHandler({
      db,
      projectRef,
      router: cannotThink ? null : new ProviderRouter(db, orKey),
      serviceKey,
    }),
    /*
      And the job that waits for several specialists and answers (#262).

      Registered beside the rest because a branch is an ordinary job and so is
      this: no orchestrator, no scheduler, nothing running between ticks. It
      wakes, asks whether the branches are in, and pauses itself when they are
      not.
    */
    synthesiseHandler({ db, router: cannotThink ? null : new ProviderRouter(db, orKey) }),
    /*
      Asking an outside MCP provider what it offers (#265).

      No router: discovery is two JSON-RPC calls and a classification made from
      a table of words, deliberately reproducible and deliberately arguable.
    */
    mcpDiscoverHandler({ db }),
    // Registered though its duty is off: the handler being absent is what made
    // 0133 seed the duty disabled in the first place, and a handler nobody can
    // reach is a handler nobody finds out is broken. Switching the duty on is
    // one UPDATE.
    vaultExportHandler(db),
    // §22 A's first clause — a source arriving is noticed — but only where the
    // notebook can actually be read. See `notebook` in the options above.
    syncHandler({
      db,
      router: cannotThink ? null : new ProviderRouter(db, orKey),
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
          instructionHandler({
            db,
            router: new ProviderRouter(db, orKey),
            ...(options.now === undefined ? {} : { now: options.now }),
          }),
          // §22 A's first clause: a source arriving is read by Research. 0107's
          // trigger makes the job; without this handler it would park.
          sourceHandler({ db, router: new ProviderRouter(db, orKey) }),
        ]),
  ]

  log(`setup: done at ${String(Date.now() - buildStartedAt)}ms`)

  const pass = async (): Promise<PassResult> => {
    const passStartedAt = Date.now()
    const at = (what: string): void => log(`${what} at ${String(Date.now() - passStartedAt)}ms`)
    // Button presses first. Approving a generation enqueues it, so pressing the
    // button and getting the artifact in the same pass is the difference
    // between "it works" and "it works eventually".
    // A pass never dies on the press step (a schema older than the code, a transient error): the drain follows.
    const pressed = await processCallbacks(db).catch((error: unknown) => {
      log(`button step failed: ${String((error as Error).message).slice(0, 120)}`)
      return [] as Awaited<ReturnType<typeof processCallbacks>>
    })
    for (const p of pressed) log(`button ${p.action}: ${p.outcome} — ${p.note.slice(0, 100)}`)

    // An instruction that never became a job, before anything else.
    //
    // The floor under the adapters (0148). Slack stored thirty commands over
    // three days and enqueued none of them, and nothing noticed because a
    // filed command looks exactly like a handled one unless you join it to
    // `jobs`. Never fatal: a sweep that throws must not stop the queue being
    // drained.
    try {
      const swept = Number((await db.execute('select app.enqueue_orphans() as n')).rows[0]?.n ?? 0)
      if (swept > 0) log(`swept ${String(swept)} instruction(s) that had no job`)
    } catch (error) {
      log(`orphan sweep: ${(error as Error).message.slice(0, 100)}`)
    }

    // Recurring duties before the drain, so one fired this pass is worked this
    // pass.
    const duties = await fireDueDuties(db)
    for (const fired of duties) log(`duty: ${fired}`)

    at('drain starts')
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
    at('drain done')
    for (const r of done) log(`${r.jobId.slice(0, 8)} ${r.finalState}: ${r.note.slice(0, 120)}`)

    // Never fatal. A narration channel that fails takes nothing with it: the
    // work is done and delivered, and the running commentary is the least
    // important thing here.
    // Only when something happened. `narrateHandoffs` costs nine seconds of a
    // twenty-two second empty pass — it re-reads recent decisions and asks
    // Slack about the channel — and on a pass that handled nothing there is by
    // definition nothing new to narrate. Grant is waiting at the other end of
    // this; the running commentary can wait for a pass that has something to
    // comment on.
    /*
      ANYTHING THAT HAS BEEN QUIET TOO LONG (#282).

      UNCONDITIONAL, and that is the whole point: a pass that handled nothing
      is exactly the pass where a long job is sitting there and Grant is
      watching nothing. Gating it on `done.length` the way the floor channel is
      gated would silence it in precisely the case it exists for.

      Measured before it was built — 335 real turns over a fortnight, median
      21s, p90 259s, and 30 of them over five minutes. Never fatal: a courtesy
      note that fails must not take the pass with it.
    */
    try {
      for (const s of await sayStillWorking(db)) {
        if (s.outcome === 'sent') log(`progress: still working on ${s.jobId.slice(0, 8)}`)
      }
    } catch (error) {
      log(`progress: ${(error as Error).message.slice(0, 120)}`)
    }

    if (floor !== null && done.length > 0) {
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

  // The registry, readable from outside. See the note on `Pass` above.
  return Object.assign(pass, { kinds: handlers.map((h) => h.kind), handlers, review })
}
