/**
 * What a job kind can do outside this office, and the one place that decides
 * whether harness work may do it (#378).
 *
 * Messages already have a chokepoint: every send goes through
 * `app.claim_delivery`, which asks `app.delivery_refusal`. Nothing like it
 * stood in front of the handlers that write to somebody else's system. A
 * harness turn that asked for a Notion page got a real Notion page, and one
 * that said "make a notebook called X" got a real notebook in Grant's
 * NotebookLM account, because `office.notion_import` and `office.execute_plan`
 * are children of `office.instruction` and a harness instruction is still an
 * instruction. `app.harness_job` follows the lineage, so the answer was
 * available the whole time; nothing asked it before the handler ran.
 *
 * ## Why here, and why a registry
 *
 * `runJob` is the only thing that runs a handler for the office, so a check
 * before `handler.handle` covers every kind at once, including the ones
 * written next month. Checks inside each handler would be as many copies as
 * there are handlers, and the one somebody forgets is the one that leaks.
 *
 * The registry is what makes it fail closed. A kind that is not listed is
 * treated as one that writes outside the office, so a new handler whose author
 * never thought about containment is contained anyway; and
 * `tests/jobs/containment.test.ts` refuses a handler kind that is not listed,
 * so the author is made to think about it before the change can land.
 *
 * ## What is NOT gated, and why
 *
 * `reads` kinds fetch from a third party and change nothing there. A harness
 * reading a web page or listing notebooks has no audience, and gating reads
 * would stop the suites that exist to prove reading works.
 *
 * `internal` kinds write only to this office's own tables. Whatever they send
 * goes through the delivery layer, where `app.claim_delivery` decides.
 * `office.instruction` is internal for exactly that reason -- its one direct
 * send (the voice-note transcript echo) is routed through the delivery layer
 * separately, rather than making every harness instruction impossible.
 */
import type { SqlExecutor } from '../db/executor.ts'

export type Reach =
  /** Writes only to this office's own database; sends only through the delivery layer. */
  | 'internal'
  /** Reads from a third party and changes nothing there. */
  | 'reads'
  /** Changes something in a third party's system, or sends outside the delivery layer. */
  | 'external'

export interface KindReach {
  readonly reach: Reach
  /** Who is on the other end, in the words the refusal uses. Required for `external`. */
  readonly service?: string
}

export const REACH: Readonly<Record<string, KindReach>> = {
  // --- external: changes something outside the office ------------------------
  'notebook.add_source': { reach: 'external', service: 'NotebookLM' },
  'notebook.push_document': { reach: 'external', service: 'NotebookLM' },
  'notebook.generate': { reach: 'external', service: 'NotebookLM' },
  'office.execute_plan': { reach: 'external', service: 'NotebookLM' },
  'office.notion_import': { reach: 'external', service: 'Notion' },
  'office.notion_adopt': { reach: 'external', service: 'Notion' },
  'office.notion_sync': { reach: 'external', service: 'Notion' },
  'google.write_calendar_tasks': { reach: 'external', service: 'Google Calendar' },
  'calendar.sync_events': { reach: 'external', service: 'Google Calendar' },
  'google.revoke': { reach: 'external', service: 'Google' },
  'ci.dispatch': { reach: 'external', service: 'GitHub' },
  'office.provision_channels': { reach: 'external', service: 'Slack' },
  'office.rename_channels': { reach: 'external', service: 'Slack' },
  'office.slack_rotate': { reach: 'external', service: 'Slack' },
  'office.vault_export': { reach: 'external', service: 'Telegram' },
  'tasks.sync': { reach: 'external', service: 'the task board' },
  'microsoft.todo_sync': { reach: 'external', service: 'Microsoft To Do' },

  // --- reads: fetches from a third party, changes nothing there -------------
  'browser.gather': { reach: 'reads' },
  'drive.index': { reach: 'reads' },
  'drive.read_file': { reach: 'reads' },
  'drive.watch': { reach: 'reads' },
  'google.read_calendar': { reach: 'reads' },
  'google.read_mail': { reach: 'reads' },
  'knowledge.read_source': { reach: 'reads' },
  'mcp.discover': { reach: 'reads' },
  'notebook.ask': { reach: 'reads' },
  'notebook.collect': { reach: 'reads' },
  'notebook.collect_artifact': { reach: 'reads' },
  'notebook.list_artifacts': { reach: 'reads' },
  'office.sync': { reach: 'reads' },
  'web.research': { reach: 'reads' },

  // --- internal: this office's own tables, and the delivery layer -----------
  'artifact.report': { reach: 'internal' },
  'briefing.morning': { reach: 'internal' },
  'office.backup': { reach: 'internal' },
  'office.capacity_report': { reach: 'internal' },
  // G-1 (1026): measures this deployment's own size and says it through the delivery layer; reaches nothing else.
  'office.capacity_watch': { reach: 'internal' },
  'office.chores': { reach: 'internal' },
  'office.extract_tasks': { reach: 'internal' },
  // REG-029: a follow-up is a task on Grant's list. It reaches nothing outside the office.
  'office.followups': { reach: 'internal' },
  'office.instruction': { reach: 'internal' },
  'office.propose': { reach: 'internal' },
  'office.prune_build_shots': { reach: 'internal' },
  'office.prune_job_traces': { reach: 'internal' },
  'office.pursue': { reach: 'internal' },
  'office.synthesise': { reach: 'internal' },
  'style.adopt': { reach: 'internal' },
  'tasks.remind': { reach: 'internal' },
}

/** Unlisted means external: the safe reading of a kind nobody has classified. */
export const reachOf = (kind: string, declared?: Reach): KindReach =>
  REACH[kind] ??
  (declared === undefined
    ? { reach: 'external', service: 'an unclassified destination' }
    : { reach: declared, service: 'an unclassified destination' })

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * Why this job may not run here, or null when it may.
 *
 * Asks `app.job_origin` (0603), the same question the delivery guard asks
 * through `app.delivery_refusal`, so "may touch the outside world" means one
 * thing on both sides of the office. Only `trusted` (a turn a production
 * adapter produced) and `internal` (a job the office itself creates) may run.
 * `harness` and `unknown` are refused, and so is a question that cannot be
 * answered -- the database refused, the job row is gone, the answer is not a
 * word we know. An unanswerable question about where work came from is not
 * permission to write to Grant's Notion.
 *
 * Deploy order: this worker ships before 0603. On a database that does not
 * have `app.job_origin` yet (and only then -- recognised by Postgres's
 * undefined-function error, 42883) it asks `app.harness_job` instead, which
 * is exactly the gate the previous worker had. Any other error still refuses.
 */
export const containmentRefusal = async (
  db: SqlExecutor,
  job: { readonly jobId: string; readonly kind: string },
  /** What the handler says about itself; ignored for a kind the registry lists. */
  declared?: Reach,
): Promise<string | null> => {
  const { reach, service } = reachOf(job.kind, declared)
  if (reach !== 'external') return null
  const to = String(service)
  // P3: an existence test on the claimed job id; returns a boolean about that one row.
  const known = `exists (select 1 from public.jobs where job_id = ${lit(job.jobId)}::uuid) as known`
  let origin: string | null = null
  try {
    const { rows } = await db.execute(
      `select app.job_origin(${lit(job.jobId)}::uuid) as o, ${known}`,
    )
    const row = rows[0] as { o?: unknown; known?: unknown } | undefined
    origin = row?.known === true && typeof row.o === 'string' ? row.o : null
  } catch (error) {
    if (
      !/42883|function app\.job_origin\(uuid\) does not exist/.test(
        String((error as Error).message),
      )
    ) {
      origin = null
    } else {
      try {
        const { rows } = await db.execute(
          `select app.harness_job(${lit(job.jobId)}::uuid) as h, ${known}`,
        )
        const row = rows[0] as { h?: unknown; known?: unknown } | undefined
        origin =
          row?.known === true && typeof row.h === 'boolean' ? (row.h ? 'harness' : 'trusted') : null
      } catch {
        origin = null
      }
    }
  }
  if (origin === 'trusted' || origin === 'internal') return null
  if (origin === 'harness') return `contained: harness work may not write to ${to}`
  if (origin === 'unknown')
    return `contained: no production door or office process made this work, so it may not write to ${to}`
  return `contained: could not establish where this job came from, so it may not write to ${to}`
}
