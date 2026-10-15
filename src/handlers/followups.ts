/**
 * The handler behind the `followup-unanswered` duty (REG-029, COS-127).
 *
 * Grant's rule for this feature: an email is never sent on his behalf. This handler creates a TASK on his list and
 * nothing else. It has no path to a mail send, and `gmail.send` is disabled in the registry.
 *
 * ## What it does
 *
 * For each live project of the job's office, it asks `app.mail_awaiting` which threads have gone quiet for the window,
 * in either direction (he has not replied, or they have not replied to him). For each such thread that has NO
 * follow-up task yet, it writes one task owned by the Chief of Staff, with the contact, the action, the source thread
 * and the current state in the detail, and no due date (the spec says never invent one).
 *
 * ## Once per thread, not once per run
 *
 * The duty runs daily. A thread already carrying a follow-up task is skipped whatever that task's state, so a task
 * he has ticked does not come back the next morning. The marker in the detail is the dedupe key; it is written by
 * this handler and nowhere else.
 *
 * ## Quiet
 *
 * `announce` is false. The task is the notification, the same reasoning the chores duty uses.
 */
import { CHIEF_OF_STAFF } from '../agents/task-home.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export const WINDOW_DAYS = 7
const LIMIT_PER_PROJECT = 20

interface Awaiting {
  readonly thread_id: string
  readonly subject: string
  readonly with: string
  readonly waiting: string
  readonly days: number
}

export function followupsHandler(db: SqlExecutor): Handler {
  return {
    kind: 'office.followups',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`, 'db:mail_messages', 'db:tasks'],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
        announce: false,
      }
      const office = job.officeId ?? null
      if (office === null) {
        return {
          ...base,
          body: 'No follow-ups were checked: this run has no office to check them for.',
        }
      }

      const projects = (
        await db.execute(`
          select p.project_id::text as project_id
            from public.projects p
           where p.office_id = ${lit(office)}::uuid
             and p.status = 'active'
             and not p.is_fixture
           order by p.project_id`)
      ).rows as { project_id: string }[]

      let raised = 0
      let already = 0
      const refused: string[] = []
      for (const { project_id } of projects) {
        const raw = (
          await db.execute(
            `select app.mail_awaiting(app.job_office(${lit(job.jobId)}::uuid), ${lit(project_id)}::uuid, ${String(WINDOW_DAYS)}, ${String(LIMIT_PER_PROJECT)})::text as r`,
          )
        ).rows[0] as { r?: unknown } | undefined
        const items = (
          typeof raw?.r === 'string' ? JSON.parse(raw.r) : (raw?.r ?? [])
        ) as Awaiting[]

        for (const item of items) {
          const marker = `[thread ${item.thread_id}]`
          const seen = (
            await db.execute(
              `select 1 from public.tasks where office_id = ${lit(office)}::uuid
                and project_id = ${lit(project_id)}::uuid
                and detail like ${lit(`%${marker}%`)} limit 1`,
            )
          ).rows.length
          if (seen > 0) {
            already += 1
            continue
          }
          const action =
            item.waiting === 'you have not replied'
              ? `Reply to ${item.with}.`
              : `Ask ${item.with} whether they have seen your message.`
          const detail =
            `Contact: ${item.with}. Action: ${action} ` +
            `Source: email thread "${item.subject}", quiet for ${String(item.days)} days. ` +
            `Current state: ${item.waiting}. Draft reply: not prepared. ${marker}`
          const title = `Follow up: ${item.with} about ${item.subject}`.slice(0, 180)
          const raisedRow = (
            await db.execute(`select app.task_add(p_office => ${lit(office)}::uuid,
              p_project => ${lit(project_id)}::uuid,
              p_title => ${lit(title)}, p_detail => ${lit(detail)}, p_due_on => null,
              p_assignee => ${lit(CHIEF_OF_STAFF)}, p_milestone => false,
              p_added_by => 'the office', p_job => ${lit(job.jobId)}::uuid) as t`)
          ).rows[0] as { t?: unknown } | undefined
          const t = (typeof raisedRow?.t === 'string' ? JSON.parse(raisedRow.t) : raisedRow?.t) as
            | { id?: string; error?: string }
            | undefined
          if (typeof t?.id === 'string') raised += 1
          else refused.push(`${item.with}: ${String(t?.error ?? 'no task id came back')}`)
        }
      }

      const body =
        raised === 0 && already === 0 && refused.length === 0
          ? 'Nothing has gone quiet long enough to need a follow-up.'
          : `${String(raised)} follow-up ${raised === 1 ? 'task' : 'tasks'} added to the list. ` +
            `${String(already)} ${already === 1 ? 'thread was' : 'threads were'} already on the list.` +
            (refused.length === 0
              ? ''
              : ` ${String(refused.length)} could not be added: ${refused.join('; ')}.`)
      return { ...base, body }
    },
  }
}
