/**
 * What work is IN a project, as canonical state a model can read (#408).
 *
 * The office retrieved a project's documents and the person's own to-do list and read a project's tasks from nowhere,
 * so "what is overdue on the trip" was answered, truthfully, with "I don't see any". The reader is
 * `app.project_work_brief` (0869): one office, one project, bounded, most pressing first.
 *
 * Which projects, and why only those:
 *   - the project the turn is filed under, when it is a real one (the reserved catch-all holds conversations, not
 *     work, so it contributes nothing and is never searched as though it did);
 *   - a project the question NAMES, by name or alias, which is the clearest sign the question is about it. A person
 *     asking from a different project about "the Japan trip" has said which one they mean;
 *   - never the rest. A project that is not asked about is not put in front of a model, so a Wellness question is not
 *     answered from the Finance project's tasks.
 *
 * Stated as a FACT and never as an order (CLAUDE.md, `projectSpine`): a block with "do not invent" in it is one a
 * model over-obeys. The block is either accurate or says the project holds no tasks, and both are facts.
 */
import type { SqlExecutor } from '../db/executor.ts'

/** Most projects whose work one turn may carry. The asking project plus one named elsewhere is a conversation; more is a dump. */
export const MAX_PROJECTS_OF_WORK = 2

export interface WorkTask {
  readonly title: string
  readonly state: string
  readonly due_on: string | null
  readonly starts_on: string | null
  readonly late: boolean
  readonly who: string | null
  readonly milestone: boolean
  readonly under: string | null
  readonly labels: readonly string[] | null
  readonly blocked_on: string | null
  readonly note: string | null
}

export interface WorkBrief {
  readonly project_id: string
  readonly name: string
  readonly today: string
  readonly counts: {
    readonly open: number
    readonly done: number
    readonly overdue: number
    readonly blocked: number
    readonly total: number
  }
  readonly shown: number
  readonly tasks: readonly WorkTask[]
  /** True for the project this conversation is filed under, so "this project" has a referent in front of the model. */
  readonly here?: boolean
}

const sentence = (t: WorkTask): string => {
  const bits: string[] = []
  if (t.state === 'blocked')
    bits.push(t.blocked_on !== null && t.blocked_on !== '' ? `blocked: ${t.blocked_on}` : 'blocked')
  else if (t.state === 'doing') bits.push('in progress')
  else if (t.state === 'done') bits.push('done')
  if (t.starts_on !== null && t.due_on !== null && t.starts_on !== t.due_on)
    bits.push(`${t.starts_on} to ${t.due_on}`)
  else if (t.due_on !== null) bits.push(`due ${t.due_on}${t.late ? ' (late)' : ''}`)
  if (t.who !== null && t.who !== '') bits.push(`with ${t.who}`)
  if (t.under !== null && t.under !== '') bits.push(`under "${t.under}"`)
  if (t.labels !== null && t.labels.length > 0) bits.push(`[${t.labels.join(', ')}]`)
  return `- ${t.milestone ? 'Milestone: ' : ''}${t.title}${bits.length === 0 ? '' : ` (${bits.join('; ')})`}${
    t.note === null ? '' : ` - ${t.note}`
  }`
}

/** One project's work as a prompt fragment. Empty for nothing, so the caller can tell a project with no tasks from no read. */
export function projectWorkSpine(briefs: readonly WorkBrief[]): string {
  if (briefs.length === 0) return ''
  return briefs
    .map((b) => {
      const c = b.counts
      const head =
        c.total === 0
          ? `The project "${b.name}"${b.here === true ? ' (the project this conversation is about)' : ''} holds no tasks.`
          : `Tasks on the project "${b.name}"${b.here === true ? ' (the project this conversation is about)' : ''} (today is ${b.today}): ${String(c.open)} open, ${String(c.done)} done` +
            `${c.overdue > 0 ? `, ${String(c.overdue)} overdue` : ''}${c.blocked > 0 ? `, ${String(c.blocked)} blocked` : ''}.` +
            (b.shown < c.total
              ? ` The ${String(b.shown)} most pressing are listed; the other ${String(c.total - b.shown)} are not shown here.`
              : ' All of them are listed.')
      return c.total === 0 ? head : `${head}\n${b.tasks.map(sentence).join('\n')}`
    })
    .join('\n\n')
}

interface Named {
  readonly project_id: string
  readonly name: string
}

/**
 * The work of the projects this turn is about, read for the job's own office.
 *
 * `[]` on any failure, and the caller treats that as "not read", never as "empty": a failed read must not become the
 * claim that a project has no tasks (the list that could not be read is not the list that is empty).
 */
export async function readProjectWork(
  db: SqlExecutor,
  jobId: string,
  projectId: string | null,
  question: string,
  lit: (v: string) => string,
): Promise<readonly WorkBrief[]> {
  try {
    const office = `app.job_office(${lit(jobId)}::uuid)`
    const asking = projectId === null ? 'null' : `${lit(projectId)}::uuid`
    const reserved = (await db.execute(`select app.unnamed_project(${office})::text as p`))
      .rows[0] as { p?: string } | undefined
    const own = projectId !== null && projectId !== reserved?.p ? [projectId] : []
    const named = (
      await db.execute(
        `select project_id::text as project_id, name from app.projects_named_in(${office}, ${lit(question)}, ${asking})`,
      )
    ).rows as unknown as Named[]
    const ids = [
      ...own,
      ...named.map((n) => n.project_id).filter((id) => id !== projectId && id !== reserved?.p),
    ].slice(0, MAX_PROJECTS_OF_WORK)
    const out: WorkBrief[] = []
    for (const id of ids) {
      const r = await db.execute(
        `select app.project_work_brief(${office}, ${lit(id)}::uuid, 40, app.harness_job(${lit(jobId)}::uuid)) as b`,
      )
      const raw = (r.rows[0] as { b?: unknown } | undefined)?.b
      if (raw === null || raw === undefined) continue
      const brief = (typeof raw === 'string' ? JSON.parse(raw) : raw) as WorkBrief
      out.push({ ...brief, here: id === projectId })
    }
    return out
  } catch {
    return []
  }
}
