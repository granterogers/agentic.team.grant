/**
 * Run one discovery and sync cycle.
 *
 *   npm run sync
 *
 * This is what the ten-minute schedule invokes. It exits **zero on a degraded
 * cycle** and non-zero only when the cycle could not be attempted at all — a
 * Notebook outage is Phase 4's "degrades rather than fails", and a scheduler
 * that saw a red run every ten minutes during an outage would train everyone
 * to ignore it.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { UnavailableNotebookAdapter } from '../../src/notebook/adapter.ts'
import { LiveNotebookAdapter } from '../../src/notebook/live-adapter.ts'
import { notebookEnabled } from '../../src/notebook/sync-queue.ts'
import { runSync, SyncAlreadyRunningError } from '../../src/projects/sync.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

// §17's kill-switch, checked first. A disabled adapter must not be reached by
// a scheduled job any more than by an interactive one, and the switch is
// worthless if the cron path ignores it.
if (!(await notebookEnabled(db))) {
  console.log('notebook.enabled is false; nothing to do.')
  process.exit(0)
}

const live = await LiveNotebookAdapter.fromVault(db)
if (live === null) {
  // No credential is a state, not a crash. The unavailable adapter is
  // installed so the run records a proper `failed` cycle with a reason,
  // rather than the process dying and leaving no trace of the attempt.
  const outcome = await runSync({
    db,
    adapter: new UnavailableNotebookAdapter(),
    listNotebooks: async () => [],
    workerId: `sync-${process.pid}`,
  })
  console.log(`run ${outcome.runId}: ${outcome.state} - ${outcome.detail}`)
  process.exit(0)
}

// A worker id that identifies the machine as well as the process, because the
// lease is what distinguishes "a worker is on this" from "a worker died on
// this" and a bare pid repeats across containers.
const workerId = `${process.env.GITHUB_RUN_ID ?? 'local'}-${String(process.pid)}`

try {
  const outcome = await runSync({
    db,
    adapter: live,
    listNotebooks: async () => live.listNotebooks(),
    workerId,
  })

  console.log(`run ${outcome.runId}: ${outcome.state}`)
  console.log(`  notebooks seen:    ${String(outcome.notebooksSeen)}`)
  console.log(`  projects created:  ${String(outcome.projectsCreated)}`)
  console.log(`  sources seen:      ${String(outcome.sourcesSeen)}`)
  console.log(`  sources added:     ${String(outcome.sourcesAdded)}`)
  console.log(`  sources changed:   ${String(outcome.sourcesChanged)}`)
  console.log(
    `  sources missing:   ${String(outcome.sourcesRemoved)} (counted, deliberately not deleted)`,
  )
  console.log(`  detail:            ${outcome.detail}`)

  // Zero even on `failed`. See the header: a degraded cycle is the designed
  // behaviour, not an error the scheduler should escalate.
  process.exit(0)
} catch (error) {
  if (error instanceof SyncAlreadyRunningError) {
    // Two ticks overlapping is normal on a ten-minute schedule with a slow
    // cycle, and is exactly what the partial unique index is for. Not a
    // failure.
    console.log('another sync is in flight; leaving it to finish.')
    process.exit(0)
  }
  console.error(`the sync could not be attempted: ${(error as Error).message.slice(0, 400)}`)
  process.exit(1)
}
