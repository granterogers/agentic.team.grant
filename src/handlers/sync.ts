/**
 * The handler behind the `discovery-sync` duty.
 *
 * §22 scenario A opens with two clauses:
 *
 *   "Grant adds a source to the Money Mastery Notebook from his phone →
 *    detected within the sync interval"
 *
 * `runSync` has done the detecting since Phase 4. What never existed was
 * anything that called it on a schedule from inside the office: the ten-minute
 * cron lived in GitHub Actions, Actions are switched off, and 0133 seeded the
 * duty `enabled = false` because there was no handler for its job kind. So the
 * first clause of the completion criterion has been unowned for four days.
 *
 * This is that owner. It is deliberately thin — a handler, not a second
 * implementation of sync — because `scripts/projects/sync.ts` already had the
 * right shape and a duplicate would be the copy that drifts.
 *
 * ## Where it can run
 *
 * Anywhere, as of 0138 — and it very nearly could not run anywhere at all.
 *
 * Reading a notebook went through `scripts/notebook/read.py` in a subprocess,
 * which no remaining runtime has: Actions are off and the only worker is a
 * Deno Edge Function. 0137 recorded that honestly and left these jobs queued
 * for a machine nobody had rented yet.
 *
 * Measuring the dependency was the way out. `notebooklm-py` needs `httpx`, not
 * a browser — Playwright is only on the login path, which happened once, by
 * hand, months ago. So the read is an ordinary HTTPS call, `api/notebook.py`
 * serves it from the Vercel project already hosting Team HQ, and
 * `HttpNotebookAdapter` is what this handler gets by default.
 *
 * ## Why a Notebook outage is a `complete` job, not a failed one
 *
 * Phase 4's acceptance requires an outage to *degrade*. `runSync` returns a
 * `failed` RUN with a reason rather than throwing, and a failed run is a real
 * outcome: we looked, and could not see. Reporting that as a failed JOB would
 * retry it three times, page nobody usefully, and make an hour of Google being
 * unavailable indistinguishable from the worker being broken.
 *
 * The distinction is carried in the body, which says plainly that we could not
 * read. Deliberately NOT in `evidence`: the enum is `verified | inferred |
 * speculative` and describes how a FINDING was arrived at. A failed cycle has
 * no finding — the only claim in the output is "we tried and could not see",
 * and that claim is verified. Downgrading it to `speculative` would say we
 * guessed at the outage, which is the opposite of what happened.
 */

import { howComposed } from '../agents/provenance.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { officeOfJob } from '../db/office.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { type NotebookAdapter, UnavailableNotebookAdapter } from '../notebook/adapter.ts'
import { notebookEnabled } from '../notebook/sync-queue.ts'
import { type RemoteNotebook, runSync, SyncAlreadyRunningError } from '../projects/sync.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { count } from '../text/plain.ts'
import { sayAs } from '../text/voice.ts'

export interface SyncHandlerDeps {
  readonly db: SqlExecutor
  /**
   * Who writes the message, when there is one worth writing.
   *
   * Null means the template speaks instead. See `src/text/voice.ts`: the
   * facts are the handler's either way; only the sentence changes.
   */
  readonly router?: ProviderRouter | null
  /**
   * How to build the live adapter, injected.
   *
   * `src/handlers/` exists precisely so a handler can bridge the notebook and
   * the job engine while neither imports it (see `notebook.ts`), and
   * `tests/notebook/isolation.test.ts` enforces that. Taking the adapter as a
   * dependency keeps the live one — which reaches the vault and a subprocess —
   * out of this file, and lets a test drive the whole handler with a fixture.
   */
  readonly adapter: () => Promise<{
    readonly adapter: NotebookAdapter
    readonly listNotebooks: () => Promise<readonly RemoteNotebook[]>
  } | null>
  readonly workerId: string
}

export function syncHandler(deps: SyncHandlerDeps): Handler {
  const { db, adapter, workerId } = deps
  const router = deps.router ?? null
  return {
    kind: 'office.sync',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }

      // §17's kill-switch, checked before anything else. A switch that the
      // scheduled path ignores is not a switch.
      if (!(await notebookEnabled(db))) {
        return {
          ...base,
          body: 'Notebook is switched off, so there was nothing to look for.',
          evidence: 'verified',
          announce: false,
        } satisfies HandlerOutput
      }

      const live = await adapter()

      let outcome: Awaited<ReturnType<typeof runSync>>
      try {
        outcome = await runSync({
          db,
          // No credential is a state, not a crash. The unavailable adapter is
          // installed so the cycle is RECORDED as failed with a reason — an
          // attempt that left no trace would make "we have not looked since
          // Tuesday" invisible.
          adapter: live?.adapter ?? new UnavailableNotebookAdapter(),
          listNotebooks: live?.listNotebooks ?? (async () => []),
          workerId,
          // The cycle runs for the claimed job's office: its projects, sources, run record and budget.
          officeId: await officeOfJob(db, job.jobId),
        })
      } catch (error) {
        if (error instanceof SyncAlreadyRunningError) {
          // Two duties firing close together, or a previous run still holding
          // its lease. Not a failure of anything: the other run is doing the
          // work.
          return {
            ...base,
            body: 'A sync was already running, so this one stood down.',
            evidence: 'verified',
            announce: false,
          } satisfies HandlerOutput
        }
        throw error
      }

      if (outcome.state === 'failed') {
        return {
          ...base,
          body: `Could not read the notebooks this time: ${outcome.detail}`,
          // News. Not being able to see is the one outcome of this duty that
          // is worth interrupting someone over.
          announce: true,
          // `verified` and `high`, which looks wrong for a failure and is not:
          // the claim being made is about the ATTEMPT, and we know exactly
          // what happened to it. The run is recorded as failed in
          // `notebook_sync_runs`, which is where "we have not managed to look
          // since Tuesday" is answered from.
          evidence: 'verified',
        } satisfies HandlerOutput
      }

      // Written as a sentence rather than a table of counters. Nobody reads
      // this unless something arrived, and when something did, the useful
      // sentence is which thing.
      const parts: string[] = []
      if (outcome.projectsCreated > 0) {
        parts.push(`${count(outcome.projectsCreated, 'new project', 'new projects')}`)
      }
      if (outcome.sourcesAdded > 0) {
        parts.push(`${count(outcome.sourcesAdded, 'new source', 'new sources')}`)
      }
      if (outcome.sourcesChanged > 0) {
        parts.push(`${count(outcome.sourcesChanged, 'change', 'changes')}`)
      }

      const body =
        parts.length === 0
          ? `Looked through ${count(outcome.notebooksSeen, 'notebook', 'notebooks')}. ` +
            'Nothing new.'
          : `${parts.join(', ')} across ` +
            `${count(outcome.notebooksSeen, 'notebook', 'notebooks')}.` +
            // Counted, never deleted — `countRemoved` explains why a source
            // that vanished is a thing to notice rather than act on.
            /*
              Reconciled now, under ADR-0040, rather than only counted.

              The three states are said separately because they mean different
              things to Grant: MISSING is a first absence and nothing has
              changed yet; ARCHIVED is out of the office's answers but still on
              record and restorable; BACK is something that returned and can be
              answered from again. Collapsing them into "3 sources removed"
              would report a provider hiccup and a real deletion in the same
              words.
            */
            (outcome.sourcesArchived === 0
              ? ''
              : ` ${count(outcome.sourcesArchived, 'source', 'sources')} missing for a second ` +
                'time, so out of our answers now — still on record and restorable.') +
            (outcome.sourcesRestored === 0
              ? ''
              : ` ${count(outcome.sourcesRestored, 'source', 'sources')} came back and ` +
                'can be answered from again.') +
            (outcome.sourcesRemoved - outcome.sourcesArchived <= 0
              ? ''
              : ` ${count(outcome.sourcesRemoved - outcome.sourcesArchived, 'source', 'sources')} ` +
                'missing from this listing for the first time — marked, not hidden.') +
            /*
              A refusal is the loudest thing in this message, deliberately.

              `app.reconcile_vanished` declines a pass that would archive more
              than half of a notebook, because that is an auth failure far more
              often than a deletion. A sync that quietly declined would be the
              same defect as one that quietly emptied the cache, with nothing
              to see.
            */
            (outcome.reconcileRefusals.length === 0
              ? ''
              : ` ${String(outcome.reconcileRefusals.length)} notebook(s) looked emptied rather ` +
                'than edited, so nothing was archived there: ' +
                `${outcome.reconcileRefusals[0] ?? ''}`)

      // Hourly, and almost always "nothing new". Announcing that is how a
      // channel stops being read — Marcus said it to Grant on two surfaces
      // every hour for a day before this line existed.
      /*
        Archiving is an event even when nothing new arrived.

        `parts` counts additions and changes, and the hourly "nothing new" is
        deliberately silent (#57). But material LEAVING the office's answers is
        exactly the kind of thing Grant should hear about the first time, and
        so is a refusal to reconcile.
      */
      const announce =
        parts.length > 0 ||
        outcome.sourcesArchived > 0 ||
        outcome.sourcesRestored > 0 ||
        outcome.reconcileRefusals.length > 0
      /*
        THE BODY FIRST. Same defect as `notion-sync`, same handler family, and
        the comment below names this very job kind as the case 0489 was
        written for.

        `path` and `body` were both properties of one object literal, and an
        object literal evaluates in SOURCE ORDER — so `howComposed` counted the
        correlation's inferences BEFORE `sayAs` on the next line spent one,
        answered `deterministic_retrieval`, and the insert was then refused by
        `enforce_deterministic_claim`. 0489 fixed the question and left the
        order, which is why the failures continued after it shipped.

        Written by Marcus when it is going to reach anybody, and left as the
        template when it is not — there is no point spending a model call on a
        sentence nobody will read.
      */
      const said = announce
        ? await sayAs(db, router, 'operations-director', {
            purpose:
              'Tell Grant what turned up in his notebooks. This is a routine ' +
              'hourly check and most of them find nothing, so keep it brief ' +
              'and do not make it sound like an event.',
            facts: [
              `${String(outcome.notebooksSeen)} notebook(s) were read`,
              `${String(outcome.projectsCreated)} new project(s)`,
              `${String(outcome.sourcesAdded)} new source(s)`,
              `${String(outcome.sourcesChanged)} source(s) changed`,
              `${String(outcome.sourcesRemoved)} source(s) we held are no longer listed`,
              `${String(outcome.sourcesArchived)} archived after a second absence (still on record)`,
              `${String(outcome.sourcesRestored)} came back out of the archive`,
              `${String(outcome.reconcileRefusals.length)} notebook(s) refused reconciliation as too big a change`,
            ],
            fallback: body,
            // #268: attributed, so the call lands under this job KIND rather
            // than under (unattributed).
            job: { jobId: job.jobId, correlationId: job.correlationId },
            words: 45,
          })
        : body
      // Asked AFTER the model has or has not been spent.
      const composed = await howComposed(db, job.jobId)

      return {
        ...base,
        /*
          Read from the record (0489). This return spends a model whenever
          `announce` is true, and `base` claims `deterministic_retrieval` —
          which `enforce_deterministic_claim` refuses on any correlation that
          recorded an inference, so the output was discarded and the job
          FAILED. `office.sync` did exactly that twice, most recently 08:02 on
          18 September.

          Overridden here rather than in `base`: the OTHER returns in this
          handler are templated and the exemption is true for them, and losing
          it everywhere would send routine hourly output through quality
          review for nothing.
        */
        path: composed,
        body: said,
        evidence: 'verified',
        announce,
      } satisfies HandlerOutput
    },
  }
}
