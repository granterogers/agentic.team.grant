/**
 * Carrying out a plan Grant approved.
 *
 * `src/agents/plan.ts` reads the instruction and writes the plan;
 * `office.instruction` shows it and holds it; 0087 turns a Go ahead into one
 * job of this kind carrying the plan in `pinned_config`. This is the part that
 * does it.
 *
 * ## Each step becomes a job, not a line of code
 *
 * The steps are `notebook.add_source`, `notebook.generate` and `notebook.ask`,
 * which already exist, are already metered against the notebook's allowance
 * (0078), and already gate generation behind its own approval (0083). A plan
 * executor that did the work itself would be a second implementation of all
 * three, and the first thing to drift would be the meter.
 *
 * So this schedules, and the steps run themselves.
 *
 * ## Ordering is a delay, and the delay is a guess
 *
 * A question about a video cannot be asked until Google has transcribed it, and
 * nothing tells us when that finished — `sources.list` reports a status, so the
 * ask step checks it and defers itself rather than trusting a timer. What is
 * scheduled here is a first attempt a few minutes out; the honesty is in the
 * step, not in the arithmetic.
 *
 * ## Creating a project creates three things
 *
 * A notebook in Google, a project row, and the attachment that ties them —
 * because "a new notebook project called AI Learning" is all three and Grant
 * should not have to make any of them by hand. The notebook is made FIRST: a
 * project with no attachment violates 0067's rule, so there would be nothing to
 * attach it to if the order were reversed.
 */

import type { Step } from '../agents/plan.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { NotebookActions } from '../notebook/actions.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Long enough for Google to transcribe a video; the step re-checks anyway. */
const FIRST_ASK_DELAY = '3 minutes'

const payloadOf = async (db: SqlExecutor, job: Job): Promise<Record<string, unknown>> => {
  const { rows } = await db.execute(
    `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
  )
  return ((rows[0] as { pinned_config?: Record<string, unknown> } | undefined)?.pinned_config ??
    {}) as Record<string, unknown>
}

const done = (body: string, sources: readonly string[]): HandlerOutput =>
  ({
    body,
    confidence: 'high',
    evidence: 'verified',
    sources,
    contradictions: null,
    path: 'deterministic_retrieval',
    model: null,
  }) satisfies HandlerOutput

export function planHandler(db: SqlExecutor): Handler {
  return {
    kind: 'office.execute_plan',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const payload = await payloadOf(db, job)
      const steps = (payload.plan_steps ?? []) as Step[]
      if (!Array.isArray(steps) || steps.length === 0) {
        throw new Error('this plan has no steps')
      }

      // The project every step belongs to. A `create_project` step replaces it;
      // otherwise it is the job's own, which `enqueue_inbound` set.
      let projectId = job.projectId
      let projectName = ''
      const said: string[] = []
      const references: string[] = []

      for (const step of steps) {
        if (step.kind === 'use_project') {
          // Already exists — ours, or one of Grant's the resolver matched by
          // name. Adopt it rather than making a second: `hq_create_project` is
          // idempotent on the slug, so a project we already run is found and a
          // notebook of his we have never seen gets a project around it.
          const { rows } = await db.execute(`
            select app.hq_create_project(
              ${lit(step.name)}, 'notebooklm', ${lit(step.notebookRef)}, ${lit(step.name)}
            ) as r
          `)
          const made = (rows[0] as { r: { error?: string; project_id?: string } }).r
          if (made.project_id !== undefined) projectId = String(made.project_id)
          else {
            const found = await db.execute(`
              select project_id::text as project_id from public.projects p
               join public.project_attachments a using (project_id)
               where a.external_ref = ${lit(step.notebookRef)} limit 1
            `)
            const row = found.rows[0] as { project_id?: string } | undefined
            if (row?.project_id === undefined) throw new Error(String(made.error))
            projectId = row.project_id
          }
          projectName = step.name
          said.push(`working in your existing “${step.name}”`)
          references.push(`notebooklm:${step.notebookRef} ${step.name}`)
          continue
        }

        if (step.kind === 'project') {
          // Unresolved: the handler is supposed to have decided before this ran.
          // Refusing beats guessing — guessing is what made the duplicate.
          throw new Error(
            `I do not know whether “${step.name}” already exists, and I am not going to guess`,
          )
        }

        if (step.kind === 'create_project') {
          const actions = await NotebookActions.fromVault(db)
          if (actions === null) {
            throw new Error('no NotebookLM credential in the vault; cannot make a notebook')
          }
          // The notebook first: 0067 refuses a project with no attachment, so
          // reversing this order leaves nothing to attach.
          const notebook = await actions.createNotebook(step.name)
          const { rows } = await db.execute(`
            select app.hq_create_project(
              ${lit(step.name)}, 'notebooklm', ${lit(notebook.id)}, ${lit(step.name)}
            ) as r
          `)
          const made = (rows[0] as { r: { error?: string; project_id?: string; slug?: string } }).r
          if (made.error !== undefined) throw new Error(String(made.error))
          projectId = String(made.project_id)
          projectName = step.name
          // Artifacts belong here too, not just documents. Without a `home`
          // the generate handler falls back to "any notebook source", which is
          // the same notebook today and would not be once a second is attached.
          await db.execute(`
            update public.project_attachments
               set role = 'home', artifact_kind = 'artifact'
             where project_id = ${lit(projectId)}::uuid and connector = 'notebooklm'
          `)
          said.push(`started “${step.name}” with a new notebook`)
          references.push(`notebooklm:${notebook.id} ${step.name}`)
          continue
        }

        if (projectId === null) throw new Error('no project to carry this plan out in')

        switch (step.kind) {
          case 'attach': {
            const { rows } = await db.execute(`
              select app.hq_attach(
                (select slug from public.projects where project_id = ${lit(projectId)}::uuid),
                ${lit(step.link.kind === 'notion' ? 'notion' : 'notebooklm')},
                ${lit(step.link.ref)},
                ${step.link.kind === 'notebooklm' ? "'home'" : "'source'"},
                ${step.link.kind === 'notebooklm' ? "'artifact'" : 'null'},
                null
              ) as r
            `)
            const r = (rows[0] as { r: { error?: string } }).r
            said.push(r.error === undefined ? 'attached it' : `could not attach it: ${r.error}`)
            break
          }

          case 'add_source': {
            await child(db, job, projectId, 'notebook.add_source', {
              url: step.link.url,
              kind: step.link.kind,
            })
            said.push(`sending ${step.link.url} to the notebook`)
            break
          }

          case 'generate': {
            // No delay and no silence: the generate handler asks Grant for
            // permission itself (0083), which is the message he gets next.
            await child(db, job, projectId, 'notebook.generate', { kind: step.artifact })
            said.push(`queued the ${step.artifact} — I will ask before making it`)
            break
          }

          case 'ask': {
            // After the sources, and the step checks their status before
            // answering rather than trusting this number.
            await child(
              db,
              job,
              projectId,
              'notebook.ask',
              { question: step.question, await_sources: true },
              FIRST_ASK_DELAY,
            )
            said.push('will read it and come back to you here')
            break
          }
        }
      }

      const list =
        said.length === 1
          ? (said[0] as string)
          : `${said.slice(0, -1).join(', ')}, and ${String(said.at(-1))}`
      return done(
        `Right — ${list}.` +
          (projectName === '' ? '' : ` Everything for this is under “${projectName}”.`),
        references.length > 0 ? references : [`job:${job.jobId}`],
      )
    },
  }
}

/**
 * One step, as a job on the right project.
 *
 * `enqueue_child` inherits the parent's project, and for a plan that created a
 * project the parent's is the wrong one — `enqueue_inbound` picked the most
 * recently updated active project for the message that started all this. So the
 * project is set explicitly afterwards, in the same statement.
 */
async function child(
  db: SqlExecutor,
  job: Job,
  projectId: string,
  kind: string,
  payload: Record<string, unknown>,
  delay = '0',
): Promise<void> {
  // The project as a PARAMETER (0090). The first version wrapped the enqueue in
  // a CTE and updated the row afterwards in the same statement — where the
  // UPDATE's snapshot predates the insert the CTE performed, so it matched
  // nothing, raised nothing, and left every step of the plan on the parent's
  // project. Grant's video went into the wrong notebook and both outputs read
  // as success.
  await db.execute(`
    select app.enqueue_child(
      ${lit(job.jobId)}::uuid, ${lit(kind)},
      ${lit(JSON.stringify(payload))}::jsonb,
      ${lit(delay)}::interval, true, ${lit(projectId)}::uuid
    )
  `)
}
